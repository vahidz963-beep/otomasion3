-- =====================================================================
-- 034_FINAL_STABILITY_FINANCE_PRODUCTION_LINKS
-- Stabilization step:
-- - Links production BOMs to orders/production orders for profitability
-- - Rolls R&D and Production costs into order profitability by source_order_id
-- - Recalculates invoice status so paid status only happens when balance is zero
-- - Allows removing a production plan from the planning timeline
-- =====================================================================

alter table public.production_boms
  add column if not exists related_order_id uuid references public.orders(id) on delete set null,
  add column if not exists related_production_order_id uuid references public.production_orders(id) on delete set null,
  add column if not exists related_rnd_project_id uuid references public.rnd_projects(id) on delete set null;

create index if not exists idx_production_boms_related_order on public.production_boms(related_order_id);
create index if not exists idx_production_boms_related_production on public.production_boms(related_production_order_id);
create index if not exists idx_production_boms_related_rnd on public.production_boms(related_rnd_project_id);

create or replace view public.v_production_bom_summary
with (security_invoker = true)
as
select
  b.*,
  wi.item_code as warehouse_item_code,
  wi.item_name_fa as warehouse_item_name,
  po.code as production_order_code,
  po.source_order_id as production_source_order_id,
  o.order_code as related_order_code,
  count(i.id) as item_count
from public.production_boms b
left join public.warehouse_items wi on wi.id = b.warehouse_item_id
left join public.production_orders po on po.id = b.related_production_order_id
left join public.orders o on o.id = coalesce(b.related_order_id, po.source_order_id)
left join public.production_bom_items i on i.bom_id = b.id
group by b.id, wi.item_code, wi.item_name_fa, po.code, po.source_order_id, o.order_code;

-- Unified costs by order. The canonical connector is orders.id.
-- Production/R&D costs are mapped through their source_order_id.
create or replace view public.v_order_unified_costs
with (security_invoker = true)
as
select
  oc.related_order_id as order_id,
  'manual_finance_cost'::text as source_type,
  oc.id as source_id,
  oc.cost_type,
  oc.amount,
  oc.notes,
  oc.created_at
from public.finance_order_costs oc
where oc.related_order_id is not null

union all

select
  coalesce(b.related_order_id, po.source_order_id) as order_id,
  'production_bom'::text as source_type,
  b.id as source_id,
  'production'::text as cost_type,
  coalesce(b.total_estimated_cost, 0) as amount,
  'هزینه نهایی فرمول تولید: ' || b.product_name_fa as notes,
  b.updated_at as created_at
from public.production_boms b
left join public.production_orders po on po.id = b.related_production_order_id
where coalesce(b.related_order_id, po.source_order_id) is not null
  and b.status <> 'archived'

union all

select
  rp.source_order_id as order_id,
  'rnd_cost'::text as source_type,
  ci.id as source_id,
  ci.cost_type,
  coalesce(ci.total_cost, 0) as amount,
  ci.title_fa || coalesce(' - ' || ci.note, '') as notes,
  ci.created_at
from public.rnd_cost_items ci
join public.rnd_projects rp on rp.id = ci.rnd_project_id
where rp.source_order_id is not null;

