-- ============================================================================
-- 127_UI_SEARCH_ORDER_AND_SAFE_FINANCE_WAREHOUSE_EDIT
-- - stable order-item line numbers from order -> proforma -> invoice
-- - searchable finance/warehouse summaries
-- - atomic approved-invoice edits with non-destructive warehouse synchronization
-- - shipment-owned physical OUT documents are never cancelled/re-written by a
--   finance edit; only reservations and revision metadata are synchronized
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1) Stable order line identity/order.
-- --------------------------------------------------------------------------
alter table public.order_items
  add column if not exists line_no integer;

with ranked as (
  select id,
         row_number() over (partition by order_id order by created_at, id)::integer as line_no
  from public.order_items
)
update public.order_items oi
set line_no = ranked.line_no
from ranked
where ranked.id = oi.id
  and oi.line_no is null;

create or replace function public.fn_assign_order_item_line_no()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.line_no is null or new.line_no <= 0 then
    select coalesce(max(oi.line_no), 0) + 1
    into new.line_no
    from public.order_items oi
    where oi.order_id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_order_item_line_no on public.order_items;
create trigger trg_assign_order_item_line_no
before insert on public.order_items
for each row execute function public.fn_assign_order_item_line_no();

alter table public.order_items
  alter column line_no set not null;

create unique index if not exists uq_order_items_order_line_no
  on public.order_items(order_id, line_no);

-- Keep JSON array order and discounts when the application creates an order.
create or replace function public.fn_app_create_order(
  p_customer jsonb,
  p_order jsonb,
  p_items jsonb default '[]'::jsonb,
  p_create_proforma boolean default false,
  p_ref_finance boolean default false,
  p_ref_warehouse boolean default false,
  p_ref_path boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_id uuid;
  v_order_id uuid;
  v_order_code text;
  v_doc_id uuid;
  v_item jsonb;
  v_item_no bigint;
  v_sales_path public.order_sales_path;
  v_target_module text;
  v_target_role public.user_role;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales']) then
    raise exception 'Only sales/admin can create orders';
  end if;

  if v_actor is null then
    select id into v_actor from public.profiles where role = 'admin' and is_active limit 1;
  end if;

  v_customer_id := nullif(p_order->>'customer_id', '')::uuid;
  if v_customer_id is null then
    insert into public.customers (
      company_name, contact_person_name, contact_phone, contact_email, city, address,
      preferred_contact_channel, acquisition_source, crm_status, lead_score,
      assigned_sales_id, created_by
    ) values (
      coalesce(nullif(p_customer->>'company_name', ''), 'مشتری جدید'),
      nullif(p_customer->>'contact_person_name', ''),
      nullif(p_customer->>'contact_phone', ''),
      nullif(p_customer->>'contact_email', ''),
      nullif(p_customer->>'city', ''),
      nullif(p_customer->>'address', ''),
      nullif(p_customer->>'preferred_contact_channel', '')::public.crm_contact_channel,
      coalesce(nullif(p_customer->>'acquisition_source', ''), 'ثبت سفارش'),
      coalesce(nullif(p_customer->>'crm_status', '')::public.crm_party_status, 'lead'),
      coalesce(nullif(p_customer->>'lead_score', '')::int, 50),
      v_actor,
      v_actor
    ) returning id into v_customer_id;
  end if;

  v_sales_path := coalesce(nullif(p_order->>'sales_path', '')::public.order_sales_path, 'trading');

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, title_en, description_fa, priority,
    expected_delivery_date, sales_officer_id, created_by, contact_channel,
    customer_phone_snapshot, customer_city_snapshot
  ) values (
    null,
    v_customer_id,
    v_sales_path,
    nullif(p_order->>'workflow_template_id', '')::uuid,
    null,
    coalesce(nullif(p_order->>'registered_at', '')::date, current_date),
    coalesce(nullif(p_order->>'title_fa', ''), 'سفارش جدید'),
    nullif(p_order->>'title_en', ''),
    nullif(p_order->>'description_fa', ''),
    coalesce(nullif(p_order->>'priority', '')::smallint, 2),
    nullif(p_order->>'expected_delivery_date', '')::date,
    v_actor,
    v_actor,
    nullif(p_order->>'contact_channel', '')::public.crm_contact_channel,
    nullif(p_order->>'customer_phone_snapshot', ''),
    nullif(p_order->>'customer_city_snapshot', '')
  ) returning id, order_code into v_order_id, v_order_code;

  for v_item, v_item_no in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    insert into public.order_items (
      order_id, line_no, item_name_fa, item_name_en, warehouse_item_code,
      quantity, unit, unit_price, discount_percent, discount_amount, notes
    ) values (
      v_order_id,
      v_item_no::integer,
      coalesce(nullif(v_item->>'item_name_fa', ''), 'قلم سفارش'),
      nullif(v_item->>'item_name_en', ''),
      nullif(v_item->>'warehouse_item_code', ''),
      coalesce(nullif(v_item->>'quantity', '')::numeric, 1),
      coalesce(nullif(v_item->>'unit', ''), 'عدد'),
      coalesce(nullif(v_item->>'unit_price', '')::numeric, 0),
      least(100, greatest(0, coalesce(nullif(v_item->>'discount_percent', '')::numeric, 0))),
      greatest(0, coalesce(nullif(v_item->>'discount_amount', '')::numeric, 0)),
      nullif(v_item->>'notes', '')
    );
  end loop;

  if p_create_proforma then
    v_doc_id := public.fn_create_sales_proforma_from_order(v_order_id);
  end if;
  if p_ref_finance then
    perform public.fn_create_order_referral(v_order_id, 'accounting'::text, ('صدور/پیگیری فاکتور سفارش ' || v_order_code)::text, null::text, 'accountant'::public.user_role, 2::integer, null::date);
  end if;
  if p_ref_warehouse then
    perform public.fn_create_order_referral(v_order_id, 'warehouse'::text, ('بررسی موجودی سفارش ' || v_order_code)::text, null::text, 'warehouse'::public.user_role, 2::integer, null::date);
  end if;
  if p_ref_path then
    v_target_module := case v_sales_path when 'rnd' then 'rnd' when 'production' then 'production' else 'warehouse' end;
    v_target_role := case v_sales_path when 'rnd' then 'rnd'::public.user_role when 'production' then 'production'::public.user_role else 'warehouse'::public.user_role end;
    perform public.fn_create_order_referral(v_order_id, v_target_module::text, ('ارجاع مسیر سفارش ' || v_order_code)::text, null::text, v_target_role, 2::integer, null::date);
  end if;

  perform public.fn_log_crm_interaction(v_customer_id, ('ثبت سفارش ' || v_order_code)::text, null::text, 'note', null, v_order_id);
  return jsonb_build_object('id', v_order_id, 'order_code', v_order_code, 'proforma_id', v_doc_id);
