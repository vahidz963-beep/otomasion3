-- =====================================================================
-- 035_PRODUCTION_INVENTORY_FINANCE_FLOW_STABILITY
-- Stabilizes production -> inventory -> finance/order profitability flow.
-- - Unified inventory catalog view for all modules
-- - Production output RPC that safely adds produced quantity to warehouse
-- - Material usage preparation from production BOM
-- - Better linkage from production BOM to production order and source order
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Unified inventory catalog for Orders/Finance/Warehouse/Production/R&D
-- ---------------------------------------------------------------------
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
  s.reserved_qty,
  s.available_for_sale_qty,
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

-- Preserve existing v_sales_stock_overview columns and append labels for new UI.
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

-- ---------------------------------------------------------------------
-- 2) Ensure BOM publish links production/order ids and creates item price
-- ---------------------------------------------------------------------
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
      v_item_code := 'PRD-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.production_item_code_seq')::text, 5, '0');
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

-- ---------------------------------------------------------------------
-- 3) Register production output robustly and update warehouse/order feedback
-- ---------------------------------------------------------------------
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
  v_output_id uuid;
  v_bom_id uuid;
  v_total_produced numeric;
  v_done boolean;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی ثبت خروجی تولید ندارید';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'تعداد خروجی تولید باید بزرگ‌تر از صفر باشد';
  end if;

  select * into v_po from public.production_orders where id = p_production_order_id for update;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  v_item_id := p_warehouse_item_id;

  if v_item_id is null then
    v_item_id := v_po.output_warehouse_item_id;
  end if;

  if v_item_id is null then
    select id into v_bom_id
    from public.production_boms
    where related_production_order_id = p_production_order_id
       or (related_order_id is not null and related_order_id = v_po.source_order_id)
    order by updated_at desc, created_at desc
    limit 1;

    if v_bom_id is not null then
      v_item_id := public.fn_production_publish_bom_to_warehouse(v_bom_id, null);
    end if;
  end if;

  if v_item_id is null then
    raise exception 'برای ثبت خروجی، ابتدا کالای انبار یا فرمول تولید مرتبط را مشخص کنید';
  end if;

  insert into public.production_output (
    production_order_id, warehouse_item_id, quantity, registered_by
  ) values (
    p_production_order_id, v_item_id, p_quantity, auth.uid()
  ) returning id into v_output_id;

  update public.production_orders
  set output_warehouse_item_id = v_item_id,
      updated_at = now()
  where id = p_production_order_id;

  select quantity_produced into v_total_produced
  from public.production_orders
  where id = p_production_order_id;

  v_done := coalesce(v_total_produced,0) >= coalesce(v_po.quantity_planned,0);

  insert into public.production_documents (
    production_order_id, document_type, title_fa, description_fa, status, created_by
  ) values (
    p_production_order_id,
    'output',
    'ثبت خروجی تولید در انبار',
    'تعداد ' || p_quantity || ' ' || coalesce(v_po.unit,'عدد') || ' به موجودی انبار اضافه شد.',
    'registered',
    auth.uid()
  );

  if v_po.source_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (
      v_po.source_order_id,
      'production',
      'خروجی تولید در انبار ثبت شد',
      'کد تولید ' || v_po.code || '، مقدار خروجی: ' || p_quantity || '، مجموع تولید: ' || coalesce(v_total_produced,0),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'output_id', v_output_id,
    'warehouse_item_id', v_item_id,
    'quantity_registered', p_quantity,
    'total_produced', v_total_produced,
    'production_completed', v_done
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Prepare material usage lines from BOM for production order
-- ---------------------------------------------------------------------
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
    and bi.warehouse_item_id is not null
    and not exists (
      select 1
      from public.production_material_usage pmu
      where pmu.production_order_id = p_production_order_id
        and pmu.warehouse_item_id = bi.warehouse_item_id
        and pmu.status <> 'cancelled'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant select on public.v_app_inventory_catalog to authenticated;
grant execute on function public.fn_production_publish_bom_to_warehouse(uuid,text) to authenticated;
grant execute on function public.fn_production_register_output(uuid,numeric,uuid) to authenticated;
grant execute on function public.fn_production_prepare_material_usage_from_bom(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
