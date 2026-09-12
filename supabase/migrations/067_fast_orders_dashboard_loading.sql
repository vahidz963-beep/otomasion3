-- =====================================================================
-- 067_FAST_ORDERS_DASHBOARD_LOADING
-- Fixes statement timeout on Orders and Dashboard by adding lightweight
-- customer/contact and order overview data sources.
-- =====================================================================

alter table public.finance_parties
  add column if not exists registration_number text,
  add column if not exists postal_code text;

-- 1) Very light shared customers/contact list for Orders/CRM initial load.
create or replace view public.v_customer_accounting_contacts_fast
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.contact_person_name,
  c.contact_phone,
  c.contact_email,
  c.address,
  c.city,
  c.preferred_contact_channel,
  c.acquisition_source,
  c.crm_status,
  c.lead_score,
  c.assigned_sales_id,
  pr.full_name as assigned_sales_name,
  c.last_contacted_at,
  c.next_follow_up_at,
  c.is_active,
  fp.id as finance_party_id,
  fp.party_type as finance_party_type,
  fp.economic_code,
  fp.registration_number,
  fp.national_id,
  fp.postal_code,
  fp.opening_balance,
  fp.notes as finance_notes,
  0::bigint as total_orders,
  0::numeric as total_sales_amount,
  null::timestamptz as last_order_at,
  0::bigint as due_followups
from public.customers c
left join public.finance_parties fp
  on fp.linked_customer_id = c.id
 and fp.party_type = 'customer'::public.finance_party_type
left join public.profiles pr on pr.id = c.assigned_sales_id
where coalesce(c.is_active, true) = true;

