-- =====================================================================
-- 010_DEPLOY_READINESS_HARDENING
-- Final hardening before first online test deployment:
-- - Validate workflow templates before use (4..12 stages, draft/closed required)
-- - Fill order customer snapshots automatically
-- - Make inventory reservation idempotent and prevent over-reservation
-- - Add app health check function for Supabase preflight
-- Depends on migrations 001..009.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Workflow template validation
-- ---------------------------------------------------------------------
create or replace function public.fn_validate_order_workflow_template(p_template_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count int;
  v_template_name text;
begin
  select name_fa into v_template_name
  from public.order_workflow_templates
  where id = p_template_id and is_active;

  if v_template_name is null then
    raise exception 'قالب مراحل سفارش پیدا نشد یا غیرفعال است / Workflow template not found or inactive';
  end if;

  select count(*) into v_count
  from public.order_workflow_template_steps
  where template_id = p_template_id and is_active;

  if v_count < 4 or v_count > 12 then
    raise exception 'قالب مراحل «%» باید بین ۴ تا ۱۲ مرحله فعال داشته باشد. تعداد فعلی: %', v_template_name, v_count;
  end if;

  if not exists (
    select 1 from public.order_workflow_template_steps
    where template_id = p_template_id and stage_key = 'draft' and is_active
  ) then
    raise exception 'قالب مراحل «%» باید مرحله ثبت سفارش داشته باشد.', v_template_name;
  end if;

  if not exists (
    select 1 from public.order_workflow_template_steps
    where template_id = p_template_id and stage_key = 'closed' and is_active
  ) then
    raise exception 'قالب مراحل «%» باید مرحله بسته‌شده داشته باشد.', v_template_name;
  end if;
end;
$$;

-- Recreate prepare trigger function with validation and customer snapshots.
create or replace function public.fn_prepare_order_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_stage text;
  v_customer public.customers%rowtype;
begin
  if new.workflow_template_id is null then
    new.workflow_template_id := public.fn_default_order_workflow_template(new.sales_path);
  end if;

  if new.workflow_template_id is not null then
    perform public.fn_validate_order_workflow_template(new.workflow_template_id);
  end if;

  if new.workflow_template_id is not null and (new.current_stage is null or new.current_stage = '') then
    select stage_key into v_first_stage
    from public.order_workflow_template_steps
    where template_id = new.workflow_template_id and is_active
    order by stage_order
    limit 1;

    new.current_stage := coalesce(v_first_stage, new.current_stage);
  end if;

  if new.registered_at is null then
    new.registered_at := current_date;
  end if;

  select * into v_customer
  from public.customers
  where id = new.customer_id;

  if found then
    new.customer_phone_snapshot := coalesce(new.customer_phone_snapshot, v_customer.contact_phone);
    new.customer_city_snapshot := coalesce(new.customer_city_snapshot, v_customer.city);
    new.contact_channel := coalesce(new.contact_channel, v_customer.preferred_contact_channel);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Inventory reservation hardening
-- ---------------------------------------------------------------------
create unique index if not exists uq_order_inventory_reserved_order_item
on public.order_inventory_reservations(order_item_id)
where status = 'reserved' and order_item_id is not null;

create or replace function public.fn_reserve_order_inventory(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
  v_available numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','warehouse']) then
    raise exception 'Not allowed to reserve inventory';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Order not found';
  end if;

  for r in
    select
      oi.id as order_item_id,
      oi.item_name_fa,
      oi.quantity,
      wi.id as warehouse_item_id,
      wi.item_code
    from public.order_items oi
    join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
    where oi.order_id = p_order_id
      and not exists (
        select 1
        from public.order_inventory_reservations existing
        where existing.order_item_id = oi.id
          and existing.status = 'reserved'
      )
  loop
    select available_for_sale_qty into v_available
    from public.v_sales_stock_overview
    where item_id = r.warehouse_item_id;

    if coalesce(v_available, 0) < r.quantity then
      raise exception 'موجودی قابل فروش برای قلم «%» کافی نیست. کد کالا: %, درخواست: %, قابل فروش: %',
        r.item_name_fa,
        r.item_code,
        r.quantity,
        coalesce(v_available, 0);
    end if;

    insert into public.order_inventory_reservations (
      order_id, order_item_id, warehouse_item_id, quantity, reserved_by
    ) values (
      p_order_id, r.order_item_id, r.warehouse_item_id, r.quantity, auth.uid()
    )
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  perform public.fn_log_order_event(
    p_order_id,
    'warehouse',
    'موجودی سفارش رزرو شد',
    v_count::text || ' قلم رزرو شد'
  );

  return v_count;
end;
$$;

create or replace function public.fn_release_order_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','warehouse']) then
    raise exception 'Not allowed to release inventory reservation';
  end if;

  update public.order_inventory_reservations
  set status = 'released', released_at = now()
  where order_id = p_order_id and status = 'reserved';

  perform public.fn_log_order_event(p_order_id, 'warehouse', 'رزرو موجودی آزاد شد');
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Preflight health check for deploy/testing
-- ---------------------------------------------------------------------
create or replace function public.fn_get_deploy_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'core', jsonb_build_object(
      'profiles_table', to_regclass('public.profiles') is not null,
      'roles_type', to_regtype('public.user_role') is not null,
      'active_profiles', coalesce((select count(*) from public.profiles where is_active), 0)
    ),
    'orders', jsonb_build_object(
      'orders_table', to_regclass('public.orders') is not null,
      'order_items_table', to_regclass('public.order_items') is not null,
      'workflow_templates', coalesce((select count(*) from public.order_workflow_templates where is_active), 0),
      'workflow_steps', coalesce((select count(*) from public.order_workflow_template_steps where is_active), 0),
      'lifecycle_view', to_regclass('public.v_order_lifecycle_overview') is not null,
      'crm_view', to_regclass('public.v_crm_customer_overview') is not null
    ),
    'finance', jsonb_build_object(
      'finance_documents_table', to_regclass('public.finance_documents') is not null,
      'finance_numbering_rules', coalesce((select count(*) from public.finance_numbering_rules where is_active), 0),
      'finance_dashboard_view', to_regclass('public.v_finance_dashboard') is not null,
      'document_timeline_view', to_regclass('public.v_finance_document_timeline') is not null
    ),
    'warehouse', jsonb_build_object(
      'warehouse_items_table', to_regclass('public.warehouse_items') is not null,
      'sales_stock_view', to_regclass('public.v_sales_stock_overview') is not null,
      'current_stock_view', to_regclass('public.v_warehouse_current_stock') is not null
    ),
    'timestamp', now()
  ) into v_result;

  return v_result;
end;
$$;

-- Keep execute restricted to authenticated users; useful for admin preflight checks.
revoke all on function public.fn_get_deploy_health() from public;
grant execute on function public.fn_get_deploy_health() to authenticated;
