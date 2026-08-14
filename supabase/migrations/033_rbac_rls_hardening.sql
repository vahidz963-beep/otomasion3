-- =====================================================================
-- 033_RBAC_RLS_HARDENING
-- Stabilizes role-based access for multi-role users.
-- - Adds helper current_role_names()
-- - Makes referral policies multi-role aware
-- - Adds sales_manager to Sales/Orders/CRM write policies
-- - Keeps cross-module read permissions needed by Production/R&D/Warehouse/Finance views
-- =====================================================================

alter type public.user_role add value if not exists 'sales_manager';

alter table public.profiles
  add column if not exists additional_roles text[] not null default array[]::text[];

update public.profiles
set additional_roles = array[role::text]
where additional_roles is null or array_length(additional_roles, 1) is null;

create or replace function public.current_role_names()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array(select distinct unnest(array_append(coalesce(additional_roles, array[]::text[]), role::text)))
     from public.profiles
     where id = auth.uid() and is_active),
    array[]::text[]
  );
$$;

create or replace function public.has_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_names() && roles, false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce('admin' = any(public.current_role_names()), false);
$$;

-- Order visibility remains cross-module for operational workflows, but sales_manager gets sales access.
create or replace function public.fn_user_can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and public.is_active_user()
      and (
        public.is_admin()
        or (public.has_role(array['sales','sales_manager']) and (o.created_by = auth.uid() or o.sales_officer_id = auth.uid() or public.sales_can_view_all_orders()))
        or (public.has_role(array['rnd']) and o.sales_path = 'rnd')
        or (public.has_role(array['production']) and o.sales_path = 'production')
        or (public.has_role(array['warehouse']) and (o.current_stage in ('warehouse_receipt','final_output','delivered') or o.sales_path in ('trading','production')))
        or public.has_role(array['accountant'])
      )
  );
$$;

-- Customers: only admin/sales/sales_manager can write; active users can read for cross-module references.
drop policy if exists customers_write_sales_admin on public.customers;
create policy customers_write_sales_admin on public.customers
for all using (public.has_role(array['admin','sales','sales_manager']))
with check (public.has_role(array['admin','sales','sales_manager']));

-- Orders insert/update with sales_manager.
drop policy if exists orders_insert_sales_admin on public.orders;
create policy orders_insert_sales_admin on public.orders
for insert with check (
  public.is_admin()
  or (public.has_role(array['sales','sales_manager']) and public.is_active_user() and created_by = auth.uid() and (sales_officer_id is null or sales_officer_id = auth.uid()))
);

drop policy if exists orders_update_authorized on public.orders;
create policy orders_update_authorized on public.orders
for update using (
  public.is_admin()
  or (public.has_role(array['sales','sales_manager']) and public.is_active_user() and created_by = auth.uid())
  or (public.has_role(array['rnd']) and public.is_active_user() and sales_path = 'rnd')
  or (public.has_role(array['production']) and public.is_active_user() and sales_path = 'production')
  or (public.has_role(array['warehouse']) and public.is_active_user() and current_stage in ('warehouse_receipt','final_output','delivered'))
)
with check (
  public.is_admin()
  or (public.has_role(array['sales','sales_manager']) and public.is_active_user())
  or (public.has_role(array['rnd','production','warehouse']) and public.is_active_user())
);

-- CRM tables: sales_manager support.
drop policy if exists crm_interactions_select on public.crm_interactions;
create policy crm_interactions_select on public.crm_interactions for select using (public.has_role(array['admin','sales','sales_manager','accountant']));
drop policy if exists crm_interactions_write on public.crm_interactions;
create policy crm_interactions_write on public.crm_interactions for all using (public.has_role(array['admin','sales','sales_manager'])) with check (public.has_role(array['admin','sales','sales_manager']));

drop policy if exists crm_followups_select on public.crm_followups;
create policy crm_followups_select on public.crm_followups for select using (public.has_role(array['admin','sales','sales_manager','accountant']));
drop policy if exists crm_followups_write on public.crm_followups;
create policy crm_followups_write on public.crm_followups for all using (public.has_role(array['admin','sales','sales_manager'])) with check (public.has_role(array['admin','sales','sales_manager']));

drop policy if exists crm_opportunities_select on public.crm_opportunities;
create policy crm_opportunities_select on public.crm_opportunities for select using (public.has_role(array['admin','sales','sales_manager','accountant']));
drop policy if exists crm_opportunities_write on public.crm_opportunities;
create policy crm_opportunities_write on public.crm_opportunities for all using (public.has_role(array['admin','sales','sales_manager'])) with check (public.has_role(array['admin','sales','sales_manager']));

-- Order workflow configuration: admin/sales_manager/sales.
drop policy if exists order_workflow_templates_write on public.order_workflow_templates;
create policy order_workflow_templates_write on public.order_workflow_templates for all using (public.has_role(array['admin','sales','sales_manager'])) with check (public.has_role(array['admin','sales','sales_manager']));

drop policy if exists order_workflow_steps_write on public.order_workflow_template_steps;
create policy order_workflow_steps_write on public.order_workflow_template_steps for all using (public.has_role(array['admin','sales','sales_manager'])) with check (public.has_role(array['admin','sales','sales_manager']));

-- Referrals: target_role must check all user roles, not only primary role.
drop policy if exists automation_referrals_select on public.automation_referrals;
create policy automation_referrals_select on public.automation_referrals for select using (
  public.is_active_user() and (
    public.is_admin()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or target_role::text = any(public.current_role_names())
    or source_module = any(array['orders','sales','rnd','production','warehouse','accounting','admin','manual'])
    or (related_order_id is not null and public.fn_user_can_access_order(related_order_id))
  )
);

drop policy if exists automation_referrals_update on public.automation_referrals;
create policy automation_referrals_update on public.automation_referrals for update using (
  public.is_active_user() and (
    public.is_admin()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or target_role::text = any(public.current_role_names())
  )
);

-- Referral messages follow referral access; active users can insert messages for shared workflow.
drop policy if exists referral_messages_read on public.automation_referral_messages;
create policy referral_messages_read on public.automation_referral_messages
for select using (
  public.is_active_user()
  and exists (select 1 from public.automation_referrals r where r.id = referral_id)
);

drop policy if exists referral_messages_write on public.automation_referral_messages;
create policy referral_messages_write on public.automation_referral_messages
for insert with check (public.is_active_user());

-- Grant helpers.
grant execute on function public.current_role_names() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.fn_user_can_access_order(uuid) to authenticated;

notify pgrst, 'reload schema';
