-- =====================================================================
-- 038_CROSS_MODULE_INVENTORY_FINANCE_PRODUCTION_COORDINATION
-- Coordinates Production + Warehouse + Finance + Orders/R&D flows.
-- 1) Produced items get 4-digit warehouse item codes.
-- 2) Draft warehouse documents do not affect current stock until finalized.
-- 3) Approved sales invoices create final warehouse OUT documents automatically.
-- 4) Production output is one logical record per production order; later calls adjust quantity.
-- 5) Production material issue creates warehouse OUT draft documents; stock is deducted only after warehouse final approval.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Clean conflicting views before recreation
-- This migration may be re-run after newer patches. PostgreSQL does not allow
-- CREATE OR REPLACE VIEW to remove/reorder columns, so we drop the involved
-- views first in dependency-safe order and recreate them below.
-- ---------------------------------------------------------------------
drop view if exists public.v_production_material_usage_overview cascade;
drop view if exists public.v_app_inventory_catalog cascade;
drop view if exists public.v_sales_stock_overview cascade;
drop view if exists public.v_warehouse_stock_readonly cascade;
drop view if exists public.v_warehouse_kardex cascade;
drop view if exists public.v_production_order_overview cascade;
drop view if exists public.v_warehouse_current_stock cascade;

-- ---------------------------------------------------------------------
-- 1) Stock/Kardex should count only direct/system transactions or FINAL docs.
-- Draft/cancelled warehouse documents remain visible as documents, but do not affect stock.
-- Keep old v_warehouse_current_stock column order and append nothing.
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
), counted_transactions as (
  select wt.*
  from public.warehouse_transactions wt
  left join public.warehouse_documents wd on wd.id = wt.document_id
  where wt.document_id is null or wd.status::text = 'final'
), tx_since_snapshot as (
  select
    wt.item_id,
    sum(case
      when wt.transaction_type = 'issue' then -wt.quantity
      when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity
      else 0
    end) as net_qty
  from counted_transactions wt
  left join latest_snapshot ls on ls.item_id = wt.item_id
  where ls.snapshot_imported_at is null or wt.created_at > ls.snapshot_imported_at
  group by wt.item_id
), tx_totals as (
  select
    wt.item_id,
    sum(case when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity else 0 end) as total_in,
    sum(case when wt.transaction_type = 'issue' then wt.quantity else 0 end) as total_out,
    max(wt.created_at) as last_movement_at
  from counted_transactions wt
  group by wt.item_id
), reservations as (
  select warehouse_item_id as item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
), stock_base as (
  select
    wi.id as item_id,
    wi.item_code,
    wi.item_name_fa,
    wi.item_name_en,
    wi.unit,
    wi.category,
    wi.min_stock_threshold,
    ls.snapshot_qty,
    ls.snapshot_imported_at as last_synced_at,
    coalesce(tx.net_qty, 0) as net_transactions_since_sync,
    (coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) as current_qty,
    ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) < wi.min_stock_threshold) as is_low_stock,
    (ls.snapshot_imported_at is null) as never_synced,
    wi.category as item_group,
    wi.location,
    wi.min_stock_threshold as reorder_point,
    wi.unit_price_estimate,
    wi.price_currency,
    coalesce(tt.total_in, 0) as total_in,
    coalesce(tt.total_out, 0) as total_out,
    tt.last_movement_at,
    ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) * wi.unit_price_estimate) as stock_value_estimate,
    coalesce(r.reserved_qty, 0) as reserved_qty
  from public.warehouse_items wi
  left join latest_snapshot ls on ls.item_id = wi.id
  left join tx_since_snapshot tx on tx.item_id = wi.id
  left join tx_totals tt on tt.item_id = wi.id
  left join reservations r on r.item_id = wi.id
  where wi.is_active
)
select
  item_id,
  item_code,
  item_name_fa,
  item_name_en,
  unit,
  category,
  min_stock_threshold,
  snapshot_qty,
  last_synced_at,
  net_transactions_since_sync,
  current_qty,
  is_low_stock,
  never_synced,
  item_group,
  location,
  reorder_point,
  unit_price_estimate,
  price_currency,
  total_in,
  total_out,
  last_movement_at,
  stock_value_estimate,
  reserved_qty,
  (current_qty - reserved_qty) as available_for_sale_qty
from stock_base;

