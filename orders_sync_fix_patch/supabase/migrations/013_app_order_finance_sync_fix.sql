-- =====================================================================
-- 013_APP_ORDER_FINANCE_SYNC_FIX
-- Fixes online app sync issues between Orders, CRM, Inventory and Finance:
-- - Backfill stage instances for existing orders
-- - Robust lifecycle view after backfill
-- - Single RPC for creating an order with items, CRM customer, proforma and referrals
-- Run after 001..012.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Backfill / repair stage instances for orders
-- ---------------------------------------------------------------------
create or replace function public.fn_backfill_order_stage_instances()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  o record;
  v_template uuid;
  v_first_stage text;
  v_current_order int;
begin
  for o in select * from public.orders loop
    v_template := o.workflow_template_id;

    if v_template is null then
      v_template := public.fn_default_order_workflow_template(o.sales_path);
      update public.orders set workflow_template_id = v_template where id = o.id;
    end if;

    if v_template is null then
      continue;
    end if;

    perform public.fn_validate_order_workflow_template(v_template);

    select stage_key into v_first_stage
    from public.order_workflow_template_steps
    where template_id = v_template and is_active
    order by stage_order
    limit 1;

    if o.current_stage is null or not exists (
      select 1 from public.order_workflow_template_steps
      where template_id = v_template and stage_key = o.current_stage and is_active
    ) then
      update public.orders set current_stage = v_first_stage where id = o.id;
      o.current_stage := v_first_stage;
    end if;

    select stage_order into v_current_order
    from public.order_workflow_template_steps
    where template_id = v_template and stage_key = o.current_stage and is_active
    limit 1;

    insert into public.order_stage_instances (
      order_id, template_step_id, stage_key, stage_order, stage_name_fa, stage_name_en,
      responsible_role, status, started_at, completed_at
    )
    select
      o.id,
      s.id,
      s.stage_key,
      s.stage_order,
      s.stage_name_fa,
      s.stage_name_en,
      s.responsible_role,
      case
        when s.stage_order < v_current_order then 'done'::public.order_stage_instance_status
        when s.stage_order = v_current_order then 'current'::public.order_stage_instance_status
        else 'pending'::public.order_stage_instance_status
      end,
      case when s.stage_order = v_current_order then coalesce(o.created_at, now()) else null end,
      case when s.stage_order < v_current_order then coalesce(o.updated_at, now()) else null end
    from public.order_workflow_template_steps s
    where s.template_id = v_template and s.is_active
    on conflict (order_id, stage_key) do update set
      stage_order = excluded.stage_order,
      stage_name_fa = excluded.stage_name_fa,
      stage_name_en = excluded.stage_name_en,
      responsible_role = excluded.responsible_role;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

select public.fn_backfill_order_stage_instances();

