-- =====================================================================
-- 069_CUSTOMER_CODE_CROSS_MODULE_VIEWS
-- Exposes the canonical customer code in Orders, R&D, Production and
-- Warehouse rows without duplicating the customer identity.
-- =====================================================================

create or replace view public.v_production_incoming_orders
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.description_fa,
  o.expected_delivery_date,
  o.priority,
  c.company_name as customer_name,
  c.contact_phone,
  coalesce(sum(oi.quantity), 1) as total_quantity,
  count(oi.id) as item_count,
  max(o.created_at) as created_at,
  c.customer_code
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_items oi on oi.order_id = o.id
where o.sales_path = 'production'
  and coalesce(o.is_cancelled, false) = false
  and o.production_order_id is null
group by o.id, c.id;

grant select on public.v_production_incoming_orders to authenticated, service_role;

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
  (coalesce(count(pos.id), 0) = 0 or coalesce(count(pos.id) filter (where pos.status = 'completed'), 0) = coalesce(count(pos.id), 0)) as can_register_output,
  coalesce(c.customer_code, '') as customer_code
from public.production_orders po
left join public.orders o on o.id = po.source_order_id
left join public.customers c on c.id = o.customer_id
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
group by po.id, o.order_code, c.customer_code, pwt.name_fa, wi.item_code, wi.item_name_fa, outp.output_registered_qty, outp.output_count;

grant select on public.v_production_order_overview to authenticated, service_role;

create or replace view public.v_rnd_incoming_orders
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.description_fa,
  o.expected_delivery_date,
  o.priority,
  c.company_name as customer_name,
  c.contact_phone,
  count(oi.id) as item_count,
  coalesce(sum(oi.quantity),1) as total_quantity,
  o.created_at,
  c.customer_code
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_items oi on oi.order_id = o.id
where o.sales_path = 'rnd'
  and coalesce(o.is_cancelled,false) = false
  and o.rnd_project_id is null
group by o.id, c.id;

grant select on public.v_rnd_incoming_orders to authenticated, service_role;

create or replace view public.v_rnd_project_overview
with (security_invoker = true)
as
select
  rp.id,
  rp.code,
  rp.title_fa,
  rp.title_en,
  rp.source_order_id,
  o.order_code,
  rp.source_order_code,
  rp.customer_name_snapshot as customer_name,
  rp.requester_name,
  rp.status,
  rp.progress_percent,
  rp.current_stage_name_fa,
  rp.output_destination,
  rp.planned_start,
  rp.planned_end,
  (rp.planned_end - current_date) as days_to_delivery,
  case
    when rp.status in ('approved','sent_to_production','archived') then 'completed'
    when rp.status = 'rejected' then 'cancelled'
    when rp.planned_end is not null and rp.planned_end < current_date then 'late'
    when rp.planned_end is not null and rp.planned_end <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as delivery_status,
  rp.work_days,
  rp.total_man_hours,
  rp.estimated_total_cost,
  rp.actual_total_cost,
  rp.workflow_template_id,
  rwt.name_fa as workflow_template_name,
  coalesce(count(rs.id),0) as total_stages,
  coalesce(count(rs.id) filter (where rs.status = 'completed'),0) as completed_stages,
  rp.created_at,
  rp.updated_at,
  coalesce(c.customer_code, '') as customer_code
from public.rnd_projects rp
left join public.orders o on o.id = rp.source_order_id
left join public.customers c on c.id = o.customer_id
left join public.rnd_workflow_templates rwt on rwt.id = rp.workflow_template_id
left join public.rnd_project_stages rs on rs.rnd_project_id = rp.id
group by rp.id, o.order_code, c.customer_code, rwt.name_fa;

grant select on public.v_rnd_project_overview to authenticated, service_role;

create or replace view public.v_warehouse_shipment_overview
with (security_invoker = true)
as
-- Do not use s.* here. Migration 043 added source_record_id after this view
-- was originally created; s.* would shift existing view columns and make
-- CREATE OR REPLACE VIEW fail. Keep the historical column order explicit.
select
  s.id,
  s.shipment_number,
  s.source_type,
  s.warehouse_document_id,
  s.finance_document_id,
  s.related_order_id,
  s.customer_name,
  s.customer_city,
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
  wd.doc_number as warehouse_doc_number,
  fd.doc_number as finance_doc_number,
  o.order_code,
  fp.display_name as party_name,
  c.customer_code
from public.warehouse_shipments s
left join public.warehouse_documents wd on wd.id = s.warehouse_document_id
left join public.finance_documents fd on fd.id = s.finance_document_id
left join public.finance_parties fp on fp.id = fd.party_id
left join public.orders o on o.id = s.related_order_id
left join public.customers c on c.id = o.customer_id;

grant select on public.v_warehouse_shipment_overview to authenticated, service_role;

notify pgrst, 'reload schema';
