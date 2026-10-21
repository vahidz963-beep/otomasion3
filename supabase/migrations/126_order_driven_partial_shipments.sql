-- ============================================================================
-- 126_ORDER_DRIVEN_PARTIAL_SHIPMENTS
--
-- Non-destructive redesign of customer shipments:
--   * one order may have many partial shipments;
--   * stock leaves only when warehouse confirms a shipment;
--   * shipment, OUT document, kardex transaction and reservation consumption
--     are written in one database transaction;
--   * production completion only receives finished goods into warehouse;
--   * invoice approval reserves stock but never issues it;
--   * legacy duplicates/inferred rows are archived, never deleted;
--   * free-text manual shipment notes remain available and never change stock.
-- ============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- --------------------------------------------------------------------------
-- 0) Preconditions and stop every legacy auto-shipment producer first.
-- --------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.warehouse_shipments') is null
     or to_regclass('public.warehouse_documents') is null
     or to_regclass('public.order_inventory_reservations') is null then
    raise exception 'Migration 126 requires the existing orders/warehouse schema (through migration 125).';
  end if;
end $$;

drop trigger if exists trg_warehouse_shipment_sync on public.warehouse_documents;
drop trigger if exists trg_warehouse_order_final_shipment on public.orders;
drop trigger if exists trg_warehouse_production_final_shipment on public.production_orders;
drop trigger if exists trg_warehouse_rnd_final_shipment on public.rnd_projects;
drop trigger if exists trg_finance_issue_inventory_on_approval on public.finance_documents;
drop trigger if exists trg_finance_inventory_issue_after_approval on public.finance_documents;

-- --------------------------------------------------------------------------
-- 1) Shipment header extensions and immutable structured shipment lines.
-- --------------------------------------------------------------------------
alter table public.warehouse_shipments
  add column if not exists model_version integer,
  add column if not exists dispatch_idempotency_key text,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists reversal_warehouse_document_id uuid references public.warehouse_documents(id) on delete set null,
  add column if not exists legacy_stock_issued boolean not null default false;

-- Rows existing before this migration are version 1. New rows default to version 2.
update public.warehouse_shipments set model_version = 1 where model_version is null;
alter table public.warehouse_shipments alter column model_version set default 2;
alter table public.warehouse_shipments alter column model_version set not null;

create unique index if not exists uq_warehouse_shipment_dispatch_key
  on public.warehouse_shipments(related_order_id, dispatch_idempotency_key)
  where related_order_id is not null and dispatch_idempotency_key is not null;

create index if not exists idx_warehouse_shipments_order_status_date
  on public.warehouse_shipments(related_order_id, status, shipment_date desc, created_at desc);
create index if not exists idx_warehouse_shipments_sent_at
  on public.warehouse_shipments(sent_at desc)
  where sent_at is not null;

create table if not exists public.warehouse_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.warehouse_shipments(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  order_item_id uuid references public.order_items(id) on delete set null,
  warehouse_item_id uuid not null references public.warehouse_items(id),
  warehouse_document_line_id uuid references public.warehouse_document_lines(id) on delete set null,
  warehouse_transaction_id uuid references public.warehouse_transactions(id) on delete set null,
  reversal_warehouse_document_line_id uuid references public.warehouse_document_lines(id) on delete set null,
  reversal_warehouse_transaction_id uuid references public.warehouse_transactions(id) on delete set null,
  item_code_snapshot text not null,
  item_name_snapshot text not null,
  unit_snapshot text not null,
  quantity numeric not null check (quantity > 0),
  unit_value_snapshot numeric not null default 0 check (unit_value_snapshot >= 0),
  created_at timestamptz not null default now(),
  unique (shipment_id, line_no)
);

create index if not exists idx_warehouse_shipment_lines_shipment
  on public.warehouse_shipment_lines(shipment_id, line_no);
create index if not exists idx_warehouse_shipment_lines_order_item
  on public.warehouse_shipment_lines(order_item_id)
  where order_item_id is not null;
create index if not exists idx_warehouse_shipment_lines_item
  on public.warehouse_shipment_lines(warehouse_item_id);
create unique index if not exists uq_warehouse_shipment_line_document_line
  on public.warehouse_shipment_lines(warehouse_document_line_id)
  where warehouse_document_line_id is not null;
create unique index if not exists uq_warehouse_shipment_line_transaction
  on public.warehouse_shipment_lines(warehouse_transaction_id)
  where warehouse_transaction_id is not null;
create unique index if not exists uq_warehouse_shipment_line_reversal_transaction
  on public.warehouse_shipment_lines(reversal_warehouse_transaction_id)
  where reversal_warehouse_transaction_id is not null;

alter table public.warehouse_shipment_lines enable row level security;

drop policy if exists warehouse_shipment_lines_select on public.warehouse_shipment_lines;
create policy warehouse_shipment_lines_select on public.warehouse_shipment_lines
for select using (
  public.has_role(array['admin','warehouse','accountant','sales','sales_manager','production','rnd','office_admin'])
);

-- Structured lines are written only by the SECURITY DEFINER RPCs below.
revoke all on public.warehouse_shipment_lines from anon;
revoke insert, update, delete on public.warehouse_shipment_lines from authenticated;
grant select on public.warehouse_shipment_lines to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2) Non-destructive legacy classification, canonicalization and line backfill.
-- --------------------------------------------------------------------------
-- Attach every historic approved sales-invoice OUT document to one canonical
-- shipment. An unlinked inferred row may be reused; otherwise a new legacy
-- canonical header is inserted. No business row is deleted.
do $$
declare
  r record;
  v_shipment_id uuid;