create or replace view public.v_order_profitability
with (security_invoker = true)
as
with doc_summary as (
  select
    related_order_id as order_id,
    coalesce(sum(subtotal_amount - discount_amount) filter (where document_type = 'sales_invoice' and status not in ('draft','cancelled','void')), 0) as revenue_before_tax,
    coalesce(sum(subtotal_amount - discount_amount) filter (where document_type in ('purchase_invoice','expense_invoice') and status not in ('draft','cancelled','void')), 0) as document_cost_before_tax,
    coalesce(sum(tax_amount) filter (where status not in ('draft','cancelled','void')), 0) as tax_total
  from public.finance_documents
  where related_order_id is not null
  group by related_order_id
), cost_summary as (
  select
    order_id,
    coalesce(sum(amount), 0) as linked_costs
  from public.v_order_unified_costs
  group by order_id
)
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.sales_path,
  c.company_name,
  coalesce(ds.revenue_before_tax, 0) as revenue_before_tax,
  coalesce(ds.document_cost_before_tax, 0) + coalesce(cs.linked_costs, 0) as cost_before_tax,
  coalesce(ds.tax_total, 0) as tax_total,
  coalesce(ds.revenue_before_tax, 0) - (coalesce(ds.document_cost_before_tax, 0) + coalesce(cs.linked_costs, 0)) as gross_profit,
  case
    when coalesce(ds.revenue_before_tax, 0) > 0
    then round((coalesce(ds.revenue_before_tax, 0) - (coalesce(ds.document_cost_before_tax, 0) + coalesce(cs.linked_costs, 0))) / nullif(coalesce(ds.revenue_before_tax, 0), 0) * 100, 2)
    else null
  end as gross_margin_pct
from public.orders o
join public.customers c on c.id = o.customer_id
left join doc_summary ds on ds.order_id = o.id
left join cost_summary cs on cs.order_id = o.id;

-- Keep paid status accurate when totals change after editing.
create or replace function public.fn_finance_update_document_paid_amount(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_total numeric;
  v_status public.finance_document_status;
  v_new_status public.finance_document_status;
begin
  select coalesce(sum(a.amount), 0)
  into v_paid
  from public.finance_payment_allocations a
  join public.finance_payments p on p.id = a.payment_id
  where a.document_id = p_document_id
    and p.status = 'confirmed';

  select total_amount, status into v_total, v_status
  from public.finance_documents
  where id = p_document_id;

  v_new_status := case
    when v_status in ('cancelled','void','draft','pending_approval') then v_status
    when coalesce(v_paid, 0) >= coalesce(v_total, 0) and coalesce(v_total, 0) > 0 then 'paid'::public.finance_document_status
    when coalesce(v_paid, 0) > 0 then 'partially_paid'::public.finance_document_status
    when v_status in ('paid','partially_paid') then 'approved'::public.finance_document_status
    else v_status
  end;

  update public.finance_documents
  set paid_amount = least(coalesce(v_paid, 0), coalesce(v_total, 0)),
      status = v_new_status,
      updated_at = now()
  where id = p_document_id;
end;
$$;

create or replace function public.fn_finance_recalculate_document_totals(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_tax numeric;
  v_discount numeric;
begin
  select
    coalesce(sum(greatest((quantity * unit_price) - discount_amount, 0)), 0),
    coalesce(sum(tax_amount), 0)
  into v_subtotal, v_tax
  from public.finance_document_items
  where document_id = p_document_id;

  select discount_amount into v_discount
  from public.finance_documents
  where id = p_document_id;

  update public.finance_documents
  set subtotal_amount = v_subtotal,
      tax_amount = v_tax,
      total_amount = greatest(v_subtotal - coalesce(v_discount, 0) + v_tax, 0),
      updated_at = now()
  where id = p_document_id;

  perform public.fn_finance_update_document_paid_amount(p_document_id);
end;
$$;

-- Production planning: remove from timeline without deleting production order.
create or replace function public.fn_production_delete_plan(p_production_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  delete from public.production_plans
  where production_order_id = p_production_order_id;

  update public.production_orders
  set planned_start = null,
      planned_end = null,
      work_days = null,
      labor_people = null,
      total_man_hours = null,
      updated_at = now()
  where id = p_production_order_id;

  return p_production_order_id;
end;
$$;

grant select on public.v_order_unified_costs to authenticated;
grant select on public.v_order_profitability to authenticated;
grant select on public.v_production_bom_summary to authenticated;
grant execute on function public.fn_finance_update_document_paid_amount(uuid) to authenticated;
grant execute on function public.fn_finance_recalculate_document_totals(uuid) to authenticated;
grant execute on function public.fn_production_delete_plan(uuid) to authenticated;

notify pgrst, 'reload schema';
