-- =====================================================================
-- 036_PRODUCTION_MATERIAL_ISSUE_AND_INVENTORY_CATALOG
-- Stabilizes the shared inventory catalog and production material issue flow.
-- - One inventory catalog for Orders/Finance/Warehouse/Production/R&D
-- - Prepared material usage view for production
-- - RPCs to issue one/all production material lines
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Unified inventory catalog, safe to re-run
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
-- 2) Production material usage overview
-- ---------------------------------------------------------------------
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
  (pmu.quantity_requested * coalesce(cat.unit_price_estimate, 0)) as estimated_cost
from public.production_material_usage pmu
join public.production_orders po on po.id = pmu.production_order_id
join public.warehouse_items wi on wi.id = pmu.warehouse_item_id
left join public.v_app_inventory_catalog cat on cat.item_id = pmu.warehouse_item_id;

grant select on public.v_production_material_usage_overview to authenticated;

-- ---------------------------------------------------------------------
-- 3) Issue production material lines
-- Existing trigger trg_issue_production_material turns quantity_issued updates
-- into warehouse issue transactions. We call update only once per line.
-- ---------------------------------------------------------------------
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
  v_qty numeric;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی صدور مواد تولید ندارید';
  end if;

  select * into v_usage
  from public.production_material_usage
  where id = p_usage_id
  for update;

  if not found then
    raise exception 'ردیف مواد مصرفی یافت نشد';
  end if;

  if v_usage.status = 'issued' or v_usage.quantity_issued is not null then
    return p_usage_id;
  end if;

  v_qty := coalesce(p_quantity, v_usage.quantity_requested);
  if v_qty is null or v_qty <= 0 then
    raise exception 'مقدار صدور مواد نامعتبر است';
  end if;

  update public.production_material_usage
  set quantity_issued = v_qty,
      issued_by = auth.uid()
  where id = p_usage_id;

  insert into public.production_documents (
    production_order_id, document_type, title_fa, description_fa, status, created_by
  ) values (
    v_usage.production_order_id,
    'material_issue',
    'صدور مواد مصرفی تولید',
    'ردیف مواد مصرفی با مقدار ' || v_qty || ' صادر شد.',
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
    raise exception 'دسترسی صدور مواد تولید ندارید';
  end if;

  for v_row in
    select id from public.production_material_usage
    where production_order_id = p_production_order_id
      and status <> 'cancelled'
      and quantity_issued is null
    order by created_at
  loop
    perform public.fn_production_issue_material_usage(v_row.id, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Prepare material usage remains in 035; grant again for safety.
grant execute on function public.fn_production_prepare_material_usage_from_bom(uuid,uuid) to authenticated;
grant execute on function public.fn_production_issue_material_usage(uuid,numeric) to authenticated;
grant execute on function public.fn_production_issue_all_materials(uuid) to authenticated;

notify pgrst, 'reload schema';