begin
  for r in
    select
      fd.id as finance_document_id,
      fd.related_order_id,
      fd.warehouse_issue_document_id as warehouse_document_id,
      fd.issue_date,
      fd.total_amount,
      wd.finalized_at,
      o.order_code,
      o.sales_path::text as sales_path,
      c.company_name as customer_name,
      c.city as customer_city,
      fp.display_name as party_name
    from public.finance_documents fd
    join public.orders o on o.id = fd.related_order_id
    join public.warehouse_documents wd on wd.id = fd.warehouse_issue_document_id
    left join public.customers c on c.id = o.customer_id
    left join public.finance_parties fp on fp.id = fd.party_id
    where fd.document_type::text = 'sales_invoice'
      and fd.related_order_id is not null
      and fd.warehouse_issue_document_id is not null
      and wd.type::text = 'out'
      and wd.status::text = 'final'
    order by coalesce(wd.finalized_at, fd.created_at), fd.id
  loop
    v_shipment_id := null;

    select s.id into v_shipment_id
    from public.warehouse_shipments s
    where s.archived_at is null
      and (s.warehouse_document_id = r.warehouse_document_id
           or s.finance_document_id = r.finance_document_id)
    order by (s.warehouse_document_id = r.warehouse_document_id) desc,
             (s.finance_document_id = r.finance_document_id) desc,
             s.created_at
    limit 1;

    if v_shipment_id is null then
      select s.id into v_shipment_id
      from public.warehouse_shipments s
      where s.archived_at is null
        and s.related_order_id = r.related_order_id
        and s.warehouse_document_id is null
        and s.finance_document_id is null
        and s.model_version = 1
      order by (s.status in ('sent','delivered')) desc, s.updated_at desc, s.created_at desc
      limit 1;
    end if;

    if v_shipment_id is null then
      insert into public.warehouse_shipments (
        source_type, warehouse_document_id, finance_document_id, related_order_id,
        customer_name, customer_city, shipment_date, total_value, status,
        notes, created_by, model_version, sent_at, legacy_stock_issued
      ) values (
        case when r.sales_path in ('trading','production','rnd') then r.sales_path else 'other' end,
        r.warehouse_document_id, r.finance_document_id, r.related_order_id,
        coalesce(r.customer_name, r.party_name), r.customer_city,
        coalesce(r.finalized_at::date, r.issue_date, current_date),
        coalesce(r.total_amount, 0), 'sent',
        'بازسازی غیرمخرب از سند خروج نهایی فاکتور در Migration 126',
        (select created_by from public.warehouse_documents where id = r.warehouse_document_id),
        1, coalesce(r.finalized_at, now()), true
      ) returning id into v_shipment_id;
    else
      update public.warehouse_shipments
      set source_type = case when r.sales_path in ('trading','production','rnd') then r.sales_path else source_type end,
          warehouse_document_id = r.warehouse_document_id,
          finance_document_id = r.finance_document_id,
          related_order_id = r.related_order_id,
          customer_name = coalesce(r.customer_name, r.party_name, customer_name),
          customer_city = coalesce(r.customer_city, customer_city),
          shipment_date = coalesce(r.finalized_at::date, r.issue_date, shipment_date),
          total_value = greatest(coalesce(total_value, 0), coalesce(r.total_amount, 0)),
          status = 'sent',
          sent_at = coalesce(sent_at, r.finalized_at, updated_at, created_at, now()),
          legacy_stock_issued = true,
          notes = concat_ws(E'\n', notes, 'طبقه‌بندی به‌عنوان خروج واقعی سفارش در Migration 126'),
          updated_at = now()
      where id = v_shipment_id;
    end if;

    -- Any second row pointing to the exact same physical document/invoice is a
    -- presentation duplicate. Archive it while keeping its full history.
    update public.warehouse_shipments s
    set archived_at = coalesce(s.archived_at, now()),
        notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب: تکراری سند واقعی ' || r.warehouse_document_id::text),
        updated_at = now()
    where s.id <> v_shipment_id
      and s.archived_at is null
      and (s.warehouse_document_id = r.warehouse_document_id
           or s.finance_document_id = r.finance_document_id);
  end loop;
end $$;

-- Inferred ready rows from order/production/R&D had no proof of physical
-- dispatch. Hide them without changing or deleting their historical payload.
update public.warehouse_shipments s
set archived_at = coalesce(s.archived_at, now()),
    notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب در Migration 126: رکورد استنباطی بدون خروج واقعی'),
    updated_at = now()
where s.archived_at is null
  and s.model_version = 1
  and s.source_type in ('trading','production','rnd')
  and s.status in ('pending_warehouse','ready')
  and s.warehouse_document_id is null;

-- An invoice-only ready row is also inferred, not proof of handover. Approved
-- invoices now reserve inventory and the user creates the actual shipment later.
update public.warehouse_shipments s
set archived_at = coalesce(s.archived_at, now()),
    notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب در Migration 126: فاکتور بدون محموله و سند خروج واقعی'),
    updated_at = now()
where s.archived_at is null
  and s.model_version = 1
  and s.source_type = 'finance_invoice'
  and s.status in ('pending_warehouse','ready')
  and s.warehouse_document_id is null;

-- Generic internal OUT documents (production material, R&D usage, adjustments,
-- etc.) are not customer shipments.
update public.warehouse_shipments s
set archived_at = coalesce(s.archived_at, now()),
    notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب در Migration 126: سند خروج داخلی، نه ارسال مشتری'),
    updated_at = now()
where s.archived_at is null
  and s.model_version = 1
  and s.warehouse_document_id is not null
  and s.related_order_id is null
  and s.finance_document_id is null
  and s.status in ('pending_warehouse','ready')
  and not exists (
    select 1 from public.warehouse_document_lines wdl
    where wdl.document_id = s.warehouse_document_id
      and wdl.removed_at is null
      and wdl.reason = 'order_delivery'
  );

-- Once an order has a physical customer OUT document, an additional unlinked
-- version-1 row for that same order is an inferred duplicate from the old flow.
update public.warehouse_shipments s
set archived_at = coalesce(s.archived_at, now()),
    notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب در Migration 126: نسخه بدون سندِ یک محموله دارای سند خروج'),
    updated_at = now()
where s.archived_at is null
  and s.model_version = 1
  and s.related_order_id is not null
  and s.warehouse_document_id is null
  and exists (
    select 1 from public.warehouse_shipments physical
    where physical.archived_at is null
      and physical.related_order_id = s.related_order_id
      and physical.warehouse_document_id is not null
      and physical.id <> s.id
  );

-- Archive only exact-looking duplicate legacy rows without a physical document.
-- Different dates/tracking codes remain separate history.
with ranked as (
  select
    s.id,
    row_number() over (
      partition by s.related_order_id, s.status, coalesce(s.item_summary,''),
                   coalesce(s.total_quantity,0), s.shipment_date,
                   coalesce(s.tracking_code,''), coalesce(s.receiver_name,'')
      order by s.updated_at desc nulls last, s.created_at desc, s.id
    ) as rn
  from public.warehouse_shipments s
  where s.archived_at is null
    and s.model_version = 1
    and s.related_order_id is not null
    and s.warehouse_document_id is null
)
update public.warehouse_shipments s
set archived_at = now(),
    notes = concat_ws(E'\n', s.notes, 'بایگانی غیرمخرب در Migration 126: رکورد قدیمی تکراری'),
    updated_at = now()
from ranked r
where r.id = s.id and r.rn > 1;

-- A final order_delivery document is evidence that stock already left under the
-- legacy flow. Mark it sent so the new flow never deducts it for a second time.
update public.warehouse_shipments s
set status = 'sent',
    sent_at = coalesce(s.sent_at, wd.finalized_at, s.updated_at, s.created_at),
    legacy_stock_issued = true,
    updated_at = now()
from public.warehouse_documents wd
where wd.id = s.warehouse_document_id
  and s.archived_at is null
  and wd.type::text = 'out'
  and wd.status::text = 'final'
  and exists (
    select 1 from public.warehouse_document_lines wdl
    where wdl.document_id = wd.id
      and wdl.removed_at is null
      and wdl.reason = 'order_delivery'
  );

-- Materialize exact historic item rows from their OUT document lines.
insert into public.warehouse_shipment_lines (
  shipment_id, line_no, order_item_id, warehouse_item_id,
  warehouse_document_line_id, warehouse_transaction_id,
  item_code_snapshot, item_name_snapshot, unit_snapshot,
  quantity, unit_value_snapshot, created_at
)
select
  s.id,
  row_number() over (partition by s.id order by wdl.created_at, wdl.id),
  coalesce(fdi.order_item_id,oi.id),
  wi.id,
  wdl.id,
  wdl.tx_id,
  wi.item_code,
  wi.item_name_fa,
  coalesce(fdi.unit, oi.unit, wi.unit, 'عدد'),
  wdl.quantity,
  coalesce(fdi.unit_price, oi.unit_price, 0),
  coalesce(wdl.created_at, s.created_at)
