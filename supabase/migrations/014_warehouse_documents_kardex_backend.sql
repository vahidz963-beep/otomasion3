-- =====================================================================
-- 014_WAREHOUSE_DOCUMENTS_KARDEX_BACKEND
-- Warehouse backend upgrade compatible with existing 003_warehouse schema.
-- Adds:
-- - item price estimate for valuation
-- - warehouse in/out documents and per-user OUT draft
-- - document lines linked to existing warehouse_transactions
-- - quick stock movement RPCs
-- - kardex view with running balance
-- - safe edit/remove line behavior
-- - system movement function for Orders/Production
-- - grants/RLS for authenticated app access
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'warehouse_document_type') then
    create type public.warehouse_document_type as enum ('in','out');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'warehouse_document_status') then
    create type public.warehouse_document_status as enum ('draft','final','cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Extend existing items/transactions
-- ---------------------------------------------------------------------
alter table public.warehouse_items
  add column if not exists unit_price_estimate numeric not null default 0,
  add column if not exists price_currency text not null default 'IRR';

-- Documents are created below; add document_id after table exists.

-- ---------------------------------------------------------------------
-- 3) Warehouse documents and lines
-- ---------------------------------------------------------------------
create table if not exists public.warehouse_documents (
  id uuid primary key default gen_random_uuid(),
  doc_number text unique,
  type public.warehouse_document_type not null,
  status public.warehouse_document_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  cancelled_at timestamptz,
  note text
);

-- One open OUT draft per user. Prevents two warehouse users from mixing draft lines.
create unique index if not exists uq_warehouse_one_open_out_draft_per_user
on public.warehouse_documents(created_by)
where status = 'draft' and type = 'out';

create index if not exists idx_warehouse_documents_status on public.warehouse_documents(status, type);
create index if not exists idx_warehouse_documents_created_by on public.warehouse_documents(created_by, status);

alter table public.warehouse_transactions
  add column if not exists document_id uuid references public.warehouse_documents(id);

create index if not exists idx_warehouse_transactions_document on public.warehouse_transactions(document_id);

create table if not exists public.warehouse_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.warehouse_documents(id) on delete cascade,
  item_id uuid not null references public.warehouse_items(id),
  quantity numeric not null check (quantity > 0),
  reason text not null default 'manual_out',
  note text,
  tx_id uuid references public.warehouse_transactions(id),
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_warehouse_document_lines_document on public.warehouse_document_lines(document_id);
create index if not exists idx_warehouse_document_lines_item on public.warehouse_document_lines(item_id);

create sequence if not exists public.warehouse_in_doc_seq;
create sequence if not exists public.warehouse_out_doc_seq;

-- ---------------------------------------------------------------------
-- 4) Rebuild stock views with price/valuation while preserving old columns
-- ---------------------------------------------------------------------
create or replace view public.v_warehouse_current_stock
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (wsi.item_id)
    wsi.item_id,
    wsi.quantity as snapshot_qty,
    s.id as snapshot_id,
    s.imported_at as snapshot_imported_at
  from public.warehouse_snapshot_items wsi
  join public.warehouse_snapshots s on s.id = wsi.snapshot_id
  where wsi.item_id is not null
  order by wsi.item_id, s.imported_at desc
), tx_since_snapshot as (
  select
    wt.item_id,
    sum(case
      when wt.transaction_type = 'issue' then -wt.quantity
      when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity
      else 0
    end) as net_qty
  from public.warehouse_transactions wt
  left join latest_snapshot ls on ls.item_id = wt.item_id
  where ls.snapshot_imported_at is null or wt.created_at > ls.snapshot_imported_at
  group by wt.item_id
), tx_totals as (
  select
    wt.item_id,
    sum(case when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity else 0 end) as total_in,
    sum(case when wt.transaction_type = 'issue' then wt.quantity else 0 end) as total_out,
    max(wt.created_at) as last_movement_at
  from public.warehouse_transactions wt
  group by wt.item_id
)
select
  wi.id as item_id,
  wi.item_code,
  wi.item_name_fa,
  wi.item_name_en,
  wi.unit,
  wi.category,
  wi.category as item_group,
  wi.location,
  wi.min_stock_threshold,
  wi.min_stock_threshold as reorder_point,
  wi.unit_price_estimate,
  wi.price_currency,
  ls.snapshot_qty,
  ls.snapshot_imported_at as last_synced_at,
  coalesce(tx.net_qty, 0) as net_transactions_since_sync,
  (coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) as current_qty,
  coalesce(tt.total_in, 0) as total_in,
  coalesce(tt.total_out, 0) as total_out,
  tt.last_movement_at,
  ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) < wi.min_stock_threshold) as is_low_stock,
  (ls.snapshot_imported_at is null) as never_synced,
  ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) * wi.unit_price_estimate) as stock_value_estimate