end;
$$;

grant execute on function public.fn_app_create_order(jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean) to authenticated, service_role;

create or replace function public.fn_create_sales_proforma_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_party_id uuid;
  v_doc_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Not allowed to create proforma from order';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  select id into v_doc_id
  from public.finance_documents
  where related_order_id = p_order_id
    and document_type = 'sales_proforma'
    and status <> 'void'
  order by created_at desc
  limit 1;
  if v_doc_id is not null then return v_doc_id; end if;

  v_party_id := public.fn_finance_party_for_customer(v_order.customer_id);
  insert into public.finance_documents (
    doc_number, document_type, status, party_id, related_order_id,
    source_module, source_record_id, issue_date, due_date, description, created_by
  ) values (
    null, 'sales_proforma', 'draft', v_party_id, v_order.id,
    'orders', v_order.id, current_date,
    coalesce(v_order.expected_delivery_date,current_date + 7),
    'پیش‌فاکتور برای سفارش ' || v_order.order_code, auth.uid()
  ) returning id into v_doc_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id
  )
  select
    v_doc_id, oi.line_no, 'goods', oi.item_name_fa, oi.item_name_en,
    oi.quantity, oi.unit, oi.unit_price,
    least(greatest(coalesce(oi.discount_amount,0),0), oi.quantity * oi.unit_price),
    0, wi.id, oi.id
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  where oi.order_id = p_order_id
  order by oi.line_no;

  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  perform public.fn_log_order_event(p_order_id, 'finance', 'پیش‌فاکتور از سفارش با ترتیب پایدار اقلام ساخته شد', null, null, null, jsonb_build_object('finance_document_id',v_doc_id));
  return v_doc_id;
end;
$$;

grant execute on function public.fn_create_sales_proforma_from_order(uuid) to authenticated, service_role;

create or replace function public.fn_create_sales_invoice_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_party_id uuid;
  v_doc_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Not allowed to create invoice from order';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  select id into v_doc_id
  from public.finance_documents
  where related_order_id = p_order_id
    and document_type = 'sales_invoice'
    and status <> 'void'
  order by created_at desc
  limit 1;
  if v_doc_id is not null then return v_doc_id; end if;

  v_party_id := public.fn_finance_party_for_customer(v_order.customer_id);
  insert into public.finance_documents (
    doc_number, document_type, status, party_id, related_order_id,
    source_module, source_record_id, issue_date, due_date, description, created_by
  ) values (
    null, 'sales_invoice', 'draft', v_party_id, v_order.id,
    'orders', v_order.id, current_date,
    coalesce(v_order.expected_delivery_date,current_date + 7),
    'فاکتور فروش برای سفارش ' || v_order.order_code, auth.uid()
  ) returning id into v_doc_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id
  )
  select
    v_doc_id, oi.line_no, 'goods', oi.item_name_fa, oi.item_name_en,
    oi.quantity, oi.unit, oi.unit_price,
    least(greatest(coalesce(oi.discount_amount,0),0), oi.quantity * oi.unit_price),
    0, wi.id, oi.id
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  where oi.order_id = p_order_id
  order by oi.line_no;

  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  perform public.fn_log_order_event(p_order_id, 'finance', 'فاکتور فروش از سفارش با ترتیب پایدار اقلام ساخته شد', null, null, null, jsonb_build_object('finance_document_id',v_doc_id));
  return v_doc_id;