from public.warehouse_shipments s
join public.warehouse_document_lines wdl
  on wdl.document_id = s.warehouse_document_id and wdl.removed_at is null
join public.warehouse_items wi on wi.id = wdl.item_id
left join lateral (
  select x.order_item_id, x.unit, x.unit_price
  from public.finance_document_items x
  where x.document_id = s.finance_document_id
    and x.warehouse_item_id = wi.id
    and x.order_item_id is not null
  order by abs(x.quantity - wdl.quantity), x.line_no, x.id
  limit 1
) fdi on true
left join lateral (
  select x.id, x.unit, x.unit_price
  from public.order_items x
  where x.order_id = s.related_order_id
    and (x.id = fdi.order_item_id or (fdi.order_item_id is null and x.warehouse_item_code = wi.item_code))
  order by (x.id = fdi.order_item_id) desc, x.created_at, x.id
  limit 1
) oi on true
where s.archived_at is null
  and s.warehouse_document_id is not null
  and not exists (
    select 1 from public.warehouse_shipment_lines existing
    where existing.warehouse_document_line_id = wdl.id
  )
on conflict do nothing;

-- Refresh legacy summaries only where exact lines now exist.
with aggregates as (
  select
    l.shipment_id,
    sum(l.quantity) as total_quantity,
    sum(l.quantity * l.unit_value_snapshot) as total_value,
    string_agg(
      l.item_name_snapshot || ' (' || l.item_code_snapshot || '): '
      || trim(to_char(l.quantity, 'FM999999999999990.########')) || ' ' || l.unit_snapshot,
      E'\n' order by l.line_no
    ) as item_summary
  from public.warehouse_shipment_lines l
  group by l.shipment_id
)
update public.warehouse_shipments s
set total_quantity = a.total_quantity,
    total_value = case when coalesce(s.total_value,0) > 0 then s.total_value else a.total_value end,
    item_summary = a.item_summary,
    updated_at = now()
from aggregates a
where a.shipment_id = s.id and s.model_version = 1;

-- --------------------------------------------------------------------------
-- 3) Header normalization and direct-write guard.
-- --------------------------------------------------------------------------
create or replace function public.fn_warehouse_shipment_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.status in ('sent','delivered') and new.sent_at is null then
    new.sent_at := now();
    new.sent_by := coalesce(new.sent_by, auth.uid());
  end if;

  if new.status in ('cancelled','returned') and new.cancelled_at is null then
    new.cancelled_at := now();
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  end if;

  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    new.archived_by := coalesce(new.archived_by, auth.uid());
  end if;

  return new;
end;
$$;