from public.warehouse_items wi
left join latest_snapshot ls on ls.item_id = wi.id
left join tx_since_snapshot tx on tx.item_id = wi.id
left join tx_totals tt on tt.item_id = wi.id
where wi.is_active;

create or replace view public.v_sales_stock_overview
with (security_invoker = true)
as
select
  s.item_id,
  s.item_code,
  s.item_name_fa,
  s.item_name_en,
  s.unit,
  s.category,
  s.item_group,
  s.location,
  s.current_qty,
  s.min_stock_threshold,
  s.reorder_point,
  s.unit_price_estimate,
  s.stock_value_estimate,
  coalesce(r.reserved_qty, 0) as reserved_qty,
  (s.current_qty - coalesce(r.reserved_qty, 0)) as available_for_sale_qty,
  ((s.current_qty - coalesce(r.reserved_qty, 0)) < s.min_stock_threshold) as is_low_stock,
  s.last_synced_at,
  s.last_movement_at
from public.v_warehouse_current_stock s
left join (
  select warehouse_item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
) r on r.warehouse_item_id = s.item_id;

create or replace view public.v_warehouse_kardex
with (security_invoker = true)
as
select
  wt.item_id,
  wi.item_code,
  wi.item_name_fa,
  wt.id as tx_id,
  wt.transaction_type,
  case when wt.transaction_type = 'issue' then 'out' else 'in' end as direction,
  wt.quantity,
  wt.document_id,
  wd.doc_number,
  wd.status as document_status,
  wt.reference_type,
  wt.reference_id,
  wt.created_by,
  wt.note,
  wt.created_at,
  sum(case
    when wt.transaction_type = 'issue' then -wt.quantity
    when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity
    else 0
  end) over (partition by wt.item_id order by wt.created_at, wt.id rows between unbounded preceding and current row) as running_balance
from public.warehouse_transactions wt
join public.warehouse_items wi on wi.id = wt.item_id
left join public.warehouse_documents wd on wd.id = wt.document_id;

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
  wd.note
from public.warehouse_documents wd
left join public.warehouse_document_lines wdl on wdl.document_id = wd.id
left join public.profiles p on p.id = wd.created_by
group by wd.id, p.full_name;

-- ---------------------------------------------------------------------
-- 5) Helpers and RPCs
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_tx_type_from_direction(p_direction text, p_positive boolean default true)
returns public.warehouse_transaction_type
language sql
immutable
as $$
  select case
    when p_direction = 'out' and p_positive then 'issue'::public.warehouse_transaction_type
    when p_direction = 'out' and not p_positive then 'receipt'::public.warehouse_transaction_type
    when p_direction = 'in' and p_positive then 'receipt'::public.warehouse_transaction_type
    when p_direction = 'in' and not p_positive then 'issue'::public.warehouse_transaction_type
    else 'adjustment'::public.warehouse_transaction_type
  end;
$$;