grant select on public.v_warehouse_current_stock to authenticated;

-- Compatibility view for older sales/order UI.
create or replace view public.v_warehouse_stock_readonly
with (security_invoker = true)
as
select
  item_code,
  item_name_fa,
  item_name_en,
  available_for_sale_qty as available_qty,
  unit,
  last_synced_at as updated_at
from public.v_warehouse_current_stock;

grant select on public.v_warehouse_stock_readonly to authenticated;

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
left join public.warehouse_documents wd on wd.id = wt.document_id
where wt.document_id is null or wd.status::text = 'final';

grant select on public.v_warehouse_kardex to authenticated;

-- Shared sales/inventory views after current stock correction.
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
  s.current_qty,
  s.min_stock_threshold,
  coalesce(r.reserved_qty, 0) as reserved_qty,
  (s.current_qty - coalesce(r.reserved_qty, 0)) as available_for_sale_qty,
  ((s.current_qty - coalesce(r.reserved_qty, 0)) < s.min_stock_threshold) as is_low_stock,
  s.last_synced_at,
  s.item_group,
  s.location,
  s.reorder_point,
  s.unit_price_estimate,
  s.stock_value_estimate,
  s.last_movement_at,
  case
    when coalesce(s.category, s.item_group) = 'Finished' then 'تولید شده‌ها'
    when coalesce(s.category, s.item_group) is null then 'بدون گروه'
    else coalesce(s.category, s.item_group)
  end as item_group_label,
  (coalesce(s.category, s.item_group) = 'Finished') as is_produced_item
from public.v_warehouse_current_stock s
left join (
  select warehouse_item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
) r on r.warehouse_item_id = s.item_id;

grant select on public.v_sales_stock_overview to authenticated;

create or replace view public.v_app_inventory_catalog
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
  case
    when coalesce(s.category, s.item_group) = 'Finished' then 'تولید شده‌ها'
    when coalesce(s.category, s.item_group) is null then 'بدون گروه'
    else coalesce(s.category, s.item_group)
  end as item_group_label,
  (coalesce(s.category, s.item_group) = 'Finished') as is_produced_item,
  s.location,
  s.current_qty,
  coalesce(s.reserved_qty, 0) as reserved_qty,
  coalesce(s.available_for_sale_qty, s.current_qty - coalesce(s.reserved_qty, 0)) as available_for_sale_qty,
  s.min_stock_threshold,
  s.reorder_point,
  s.is_low_stock,
  s.last_synced_at,
  s.unit_price_estimate,
  s.stock_value_estimate,
  ls.last_sale_unit_price,
  coalesce(ls.last_sale_unit_price, s.unit_price_estimate, 0) as effective_sale_price,
  ls.doc_number as last_sale_doc_number,
  ls.issue_date as last_sale_date
from public.v_sales_stock_overview s
left join public.v_finance_item_last_sale ls on ls.warehouse_item_id = s.item_id;

grant select on public.v_app_inventory_catalog to authenticated;

-- ---------------------------------------------------------------------
-- 2) Four digit warehouse item code for produced items.
-- ---------------------------------------------------------------------
create sequence if not exists public.production_item_code_seq;

do $$
declare
  v_max_existing int;
  v_last_value bigint;
begin
  select max(item_code::int) into v_max_existing
  from public.warehouse_items
  where item_code ~ '^[0-9]{4}$';

  select last_value into v_last_value from public.production_item_code_seq;

  if v_max_existing is not null and v_max_existing > coalesce(v_last_value, 0) then
    perform setval('public.production_item_code_seq', v_max_existing, true);
  end if;
end $$;

create or replace function public.fn_next_warehouse_item_code_4digit()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  loop
    v_code := lpad(nextval('public.production_item_code_seq')::text, 4, '0');
    v_try := v_try + 1;

    if length(v_code) > 4 then
      raise exception 'ظرفیت کد چهاررقمی کالاهای تولیدی تکمیل شده است';
    end if;

    if not exists (select 1 from public.warehouse_items where item_code = v_code) then
      return v_code;
    end if;

    if v_try > 10000 then
      raise exception 'کد چهاررقمی خالی برای کالای تولیدی پیدا نشد';
    end if;
  end loop;
end;
$$;

grant execute on function public.fn_next_warehouse_item_code_4digit() to authenticated;