-- 2) Fast order overview. It limits orders first, then aggregates only related rows.
create or replace function public.fn_orders_fast_overview(
  p_date_from date default null,
  p_date_to date default null,
  p_sales_path text default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  order_code text,
  customer_id uuid,
  customer_name text,
  contact_phone text,
  customer_city text,
  preferred_contact_channel text,
  acquisition_source text,
  sales_path text,
  current_stage text,
  current_stage_name_fa text,
  workflow_template_id uuid,
  workflow_template_name text,
  total_stages bigint,
  done_stages bigint,
  progress_percent numeric,
  registered_at date,
  expected_delivery_date date,
  days_to_delivery integer,
  delivery_status text,
  stock_short_items bigint,
  stock_unknown_items bigint,
  stock_status text,
  proforma_count bigint,
  invoice_count bigint,
  invoiced_amount numeric,
  paid_amount numeric,
  balance_amount numeric,
  financial_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_active_user() then
    raise exception 'Access denied';
  end if;

  return query
  with limited_orders as (
    select
      o.id,
      o.order_code,
      o.customer_id,
      o.sales_path,
      o.current_stage,
      o.workflow_template_id,
      o.registered_at,
      o.expected_delivery_date,
      o.is_cancelled,
      o.customer_phone_snapshot,
      o.customer_city_snapshot,
      o.contact_channel,
      o.created_at,
      o.updated_at,
      c.company_name,
      c.contact_phone,
      c.city,
      c.preferred_contact_channel,
      c.acquisition_source
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where (p_date_from is null or o.registered_at >= p_date_from)
      and (p_date_to is null or o.registered_at <= p_date_to)
      and (p_sales_path is null or p_sales_path = '' or o.sales_path::text = p_sales_path)
    order by o.registered_at desc, o.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ), stage_counts as (
    select
      osi.order_id,
      count(*) as total_stages,
      count(*) filter (where osi.status = 'done') as done_stages,
      count(*) filter (where osi.status = 'current') as current_stage_count
    from public.order_stage_instances osi
    join limited_orders lo on lo.id = osi.order_id
    group by osi.order_id
  ), stock_summary as (
    select
      oi.order_id,
      0::bigint as short_items,
      count(*) filter (where nullif(oi.warehouse_item_code, '') is not null and wi.id is null) as unknown_items
    from public.order_items oi
    join limited_orders lo on lo.id = oi.order_id
    left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
    group by oi.order_id
  ), finance_summary as (
    select
      d.related_order_id as order_id,
      coalesce(sum(d.total_amount) filter (where d.document_type in ('sales_invoice','debit_note') and d.status <> 'void'), 0) as invoiced_amount,
      coalesce(sum(d.paid_amount) filter (where d.document_type in ('sales_invoice','debit_note') and d.status <> 'void'), 0) as paid_amount,
      coalesce(sum(d.balance_amount) filter (where d.document_type in ('sales_invoice','debit_note') and d.status <> 'void'), 0) as balance_amount,
      count(*) filter (where d.document_type = 'sales_proforma' and d.status <> 'void') as proforma_count,
      count(*) filter (where d.document_type = 'sales_invoice' and d.status <> 'void') as invoice_count
    from public.finance_documents d
    join limited_orders lo on lo.id = d.related_order_id
    group by d.related_order_id
  )
  select
    lo.id,
    lo.order_code,
    lo.customer_id,
    lo.company_name as customer_name,
    coalesce(lo.customer_phone_snapshot, lo.contact_phone) as contact_phone,
    coalesce(lo.customer_city_snapshot, lo.city) as customer_city,
    coalesce(lo.contact_channel::text, lo.preferred_contact_channel::text) as preferred_contact_channel,
    lo.acquisition_source,
    lo.sales_path::text as sales_path,
    lo.current_stage,
    coalesce(osi.stage_name_fa, osd.stage_name_fa, lo.current_stage) as current_stage_name_fa,
    lo.workflow_template_id,
    wt.name_fa as workflow_template_name,
    coalesce(sc.total_stages, 0) as total_stages,
    coalesce(sc.done_stages, 0) as done_stages,
    case when coalesce(sc.total_stages, 0) > 0
         then round(((coalesce(sc.done_stages, 0) + coalesce(sc.current_stage_count, 0))::numeric / sc.total_stages) * 100, 1)
         else 0 end as progress_percent,
    lo.registered_at,
    lo.expected_delivery_date,
    (lo.expected_delivery_date - current_date)::integer as days_to_delivery,
    case
      when lo.is_cancelled then 'cancelled'
      when lo.current_stage = 'closed' then 'closed'
      when lo.expected_delivery_date < current_date then 'late'
      when lo.expected_delivery_date <= current_date + 3 then 'due_soon'
      else 'on_track'
    end as delivery_status,
    coalesce(ss.short_items, 0) as stock_short_items,
    coalesce(ss.unknown_items, 0) as stock_unknown_items,
    case
      when coalesce(ss.short_items, 0) > 0 then 'short'
      when coalesce(ss.unknown_items, 0) > 0 then 'unknown'
      else 'available'
    end as stock_status,
    coalesce(fs.proforma_count, 0) as proforma_count,
    coalesce(fs.invoice_count, 0) as invoice_count,
    coalesce(fs.invoiced_amount, 0) as invoiced_amount,
    coalesce(fs.paid_amount, 0) as paid_amount,
    coalesce(fs.balance_amount, 0) as balance_amount,
    case
      when coalesce(fs.invoice_count, 0) = 0 and coalesce(fs.proforma_count, 0) = 0 then 'none'
      when coalesce(fs.balance_amount, 0) <= 0 and coalesce(fs.invoice_count, 0) > 0 then 'paid'
      when coalesce(fs.paid_amount, 0) > 0 then 'partial'
      when coalesce(fs.invoice_count, 0) > 0 then 'invoiced'
      else 'proforma'
    end as financial_status,
    lo.created_at,
    lo.updated_at
  from limited_orders lo
  left join public.order_workflow_templates wt on wt.id = lo.workflow_template_id
  left join stage_counts sc on sc.order_id = lo.id
  left join stock_summary ss on ss.order_id = lo.id
  left join finance_summary fs on fs.order_id = lo.id
  left join public.order_stage_instances osi on osi.order_id = lo.id and osi.stage_key = lo.current_stage
  left join public.order_status_definitions osd on osd.sales_path = lo.sales_path and osd.stage_key = lo.current_stage
  order by lo.registered_at desc, lo.created_at desc;
end;
$$;

-- 3) Planner indexes used by the fast loaders.
create index if not exists idx_fast_orders_registered_path on public.orders (registered_at desc, sales_path, id);
create index if not exists idx_fast_orders_customer on public.orders (customer_id, registered_at desc);
create index if not exists idx_fast_order_stages_order_stage on public.order_stage_instances (order_id, stage_key, status, stage_order);
create index if not exists idx_fast_order_items_order_code on public.order_items (order_id, warehouse_item_code);
create index if not exists idx_fast_fin_docs_order_type_status on public.finance_documents (related_order_id, document_type, status);
create index if not exists idx_fast_fin_docs_issue_type_status on public.finance_documents (issue_date desc, document_type, status);
create index if not exists idx_fast_payments_status_date on public.finance_payments (status, payment_date desc, direction);
create index if not exists idx_fast_customers_active_status_name on public.customers (is_active, crm_status, company_name);
create index if not exists idx_fast_fin_parties_linked_customer on public.finance_parties (linked_customer_id, party_type);

analyze public.orders;
analyze public.order_stage_instances;
analyze public.order_items;
analyze public.finance_documents;
analyze public.finance_payments;
analyze public.customers;
analyze public.finance_parties;

grant usage on schema public to authenticated, service_role;
grant select on public.v_customer_accounting_contacts_fast to authenticated, service_role;
grant execute on function public.fn_orders_fast_overview(date, date, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