create or replace function public.fn_get_or_create_open_out_draft()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'کاربر غیرفعال است';
  end if;

  select id into v_id
  from public.warehouse_documents
  where type = 'out' and status = 'draft' and created_by = auth.uid()
  limit 1;

  if v_id is null then
    insert into public.warehouse_documents (type, status, created_by)
    values ('out', 'draft', auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.fn_record_stock_movement(
  p_item_id uuid,
  p_direction text,
  p_quantity numeric,
  p_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_doc_number text;
  v_tx_id uuid;
  v_tx_type public.warehouse_transaction_type;
begin
  if not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی انبار ندارید';
  end if;

  if p_direction not in ('in','out') then
    raise exception 'جهت باید in یا out باشد';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'مقدار باید بزرگ‌تر از صفر باشد';
  end if;

  if p_direction = 'out' then
    v_doc_id := public.fn_get_or_create_open_out_draft();
  else
    v_doc_number := 'WH-IN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
    insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at)
    values (v_doc_number, 'in', 'final', auth.uid(), now())
    returning id into v_doc_id;
  end if;

  v_tx_type := public.fn_warehouse_tx_type_from_direction(p_direction, true);

  insert into public.warehouse_transactions (
    item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note
  ) values (
    p_item_id, v_tx_type, p_quantity, null, null, v_doc_id, auth.uid(), coalesce(p_reason, p_direction) || coalesce(' - ' || p_note, '')
  ) returning id into v_tx_id;

  insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
  values (v_doc_id, p_item_id, p_quantity, coalesce(p_reason, case when p_direction='in' then 'manual_in' else 'manual_out' end), p_note, v_tx_id);

  return jsonb_build_object(
    'document_id', v_doc_id,
    'doc_number', (select doc_number from public.warehouse_documents where id = v_doc_id),
    'status', (select status from public.warehouse_documents where id = v_doc_id)
  );
end;
$$;

create or replace function public.fn_finalize_document(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
  v_doc_number text;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;

  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;
  if v_doc.status <> 'draft' then raise exception 'این سند قبلاً ثبت شده است'; end if;

  v_doc_number := 'WH-OUT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.warehouse_out_doc_seq')::text, 4, '0');

  update public.warehouse_documents
  set doc_number = v_doc_number,
      status = 'final',
      finalized_at = now()
  where id = p_document_id;

  return v_doc_number;
end;
$$;

create or replace function public.fn_cancel_draft_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;
  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;
  if v_doc.status <> 'draft' then raise exception 'فقط سند موقت قابل لغو است'; end if;

  delete from public.warehouse_transactions where document_id = p_document_id;
  delete from public.warehouse_document_lines where document_id = p_document_id;
  delete from public.warehouse_documents where id = p_document_id;
end;
$$;

create or replace function public.fn_update_document_line(p_line_id uuid, p_new_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.warehouse_document_lines%rowtype;
  v_doc public.warehouse_documents%rowtype;
  v_delta numeric;
  v_direction text;
  v_tx_type public.warehouse_transaction_type;
begin
  if p_new_quantity is null or p_new_quantity <= 0 then raise exception 'مقدار نامعتبر است'; end if;

  select * into v_line from public.warehouse_document_lines where id = p_line_id for update;
  if not found then raise exception 'ردیف سند یافت نشد'; end if;

  select * into v_doc from public.warehouse_documents where id = v_line.document_id;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  v_delta := p_new_quantity - v_line.quantity;
  if v_delta = 0 then return; end if;

  if v_doc.status = 'draft' then
    update public.warehouse_document_lines set quantity = p_new_quantity where id = p_line_id;
    update public.warehouse_transactions set quantity = p_new_quantity where id = v_line.tx_id;
  else
    v_direction := case when v_doc.type = 'out' then 'out' else 'in' end;
    v_tx_type := public.fn_warehouse_tx_type_from_direction(v_direction, v_delta > 0);

    insert into public.warehouse_transactions (item_id, transaction_type, quantity, document_id, created_by, note)
    values (v_line.item_id, v_tx_type, abs(v_delta), v_doc.id, auth.uid(), 'count_correction: اصلاح ردیف سند');

    update public.warehouse_document_lines set quantity = p_new_quantity where id = p_line_id;
  end if;
end;
$$;

create or replace function public.fn_remove_document_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.warehouse_document_lines%rowtype;
  v_doc public.warehouse_documents%rowtype;
  v_tx_type public.warehouse_transaction_type;
begin
  select * into v_line from public.warehouse_document_lines where id = p_line_id for update;
  if not found then raise exception 'ردیف سند یافت نشد'; end if;

  select * into v_doc from public.warehouse_documents where id = v_line.document_id;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  if v_doc.status = 'draft' then
    delete from public.warehouse_transactions where id = v_line.tx_id;
    delete from public.warehouse_document_lines where id = p_line_id;
  else
    v_tx_type := case when v_doc.type = 'out' then 'receipt'::public.warehouse_transaction_type else 'issue'::public.warehouse_transaction_type end;
    insert into public.warehouse_transactions (item_id, transaction_type, quantity, document_id, created_by, note)
    values (v_line.item_id, v_tx_type, v_line.quantity, v_doc.id, auth.uid(), 'count_correction: حذف ردیف سند');
    update public.warehouse_document_lines set removed_at = now() where id = p_line_id;
  end if;
end;
$$;

create or replace function public.fn_deactivate_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['admin','warehouse']) then raise exception 'دسترسی ندارید'; end if;
  update public.warehouse_items set is_active = false where id = p_item_id;
