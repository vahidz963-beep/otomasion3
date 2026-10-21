-- =====================================================================
-- 125_REPAIR_ACCIDENTAL_LEGACY_MIGRATION_REPLAY
--
-- Repairs only the runtime definitions that were regressed when legacy
-- migrations 001 and 002 were accidentally replayed against an already-current
-- database. This migration intentionally performs no business-data DML.
--
-- Restores the latest definitions from migrations 008, 009, 033, 047 and 052.
-- Safe to replay: functions/views are CREATE OR REPLACE and policies are
-- recreated atomically inside this transaction.
-- =====================================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------
-- Multi-role security helpers (latest definition: migration 047)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Auth/profile trigger functions (latest definition: migration 047)
-- Existing profile rows are not modified.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_role_text text;
  v_roles text[];
begin
  v_role_text := new.raw_user_meta_data->>'role';

  if v_role_text in ('admin','sales','sales_manager','rnd','production','warehouse','accountant','office_admin') then
    v_role := v_role_text::public.user_role;
  else
    v_role := 'sales'::public.user_role;
  end if;

  if jsonb_typeof(new.raw_user_meta_data->'roles') = 'array' then
    select array_agg(distinct role_name)
    into v_roles
    from jsonb_array_elements_text(new.raw_user_meta_data->'roles') as r(role_name)
    where role_name in ('admin','sales','sales_manager','rnd','production','warehouse','accountant','office_admin');
  else
    v_roles := array[]::text[];
  end if;

  v_roles := array(
    select distinct role_name
    from unnest(array_append(coalesce(v_roles, array[]::text[]), v_role::text)) as r(role_name)
    where role_name is not null and role_name <> ''
    limit 3
  );

  if array_length(v_roles, 1) is null then
    v_roles := array[v_role::text];
  end if;

  insert into public.profiles (id, email, full_name, full_name_en, role, additional_roles, preferred_language, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email, ''),
    nullif(new.raw_user_meta_data->>'full_name_en', ''),
    v_role,
    v_roles,
    case when new.raw_user_meta_data->>'preferred_language' in ('fa','en') then new.raw_user_meta_data->>'preferred_language' else 'fa' end,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    full_name_en = excluded.full_name_en,
    role = excluded.role,
    additional_roles = excluded.additional_roles,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (
      new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or coalesce(new.additional_roles, array[]::text[]) is distinct from coalesce(old.additional_roles, array[]::text[])
     )
     and not public.is_admin() then
    raise exception 'Only admin can change role, additional roles, or active status';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Order numbering and workflow validation (latest: migrations 008/009)
-- ---------------------------------------------------------------------
create or replace function public.fn_generate_order_code()
returns trigger
language plpgsql
as $$
begin
  if new.order_code is null or new.order_code = '' then
    new.order_code := public.fn_next_document_number('order');
  end if;
  return new;
end;
$$;

create or replace function public.fn_validate_order_stage()
returns trigger
language plpgsql
as $$
declare
  v_valid boolean;
begin
  if tg_op = 'INSERT' and (new.current_stage is null or new.current_stage = '') then
    select stage_key into new.current_stage
    from public.order_workflow_template_steps
    where template_id = new.workflow_template_id and is_active
    order by stage_order
    limit 1;
  end if;

  select exists (
    select 1
    from public.order_workflow_template_steps
    where template_id = new.workflow_template_id
      and stage_key = new.current_stage
      and is_active
  ) into v_valid;

  if not v_valid then
    select exists (
      select 1
      from public.order_status_definitions
      where sales_path = new.sales_path
        and stage_key = new.current_stage
        and is_active
    ) into v_valid;
  end if;

  if not v_valid then
    raise exception 'Invalid stage % for sales_path %', new.current_stage, new.sales_path;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Multi-role order access (latest definition: migration 033)
-- ---------------------------------------------------------------------
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

-- Policies that 002 regressed from their migration-033 definitions.
drop policy if exists customers_write_sales_admin on public.customers;
create policy customers_write_sales_admin on public.customers
for all using (public.has_role(array['admin','sales','sales_manager']))
with check (public.has_role(array['admin','sales','sales_manager']));

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