end;
$$;

grant execute on function public.fn_create_sales_invoice_from_order(uuid) to authenticated, service_role;

-- Append line_no to the existing order views without changing previous columns.
create or replace view public.v_order_stock_status
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  oi.id as order_item_id,
  oi.item_name_fa,
  oi.warehouse_item_code,
  wi.id as warehouse_item_id,
  oi.quantity as requested_qty,
  coalesce(s.available_for_sale_qty, 0) as available_for_sale_qty,
  coalesce(s.current_qty, 0) as current_qty,
  coalesce(s.reserved_qty, 0) as reserved_qty,
  s.unit as stock_unit,
  case
    when oi.warehouse_item_code is null or oi.warehouse_item_code = '' then 'no_code'
    when wi.id is null then 'invalid_code'
    when coalesce(s.available_for_sale_qty, 0) >= oi.quantity then 'available'
    when coalesce(s.current_qty, 0) >= oi.quantity then 'reserved_by_others'
    else 'short'
  end as stock_status,
  oi.line_no
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
left join public.v_sales_stock_overview s on s.item_id = wi.id;

grant select on public.v_order_stock_status to authenticated, service_role;

create or replace view public.v_order_shipment_item_progress
with (security_invoker = true)
as
with sent as (
  select sl.order_item_id, sum(sl.quantity) as sent_quantity
  from public.warehouse_shipment_lines sl
  join public.warehouse_shipments s on s.id = sl.shipment_id
  where sl.order_item_id is not null and s.status in ('sent','delivered')
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
  ) as has_approved_invoice,
  oi.line_no
from public.order_items oi
left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code and wi.is_active
left join public.v_warehouse_current_stock st on st.item_id = wi.id
left join sent se on se.order_item_id = oi.id
left join own_reservation orv on orv.order_item_id = oi.id
left join other_reservation oth on oth.order_item_id = oi.id;

grant select on public.v_order_shipment_item_progress to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2) Search-enriched summaries (new fields are appended for compatibility).
-- --------------------------------------------------------------------------
create or replace view public.v_finance_document_summary
with (security_invoker = true)
as
select
  d.id,
  d.doc_number,
  d.document_type,
  d.status,
  d.issue_date,
  d.due_date,
  d.party_id,
  p.display_name as party_name,
  p.party_type,
  d.related_order_id,
  o.order_code,
  d.source_module,
  d.subtotal_amount,
  d.discount_amount,
  d.tax_amount,
  d.total_amount,
  d.paid_amount,
  d.balance_amount,
  case when d.due_date < current_date and d.balance_amount > 0 and d.status in ('approved','sent','partially_paid') then true else false end as is_overdue,
  d.converted_from_document_id,
  p.customer_code,
  p.phone as party_phone,
  p.economic_code as party_economic_code,
  d.description,
  coalesce((
    select string_agg(concat_ws(' ', i.description_fa, i.description_en, wi.item_code, wi.item_name_fa, i.quantity::text, i.unit), ' ' order by i.line_no)
    from public.finance_document_items i
    left join public.warehouse_items wi on wi.id = i.warehouse_item_id
    where i.document_id = d.id
  ), '') as item_search_text
from public.finance_documents d
left join public.finance_parties p on p.id = d.party_id
left join public.orders o on o.id = d.related_order_id;

grant select on public.v_finance_document_summary to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3) Safe finance-edit synchronization metadata and immutable audit snapshots.
-- --------------------------------------------------------------------------
alter table public.warehouse_documents
  add column if not exists finance_sync_state text not null default 'registered',
  add column if not exists finance_revision_no integer not null default 0,
  add column if not exists finance_last_synced_at timestamptz,
  add column if not exists finance_sync_note text;