end;
$$;

create or replace function public.fn_system_record_stock_movement(
  p_item_id uuid,
  p_direction text,
  p_quantity numeric,
  p_reason text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_tx_type public.warehouse_transaction_type;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Invalid quantity'; end if;
  if p_direction not in ('in','out') then raise exception 'Invalid direction'; end if;

  v_tx_type := public.fn_warehouse_tx_type_from_direction(p_direction, true);

  insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, created_by, note)
  values (p_item_id, v_tx_type, p_quantity, p_reference_type, p_reference_id, p_created_by, coalesce(p_reason,'system') || coalesce(' - ' || p_note, ''))
  returning id into v_tx_id;

  return v_tx_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) RLS and grants
-- ---------------------------------------------------------------------
alter table public.warehouse_documents enable row level security;
alter table public.warehouse_document_lines enable row level security;

drop policy if exists warehouse_documents_select on public.warehouse_documents;
create policy warehouse_documents_select on public.warehouse_documents
for select using (
  public.is_active_user() and (status = 'final' or created_by = auth.uid() or public.is_admin())
);

drop policy if exists warehouse_documents_write on public.warehouse_documents;
create policy warehouse_documents_write on public.warehouse_documents
for all using (public.has_role(array['admin','warehouse']))
with check (public.has_role(array['admin','warehouse']));

drop policy if exists warehouse_document_lines_select on public.warehouse_document_lines;
create policy warehouse_document_lines_select on public.warehouse_document_lines
for select using (
  exists (
    select 1 from public.warehouse_documents d
    where d.id = warehouse_document_lines.document_id
      and (d.status = 'final' or d.created_by = auth.uid() or public.is_admin())
  )
);

drop policy if exists warehouse_document_lines_write on public.warehouse_document_lines;
create policy warehouse_document_lines_write on public.warehouse_document_lines
for all using (public.has_role(array['admin','warehouse']))
with check (public.has_role(array['admin','warehouse']));

grant select, insert, update, delete on public.warehouse_documents to authenticated;
grant select, insert, update, delete on public.warehouse_document_lines to authenticated;
grant usage, select on sequence public.warehouse_in_doc_seq to authenticated;
grant usage, select on sequence public.warehouse_out_doc_seq to authenticated;
grant execute on function public.fn_get_or_create_open_out_draft() to authenticated;
grant execute on function public.fn_record_stock_movement(uuid,text,numeric,text,text) to authenticated;
grant execute on function public.fn_finalize_document(uuid) to authenticated;
grant execute on function public.fn_cancel_draft_document(uuid) to authenticated;
grant execute on function public.fn_update_document_line(uuid,numeric) to authenticated;
grant execute on function public.fn_remove_document_line(uuid) to authenticated;
grant execute on function public.fn_deactivate_item(uuid) to authenticated;
grant execute on function public.fn_system_record_stock_movement(uuid,text,numeric,text,text,uuid,uuid,text) to authenticated;