-- ---------------------------------------------------------------------
-- Latest dashboard tracking semantics (migration 052)
-- ---------------------------------------------------------------------
create or replace view public.v_order_tracking
with (security_invoker = true)
as
with order_stage_limits as (
  select
    order_id,
    max(stage_order) as max_stage_order
  from public.order_stage_instances
  group by order_id
)
select
  o.id,
  o.order_code,
  c.company_name as customer_name,
  c.tier as customer_tier,
  o.sales_path,
  o.current_stage,
  coalesce(osi.stage_name_fa, d.stage_name_fa, o.current_stage) as stage_name_fa,
  coalesce(osi.stage_name_en, d.stage_name_en, o.current_stage) as stage_name_en,
  coalesce(osi.stage_order::numeric, d.stage_order) as stage_order,
  (
    coalesce(tpl_step.is_terminal, d.is_terminal, false)
    or (
      osl.max_stage_order is not null
      and osi.stage_order is not null
      and osi.stage_order >= osl.max_stage_order
    )
    or (
      osi.id is not null
      and not exists (
        select 1
        from public.order_stage_instances next_stage
        where next_stage.order_id = o.id
          and next_stage.stage_order > osi.stage_order
      )
    )
  ) as is_terminal,
  o.priority,
  o.expected_delivery_date,
  o.is_cancelled,
  date_trunc('day', o.created_at) as created_at,
  date_trunc('day', o.updated_at) as updated_at,
  p.full_name as sales_officer_name
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_stage_instances osi on osi.order_id = o.id and osi.stage_key = o.current_stage
left join public.order_workflow_template_steps tpl_step on tpl_step.id = osi.template_step_id
left join public.order_status_definitions d on d.sales_path = o.sales_path and d.stage_key = o.current_stage
left join order_stage_limits osl on osl.order_id = o.id
left join public.profiles p on p.id = o.sales_officer_id;

-- Preserve/refresh the runtime grants established by later migrations.
grant execute on function public.has_role(text[]) to service_role, authenticated;
grant execute on function public.is_admin() to service_role, authenticated;
grant execute on function public.fn_user_can_access_order(uuid) to authenticated;
grant select on public.v_order_tracking to authenticated;

-- Transactional postconditions. Any failed assertion aborts the whole repair.
do $verify$
begin
  if position('current_role_names' in lower(pg_get_functiondef('public.has_role(text[])'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: has_role';
  end if;
  if position('current_role_names' in lower(pg_get_functiondef('public.is_admin()'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: is_admin';
  end if;
  if position('additional_roles' in lower(pg_get_functiondef('public.handle_new_user()'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: handle_new_user';
  end if;
  if position('additional_roles' in lower(pg_get_functiondef('public.prevent_profile_privilege_escalation()'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: prevent_profile_privilege_escalation';
  end if;
  if position('fn_next_document_number' in lower(pg_get_functiondef('public.fn_generate_order_code()'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: fn_generate_order_code';
  end if;
  if position('order_workflow_template_steps' in lower(pg_get_functiondef('public.fn_validate_order_stage()'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: fn_validate_order_stage';
  end if;
  if position('sales_manager' in lower(pg_get_functiondef('public.fn_user_can_access_order(uuid)'::regprocedure))) = 0 then
    raise exception 'Repair verification failed: fn_user_can_access_order';
  end if;
  if position('order_stage_instances' in lower(pg_get_viewdef('public.v_order_tracking'::regclass, true))) = 0
     or position('date_trunc' in lower(pg_get_viewdef('public.v_order_tracking'::regclass, true))) = 0 then
    raise exception 'Repair verification failed: v_order_tracking';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customers'
      and policyname = 'customers_write_sales_admin'
      and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%sales_manager%'
  ) then
    raise exception 'Repair verification failed: customers policy';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders_insert_sales_admin'
      and coalesce(with_check, '') ilike '%sales_manager%'
  ) then
    raise exception 'Repair verification failed: orders insert policy';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders_update_authorized'
      and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%sales_manager%'
  ) then
    raise exception 'Repair verification failed: orders update policy';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
