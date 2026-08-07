-- =====================================================================
-- 018_CRM_FOLLOWUP_REAL_SAVE_AND_UI_SUPPORT
-- Fixes CRM follow-up behavior for the online React app:
-- - Creates a real RPC for CRM follow-up registration.
-- - Follow-up registration also logs a CRM interaction.
-- - Customer next follow-up date is updated.
-- - Completing a follow-up is handled safely through RPC.
-- - CRM views ignore deactivated customers.
-- Depends on: 009_orders_backend_workflow.sql, 012 grants
-- =====================================================================

create or replace function public.fn_create_crm_followup(
  p_customer_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_description text default null,
  p_activity_type public.crm_activity_type default 'follow_up',
  p_contact_channel public.crm_contact_channel default null,
  p_related_order_id uuid default null,
  p_assigned_to uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_followup_id uuid;
  v_customer_name text;
begin
  if v_actor is null then
    raise exception 'User session is required for CRM follow-up';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales']) then
    raise exception 'Not allowed to create CRM follow-up';
  end if;

  if p_customer_id is null then
    raise exception 'Customer is required';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Follow-up title is required';
  end if;

  if p_due_at is null then
    raise exception 'Follow-up due date is required';
  end if;

  select c.company_name into v_customer_name
  from public.customers c
  where c.id = p_customer_id
    and coalesce(c.is_active, true) = true;

  if v_customer_name is null then
    raise exception 'Active customer was not found';
  end if;

  if p_related_order_id is not null and not exists (
    select 1 from public.orders o where o.id = p_related_order_id and o.customer_id = p_customer_id
  ) then
    raise exception 'Selected order does not belong to selected customer';
  end if;

  insert into public.crm_followups (
    customer_id,
    related_order_id,
    title,
    due_at,
    assigned_to,
    created_by
  ) values (
    p_customer_id,
    p_related_order_id,
    trim(p_title),
    p_due_at,
    coalesce(p_assigned_to, v_actor),
    v_actor
  ) returning id into v_followup_id;

  insert into public.crm_interactions (
    customer_id,
    related_order_id,
    activity_type,
    contact_channel,
    title,
    description,
    activity_at,
    created_by
  ) values (
    p_customer_id,
    p_related_order_id,
    coalesce(p_activity_type, 'follow_up'::public.crm_activity_type),
    p_contact_channel,
    'برنامه‌ریزی پیگیری: ' || trim(p_title),
    p_description,
    now(),
    v_actor
  );

  update public.customers
  set last_contacted_at = now(),
      next_follow_up_at = p_due_at,
      preferred_contact_channel = coalesce(p_contact_channel, preferred_contact_channel),
      updated_at = now()
  where id = p_customer_id;

  if p_related_order_id is not null then
    insert into public.order_events (
      order_id,
      event_type,
      title,
      description,
      created_by
    ) values (
      p_related_order_id,
      'crm',
      'ثبت پیگیری CRM برای ' || v_customer_name,
      trim(p_title) || ' · موعد: ' || to_char(p_due_at at time zone 'Asia/Tehran', 'YYYY-MM-DD HH24:MI'),
      v_actor
    );
  end if;

  return v_followup_id;
end;
$$;

create or replace function public.fn_complete_crm_followup(
  p_followup_id uuid,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_followup record;
begin
  if v_actor is null then
    raise exception 'User session is required for CRM follow-up completion';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales']) then
    raise exception 'Not allowed to complete CRM follow-up';
  end if;

  select * into v_followup
  from public.crm_followups
  where id = p_followup_id
  for update;

  if not found then
    raise exception 'Follow-up was not found';
  end if;

  update public.crm_followups
  set is_done = true,
      done_at = now()
  where id = p_followup_id;

  insert into public.crm_interactions (
    customer_id,
    related_order_id,
    activity_type,
    title,
    description,
    activity_at,
    created_by
  ) values (
    v_followup.customer_id,
    v_followup.related_order_id,
    'follow_up',
    'انجام پیگیری: ' || v_followup.title,
    p_note,
    now(),
    v_actor
  );

  update public.customers
  set last_contacted_at = now(),
      updated_at = now()
  where id = v_followup.customer_id;

  if v_followup.related_order_id is not null then
    insert into public.order_events (
      order_id,
      event_type,
      title,
      description,
      created_by
    ) values (
      v_followup.related_order_id,
      'crm',
      'انجام پیگیری CRM',
      coalesce(p_note, v_followup.title),
      v_actor
    );
  end if;

  return p_followup_id;
end;
$$;

-- Keep the original column order of the view so existing frontends do not break.
create or replace view public.v_crm_customer_overview
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.contact_person_name,
  c.contact_phone,
  c.contact_email,
  c.city,
  c.preferred_contact_channel,
  c.acquisition_source,
  c.crm_status,
  c.lead_score,
  c.assigned_sales_id,
  p.full_name as assigned_sales_name,
  c.last_contacted_at,
  c.next_follow_up_at,
  count(distinct o.id) as total_orders,
  coalesce(sum(fd.total_amount) filter (where fd.document_type = 'sales_invoice' and fd.status <> 'void'), 0) as total_sales_amount,
  max(o.created_at) as last_order_at,
  count(distinct f.id) filter (where f.is_done = false and f.due_at <= now() + interval '3 days') as due_followups
from public.customers c
left join public.profiles p on p.id = c.assigned_sales_id
left join public.orders o on o.customer_id = c.id
left join public.finance_documents fd on fd.related_order_id = o.id
left join public.crm_followups f on f.customer_id = c.id
where coalesce(c.is_active, true) = true
group by c.id, p.full_name;

create or replace view public.v_crm_due_followups
with (security_invoker = true)
as
select
  f.id,
  f.customer_id,
  c.company_name,
  c.contact_phone,
  c.preferred_contact_channel,
  f.related_order_id,
  o.order_code,
  f.title,
  f.due_at,
  f.is_done,
  f.assigned_to,
  p.full_name as assigned_to_name,
  (f.due_at < now()) as is_overdue
from public.crm_followups f
join public.customers c on c.id = f.customer_id
left join public.orders o on o.id = f.related_order_id
left join public.profiles p on p.id = f.assigned_to
where f.is_done = false
  and coalesce(c.is_active, true) = true;

grant execute on function public.fn_create_crm_followup(uuid, text, timestamptz, text, public.crm_activity_type, public.crm_contact_channel, uuid, uuid) to authenticated;
grant execute on function public.fn_complete_crm_followup(uuid, text) to authenticated;

notify pgrst, 'reload schema';