-- Generic warehouse cancellation is allowed for a finance-owned document only
-- after the financial document itself has really been voided/cancelled. Shipment
-- documents remain protected even after that and use the shipment reversal RPC.
create or replace function public.fn_guard_shipment_warehouse_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status::text = 'final' and new.status::text = 'cancelled' then
    if exists (
      select 1 from public.warehouse_shipments s
      where s.warehouse_document_id = old.id
    ) then
      raise exception 'این سند متعلق به محموله ثبت‌شده است؛ برگشت را از «مدیریت ارسال‌ها» انجام دهید';
    end if;

    if exists (
      select 1 from public.finance_documents fd
      where fd.warehouse_issue_document_id = old.id
        and fd.status::text not in ('void','cancelled')
    ) then
      raise exception 'لغو سند خروج مرتبط فقط پس از ابطال کامل سند مالی مجاز است';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_shipment_warehouse_document on public.warehouse_documents;
create trigger trg_guard_shipment_warehouse_document
before update of status on public.warehouse_documents
for each row execute function public.fn_guard_shipment_warehouse_document();

create table if not exists public.finance_document_revision_snapshots (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.finance_documents(id) on delete restrict,
  revision_no integer not null,
  reason text not null,
  document_snapshot jsonb not null,
  items_snapshot jsonb not null,
  warehouse_sync_result jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(document_id, revision_no)
);

alter table public.finance_document_revision_snapshots enable row level security;

do $$ begin
  create policy finance_revision_snapshots_read
  on public.finance_document_revision_snapshots
  for select to authenticated
  using (public.has_role(array['admin','accountant']));
exception when duplicate_object then null;
end $$;

grant select on public.finance_document_revision_snapshots to authenticated, service_role;