create or replace function public.fn_production_publish_bom_to_warehouse(
  p_bom_id uuid,
  p_item_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom public.production_boms%rowtype;
  v_item_id uuid;
  v_item_code text;
  v_source_order_id uuid;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  perform public.fn_production_recalc_costs(p_bom_id);
  select * into v_bom from public.production_boms where id = p_bom_id for update;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  if v_bom.related_production_order_id is not null and v_bom.related_order_id is null then
    select source_order_id into v_source_order_id
    from public.production_orders
    where id = v_bom.related_production_order_id;

    update public.production_boms
    set related_order_id = v_source_order_id,
        updated_at = now()
    where id = p_bom_id;

    v_bom.related_order_id := v_source_order_id;
  end if;

  v_item_id := v_bom.warehouse_item_id;
  v_item_code := nullif(trim(coalesce(p_item_code, '')), '');

  if v_item_id is null then
    if v_item_code is null then
      v_item_code := public.fn_next_warehouse_item_code_4digit();
    end if;

    insert into public.warehouse_items (
      item_code, item_name_fa, item_name_en, category, unit, location,
      min_stock_threshold, unit_price_estimate, price_currency, is_active
    ) values (
      v_item_code,
      v_bom.product_name_fa,
      v_bom.product_name_en,
      'Finished',
      coalesce(v_bom.unit, 'عدد'),
      'تولید',
      0,
      coalesce(v_bom.total_estimated_cost, 0),
      'IRR',
      true
    ) returning id into v_item_id;

    update public.production_boms
    set warehouse_item_id = v_item_id,
        status = case when status = 'draft' then 'active' else status end,
        updated_at = now()
    where id = p_bom_id;
  else
    update public.warehouse_items
    set item_name_fa = v_bom.product_name_fa,
        item_name_en = v_bom.product_name_en,
        category = 'Finished',
        unit = coalesce(v_bom.unit, unit, 'عدد'),
        unit_price_estimate = coalesce(v_bom.total_estimated_cost, 0),
        price_currency = 'IRR',
        is_active = true,
        updated_at = now()
    where id = v_item_id;
  end if;

  return v_item_id;
end;
$$;

grant execute on function public.fn_production_publish_bom_to_warehouse(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Production output: one logical output per production order; later calls adjust.
-- ---------------------------------------------------------------------
alter table public.production_output
  add column if not exists warehouse_document_id uuid references public.warehouse_documents(id);

-- The old trigger inserted direct warehouse transactions on every insert.
-- New RPC below handles insert/update and creates visible warehouse documents.
drop trigger if exists trg_register_production_output on public.production_output;

create or replace function public.fn_create_finished_item_for_production(p_production_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_item_id uuid;
begin
  select * into v_po from public.production_orders where id = p_production_order_id;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  insert into public.warehouse_items (
    item_code, item_name_fa, item_name_en, category, unit, location,
    min_stock_threshold, unit_price_estimate, price_currency, is_active
  ) values (
    public.fn_next_warehouse_item_code_4digit(),
    v_po.product_name_fa,
    v_po.product_name_en,
    'Finished',
    coalesce(v_po.unit, 'عدد'),
    'تولید',
    0,
    coalesce(v_po.estimated_total_cost, 0),
    'IRR',
    true
  ) returning id into v_item_id;

  update public.production_orders
  set output_warehouse_item_id = v_item_id,
      updated_at = now()
  where id = p_production_order_id;

  return v_item_id;
end;
$$;

grant execute on function public.fn_create_finished_item_for_production(uuid) to authenticated;

create or replace function public.fn_production_register_output(
  p_production_order_id uuid,
  p_quantity numeric,
  p_warehouse_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_item_id uuid;
  v_bom_id uuid;
  v_existing public.production_output%rowtype;
  v_output_id uuid;
  v_doc_id uuid;
  v_doc_number text;
  v_tx_id uuid;
  v_delta numeric;
  v_total int;
  v_done int;
  v_line_id uuid;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی ثبت خروجی تولید ندارید';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'تعداد خروجی تولید باید بزرگ‌تر از صفر باشد';
  end if;

  select * into v_po from public.production_orders where id = p_production_order_id for update;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  select count(*), count(*) filter (where status::text = 'completed')
  into v_total, v_done
  from public.production_order_stages
  where production_order_id = p_production_order_id;

  if coalesce(v_total,0) > 0 and coalesce(v_done,0) < coalesce(v_total,0) then
    raise exception 'ثبت خروجی فقط پس از تکمیل همه مراحل تولید مجاز است';
  end if;

  v_item_id := p_warehouse_item_id;
  if v_item_id is null then v_item_id := v_po.output_warehouse_item_id; end if;

  if v_item_id is null then
    select id into v_bom_id
    from public.production_boms
    where related_production_order_id = p_production_order_id
       or (related_order_id is not null and related_order_id = v_po.source_order_id)
    order by updated_at desc, created_at desc
    limit 1;

    if v_bom_id is not null then
      v_item_id := public.fn_production_publish_bom_to_warehouse(v_bom_id, null);
    else
      v_item_id := public.fn_create_finished_item_for_production(p_production_order_id);
    end if;
  end if;

  select * into v_existing
  from public.production_output
  where production_order_id = p_production_order_id
  order by registered_at desc
  limit 1
  for update;

  if found then
    v_output_id := v_existing.id;
    v_doc_id := v_existing.warehouse_document_id;
    v_delta := p_quantity - coalesce(v_existing.quantity, 0);

    if v_doc_id is null then
      v_doc_number := 'WH-IN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
      insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note)
      values (v_doc_number, 'in'::public.warehouse_document_type, 'final'::public.warehouse_document_status, auth.uid(), now(), 'سند ورود خروجی تولید ' || v_po.code)
      returning id into v_doc_id;
    end if;

    if v_delta <> 0 then
      insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
      values (
        v_item_id,
        case when v_delta > 0 then 'receipt'::public.warehouse_transaction_type else 'issue'::public.warehouse_transaction_type end,
        abs(v_delta),
        'production_output_adjustment',
        v_output_id,
        v_doc_id,
        auth.uid(),
        'اصلاح مقدار خروجی تولید ' || v_po.code || ' از ' || coalesce(v_existing.quantity,0) || ' به ' || p_quantity
      ) returning id into v_tx_id;
    end if;

    select id into v_line_id
    from public.warehouse_document_lines
    where document_id = v_doc_id and item_id = v_item_id and removed_at is null
    order by created_at
    limit 1;

    if v_line_id is null then
      insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
      values (v_doc_id, v_item_id, p_quantity, 'production_output', 'خروجی تولید ' || v_po.code, v_tx_id);
    else
      update public.warehouse_document_lines
      set quantity = p_quantity,
          note = 'خروجی تولید ' || v_po.code || ' - مقدار اصلاح شد'
      where id = v_line_id;
    end if;

    update public.production_output
    set warehouse_item_id = v_item_id,
        quantity = p_quantity,
        warehouse_document_id = v_doc_id,
        registered_by = auth.uid(),
        registered_at = now()
    where id = v_output_id;
  else
    v_doc_number := 'WH-IN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
    insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note)
    values (v_doc_number, 'in'::public.warehouse_document_type, 'final'::public.warehouse_document_status, auth.uid(), now(), 'سند ورود خروجی تولید ' || v_po.code)
    returning id into v_doc_id;

    insert into public.production_output (production_order_id, warehouse_item_id, quantity, registered_by, warehouse_document_id)
    values (p_production_order_id, v_item_id, p_quantity, auth.uid(), v_doc_id)
    returning id into v_output_id;

    insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
    values (v_item_id, 'receipt'::public.warehouse_transaction_type, p_quantity, 'production_output', v_output_id, v_doc_id, auth.uid(), 'خروجی تولید ' || v_po.code)
    returning id into v_tx_id;

    insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
    values (v_doc_id, v_item_id, p_quantity, 'production_output', 'خروجی تولید ' || v_po.code, v_tx_id);
  end if;

  update public.production_orders
  set output_warehouse_item_id = v_item_id,
      quantity_produced = p_quantity,
      status = 'delivered_to_warehouse'::public.production_order_status,
      updated_at = now()
  where id = p_production_order_id;

  insert into public.production_documents (production_order_id, document_type, title_fa, description_fa, status, created_by)
  values (
    p_production_order_id,
    'output',
    case when v_existing.id is null then 'ثبت خروجی تولید در انبار' else 'اصلاح خروجی تولید در انبار' end,
    'مقدار نهایی خروجی: ' || p_quantity || ' ' || coalesce(v_po.unit,'عدد') || '، سند انبار: ' || coalesce(v_doc_number, (select doc_number from public.warehouse_documents where id = v_doc_id)),
    'registered',
    auth.uid()
  );

  if v_po.source_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (
      v_po.source_order_id,
      'production',
      case when v_existing.id is null then 'خروجی تولید در انبار ثبت شد' else 'خروجی تولید در انبار اصلاح شد' end,
      'کد تولید ' || v_po.code || '، مقدار نهایی خروجی: ' || p_quantity || '، کد کالا: ' || (select item_code from public.warehouse_items where id = v_item_id),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'output_id', v_output_id,
    'warehouse_item_id', v_item_id,
    'warehouse_document_id', v_doc_id,
    'quantity_registered', p_quantity,
    'total_produced', p_quantity,
    'production_completed', true,
    'item_code', (select item_code from public.warehouse_items where id = v_item_id)
  );
end;
$$;

grant execute on function public.fn_production_register_output(uuid,numeric,uuid) to authenticated;

-- Append output columns to production overview without changing previous column order.
create or replace view public.v_production_order_overview
with (security_invoker = true)
as
select
  po.id,
  po.code,
  po.source_order_id,
  po.source_order_code,
  o.order_code,
  po.customer_name_snapshot as customer_name,
  po.product_name_fa,
  po.quantity_planned,
  po.quantity_produced,
  po.unit,
  po.status,
  po.progress_percent,
  po.current_stage_name_fa,
  po.planned_start,
  po.planned_end,
  (po.planned_end - current_date) as days_to_delivery,
  case
    when po.status = 'cancelled' then 'cancelled'
    when po.status in ('completed','delivered_to_warehouse') then 'completed'
    when po.planned_end is not null and po.planned_end < current_date then 'late'
    when po.planned_end is not null and po.planned_end <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as delivery_status,
  po.work_days,
  po.labor_people,
  po.total_man_hours,
  po.estimated_total_cost,
  po.workflow_template_id,
  pwt.name_fa as workflow_template_name,
  coalesce(count(pos.id), 0) as total_stages,
  coalesce(count(pos.id) filter (where pos.status = 'completed'), 0) as completed_stages,
  coalesce(count(pmu.id) filter (where pmu.status = 'short'), 0) as material_shortages,
  coalesce(count(qc.id) filter (where qc.result = 'failed'), 0) as qc_failures,
  po.created_at,
  po.updated_at,
  po.output_warehouse_item_id,
  wi.item_code as output_item_code,
  wi.item_name_fa as output_item_name_fa,
  coalesce(outp.output_registered_qty, 0) as output_registered_qty,
  coalesce(outp.output_count, 0) as output_count,
  (coalesce(count(pos.id), 0) = 0 or coalesce(count(pos.id) filter (where pos.status = 'completed'), 0) = coalesce(count(pos.id), 0)) as can_register_output
from public.production_orders po
left join public.orders o on o.id = po.source_order_id
left join public.production_workflow_templates pwt on pwt.id = po.workflow_template_id
left join public.production_order_stages pos on pos.production_order_id = po.id
left join public.production_material_usage pmu on pmu.production_order_id = po.id
left join public.production_qc_checks qc on qc.production_order_id = po.id
left join public.warehouse_items wi on wi.id = po.output_warehouse_item_id
left join (
  select production_order_id, sum(quantity) as output_registered_qty, count(*) as output_count
  from public.production_output
  group by production_order_id
) outp on outp.production_order_id = po.id
group by po.id, o.order_code, pwt.name_fa, wi.item_code, wi.item_name_fa, outp.output_registered_qty, outp.output_count;

grant select on public.v_production_order_overview to authenticated;

-- ---------------------------------------------------------------------
-- 4) Finance invoice approval -> final warehouse OUT document.
-- ---------------------------------------------------------------------
alter table public.finance_documents
  add column if not exists warehouse_issue_document_id uuid references public.warehouse_documents(id);

create or replace function public.fn_finance_issue_inventory_for_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_wh_doc_id uuid;
  v_doc_number text;
  v_line record;
  v_tx_id uuid;
  v_actor uuid;
  v_party_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت خروج انبار فاکتور ندارید';
  end if;

  select * into v_doc
  from public.finance_documents
  where id = p_document_id
  for update;

  if not found then raise exception 'فاکتور یافت نشد'; end if;
  if v_doc.document_type <> 'sales_invoice' then return null; end if;
  if v_doc.status::text in ('void','cancelled') then raise exception 'فاکتور باطل/لغوشده قابل خروج انبار نیست'; end if;

  if v_doc.warehouse_issue_document_id is not null then
    return v_doc.warehouse_issue_document_id;
  end if;

  if exists (
    select 1
    from public.warehouse_transactions
    where reference_type = 'finance_document'
      and reference_id = p_document_id
      and transaction_type = 'issue'::public.warehouse_transaction_type
  ) then
    select document_id into v_wh_doc_id
    from public.warehouse_transactions
    where reference_type = 'finance_document'
      and reference_id = p_document_id
      and transaction_type = 'issue'::public.warehouse_transaction_type
    limit 1;

    update public.finance_documents
    set warehouse_issue_document_id = v_wh_doc_id,
        updated_at = now()
    where id = p_document_id;

    return v_wh_doc_id;
  end if;

  if not exists (
    select 1 from public.finance_document_items
    where document_id = p_document_id
      and warehouse_item_id is not null
      and quantity > 0
  ) then
    return null;
  end if;

  v_actor := coalesce(v_doc.approved_by, auth.uid(), v_doc.created_by);
  select display_name into v_party_name from public.finance_parties where id = v_doc.party_id;

  v_doc_number := 'WH-OUT-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_out_doc_seq')::text, 4, '0');

  insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note, customer_name)
  values (
    v_doc_number,
    'out'::public.warehouse_document_type,
    'final'::public.warehouse_document_status,
    v_actor,
    now(),
    'خروج خودکار بابت فاکتور فروش ' || v_doc.doc_number,
    v_party_name
  ) returning id into v_wh_doc_id;

  for v_line in
    select warehouse_item_id, sum(quantity) as quantity, min(description_fa) as description_fa
    from public.finance_document_items
    where document_id = p_document_id
      and warehouse_item_id is not null
      and quantity > 0
    group by warehouse_item_id
  loop
    insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
    values (
      v_line.warehouse_item_id,
      'issue'::public.warehouse_transaction_type,
      v_line.quantity,
      'finance_document',
      p_document_id,
      v_wh_doc_id,
      v_actor,
      'خروج بابت فاکتور ' || v_doc.doc_number || ' - ' || coalesce(v_line.description_fa, '')
    ) returning id into v_tx_id;

    insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
    values (v_wh_doc_id, v_line.warehouse_item_id, v_line.quantity, 'order_delivery', 'خروج بابت فاکتور ' || v_doc.doc_number, v_tx_id);
  end loop;

  update public.finance_documents
  set warehouse_issue_document_id = v_wh_doc_id,
      updated_at = now()
  where id = p_document_id;

  if v_doc.related_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (
      v_doc.related_order_id,
      'warehouse',
      'خروج انبار فاکتور ثبت شد',
      'سند خروج انبار ' || v_doc_number || ' برای فاکتور ' || v_doc.doc_number || ' ثبت شد.',
      v_actor
    );
  end if;

  return v_wh_doc_id;
