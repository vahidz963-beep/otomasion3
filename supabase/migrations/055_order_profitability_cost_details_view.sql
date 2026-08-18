-- =====================================================================
-- 055_ORDER_PROFITABILITY_COST_DETAILS_VIEW
-- Adds complete cost drill-down data for Accounting > Order Profit.
-- The UI can show cost details by order from v_order_unified_costs:
-- - manual finance order costs
-- - production/BOM costs
-- - R&D cost items
-- - purchase/expense finance documents linked to the order
-- Also updates v_order_profitability to avoid double-counting document costs.
-- =====================================================================

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
  d.related_order_id as order_id,
  'finance_document_cost'::text as source_type,
  d.id as source_id,
  case
    when d.document_type = 'purchase_invoice' then 'purchase'
    when d.document_type = 'expense_invoice' then 'other'
    else 'document'
  end as cost_type,
  greatest(coalesce(d.subtotal_amount, 0) - coalesce(d.discount_amount, 0), 0) as amount,
  concat_ws(' - ', d.doc_number, case when d.document_type = 'purchase_invoice' then 'فاکتور خرید' when d.document_type = 'expense_invoice' then 'سند هزینه' else d.document_type::text end, nullif(d.description, '')) as notes,
  d.created_at
from public.finance_documents d
where d.related_order_id is not null
  and d.document_type in ('purchase_invoice','expense_invoice')
  and d.status not in ('draft','cancelled','void')

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
with revenue_summary as (
  select
    related_order_id as order_id,
    coalesce(sum(subtotal_amount - discount_amount) filter (where document_type = 'sales_invoice' and status not in ('draft','cancelled','void')), 0) as revenue_before_tax,
    coalesce(sum(tax_amount) filter (where status not in ('draft','cancelled','void')), 0) as tax_total
  from public.finance_documents
  where related_order_id is not null
  group by related_order_id
), cost_summary as (
  select
    order_id,
    coalesce(sum(amount), 0) as cost_before_tax
  from public.v_order_unified_costs
  group by order_id
)
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.sales_path,
  c.company_name,
  coalesce(rs.revenue_before_tax, 0) as revenue_before_tax,
  coalesce(cs.cost_before_tax, 0) as cost_before_tax,
  coalesce(rs.tax_total, 0) as tax_total,
  coalesce(rs.revenue_before_tax, 0) - coalesce(cs.cost_before_tax, 0) as gross_profit,
  case
    when coalesce(rs.revenue_before_tax, 0) > 0
    then round((coalesce(rs.revenue_before_tax, 0) - coalesce(cs.cost_before_tax, 0)) / nullif(coalesce(rs.revenue_before_tax, 0), 0) * 100, 2)
    else null
  end as gross_margin_pct
from public.orders o
join public.customers c on c.id = o.customer_id
left join revenue_summary rs on rs.order_id = o.id
left join cost_summary cs on cs.order_id = o.id;

grant select on public.v_order_unified_costs to authenticated;
grant select on public.v_order_profitability to authenticated;

notify pgrst, 'reload schema';