create table if not exists public.warehouse_finance_sync_audit (
  id uuid primary key default gen_random_uuid(),
  finance_document_id uuid not null references public.finance_documents(id) on delete restrict,
  warehouse_document_id uuid references public.warehouse_documents(id) on delete restrict,
  mode text not null,
  reason text,
  adjustments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.warehouse_finance_sync_audit enable row level security;

do $$ begin
  create policy warehouse_finance_sync_audit_read
  on public.warehouse_finance_sync_audit
  for select to authenticated
  using (public.has_role(array['admin','accountant','warehouse']));
exception when duplicate_object then null;
end $$;

grant select on public.warehouse_finance_sync_audit to authenticated, service_role;

-- Synchronize only a legacy finance-owned OUT document. A document belonging
-- to a real shipment is immutable here: its stock lines/transactions/status are
-- preserved and only revision metadata plus the unshipped reservation changes.
create or replace function public.fn_sync_warehouse_after_finance_edit(
  p_document_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_wh public.warehouse_documents%rowtype;
  v_line record;
  v_tx_id uuid;
  v_delta numeric;
  v_current numeric;
  v_actor uuid := auth.uid();
  v_adjustments jsonb := '[]'::jsonb;
  v_reason text := coalesce(nullif(trim(p_reason),''), 'اصلاح فاکتور تأییدشده');
  v_reservation_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی همگام‌سازی امن سند انبار را ندارید';
  end if;

  select * into v_doc
  from public.finance_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'فاکتور یافت نشد'; end if;
  if v_doc.document_type::text <> 'sales_invoice' then
    return jsonb_build_object('mode','not_sales_invoice');
  end if;
  if v_doc.status::text in ('void','cancelled') then
    raise exception 'فاکتور باطل/لغوشده قابل همگام‌سازی ویرایش نیست';
  end if;

  if v_doc.related_order_id is not null
     and v_doc.status::text in ('approved','sent','partially_paid','paid') then
    v_reservation_count := public.fn_sync_order_inventory_reservations(v_doc.related_order_id, false);
  end if;

  if v_doc.warehouse_issue_document_id is null then
    insert into public.warehouse_finance_sync_audit (
      finance_document_id, mode, reason, adjustments, created_by
    ) values (p_document_id, 'reservation_only', v_reason, '[]'::jsonb, v_actor);
    return jsonb_build_object('mode','reservation_only','reservations',v_reservation_count);
  end if;

  select * into v_wh
  from public.warehouse_documents
  where id = v_doc.warehouse_issue_document_id
  for update;
  if not found then
    raise exception 'سند خروج مرتبط فاکتور یافت نشد';
  end if;

  if exists (
    select 1
    from public.warehouse_shipments s
    where s.warehouse_document_id = v_wh.id
       or s.finance_document_id = p_document_id
  ) then
    update public.warehouse_documents
    set finance_sync_state = 'edited_registered',
        finance_revision_no = finance_revision_no + 1,
        finance_last_synced_at = now(),
        finance_sync_note = 'اصلاح مالی ثبت شد؛ محموله فیزیکی بدون تغییر حفظ شد: ' || v_reason
    where id = v_wh.id;

    insert into public.warehouse_finance_sync_audit (
      finance_document_id, warehouse_document_id, mode, reason, adjustments, created_by
    ) values (p_document_id, v_wh.id, 'protected_physical_shipment', v_reason, '[]'::jsonb, v_actor);

    perform public.fn_log_finance_document_event(
      p_document_id, 'note',
      'اصلاح مالی ثبت شد؛ سند خروج محموله فیزیکی نهایی و بدون تغییر حفظ شد',
      v_doc.status, v_doc.status,
      jsonb_build_object('warehouse_document_id',v_wh.id,'mode','protected_physical_shipment','reason',v_reason)
    );
    return jsonb_build_object(
      'mode','protected_physical_shipment',
      'warehouse_document_id',v_wh.id,
      'reservations',v_reservation_count
    );
  end if;

  if v_wh.type::text <> 'out' or v_wh.status::text <> 'final' then
    raise exception 'همگام‌سازی فقط برای سند خروج نهایی و فعال مجاز است';
  end if;

  -- Lock affected stock rows before calculating/applying deltas.
  perform 1
  from public.warehouse_items wi
  where wi.id in (
    select i.warehouse_item_id
    from public.finance_document_items i
    where i.document_id = p_document_id and i.warehouse_item_id is not null
    union
    select t.item_id
    from public.warehouse_transactions t
    where t.document_id = v_wh.id
      and t.reference_type = 'finance_document'
      and t.reference_id = p_document_id
  )
  order by wi.id
  for update;

  for v_line in
    with desired as (
      select i.warehouse_item_id as item_id, sum(i.quantity) as quantity
      from public.finance_document_items i
      where i.document_id = p_document_id
        and i.warehouse_item_id is not null
        and i.quantity > 0
      group by i.warehouse_item_id
    ), issued as (
      select t.item_id,
             coalesce(sum(case
               when t.transaction_type::text = 'issue' then t.quantity
               when t.transaction_type::text in ('reversal','receipt') then -t.quantity
               else 0 end),0) as quantity
      from public.warehouse_transactions t
      where t.document_id = v_wh.id
        and t.reference_type = 'finance_document'
        and t.reference_id = p_document_id
      group by t.item_id
    )
    select coalesce(d.item_id,i.item_id) as item_id,
           greatest(coalesce(d.quantity,0),0) as desired_quantity,
           greatest(coalesce(i.quantity,0),0) as issued_quantity
    from desired d
    full join issued i on i.item_id = d.item_id
    where coalesce(d.quantity,0) <> coalesce(i.quantity,0)
    order by coalesce(d.item_id,i.item_id)
  loop
    v_delta := v_line.desired_quantity - v_line.issued_quantity;

    if v_delta > 0 then
      select coalesce(current_qty,0) into v_current
      from public.v_warehouse_current_stock
      where item_id = v_line.item_id;
      if coalesce(v_current,0) < v_delta then
        raise exception 'موجودی برای افزایش امن خروج سند کافی نیست. کسری: %', v_delta - coalesce(v_current,0);
      end if;

      insert into public.warehouse_transactions (
        item_id, transaction_type, quantity, reference_type, reference_id,
        document_id, created_by, note
      ) values (
        v_line.item_id, 'issue'::public.warehouse_transaction_type, v_delta,
        'finance_document', p_document_id, v_wh.id, coalesce(v_actor,v_wh.created_by),
        'افزایش خروج ناشی از اصلاح فاکتور: ' || v_reason
      ) returning id into v_tx_id;

      insert into public.warehouse_document_lines (
        document_id, item_id, quantity, reason, note, tx_id
      ) values (
        v_wh.id, v_line.item_id, v_delta, 'count_correction',
        'ردیف اصلاح افزایشی فاکتور؛ سند اصلی نهایی باقی ماند', v_tx_id
      );
    else
      insert into public.warehouse_transactions (
        item_id, transaction_type, quantity, reference_type, reference_id,
        document_id, created_by, note
      ) values (
        v_line.item_id, 'reversal'::public.warehouse_transaction_type, abs(v_delta),
        'finance_document', p_document_id, v_wh.id, coalesce(v_actor,v_wh.created_by),
        'کاهش خروج ناشی از اصلاح فاکتور: ' || v_reason
      ) returning id into v_tx_id;

      insert into public.warehouse_document_lines (
        document_id, item_id, quantity, reason, note, tx_id
      ) values (
        v_wh.id, v_line.item_id, abs(v_delta), 'count_correction',
        'ردیف اصلاح کاهشی فاکتور؛ سند اصلی نهایی باقی ماند', v_tx_id
      );
    end if;

    v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
      'item_id',v_line.item_id,
      'before',v_line.issued_quantity,
      'after',v_line.desired_quantity,
      'delta',v_delta,
      'transaction_id',v_tx_id
    ));
  end loop;

  update public.warehouse_documents
  set finance_sync_state = 'edited_registered',
      finance_revision_no = finance_revision_no + 1,
      finance_last_synced_at = now(),
      finance_sync_note = 'سند نهایی با ردیف‌های اصلاحی قابل‌ردیابی همگام شد: ' || v_reason
  where id = v_wh.id;

  insert into public.warehouse_finance_sync_audit (
    finance_document_id, warehouse_document_id, mode, reason, adjustments, created_by
  ) values (p_document_id, v_wh.id, 'legacy_final_adjusted', v_reason, v_adjustments, v_actor);

  perform public.fn_log_finance_document_event(
    p_document_id, 'note',
    'سند خروج قدیمی درجا و بدون لغو، با ردیف‌های اصلاحی همگام و نهایی نگه داشته شد',
    v_doc.status, v_doc.status,
    jsonb_build_object('warehouse_document_id',v_wh.id,'mode','legacy_final_adjusted','adjustments',v_adjustments,'reason',v_reason)
  );

  return jsonb_build_object(
    'mode','legacy_final_adjusted',
    'warehouse_document_id',v_wh.id,
    'adjustments',v_adjustments,
    'reservations',v_reservation_count
  );