end;
$$;

grant execute on function public.fn_finance_issue_inventory_for_document(uuid) to authenticated;

create or replace function public.fn_finance_inventory_issue_after_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_type = 'sales_invoice'
     and new.status::text in ('approved','partially_paid','paid')
     and new.warehouse_issue_document_id is null then
    perform public.fn_finance_issue_inventory_for_document(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_inventory_issue_after_approval on public.finance_documents;
create trigger trg_finance_inventory_issue_after_approval
after insert or update of status on public.finance_documents
for each row execute function public.fn_finance_inventory_issue_after_approval();

-- Override void to cancel related warehouse issue document safely.
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
  v_wh_doc uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can void finance documents';
  end if;

  select status, warehouse_issue_document_id into v_old_status, v_wh_doc
  from public.finance_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Finance document not found';
  end if;

  update public.finance_documents
  set status = 'void',
      void_reason = p_reason,
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = p_document_id;

  if v_wh_doc is not null then
    update public.warehouse_documents
    set status = 'cancelled'::public.warehouse_document_status,
        cancelled_at = now(),
        note = concat_ws(E'\n', note, 'ابطال خودکار به دلیل ابطال فاکتور مالی: ' || coalesce(p_reason, ''))
    where id = v_wh_doc;
  end if;

  perform public.fn_log_finance_document_event(
    p_document_id,
    'voided',
    'سند باطل شد: ' || coalesce(p_reason, ''),
    v_old_status,
    'void'
  );
end;
$$;

grant execute on function public.fn_void_finance_document(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Production material issue -> warehouse OUT draft; no stock effect until final.
-- ---------------------------------------------------------------------
alter table public.production_material_usage
  add column if not exists warehouse_document_id uuid references public.warehouse_documents(id),
  add column if not exists warehouse_document_line_id uuid references public.warehouse_document_lines(id);

-- The old trigger deducted stock immediately; new flow waits for warehouse finalization.
drop trigger if exists trg_issue_production_material on public.production_material_usage;

create or replace function public.fn_production_prepare_material_usage_from_bom(
  p_production_order_id uuid,
  p_bom_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_bom_id uuid;
  v_count int := 0;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی ثبت مواد مصرفی تولید ندارید';
  end if;

  select * into v_po from public.production_orders where id = p_production_order_id;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  v_bom_id := p_bom_id;
  if v_bom_id is null then
    select id into v_bom_id
    from public.production_boms
    where related_production_order_id = p_production_order_id
       or (related_order_id is not null and related_order_id = v_po.source_order_id)
    order by updated_at desc, created_at desc
    limit 1;
  end if;

  if v_bom_id is null then
    raise exception 'فرمول تولید مرتبط یافت نشد';
  end if;

  -- Always refresh latest BOM list for non-issued/non-final lines.
  update public.production_material_usage pmu
  set status = 'cancelled'
  where pmu.production_order_id = p_production_order_id
    and pmu.status <> 'cancelled'
    and pmu.quantity_issued is null
    and not exists (
      select 1 from public.warehouse_documents wd
      where wd.id = pmu.warehouse_document_id and wd.status::text = 'final'
    );

  insert into public.production_material_usage (
    production_order_id, warehouse_item_id, quantity_requested, quantity_issued,
    status, requested_by, created_at
  )
  select
    p_production_order_id,
    bi.warehouse_item_id,
    bi.quantity * coalesce(v_po.quantity_planned, 1),
    null,
    'pending',
    auth.uid(),
    now()
  from public.production_bom_items bi
  where bi.bom_id = v_bom_id
    and bi.cost_type = 'material'
    and bi.warehouse_item_id is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.fn_production_prepare_material_usage_from_bom(uuid,uuid) to authenticated;

create or replace function public.fn_production_issue_material_usage(
  p_usage_id uuid,
  p_quantity numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.production_material_usage%rowtype;
  v_po public.production_orders%rowtype;
  v_qty numeric;
  v_doc_id uuid;
  v_tx_id uuid;
  v_line_id uuid;
  v_doc_status text;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی درخواست خروج مواد تولید ندارید';
  end if;

  select * into v_usage
  from public.production_material_usage
  where id = p_usage_id
  for update;

  if not found then raise exception 'ردیف مواد مصرفی یافت نشد'; end if;
  if v_usage.status = 'cancelled' then raise exception 'ردیف مواد مصرفی لغو شده است'; end if;

  select * into v_po from public.production_orders where id = v_usage.production_order_id;

  if v_usage.warehouse_document_id is not null then
    select status::text into v_doc_status from public.warehouse_documents where id = v_usage.warehouse_document_id;
    if v_doc_status = 'final' or v_usage.status = 'issued' then
      return p_usage_id;
    end if;
    if v_doc_status = 'draft' then
      return p_usage_id;
    end if;
  end if;

  v_qty := coalesce(p_quantity, v_usage.quantity_requested);
  if v_qty is null or v_qty <= 0 then raise exception 'مقدار درخواست خروج مواد نامعتبر است'; end if;

  v_doc_id := public.fn_get_or_create_open_draft('out');

  insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
  values (
    v_usage.warehouse_item_id,
    'issue'::public.warehouse_transaction_type,
    v_qty,
    'production_material_usage',
    p_usage_id,
    v_doc_id,
    auth.uid(),
    'درخواست خروج مواد مصرفی تولید ' || coalesce(v_po.code, '')
  ) returning id into v_tx_id;

  insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
  values (v_doc_id, v_usage.warehouse_item_id, v_qty, 'production_start', 'درخواست خروج مواد تولید ' || coalesce(v_po.code, ''), v_tx_id)
  returning id into v_line_id;

  update public.production_material_usage
  set warehouse_document_id = v_doc_id,
      warehouse_document_line_id = v_line_id,
      issued_by = null,
      issued_at = null,
      quantity_issued = null,
      status = 'pending'
  where id = p_usage_id;

  insert into public.production_documents (production_order_id, document_type, title_fa, description_fa, status, created_by)
  values (
    v_usage.production_order_id,
    'material_issue',
    'درخواست خروج مواد مصرفی تولید',
    'درخواست خروج مواد در سند موقت انبار ثبت شد و پس از تأیید انبار از موجودی کسر می‌شود.',
    'registered',
    auth.uid()
  );

  return p_usage_id;
end;
$$;

create or replace function public.fn_production_issue_all_materials(
  p_production_order_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی درخواست خروج مواد تولید ندارید';
  end if;

  for v_row in
    select pmu.id
    from public.production_material_usage pmu
    left join public.warehouse_documents wd on wd.id = pmu.warehouse_document_id
    where pmu.production_order_id = p_production_order_id
      and pmu.status <> 'cancelled'
      and pmu.quantity_issued is null
      and (pmu.warehouse_document_id is null or wd.status::text not in ('draft','final'))
    order by pmu.created_at
  loop
    perform public.fn_production_issue_material_usage(v_row.id, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.fn_production_issue_material_usage(uuid,numeric) to authenticated;
grant execute on function public.fn_production_issue_all_materials(uuid) to authenticated;

create or replace function public.fn_sync_production_material_usage_from_warehouse_doc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'final' then
    update public.production_material_usage pmu
    set quantity_issued = wdl.quantity,
        status = 'issued',
        issued_by = coalesce(new.created_by, auth.uid()),
        issued_at = coalesce(new.finalized_at, now())
    from public.warehouse_document_lines wdl
    where wdl.document_id = new.id
      and wdl.id = pmu.warehouse_document_line_id
      and pmu.status <> 'cancelled';
  elsif new.status::text = 'cancelled' then
    update public.production_material_usage pmu
    set quantity_issued = null,
        status = 'pending',
        issued_by = null,
        issued_at = null,
        warehouse_document_id = null,
        warehouse_document_line_id = null
    where pmu.warehouse_document_id = new.id
      and pmu.status <> 'cancelled';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_production_material_usage_from_warehouse_doc on public.warehouse_documents;
create trigger trg_sync_production_material_usage_from_warehouse_doc
after update of status on public.warehouse_documents
for each row execute function public.fn_sync_production_material_usage_from_warehouse_doc();

-- Drop this view before recreating it because newer stages append/remove
-- grouping columns and PostgreSQL does not allow CREATE OR REPLACE VIEW
-- to drop or reorder existing view columns.
drop view if exists public.v_production_material_usage_overview;

create or replace view public.v_production_material_usage_overview
with (security_invoker = true)
as
select
  pmu.id,
  pmu.production_order_id,
  po.code as production_code,
  po.source_order_id,
  po.source_order_code,
  po.product_name_fa,
  pmu.stage_id,
  pmu.warehouse_item_id,
  wi.item_code,
  wi.item_name_fa,
  wi.unit,
  wi.category,
  cat.item_group_label,
  pmu.quantity_requested,
  pmu.quantity_issued,
  pmu.status,
  pmu.requested_by,
  pmu.issued_by,
  pmu.created_at,
  pmu.issued_at,
  cat.current_qty,
  cat.available_for_sale_qty,
  cat.unit_price_estimate,
  (pmu.quantity_requested * coalesce(cat.unit_price_estimate, 0)) as estimated_cost,
  pmu.warehouse_document_id,
  wd.doc_number as warehouse_document_number,
  wd.status as warehouse_document_status,
  pmu.warehouse_document_line_id
from public.production_material_usage pmu
join public.production_orders po on po.id = pmu.production_order_id
join public.warehouse_items wi on wi.id = pmu.warehouse_item_id
left join public.v_app_inventory_catalog cat on cat.item_id = pmu.warehouse_item_id
left join public.warehouse_documents wd on wd.id = pmu.warehouse_document_id
where pmu.status <> 'cancelled';

grant select on public.v_production_material_usage_overview to authenticated;

notify pgrst, 'reload schema';