create or replace function public.fn_warehouse_shipment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_internal boolean := coalesce(current_setting('app.shipment_internal', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if not v_internal and (
      new.source_type <> 'manual'
      or new.related_order_id is not null
      or new.warehouse_document_id is not null
      or new.finance_document_id is not null
    ) then
      raise exception 'ارسال ساختاریافته فقط باید از سفارش و تابع ثبت قطعی ارسال ایجاد شود';
    end if;
    return new;
  end if;

  if not v_internal and (
    new.source_type is distinct from old.source_type
    or new.related_order_id is distinct from old.related_order_id
    or new.warehouse_document_id is distinct from old.warehouse_document_id
    or new.finance_document_id is distinct from old.finance_document_id
    or new.reversal_warehouse_document_id is distinct from old.reversal_warehouse_document_id
    or new.dispatch_idempotency_key is distinct from old.dispatch_idempotency_key
    or new.model_version is distinct from old.model_version
  ) then
    raise exception 'منبع و اتصال‌های محموله مستقیم قابل تغییر نیستند';
  end if;

  if not v_internal and (
    old.related_order_id is not null
    or old.warehouse_document_id is not null
    or old.finance_document_id is not null
    or old.source_type <> 'manual'
  ) then
    if new.status is distinct from old.status
       or new.shipment_date is distinct from old.shipment_date
       or new.item_summary is distinct from old.item_summary
       or new.total_quantity is distinct from old.total_quantity
       or new.total_value is distinct from old.total_value then
      raise exception 'اقلام و وضعیت ارسال سفارش مستقیم قابل ویرایش نیست؛ برای برگشت از عملیات برگشت ارسال استفاده کنید';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_warehouse_shipment_guard on public.warehouse_shipments;
create trigger trg_warehouse_shipment_guard
before insert or update on public.warehouse_shipments
for each row execute function public.fn_warehouse_shipment_guard();

drop trigger if exists trg_warehouse_shipment_normalize on public.warehouse_shipments;
create trigger trg_warehouse_shipment_normalize
before insert or update on public.warehouse_shipments
for each row execute function public.fn_warehouse_shipment_normalize();

-- A shipment-owned OUT document must never be cancelled from the generic
-- document screen because that would desynchronize shipment progress. The
-- auditable fn_reverse_order_shipment route must be used instead.
create or replace function public.fn_guard_shipment_warehouse_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status::text = 'final'
     and new.status::text = 'cancelled'
     and exists (
       select 1 from public.warehouse_shipments s
       where s.warehouse_document_id = old.id
     ) then
    raise exception 'این سند متعلق به محموله ثبت‌شده است؛ برگشت را از «مدیریت ارسال‌ها» انجام دهید';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_shipment_warehouse_document on public.warehouse_documents;
create trigger trg_guard_shipment_warehouse_document
before update of status on public.warehouse_documents
for each row execute function public.fn_guard_shipment_warehouse_document();

-- --------------------------------------------------------------------------
-- 4) Reservation synchronizer. It reserves only the still-unshipped quantity.
-- --------------------------------------------------------------------------
create or replace function public.fn_sync_order_inventory_reservations(
  p_order_id uuid,
  p_strict boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_primary_id uuid;
  v_reserved numeric;
  v_sent numeric;
  v_remaining numeric;
  v_current numeric;
  v_other_reserved numeric;
  v_synced integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','sales_manager','warehouse','accountant','production']) then
    raise exception 'دسترسی رزرو موجودی سفارش ندارید';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id and not coalesce(is_cancelled,false)) then
    if p_strict then raise exception 'سفارش فعال یافت نشد'; end if;
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-reservation:' || p_order_id::text, 126));

  -- Stable item locks serialize reservation and dispatch against concurrent users.
  perform 1
  from public.warehouse_items wi
  where wi.id in (
    select wi2.id
    from public.order_items oi
    join public.warehouse_items wi2 on wi2.item_code = oi.warehouse_item_code
    where oi.order_id = p_order_id
  )
  order by wi.id
  for update;

  for r in
    select oi.id as order_item_id, oi.item_name_fa, oi.quantity as ordered_quantity,
           oi.warehouse_item_code, wi.id as warehouse_item_id
    from public.order_items oi
    left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
    where oi.order_id = p_order_id
    order by wi.id nulls last, oi.id
  loop
    if r.warehouse_item_id is null then
      if p_strict then
        raise exception 'قلم «%» به کالای فعال انبار متصل نیست', r.item_name_fa;
      end if;
      continue;
    end if;

    select coalesce(sum(sl.quantity),0) into v_sent
    from public.warehouse_shipment_lines sl
    join public.warehouse_shipments s on s.id = sl.shipment_id
    where sl.order_item_id = r.order_item_id
      and s.status in ('sent','delivered');

    v_remaining := greatest(r.ordered_quantity - v_sent, 0);

    v_primary_id := null;
    select id into v_primary_id
    from public.order_inventory_reservations
    where order_item_id = r.order_item_id and status = 'reserved'
    order by reserved_at, id
    limit 1;

    select coalesce(sum(quantity),0) into v_reserved
    from public.order_inventory_reservations
    where order_item_id = r.order_item_id and status = 'reserved';

    -- Merge accidental duplicate active reservation rows non-destructively.
    if v_primary_id is not null then
      update public.order_inventory_reservations
      set status = 'released', released_at = now(),
          notes = concat_ws(E'\n', notes, 'ادغام رزرو تکراری در Migration 126')
      where order_item_id = r.order_item_id
        and status = 'reserved'
        and id <> v_primary_id;
      update public.order_inventory_reservations
      set quantity = v_reserved
      where id = v_primary_id;
    end if;

    if v_remaining <= 0 then
      update public.order_inventory_reservations
      set status = 'released', released_at = now(),
          notes = concat_ws(E'\n', notes, 'سفارش این قلم به‌طور کامل ارسال شده است')
      where order_item_id = r.order_item_id and status = 'reserved';
      continue;
    end if;

    select coalesce(current_qty,0) into v_current
    from public.v_warehouse_current_stock
    where item_id = r.warehouse_item_id;

    select coalesce(sum(quantity),0) into v_other_reserved
    from public.order_inventory_reservations
    where warehouse_item_id = r.warehouse_item_id
      and status = 'reserved'
      and order_item_id is distinct from r.order_item_id;

    if coalesce(v_current,0) - v_other_reserved < v_remaining then
      if p_strict then
        raise exception 'موجودی قابل رزرو قلم «%» کافی نیست. مانده سفارش: %، قابل رزرو: %',
          r.item_name_fa, v_remaining, greatest(coalesce(v_current,0) - v_other_reserved,0);
      end if;
      continue;
    end if;

    if v_primary_id is null then
      insert into public.order_inventory_reservations (
        order_id, order_item_id, warehouse_item_id, quantity, status, reserved_by, notes
      ) values (
        p_order_id, r.order_item_id, r.warehouse_item_id, v_remaining,
        'reserved', auth.uid(), 'رزرو خودکار مانده قابل ارسال سفارش'
      );
    else
      update public.order_inventory_reservations
      set warehouse_item_id = r.warehouse_item_id,
          quantity = v_remaining,
          released_at = null,
          notes = concat_ws(E'\n', notes, 'همگام‌سازی با مانده قابل ارسال سفارش')
      where id = v_primary_id;
    end if;
    v_synced := v_synced + 1;
  end loop;

  return v_synced;
end;
$$;

grant execute on function public.fn_sync_order_inventory_reservations(uuid,boolean) to authenticated, service_role;

-- Keep the existing public RPC name, but make it reserve the unshipped balance.
create or replace function public.fn_reserve_order_inventory(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  v_count := public.fn_sync_order_inventory_reservations(p_order_id, true);
  perform public.fn_log_order_event(
    p_order_id, 'warehouse', 'موجودی مانده سفارش رزرو شد',
    v_count::text || ' قلم با مانده قابل ارسال همگام شد'
  );
  return v_count;
end;
$$;

grant execute on function public.fn_reserve_order_inventory(uuid) to authenticated, service_role;

create or replace function public.fn_sync_order_reservation_for_finance_document(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales','sales_manager','warehouse']) then
    raise exception 'دسترسی همگام‌سازی رزرو فاکتور ندارید';
  end if;

  select id, related_order_id, document_type::text as document_type, status::text as status
  into v_doc
  from public.finance_documents
  where id = p_document_id;

  if not found then raise exception 'فاکتور یافت نشد'; end if;
  if v_doc.document_type <> 'sales_invoice' or v_doc.related_order_id is null then return 0; end if;
  if v_doc.status not in ('approved','sent','partially_paid','paid') then return 0; end if;

  return public.fn_sync_order_inventory_reservations(v_doc.related_order_id, false);
end;
$$;

grant execute on function public.fn_sync_order_reservation_for_finance_document(uuid) to authenticated, service_role;

-- Old/cached clients may still call the legacy issue RPC. Preserve its signature
-- but change its behavior to reservation-only so invoice approval cannot issue
-- stock or create a customer shipment anymore.
create or replace function public.fn_finance_issue_inventory_for_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_sync_order_reservation_for_finance_document(p_document_id);
  return null;
end;
$$;

grant execute on function public.fn_finance_issue_inventory_for_document(uuid) to authenticated, service_role;

create or replace function public.fn_finance_reissue_inventory_for_document(
  p_document_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  perform public.fn_sync_order_reservation_for_finance_document(p_document_id);
  select warehouse_issue_document_id into v_existing
  from public.finance_documents where id = p_document_id;
  return v_existing;
end;
$$;

grant execute on function public.fn_finance_reissue_inventory_for_document(uuid,text) to authenticated, service_role;

-- Voiding a financial document must not silently change physical stock. If goods
-- are still sent, require the auditable shipment reversal first. Once reversed,
-- the invoice may be voided and the warehouse documents remain as history.
create or replace function public.fn_void_finance_document(
  p_document_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status public.finance_document_status;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ابطال سند مالی ندارید';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'ثبت دلیل ابطال الزامی است';
  end if;

  select status into v_old_status
  from public.finance_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'سند مالی یافت نشد'; end if;

  if exists (
    select 1 from public.warehouse_shipments s
    where s.finance_document_id = p_document_id
      and s.status in ('sent','delivered')
  ) then
    raise exception 'برای ابطال فاکتور، ابتدا همه محموله‌های ارسال‌شده آن را از «مدیریت ارسال‌ها» برگشت دهید';
  end if;

  update public.finance_documents
  set status = 'void',
      void_reason = trim(p_reason),
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = p_document_id;

  perform public.fn_log_finance_document_event(
    p_document_id, 'voided', 'سند باطل شد: ' || trim(p_reason),
    v_old_status, 'void'
  );
end;
$$;

grant execute on function public.fn_void_finance_document(uuid,text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5) One atomic RPC for a real partial/full order dispatch.
-- --------------------------------------------------------------------------
create or replace function public.fn_dispatch_order_shipment(
  p_order_id uuid,
  p_lines jsonb,
  p_shipment_date date default null,
  p_carton_count numeric default 0,
  p_carrier_name text default null,
  p_tracking_code text default null,
  p_receiver_name text default null,
  p_notes text default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_invoice_id uuid;
  v_actor uuid := auth.uid();
  v_existing uuid;
  v_document_id uuid;
  v_document_number text;
  v_shipment_id uuid;
  v_line record;
  v_group record;
  v_sent numeric;
  v_remaining numeric;
  v_current numeric;
  v_other_reserved numeric;
  v_tx_id uuid;
  v_document_line_id uuid;
  v_reservation record;
  v_request_count integer;
  v_valid_count integer;
  v_line_no integer := 0;
  v_summary text;
  v_total_quantity numeric;
  v_total_value numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','warehouse']) then
    raise exception 'ثبت قطعی ارسال و خروج موجودی فقط برای مدیر یا انبار مجاز است';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'ساختار اقلام ارسال معتبر نیست';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'حداقل یک قلم با تعداد مثبت برای ارسال انتخاب کنید';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where nullif(e->>'order_item_id','') is null
       or coalesce((e->>'quantity')::numeric,0) <= 0
  ) then
    raise exception 'شناسه قلم و تعداد مثبت برای تمام ردیف‌های ارسال الزامی است';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-dispatch:' || p_order_id::text, 126));

  if nullif(trim(coalesce(p_idempotency_key,'')), '') is not null then
    select id into v_existing
    from public.warehouse_shipments
    where related_order_id = p_order_id
      and dispatch_idempotency_key = trim(p_idempotency_key)
    limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;

  select
    o.id, o.order_code, o.sales_path::text as sales_path,
    o.is_cancelled, o.current_stage,
    c.company_name as customer_name, c.city as customer_city
  into v_order
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.id = p_order_id
  for update of o;

  if not found then raise exception 'سفارش یافت نشد'; end if;
  if coalesce(v_order.is_cancelled,false) or v_order.current_stage = 'cancelled' then
    raise exception 'سفارش لغوشده قابل ارسال نیست';
  end if;

  select fd.id into v_invoice_id
  from public.finance_documents fd
  where fd.related_order_id = p_order_id
    and fd.document_type::text = 'sales_invoice'
    and fd.status::text in ('approved','sent','partially_paid','paid')
  order by fd.updated_at desc nulls last, fd.created_at desc
  limit 1;

  if v_invoice_id is null then
    raise exception 'ابتدا فاکتور فروش نهایی سفارش را تأیید کنید';
  end if;

  -- Best effort reservation of all currently available remaining items.
  perform public.fn_sync_order_inventory_reservations(p_order_id, false);

  with request_rows as (
    select (e->>'order_item_id')::uuid as order_item_id,
           sum((e->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_lines) e
    group by (e->>'order_item_id')::uuid
  )
  select count(*) into v_request_count from request_rows;

  with request_rows as (
    select (e->>'order_item_id')::uuid as order_item_id,
           sum((e->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_lines) e
    group by (e->>'order_item_id')::uuid
  )
  select count(*) into v_valid_count
  from request_rows r
  join public.order_items oi on oi.id = r.order_item_id and oi.order_id = p_order_id;

  if v_request_count <> v_valid_count then
    raise exception 'یک یا چند قلم انتخاب‌شده متعلق به این سفارش نیست';
  end if;

  -- Lock every physical stock item in UUID order to avoid deadlocks.
  perform 1
  from public.warehouse_items wi
  where wi.id in (
    with request_rows as (
      select (e->>'order_item_id')::uuid as order_item_id
      from jsonb_array_elements(p_lines) e
    )
    select wi2.id
    from request_rows r
    join public.order_items oi on oi.id = r.order_item_id and oi.order_id = p_order_id
    join public.warehouse_items wi2 on wi2.item_code = oi.warehouse_item_code
  )
  order by wi.id
  for update;

  -- Validate item mapping and per-order-line remaining quantities.
  for v_line in
    with request_rows as (
      select (e->>'order_item_id')::uuid as order_item_id,
             sum((e->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lines) e
      group by (e->>'order_item_id')::uuid
    )
    select r.quantity as dispatch_quantity,
           oi.id as order_item_id, oi.item_name_fa, oi.quantity as ordered_quantity,
           oi.warehouse_item_code, oi.unit, oi.unit_price,
           wi.id as warehouse_item_id, wi.item_code, wi.item_name_fa as warehouse_item_name,
           wi.unit as warehouse_unit
    from request_rows r
    join public.order_items oi on oi.id = r.order_item_id and oi.order_id = p_order_id
    left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
    order by wi.id nulls last, oi.id
  loop
    if v_line.warehouse_item_id is null then
      raise exception 'قلم «%» به کالای فعال انبار متصل نیست', v_line.item_name_fa;
    end if;

    select coalesce(sum(sl.quantity),0) into v_sent
    from public.warehouse_shipment_lines sl
    join public.warehouse_shipments s on s.id = sl.shipment_id
    where sl.order_item_id = v_line.order_item_id
      and s.status in ('sent','delivered');

    v_remaining := greatest(v_line.ordered_quantity - v_sent, 0);
    if v_line.dispatch_quantity > v_remaining then
      raise exception 'تعداد ارسال قلم «%» از مانده سفارش بیشتر است. مانده: %',
        v_line.item_name_fa, v_remaining;
    end if;
  end loop;

  -- Validate aggregate physical stock while excluding reservations belonging to
  -- other orders/quotes. Own reservations are intentionally available here.
  for v_group in
    with request_rows as (
      select (e->>'order_item_id')::uuid as order_item_id,
             sum((e->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lines) e
      group by (e->>'order_item_id')::uuid
    )
    select wi.id as warehouse_item_id, wi.item_name_fa,
           sum(r.quantity) as dispatch_quantity
    from request_rows r
    join public.order_items oi on oi.id = r.order_item_id and oi.order_id = p_order_id
    join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
    group by wi.id, wi.item_name_fa
    order by wi.id
  loop
    select coalesce(current_qty,0) into v_current
    from public.v_warehouse_current_stock
    where item_id = v_group.warehouse_item_id;

    select coalesce(sum(r.quantity),0) into v_other_reserved
    from public.order_inventory_reservations r
    where r.warehouse_item_id = v_group.warehouse_item_id
      and r.status = 'reserved'
      and not coalesce(
        r.order_id = p_order_id
        and exists (
          select 1 from jsonb_array_elements(p_lines) e
          where (e->>'order_item_id')::uuid = r.order_item_id
        ),
        false
      );

    if coalesce(v_current,0) - v_other_reserved < v_group.dispatch_quantity then
      raise exception 'موجودی قابل ارسال «%» کافی نیست. درخواست: %، قابل ارسال: %',
        v_group.item_name_fa, v_group.dispatch_quantity,
        greatest(coalesce(v_current,0) - v_other_reserved,0);
    end if;
  end loop;

  if v_actor is null then
    select id into v_actor from public.profiles order by id limit 1;
  end if;
  if v_actor is null then raise exception 'کاربر ثبت‌کننده ارسال یافت نشد'; end if;

  v_document_number := 'OUT-' || to_char(current_date, 'YYYYMMDD') || '-'
    || lpad(nextval('public.warehouse_out_doc_seq')::text, 5, '0');

  insert into public.warehouse_documents (
    doc_number, type, status, created_by, finalized_at, note,
    customer_name, customer_city, document_kind
  ) values (
    v_document_number, 'out'::public.warehouse_document_type,
    'final'::public.warehouse_document_status, v_actor, now(),
    'خروج قطعی بابت ارسال سفارش ' || v_order.order_code,
    v_order.customer_name, v_order.customer_city, 'movement'
  ) returning id into v_document_id;

  perform set_config('app.shipment_internal', '1', true);

  insert into public.warehouse_shipments (
    source_type, warehouse_document_id, finance_document_id, related_order_id,
    customer_name, customer_city, shipment_date, carton_count,
    carrier_name, tracking_code, receiver_name, status, notes,
    created_by, model_version, dispatch_idempotency_key, sent_at, sent_by
  ) values (
    case when v_order.sales_path in ('trading','production','rnd') then v_order.sales_path else 'other' end,
    v_document_id, v_invoice_id, p_order_id,
    v_order.customer_name, v_order.customer_city,
    coalesce(p_shipment_date,current_date), greatest(coalesce(p_carton_count,0),0),
    nullif(trim(coalesce(p_carrier_name,'')),''),
    nullif(trim(coalesce(p_tracking_code,'')),''),
    nullif(trim(coalesce(p_receiver_name,'')),''),
    'sent', nullif(trim(coalesce(p_notes,'')),''),
    v_actor, 2, nullif(trim(coalesce(p_idempotency_key,'')),''), now(), v_actor
  ) returning id into v_shipment_id;

  for v_line in
    with request_rows as (
      select (e->>'order_item_id')::uuid as order_item_id,
             sum((e->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lines) e
      group by (e->>'order_item_id')::uuid
    )
    select r.quantity as dispatch_quantity,
           oi.id as order_item_id, oi.item_name_fa, oi.unit, oi.unit_price,
           wi.id as warehouse_item_id, wi.item_code,
           wi.item_name_fa as warehouse_item_name, wi.unit as warehouse_unit
    from request_rows r
    join public.order_items oi on oi.id = r.order_item_id and oi.order_id = p_order_id
    join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
    order by wi.id, oi.id
  loop
    v_line_no := v_line_no + 1;

    insert into public.warehouse_transactions (
      item_id, transaction_type, quantity, reference_type, reference_id,
      created_by, note, document_id
    ) values (
      v_line.warehouse_item_id, 'issue'::public.warehouse_transaction_type,
      v_line.dispatch_quantity, 'order_shipment', v_shipment_id,
      v_actor, 'ارسال سفارش ' || v_order.order_code, v_document_id
    ) returning id into v_tx_id;

    insert into public.warehouse_document_lines (
      document_id, item_id, quantity, reason, note, tx_id
    ) values (
      v_document_id, v_line.warehouse_item_id, v_line.dispatch_quantity,
      'order_delivery', 'ارسال سفارش ' || v_order.order_code, v_tx_id
    ) returning id into v_document_line_id;

    insert into public.warehouse_shipment_lines (
      shipment_id, line_no, order_item_id, warehouse_item_id,
      warehouse_document_line_id, warehouse_transaction_id,
      item_code_snapshot, item_name_snapshot, unit_snapshot,
      quantity, unit_value_snapshot
    ) values (
      v_shipment_id, v_line_no, v_line.order_item_id, v_line.warehouse_item_id,
      v_document_line_id, v_tx_id,
      v_line.item_code, coalesce(v_line.warehouse_item_name,v_line.item_name_fa),
      coalesce(v_line.unit,v_line.warehouse_unit,'عدد'),
      v_line.dispatch_quantity, greatest(coalesce(v_line.unit_price,0),0)
    );

    select * into v_reservation
    from public.order_inventory_reservations
    where order_item_id = v_line.order_item_id and status = 'reserved'
    order by reserved_at, id
    limit 1
    for update;

    if found and v_reservation.quantity > v_line.dispatch_quantity then
      update public.order_inventory_reservations
      set quantity = quantity - v_line.dispatch_quantity,
          notes = concat_ws(E'\n', notes, 'مصرف بخشی از رزرو در ارسال ' || v_shipment_id::text)
      where id = v_reservation.id;

      insert into public.order_inventory_reservations (
        order_id, order_item_id, warehouse_item_id, quantity, status,
        reserved_by, reserved_at, consumed_at, warehouse_transaction_id, notes
      ) values (
        p_order_id, v_line.order_item_id, v_line.warehouse_item_id,
        v_line.dispatch_quantity, 'consumed',
        coalesce(v_reservation.reserved_by,v_actor), v_reservation.reserved_at,
        now(), v_tx_id, 'مصرف رزرو در ارسال ' || v_shipment_id::text
      );
    elsif found then
      update public.order_inventory_reservations
      set quantity = v_line.dispatch_quantity,
          status = 'consumed', consumed_at = now(),
          warehouse_transaction_id = v_tx_id,
          notes = concat_ws(E'\n', notes, 'مصرف رزرو در ارسال ' || v_shipment_id::text)
      where id = v_reservation.id;
    else
      insert into public.order_inventory_reservations (
        order_id, order_item_id, warehouse_item_id, quantity, status,
        reserved_by, reserved_at, consumed_at, warehouse_transaction_id, notes
      ) values (
        p_order_id, v_line.order_item_id, v_line.warehouse_item_id,
        v_line.dispatch_quantity, 'consumed', v_actor, now(), now(), v_tx_id,
        'ثبت مصرف مستقیم هنگام ارسال اتمیک؛ رزرو فعال قبلی موجود نبود'
      );
    end if;
  end loop;

  select
    sum(quantity),
    sum(quantity * unit_value_snapshot),
    string_agg(
      item_name_snapshot || ' (' || item_code_snapshot || '): '
      || trim(to_char(quantity, 'FM999999999999990.########')) || ' ' || unit_snapshot,
      E'\n' order by line_no
    )
  into v_total_quantity, v_total_value, v_summary
  from public.warehouse_shipment_lines
  where shipment_id = v_shipment_id;

  update public.warehouse_shipments
  set total_quantity = coalesce(v_total_quantity,0),
      total_value = coalesce(v_total_value,0),
      item_summary = v_summary,
      updated_at = now()
  where id = v_shipment_id;

  perform public.fn_log_order_event(
    p_order_id, 'warehouse', 'ارسال سفارش ثبت شد',
    'محموله ' || (select shipment_number from public.warehouse_shipments where id = v_shipment_id)
      || ' با ' || v_line_no::text || ' قلم و سند خروج ' || v_document_number,
    null, null,
    jsonb_build_object('shipment_id',v_shipment_id,'warehouse_document_id',v_document_id)
  );

  return v_shipment_id;
end;
$$;

grant execute on function public.fn_dispatch_order_shipment(uuid,jsonb,date,numeric,text,text,text,text,text)
  to authenticated, service_role;

-- The old checkbox RPC cannot safely infer partial quantities. Fail explicitly
-- for cached frontends instead of issuing or cancelling stock.
create or replace function public.fn_toggle_order_shipment(
  p_order_id uuid,
  p_enabled boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'صفحه سفارش قدیمی است؛ صفحه را تازه‌سازی کنید و از «ثبت ارسال» با اقلام و تعداد استفاده کنید';
end;
$$;

grant execute on function public.fn_toggle_order_shipment(uuid,boolean) to authenticated;

-- --------------------------------------------------------------------------
-- 6) Auditable reversal for an erroneous structured shipment.
-- --------------------------------------------------------------------------
create or replace function public.fn_reverse_order_shipment(
  p_shipment_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.warehouse_shipments%rowtype;
  v_actor uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_line record;
  v_tx_id uuid;
  v_document_line_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','warehouse']) then
    raise exception 'برگشت ارسال فقط برای مدیر یا انبار مجاز است';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'ثبت دلیل برگشت ارسال الزامی است';
  end if;

  select * into v_shipment
  from public.warehouse_shipments
  where id = p_shipment_id
  for update;

  if not found then raise exception 'ارسال یافت نشد'; end if;
  if v_shipment.status not in ('sent','delivered') then
    raise exception 'فقط ارسال ثبت‌شده/تحویل‌شده قابل برگشت است';
  end if;

  if v_actor is null then select id into v_actor from public.profiles order by id limit 1; end if;

  -- Free-text manual shipment rows never changed inventory; cancelling them must
  -- not create an artificial warehouse receipt.
  if v_shipment.warehouse_document_id is null
     and not exists (select 1 from public.warehouse_shipment_lines where shipment_id = p_shipment_id) then
    perform set_config('app.shipment_internal', '1', true);
    update public.warehouse_shipments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
        cancellation_reason = trim(p_reason),
        notes = concat_ws(E'\n', notes, 'لغو ثبت دستی: ' || trim(p_reason)),
        updated_at = now()
    where id = p_shipment_id;
    return null;
  end if;

  if not exists (select 1 from public.warehouse_shipment_lines where shipment_id = p_shipment_id) then
    raise exception 'اقلام ساختاریافته این ارسال برای برگشت موجود نیست';
  end if;

  v_document_number := 'IN-' || to_char(current_date, 'YYYYMMDD') || '-'
    || lpad(nextval('public.warehouse_in_doc_seq')::text, 5, '0');

  insert into public.warehouse_documents (
    doc_number, type, status, created_by, finalized_at, note,
    customer_name, customer_city, document_kind
  ) values (
    v_document_number, 'in'::public.warehouse_document_type,
    'final'::public.warehouse_document_status, v_actor, now(),
    'برگشت ارسال ' || coalesce(v_shipment.shipment_number,p_shipment_id::text)
      || ': ' || trim(p_reason),
    v_shipment.customer_name, v_shipment.customer_city, 'movement'
  ) returning id into v_document_id;

  for v_line in
    select * from public.warehouse_shipment_lines
    where shipment_id = p_shipment_id
    order by line_no
    for update
  loop
    if v_line.reversal_warehouse_transaction_id is not null then
      raise exception 'این ارسال قبلاً به موجودی برگشت داده شده است';
    end if;

    insert into public.warehouse_transactions (
      item_id, transaction_type, quantity, reference_type, reference_id,
      created_by, note, document_id
    ) values (
      v_line.warehouse_item_id, 'reversal'::public.warehouse_transaction_type,
      v_line.quantity, 'shipment_reversal', p_shipment_id,
      v_actor, trim(p_reason), v_document_id
    ) returning id into v_tx_id;

    insert into public.warehouse_document_lines (
      document_id, item_id, quantity, reason, note, tx_id
    ) values (
      v_document_id, v_line.warehouse_item_id, v_line.quantity,
      'shipment_reversal', trim(p_reason), v_tx_id
    ) returning id into v_document_line_id;

    update public.warehouse_shipment_lines
    set reversal_warehouse_document_line_id = v_document_line_id,
        reversal_warehouse_transaction_id = v_tx_id
    where id = v_line.id;
  end loop;

  perform set_config('app.shipment_internal', '1', true);
  update public.warehouse_shipments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
      cancellation_reason = trim(p_reason),
      reversal_warehouse_document_id = v_document_id,
      notes = concat_ws(E'\n', notes, 'برگشت موجودی با سند ' || v_document_number || ': ' || trim(p_reason)),
      updated_at = now()
  where id = p_shipment_id;

  if v_shipment.related_order_id is not null then
    perform public.fn_sync_order_inventory_reservations(v_shipment.related_order_id, false);
    perform public.fn_log_order_event(
      v_shipment.related_order_id, 'warehouse', 'ارسال برگشت داده شد',
      coalesce(v_shipment.shipment_number,p_shipment_id::text) || ' · ' || trim(p_reason),
      null, null,
      jsonb_build_object('shipment_id',p_shipment_id,'reversal_document_id',v_document_id)
    );
  end if;

  return v_document_id;
end;
$$;

grant execute on function public.fn_reverse_order_shipment(uuid,text) to authenticated, service_role;

create or replace function public.fn_archive_warehouse_shipment(
  p_shipment_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی بایگانی ارسال ندارید';
  end if;

  update public.warehouse_shipments
  set archived_at = coalesce(archived_at,now()),
      archived_by = coalesce(archived_by,auth.uid()),
      notes = concat_ws(E'\n', notes, coalesce(nullif(trim(p_reason),''),'بایگانی از فهرست ارسال‌ها')),
      updated_at = now()
  where id = p_shipment_id
  returning id into v_id;

  if v_id is null then raise exception 'ارسال یافت نشد'; end if;
  return v_id;
end;
$$;

grant execute on function public.fn_archive_warehouse_shipment(uuid,text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 7) Reservation-only lifecycle triggers; no automatic customer shipments.
-- --------------------------------------------------------------------------
create or replace function public.fn_finance_reserve_order_inventory_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_type::text = 'sales_invoice' and new.related_order_id is not null then
    if new.status::text in ('approved','sent','partially_paid','paid') then
      perform public.fn_sync_order_inventory_reservations(new.related_order_id, false);
    elsif new.status::text in ('cancelled','void') then
      if exists (
        select 1 from public.warehouse_shipments s
        where s.finance_document_id = new.id
          and s.status in ('sent','delivered')
      ) then
        raise exception 'برای لغو/ابطال فاکتور، ابتدا همه محموله‌های فعال آن را از «مدیریت ارسال‌ها» برگشت دهید';
      end if;

      if not exists (
        select 1 from public.finance_documents d
        where d.related_order_id = new.related_order_id
          and d.id <> new.id
          and d.document_type::text = 'sales_invoice'
          and d.status::text in ('approved','sent','partially_paid','paid')
      ) then
        update public.order_inventory_reservations
        set status = 'released', released_at = now(),
            notes = concat_ws(E'\n', notes, 'آزادسازی پس از ابطال/لغو فاکتور')
        where order_id = new.related_order_id and status = 'reserved';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_reserve_order_inventory on public.finance_documents;
create trigger trg_finance_reserve_order_inventory
after insert or update of status, related_order_id on public.finance_documents
for each row execute function public.fn_finance_reserve_order_inventory_trigger();

create or replace function public.fn_production_reserve_finished_order_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_order_id is not null
     and new.status::text in ('completed','delivered_to_warehouse') then
    perform public.fn_sync_order_inventory_reservations(new.source_order_id, false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_production_reserve_finished_order on public.production_orders;
create trigger trg_production_reserve_finished_order
after insert or update of status, quantity_produced on public.production_orders
for each row execute function public.fn_production_reserve_finished_order_trigger();

create or replace function public.fn_order_release_reservation_on_cancel_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_cancelled,false) and not coalesce(old.is_cancelled,false) then
    update public.order_inventory_reservations
    set status = 'released', released_at = now(),
        notes = concat_ws(E'\n', notes, 'آزادسازی رزرو به دلیل لغو سفارش')
    where order_id = new.id and status = 'reserved';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_release_reservation_on_cancel on public.orders;
create trigger trg_order_release_reservation_on_cancel
after update of is_cancelled on public.orders
for each row execute function public.fn_order_release_reservation_on_cancel_trigger();

-- Defensive no-op definitions: even if an old trigger is recreated by a stale
-- deployment, final order/production/R&D/document events still cannot create a
-- customer shipment automatically.
create or replace function public.fn_warehouse_shipment_sync_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin return new; end; $$;
create or replace function public.fn_warehouse_order_final_shipment_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin return new; end; $$;
create or replace function public.fn_warehouse_production_final_shipment_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin return new; end; $$;
create or replace function public.fn_warehouse_rnd_final_shipment_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin return new; end; $$;

-- Legacy upsert RPCs remain only for historical function dependencies; clients
-- can no longer invoke them to create inferred customer shipments.
revoke execute on function public.fn_warehouse_upsert_ready_shipment(text,uuid,uuid,text,text,text,numeric,numeric,text) from public, anon, authenticated;
revoke execute on function public.fn_warehouse_upsert_shipment_from_document(uuid) from public, anon, authenticated;
revoke execute on function public.fn_warehouse_upsert_shipment_from_order(uuid) from public, anon, authenticated;
revoke execute on function public.fn_warehouse_upsert_shipment_from_production(uuid) from public, anon, authenticated;
revoke execute on function public.fn_warehouse_upsert_shipment_from_rnd(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 8) Read models: every physical shipment is one row; no DISTINCT ON by order.
-- --------------------------------------------------------------------------
drop view if exists public.v_order_shipment_item_progress;
drop view if exists public.v_warehouse_shipment_overview;

create view public.v_warehouse_shipment_overview
with (security_invoker = true)
as
select
  s.id,
  s.shipment_number,
  s.source_type,
  s.warehouse_document_id,
  s.finance_document_id,
  s.related_order_id,
  coalesce(s.customer_name,c.company_name,fp.display_name) as customer_name,
  coalesce(s.customer_city,c.city) as customer_city,
  s.shipment_date,
  s.item_summary,
  s.total_quantity,
  s.carton_count,
  s.total_value,
  s.carrier_name,
  s.tracking_code,
  s.receiver_name,
  s.status,
  s.notes,
  s.created_by,
  s.created_at,
  s.updated_at,
  s.model_version,
  s.dispatch_idempotency_key,
  s.sent_at,
  s.sent_by,
  s.cancelled_at,
  s.cancelled_by,
  s.cancellation_reason,
  s.reversal_warehouse_document_id,
  s.legacy_stock_issued,
  wd.doc_number as warehouse_doc_number,
  rwd.doc_number as reversal_warehouse_doc_number,
  fd.doc_number as finance_doc_number,
  o.order_code,
  o.sales_path::text as order_sales_path,
  fp.display_name as party_name,
  c.customer_code,
  exists (
    select 1 from public.warehouse_shipment_lines x where x.shipment_id = s.id
  ) as is_structured,
  (s.source_type = 'manual' and s.related_order_id is null and s.warehouse_document_id is null) as is_manual_record,
  (select count(*) from public.warehouse_shipment_lines x where x.shipment_id = s.id) as line_count,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',x.id,
        'line_no',x.line_no,
        'order_item_id',x.order_item_id,
        'warehouse_item_id',x.warehouse_item_id,
        'item_code',x.item_code_snapshot,
        'item_name',x.item_name_snapshot,
        'unit',x.unit_snapshot,
        'quantity',x.quantity,
        'warehouse_transaction_id',x.warehouse_transaction_id
      ) order by x.line_no
    )
    from public.warehouse_shipment_lines x
    where x.shipment_id = s.id
  ), '[]'::jsonb) as line_items
from public.warehouse_shipments s
left join public.warehouse_documents wd on wd.id = s.warehouse_document_id
left join public.warehouse_documents rwd on rwd.id = s.reversal_warehouse_document_id
left join public.finance_documents fd on fd.id = s.finance_document_id
left join public.orders o on o.id = s.related_order_id
left join public.customers c on c.id = o.customer_id
left join public.finance_parties fp on fp.id = fd.party_id
where s.archived_at is null;

create view public.v_order_shipment_item_progress
with (security_invoker = true)
as
with sent as (
  select sl.order_item_id, sum(sl.quantity) as sent_quantity
  from public.warehouse_shipment_lines sl
  join public.warehouse_shipments s on s.id = sl.shipment_id
  where sl.order_item_id is not null
    and s.status in ('sent','delivered')
  group by sl.order_item_id
), own_reservation as (
  select order_item_id, sum(quantity) as reserved_quantity
  from public.order_inventory_reservations
  where order_item_id is not null and status = 'reserved'
  group by order_item_id
), other_reservation as (
  select oi.id as order_item_id, coalesce(sum(r.quantity),0) as other_reserved_quantity
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  left join public.order_inventory_reservations r
    on r.warehouse_item_id = wi.id
   and r.status = 'reserved'
   and r.order_item_id is distinct from oi.id
  group by oi.id
)
select
  oi.order_id,
  oi.id as order_item_id,
  oi.item_name_fa,
  oi.warehouse_item_code,
  wi.id as warehouse_item_id,
  oi.quantity as ordered_quantity,
  coalesce(se.sent_quantity,0) as sent_quantity,
  greatest(oi.quantity - coalesce(se.sent_quantity,0),0) as remaining_quantity,
  coalesce(orv.reserved_quantity,0) as reserved_quantity,
  coalesce(st.current_qty,0) as current_stock_quantity,
  greatest(coalesce(st.current_qty,0) - coalesce(oth.other_reserved_quantity,0),0) as available_to_this_line,
  coalesce(oi.unit,wi.unit,'عدد') as unit,
  (wi.id is not null) as is_warehouse_mapped,
  exists (
    select 1 from public.finance_documents fd
    where fd.related_order_id = oi.order_id
      and fd.document_type::text = 'sales_invoice'
      and fd.status::text in ('approved','sent','partially_paid','paid')
  ) as has_approved_invoice
from public.order_items oi
left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
left join public.v_warehouse_current_stock st on st.item_id = wi.id
left join sent se on se.order_item_id = oi.id
left join own_reservation orv on orv.order_item_id = oi.id
left join other_reservation oth on oth.order_item_id = oi.id;

grant select on public.v_warehouse_shipment_overview to authenticated, service_role;
grant select on public.v_order_shipment_item_progress to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