end;
$$;

grant execute on function public.fn_sync_warehouse_after_finance_edit(uuid,text) to authenticated, service_role;

-- Cached/older clients calling the historical reissue RPC now use the same safe
-- in-place synchronizer. It never cancels and recreates a warehouse document.
create or replace function public.fn_finance_reissue_inventory_for_document(
  p_document_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_existing uuid;
begin
  v_result := public.fn_sync_warehouse_after_finance_edit(p_document_id, p_reason);
  select warehouse_issue_document_id into v_existing
  from public.finance_documents where id = p_document_id;
  return v_existing;
end;
$$;

grant execute on function public.fn_finance_reissue_inventory_for_document(uuid,text) to authenticated, service_role;

-- One transaction updates the confirmed finance header/items, reposts its
-- accounting entry, and invokes the guarded warehouse synchronizer.
create or replace function public.fn_update_confirmed_finance_document(
  p_document_id uuid,
  p_document jsonb,
  p_items jsonb,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.finance_documents%rowtype;
  v_revision integer;
  v_items_snapshot jsonb;
  v_sync_result jsonb;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی اصلاح فاکتور تأییدشده را ندارید';
  end if;
  if v_reason is null then raise exception 'ثبت دلیل اصلاح الزامی است'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ساختار اقلام فاکتور معتبر نیست';
  end if;

  select * into v_old
  from public.finance_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'سند مالی یافت نشد'; end if;
  if v_old.status::text in ('draft','pending_approval','cancelled','void') then
    raise exception 'این RPC فقط برای اصلاح سند تأییدشده است';
  end if;
  if p_document ? 'document_type'
     and nullif(p_document->>'document_type','') is distinct from v_old.document_type::text then
    raise exception 'نوع سند تأییدشده قابل تغییر نیست';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(trim(e->>'description_fa'),'') is not null
      and coalesce(nullif(e->>'quantity','')::numeric,0) > 0
  ) then
    raise exception 'حداقل یک ردیف معتبر برای سند الزامی است';
  end if;

  select coalesce(max(revision_no),0) + 1
  into v_revision
  from public.finance_document_revision_snapshots
  where document_id = p_document_id;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.line_no), '[]'::jsonb)
  into v_items_snapshot
  from public.finance_document_items i
  where i.document_id = p_document_id;

  insert into public.finance_document_revision_snapshots (
    document_id, revision_no, reason, document_snapshot,
    items_snapshot, created_by
  ) values (
    p_document_id, v_revision, v_reason, to_jsonb(v_old),
    v_items_snapshot, auth.uid()
  );

  update public.finance_documents
  set party_id = case when p_document ? 'party_id' then nullif(p_document->>'party_id','')::uuid else party_id end,
      related_order_id = case when p_document ? 'related_order_id' then nullif(p_document->>'related_order_id','')::uuid else related_order_id end,
      issue_date = case when p_document ? 'issue_date' then nullif(p_document->>'issue_date','')::date else issue_date end,
      due_date = case when p_document ? 'due_date' then nullif(p_document->>'due_date','')::date else due_date end,
      is_official = case when p_document ? 'is_official' then (p_document->>'is_official')::boolean else is_official end,
      description = case when p_document ? 'description' then nullif(p_document->>'description','') else description end,
      print_note = case when p_document ? 'print_note' then nullif(p_document->>'print_note','') else print_note end,
      discount_amount = case when p_document ? 'discount_amount' then greatest(coalesce(nullif(p_document->>'discount_amount','')::numeric,0),0) else discount_amount end,
      updated_at = now()
  where id = p_document_id;

  delete from public.finance_document_items where document_id = p_document_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id,
    price_currency_snapshot, base_cost_price_snapshot, base_sale_price_snapshot,
    exchange_rate_rial_snapshot, catalog_cost_rial_snapshot,
    catalog_sale_rial_snapshot, price_snapshot_at
  )
  select
    p_document_id,
    ordinality::integer,
    coalesce(nullif(item->>'item_type',''),'service'),
    trim(item->>'description_fa'),
    nullif(item->>'description_en',''),
    coalesce(nullif(item->>'quantity','')::numeric,1),
    coalesce(nullif(item->>'unit',''),'عدد'),
    coalesce(nullif(item->>'unit_price','')::numeric,0),
    greatest(coalesce(nullif(item->>'discount_amount','')::numeric,0),0),
    greatest(coalesce(nullif(item->>'tax_rate','')::numeric,0),0),
    nullif(item->>'warehouse_item_id','')::uuid,
    nullif(item->>'order_item_id','')::uuid,
    nullif(item->>'expense_category_id','')::uuid,
    nullif(item->>'cost_center_id','')::uuid,
    nullif(item->>'price_currency_snapshot',''),
    nullif(item->>'base_cost_price_snapshot','')::numeric,
    nullif(item->>'base_sale_price_snapshot','')::numeric,
    nullif(item->>'exchange_rate_rial_snapshot','')::numeric,
    nullif(item->>'catalog_cost_rial_snapshot','')::numeric,
    nullif(item->>'catalog_sale_rial_snapshot','')::numeric,
    nullif(item->>'price_snapshot_at','')::timestamptz
  from jsonb_array_elements(p_items) with ordinality as rows(item, ordinality)
  where nullif(trim(item->>'description_fa'),'') is not null
    and coalesce(nullif(item->>'quantity','')::numeric,0) > 0
  order by ordinality;

  perform public.fn_finance_recalculate_document_totals(p_document_id);
  perform public.fn_finance_repost_document_after_edit(p_document_id, v_reason);

  if v_old.document_type::text = 'sales_invoice' then
    v_sync_result := public.fn_sync_warehouse_after_finance_edit(p_document_id, v_reason);
  else
    v_sync_result := jsonb_build_object('mode','not_sales_invoice');
  end if;

  update public.finance_document_revision_snapshots
  set warehouse_sync_result = v_sync_result
  where document_id = p_document_id and revision_no = v_revision;

  perform public.fn_log_finance_document_event(
    p_document_id, 'note',
    'نسخه ' || v_revision::text || ' اصلاح سند و اقلام به‌صورت اتمیک ثبت شد: ' || v_reason,
    v_old.status, v_old.status,
    jsonb_build_object('revision_no',v_revision,'warehouse_sync',v_sync_result)
  );

  return jsonb_build_object(
    'id',p_document_id,
    'doc_number',v_old.doc_number,
    'revision_no',v_revision,
    'warehouse_sync',v_sync_result
  );