-- ---------------------------------------------------------------------
-- 2) Robust order lifecycle view
-- ---------------------------------------------------------------------
create or replace view public.v_order_lifecycle_overview
with (security_invoker = true)
as
with stage_counts as (
  select
    order_id,
    count(*) as total_stages,
    count(*) filter (where status = 'done') as done_stages,
    count(*) filter (where status = 'current') as current_stage_count
  from public.order_stage_instances
  group by order_id
), stock_summary as (
  select
    order_id,
    count(*) filter (where stock_status = 'short') as short_items,
    count(*) filter (where stock_status in ('no_code','invalid_code')) as unknown_items,
    count(*) filter (where stock_status = 'available') as available_items
  from public.v_order_stock_status
  group by order_id
), finance_summary as (
  select
    related_order_id as order_id,
    coalesce(sum(total_amount) filter (where document_type in ('sales_invoice','debit_note') and status <> 'void'), 0) as invoiced_amount,
    coalesce(sum(paid_amount) filter (where document_type in ('sales_invoice','debit_note') and status <> 'void'), 0) as paid_amount,
    coalesce(sum(balance_amount) filter (where document_type in ('sales_invoice','debit_note') and status <> 'void'), 0) as balance_amount,
    count(*) filter (where document_type = 'sales_proforma' and status <> 'void') as proforma_count,
    count(*) filter (where document_type = 'sales_invoice' and status <> 'void') as invoice_count
  from public.finance_documents
  where related_order_id is not null
  group by related_order_id
)
select
  o.id,
  o.order_code,
  o.customer_id,
  c.company_name as customer_name,
  coalesce(o.customer_phone_snapshot, c.contact_phone) as contact_phone,
  coalesce(o.customer_city_snapshot, c.city) as customer_city,
  coalesce(o.contact_channel, c.preferred_contact_channel) as preferred_contact_channel,
  c.acquisition_source,
  o.sales_path,
  o.current_stage,
  coalesce(osi.stage_name_fa, d.stage_name_fa, o.current_stage) as current_stage_name_fa,
  o.workflow_template_id,
  wt.name_fa as workflow_template_name,
  coalesce(sc.total_stages, 0) as total_stages,
  coalesce(sc.done_stages, 0) as done_stages,
  case when coalesce(sc.total_stages, 0) > 0
       then round(((coalesce(sc.done_stages, 0) + coalesce(sc.current_stage_count, 0))::numeric / sc.total_stages) * 100, 1)
       else 0 end as progress_percent,
  o.registered_at,
  o.expected_delivery_date,
  (o.expected_delivery_date - current_date) as days_to_delivery,
  case
    when o.is_cancelled then 'cancelled'
    when o.current_stage = 'closed' then 'closed'
    when o.expected_delivery_date < current_date then 'late'
    when o.expected_delivery_date <= current_date + 3 then 'due_soon'
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
  end as financial_status
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_workflow_templates wt on wt.id = o.workflow_template_id
left join stage_counts sc on sc.order_id = o.id
left join stock_summary ss on ss.order_id = o.id
left join finance_summary fs on fs.order_id = o.id
left join public.order_stage_instances osi on osi.order_id = o.id and osi.stage_key = o.current_stage
left join public.order_status_definitions d on d.sales_path = o.sales_path and d.stage_key = o.current_stage;

-- ---------------------------------------------------------------------
-- 3) App-level order creation RPC
-- ---------------------------------------------------------------------
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
  v_sales_path public.order_sales_path;
  v_title text;
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

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.order_items (
      order_id, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price, notes
    ) values (
      v_order_id,
      coalesce(nullif(v_item->>'item_name_fa', ''), 'قلم سفارش'),
      nullif(v_item->>'item_name_en', ''),
      nullif(v_item->>'warehouse_item_code', ''),
      coalesce(nullif(v_item->>'quantity', '')::numeric, 1),
      coalesce(nullif(v_item->>'unit', ''), 'عدد'),
      coalesce(nullif(v_item->>'unit_price', '')::numeric, 0),
      nullif(v_item->>'notes', '')
    );
  end loop;

  if p_create_proforma then
    v_doc_id := public.fn_create_sales_proforma_from_order(v_order_id);
  end if;

  if p_ref_finance then
    perform public.fn_create_order_referral(v_order_id, 'accounting', 'صدور/پیگیری فاکتور سفارش ' || v_order_code, null, 'accountant', 2, null);
  end if;

  if p_ref_warehouse then
    perform public.fn_create_order_referral(v_order_id, 'warehouse', 'بررسی موجودی سفارش ' || v_order_code, null, 'warehouse', 2, null);
  end if;

  if p_ref_path then
    v_target_module := case v_sales_path when 'rnd' then 'rnd' when 'production' then 'production' else 'warehouse' end;
    v_target_role := case v_sales_path when 'rnd' then 'rnd'::public.user_role when 'production' then 'production'::public.user_role else 'warehouse'::public.user_role end;
    perform public.fn_create_order_referral(v_order_id, v_target_module, 'ارجاع مسیر سفارش ' || v_order_code, null, v_target_role, 2, null);
  end if;

  perform public.fn_log_crm_interaction(v_customer_id, 'ثبت سفارش ' || v_order_code, v_title, 'note', null, v_order_id);

  return jsonb_build_object('id', v_order_id, 'order_code', v_order_code, 'proforma_id', v_doc_id);
end;
$$;

grant execute on function public.fn_app_create_order(jsonb, jsonb, jsonb, boolean, boolean, boolean, boolean) to authenticated;