end;
$$;

grant execute on function public.fn_update_confirmed_finance_document(uuid,jsonb,jsonb,text) to authenticated, service_role;

-- A real finance void is the only finance action allowed to cancel a legacy,
-- non-shipment warehouse issue. Its current net issue is reversed exactly once.
-- Physical shipment documents remain immutable and must already have an audited
-- shipment reversal before the invoice can be voided.
create or replace function public.fn_void_finance_document(
  p_document_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_wh public.warehouse_documents%rowtype;
  v_line record;
  v_tx_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ابطال سند مالی ندارید';
  end if;
  if v_reason is null then raise exception 'ثبت دلیل ابطال الزامی است'; end if;

  select * into v_doc
  from public.finance_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'سند مالی یافت نشد'; end if;
  if v_doc.status::text = 'void' then return; end if;

  if exists (
    select 1 from public.warehouse_shipments s
    where s.finance_document_id = p_document_id
      and s.status in ('sent','delivered')
  ) then
    raise exception 'برای ابطال فاکتور، ابتدا همه محموله‌های ارسال‌شده آن را از «مدیریت ارسال‌ها» برگشت دهید';
  end if;

  update public.finance_documents
  set status = 'void',
      void_reason = v_reason,
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = p_document_id;

  if v_doc.warehouse_issue_document_id is not null
     and not exists (
       select 1 from public.warehouse_shipments s
       where s.warehouse_document_id = v_doc.warehouse_issue_document_id
          or s.finance_document_id = p_document_id
     ) then
    select * into v_wh
    from public.warehouse_documents
    where id = v_doc.warehouse_issue_document_id
    for update;

    if found and v_wh.type::text = 'out' and v_wh.status::text = 'final' then
      for v_line in
        select t.item_id,
               sum(case
                 when t.transaction_type::text = 'issue' then t.quantity
                 when t.transaction_type::text in ('reversal','receipt') then -t.quantity
                 else 0 end) as net_issued
        from public.warehouse_transactions t
        where t.document_id = v_wh.id
          and t.reference_type = 'finance_document'
          and t.reference_id = p_document_id
        group by t.item_id
        having sum(case
          when t.transaction_type::text = 'issue' then t.quantity
          when t.transaction_type::text in ('reversal','receipt') then -t.quantity
          else 0 end) > 0
        order by t.item_id
      loop
        insert into public.warehouse_transactions (
          item_id, transaction_type, quantity, reference_type, reference_id,
          document_id, created_by, note
        ) values (
          v_line.item_id, 'reversal'::public.warehouse_transaction_type,
          v_line.net_issued, 'finance_void', p_document_id, v_wh.id,
          coalesce(auth.uid(),v_wh.created_by),
          'برگشت کامل اثر خروج پس از ابطال واقعی سند مالی: ' || v_reason
        ) returning id into v_tx_id;

        insert into public.warehouse_document_lines (
          document_id, item_id, quantity, reason, note, tx_id
        ) values (
          v_wh.id, v_line.item_id, v_line.net_issued, 'count_correction',
          'برگشت نهایی به علت ابطال کامل سند مالی', v_tx_id
        );
      end loop;

      update public.warehouse_documents
      set status = 'cancelled'::public.warehouse_document_status,
          cancelled_at = now(),
          finance_sync_state = 'cancelled_after_finance_void',
          finance_revision_no = finance_revision_no + 1,
          finance_last_synced_at = now(),
          finance_sync_note = 'لغو پس از ابطال کامل سند مالی: ' || v_reason,
          note = concat_ws(E'\n', note, 'لغو پس از ابطال کامل سند مالی: ' || v_reason),
          updated_at = now()
      where id = v_wh.id;

      insert into public.warehouse_finance_sync_audit (
        finance_document_id, warehouse_document_id, mode, reason, adjustments, created_by
      ) values (
        p_document_id, v_wh.id, 'cancelled_after_finance_void', v_reason,
        '[]'::jsonb, auth.uid()
      );
    end if;
  end if;

  perform public.fn_log_finance_document_event(
    p_document_id, 'voided', 'سند باطل شد: ' || v_reason,
    v_doc.status, 'void',
    jsonb_build_object('reason',v_reason,'warehouse_rule','cancel_legacy_only_after_finance_void')
  );
end;
$$;

grant execute on function public.fn_void_finance_document(uuid,text) to authenticated, service_role;

-- Search fields and visible revision state for warehouse documents.
create or replace view public.v_warehouse_documents_summary
with (security_invoker = true)
as
select
  wd.id,
  wd.doc_number,
  wd.type,
  wd.status,
  wd.created_by,
  p.full_name as created_by_name,
  wd.created_at,
  wd.finalized_at,
  count(wdl.id) filter (where wdl.removed_at is null) as line_count,
  coalesce(sum(wdl.quantity) filter (where wdl.removed_at is null), 0) as total_quantity,
  wd.note,
  wd.customer_name,
  wd.customer_city,
  wd.cancelled_at,
  wd.document_kind,
  wd.source_snapshot_id,
  wd.finance_sync_state,
  wd.finance_revision_no,
  wd.finance_last_synced_at,
  wd.finance_sync_note,
  coalesce((
    select string_agg(concat_ws(' ', wi.item_code, wi.item_name_fa, dl.quantity::text, wi.unit, dl.reason, dl.note), ' ' order by dl.created_at, dl.id)
    from public.warehouse_document_lines dl
    join public.warehouse_items wi on wi.id = dl.item_id
    where dl.document_id = wd.id and dl.removed_at is null
  ), '') as line_search_text,
  coalesce((
    select string_agg(distinct concat_ws(' ', s.shipment_number, o.order_code, s.tracking_code, s.carrier_name, s.receiver_name), ' ')
    from public.warehouse_shipments s
    left join public.orders o on o.id = s.related_order_id
    where s.warehouse_document_id = wd.id
  ), '') as shipment_search_text,
  (
    select fd.id
    from public.finance_documents fd
    where fd.warehouse_issue_document_id = wd.id
    order by fd.updated_at desc nulls last, fd.created_at desc
    limit 1
  ) as finance_document_id,
  (
    select fd.status::text
    from public.finance_documents fd
    where fd.warehouse_issue_document_id = wd.id
    order by fd.updated_at desc nulls last, fd.created_at desc
    limit 1
  ) as finance_document_status
from public.warehouse_documents wd
left join public.warehouse_document_lines wdl on wdl.document_id = wd.id
left join public.profiles p on p.id = wd.created_by
group by wd.id, p.full_name;

grant select on public.v_warehouse_documents_summary to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
