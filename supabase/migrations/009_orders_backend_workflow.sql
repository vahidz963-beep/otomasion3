-- =====================================================================
-- 009_ORDERS_BACKEND_WORKFLOW
-- Backend completion for Orders/Sales module:
-- - Sales-manager configurable workflow templates (4..12 stages)
-- - Per-order stage instances and linear progress
-- - Order event timeline
-- - CRM essentials: contact channel, source, interactions, follow-ups, opportunities
-- - Sales-visible warehouse stock and reservation
-- - Finance integration: proforma/invoice from order, financial status views
-- - Cross-module referrals from orders to finance/warehouse/production/R&D/admin
-- Depends on migrations 001..008.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'order_stage_instance_status') then
    create type public.order_stage_instance_status as enum ('pending', 'current', 'done', 'skipped', 'blocked');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'crm_contact_channel') then
    create type public.crm_contact_channel as enum ('phone','website','whatsapp','telegram','instagram','in_person','email','other');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'crm_party_status') then
    create type public.crm_party_status as enum ('lead','active_customer','vip','at_risk','inactive');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'crm_activity_type') then
    create type public.crm_activity_type as enum ('call','message','email','meeting','visit','note','follow_up','complaint','other');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'crm_opportunity_stage') then
    create type public.crm_opportunity_stage as enum ('new','follow_up','proposal','negotiation','won','lost');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'order_inventory_reservation_status') then
    create type public.order_inventory_reservation_status as enum ('reserved','released','consumed','cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) CRM fields on customers
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists city text,
  add column if not exists preferred_contact_channel public.crm_contact_channel,
  add column if not exists acquisition_source text,
  add column if not exists assigned_sales_id uuid references public.profiles(id),
  add column if not exists crm_status public.crm_party_status not null default 'active_customer',
  add column if not exists lead_score int not null default 50 check (lead_score between 0 and 100),
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists last_contacted_at timestamptz;

create index if not exists idx_customers_crm_status on public.customers(crm_status);
create index if not exists idx_customers_next_followup on public.customers(next_follow_up_at) where next_follow_up_at is not null;
create index if not exists idx_customers_assigned_sales on public.customers(assigned_sales_id);

-- ---------------------------------------------------------------------
-- 3) CRM activities / follow-ups / opportunities
-- ---------------------------------------------------------------------
create table if not exists public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  related_order_id uuid references public.orders(id) on delete set null,
  activity_type public.crm_activity_type not null default 'note',
  contact_channel public.crm_contact_channel,
  title text not null,
  description text,
  activity_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  related_order_id uuid references public.orders(id) on delete set null,
  title text not null,
  due_at timestamptz not null,
  is_done boolean not null default false,
  done_at timestamptz,
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  related_order_id uuid references public.orders(id) on delete set null,
  title text not null,
  stage public.crm_opportunity_stage not null default 'new',
  estimated_amount numeric not null default 0,
  probability_percent int not null default 50 check (probability_percent between 0 and 100),
  expected_close_date date,
  assigned_to uuid references public.profiles(id),
  source text,
  lost_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_crm_opportunities_updated_at on public.crm_opportunities;
create trigger trg_crm_opportunities_updated_at
before update on public.crm_opportunities
for each row execute function public.set_updated_at();

create index if not exists idx_crm_interactions_customer on public.crm_interactions(customer_id, activity_at desc);
create index if not exists idx_crm_followups_due on public.crm_followups(due_at, is_done);
create index if not exists idx_crm_opportunities_stage on public.crm_opportunities(stage, expected_close_date);

create or replace function public.fn_log_crm_interaction(
  p_customer_id uuid,
  p_title text,
  p_description text default null,
  p_activity_type public.crm_activity_type default 'note',
  p_contact_channel public.crm_contact_channel default null,
  p_related_order_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','accountant']) then
    raise exception 'Not allowed to log CRM interaction';
  end if;

  insert into public.crm_interactions (
    customer_id, related_order_id, activity_type, contact_channel, title, description, created_by
  ) values (
    p_customer_id, p_related_order_id, p_activity_type, p_contact_channel, p_title, p_description, auth.uid()
  ) returning id into v_id;

  update public.customers
  set last_contacted_at = now(),
      preferred_contact_channel = coalesce(p_contact_channel, preferred_contact_channel),
      updated_at = now()
  where id = p_customer_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Workflow templates and per-order stages
-- ---------------------------------------------------------------------
create table if not exists public.order_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  name_fa text not null,
  name_en text,
  sales_path public.order_sales_path,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- null sales_path = general template usable for all paths
  check (template_key <> '')
);

drop trigger if exists trg_order_workflow_templates_updated_at on public.order_workflow_templates;
create trigger trg_order_workflow_templates_updated_at
before update on public.order_workflow_templates
for each row execute function public.set_updated_at();

create table if not exists public.order_workflow_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.order_workflow_templates(id) on delete cascade,
  stage_key text not null,
  stage_order int not null check (stage_order between 1 and 99),
  stage_name_fa text not null,
  stage_name_en text,
  responsible_role public.user_role,
  notify_role_on_enter public.user_role,
  is_required boolean not null default false,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  unique (template_id, stage_key),
  unique (template_id, stage_order)
);

create table if not exists public.order_stage_instances (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  template_step_id uuid references public.order_workflow_template_steps(id) on delete set null,
  stage_key text not null,
  stage_order int not null,
  stage_name_fa text not null,
  stage_name_en text,
  responsible_role public.user_role,
  status public.order_stage_instance_status not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (order_id, stage_key),
  unique (order_id, stage_order)
);

create index if not exists idx_order_stage_instances_order on public.order_stage_instances(order_id, stage_order);
create index if not exists idx_order_stage_instances_status on public.order_stage_instances(status);

alter table public.orders
  add column if not exists workflow_template_id uuid references public.order_workflow_templates(id),
  add column if not exists registered_at date not null default current_date,
  add column if not exists contact_channel public.crm_contact_channel,
  add column if not exists customer_phone_snapshot text,
  add column if not exists customer_city_snapshot text;

create index if not exists idx_orders_workflow_template on public.orders(workflow_template_id);
create index if not exists idx_orders_registered_at on public.orders(registered_at);

-- ---------------------------------------------------------------------
-- 5) Seed default workflow templates, all 4..12 stages
-- ---------------------------------------------------------------------
insert into public.order_workflow_templates (template_key, name_fa, name_en, sales_path, is_default, is_active)
values
  ('simple_4', 'ساده ۴ مرحله‌ای', 'Simple 4-stage', null, false, true),
  ('trading_standard_10', 'بازرگانی استاندارد ۱۰ مرحله‌ای', 'Trading standard 10-stage', 'trading', true, true),
  ('trading_fast_6', 'بازرگانی سریع ۶ مرحله‌ای', 'Trading fast 6-stage', 'trading', false, true),
  ('rnd_prototype_10', 'R&D نمونه‌سازی ۱۰ مرحله‌ای', 'R&D prototype 10-stage', 'rnd', true, true),
  ('production_full_12', 'تولید کامل ۱۲ مرحله‌ای', 'Production full 12-stage', 'production', true, true),
  ('production_short_8', 'تولید خلاصه ۸ مرحله‌ای', 'Production short 8-stage', 'production', false, true)
on conflict (template_key) do update set
  name_fa = excluded.name_fa,
  name_en = excluded.name_en,
  sales_path = excluded.sales_path,
  is_default = excluded.is_default,
  is_active = excluded.is_active,
  updated_at = now();

-- Helper to seed steps idempotently.
create or replace function public.fn_seed_order_workflow_step(
  p_template_key text,
  p_stage_key text,
  p_stage_order int,
  p_stage_name_fa text,
  p_stage_name_en text default null,
  p_responsible_role public.user_role default null,
  p_notify_role public.user_role default null,
  p_required boolean default false,
  p_terminal boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  select id into v_template_id from public.order_workflow_templates where template_key = p_template_key;
  if v_template_id is null then
    raise exception 'Template not found: %', p_template_key;
  end if;

  insert into public.order_workflow_template_steps (
    template_id, stage_key, stage_order, stage_name_fa, stage_name_en,
    responsible_role, notify_role_on_enter, is_required, is_terminal, is_active
  ) values (
    v_template_id, p_stage_key, p_stage_order, p_stage_name_fa, p_stage_name_en,
    p_responsible_role, p_notify_role, p_required, p_terminal, true
  )
  on conflict (template_id, stage_key) do update set
    stage_order = excluded.stage_order,
    stage_name_fa = excluded.stage_name_fa,
    stage_name_en = excluded.stage_name_en,
    responsible_role = excluded.responsible_role,
    notify_role_on_enter = excluded.notify_role_on_enter,
    is_required = excluded.is_required,
    is_terminal = excluded.is_terminal,
    is_active = true;
end;
$$;

-- Simple 4
select public.fn_seed_order_workflow_step('simple_4','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('simple_4','quotation',2,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('simple_4','delivered',3,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('simple_4','closed',4,'بسته‌شده','Closed','accountant',null,true,true);

-- Trading 10
select public.fn_seed_order_workflow_step('trading_standard_10','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('trading_standard_10','customer_confirm',2,'تأیید مشتری','Customer confirmation','sales',null,false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','quotation',3,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','stock_check',4,'بررسی موجودی','Stock check','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','procurement',5,'خرید / تأمین','Procurement','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','warehouse_receipt',6,'ورود انبار','Warehouse receipt','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','packing',7,'بسته‌بندی کالا','Packing','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','delivered',8,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','settlement',9,'تسویه','Settlement','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('trading_standard_10','closed',10,'بسته‌شده','Closed','accountant',null,true,true);

-- Trading fast 6
select public.fn_seed_order_workflow_step('trading_fast_6','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('trading_fast_6','quotation',2,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('trading_fast_6','stock_check',3,'بررسی موجودی','Stock check','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_fast_6','packing',4,'بسته‌بندی کالا','Packing','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('trading_fast_6','delivered',5,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('trading_fast_6','closed',6,'بسته‌شده','Closed','accountant',null,true,true);

-- R&D 10
select public.fn_seed_order_workflow_step('rnd_prototype_10','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','requirements',2,'تحلیل نیازمندی','Requirements','rnd','rnd',false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','quotation',3,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','in_rnd',4,'طراحی / R&D','R&D design','rnd','rnd',false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','prototype',5,'نمونه‌سازی','Prototype','rnd',null,false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','testing',6,'تست نمونه','Testing','rnd',null,false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','customer_review',7,'تأیید مشتری روی نمونه','Customer review','sales',null,false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','handoff_or_delivery',8,'تحویل خروجی / انتقال','Handoff or delivery','rnd','production',false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','delivered',9,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('rnd_prototype_10','closed',10,'بسته‌شده','Closed','accountant',null,true,true);

-- Production full 12
select public.fn_seed_order_workflow_step('production_full_12','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('production_full_12','customer_confirm',2,'تأیید مشتری','Customer confirmation','sales',null,false,false);
select public.fn_seed_order_workflow_step('production_full_12','quotation',3,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('production_full_12','technical_review',4,'بررسی فنی','Technical review','production','production',false,false);
select public.fn_seed_order_workflow_step('production_full_12','stock_check',5,'بررسی موجودی','Stock check','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('production_full_12','planning',6,'برنامه‌ریزی تولید','Planning','production','production',false,false);
select public.fn_seed_order_workflow_step('production_full_12','material_issue',7,'خروج مواد از انبار','Material issue','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('production_full_12','execution',8,'اجرای تولید','Execution','production','production',false,false);
select public.fn_seed_order_workflow_step('production_full_12','qc',9,'کنترل کیفیت','Quality control','production',null,false,false);
select public.fn_seed_order_workflow_step('production_full_12','packing',10,'بسته‌بندی کالا','Packing','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('production_full_12','delivered',11,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('production_full_12','closed',12,'بسته‌شده','Closed','accountant',null,true,true);

-- Production short 8
select public.fn_seed_order_workflow_step('production_short_8','draft',1,'ثبت سفارش','Draft','sales',null,true,false);
select public.fn_seed_order_workflow_step('production_short_8','quotation',2,'پیش‌فاکتور / مالی','Finance','accountant','accountant',false,false);
select public.fn_seed_order_workflow_step('production_short_8','stock_check',3,'بررسی موجودی','Stock check','warehouse','warehouse',false,false);
select public.fn_seed_order_workflow_step('production_short_8','planning',4,'برنامه‌ریزی تولید','Planning','production','production',false,false);
select public.fn_seed_order_workflow_step('production_short_8','execution',5,'اجرای تولید','Execution','production','production',false,false);
select public.fn_seed_order_workflow_step('production_short_8','qc',6,'کنترل کیفیت','Quality control','production',null,false,false);
select public.fn_seed_order_workflow_step('production_short_8','delivered',7,'تحویل به مشتری','Delivered','sales',null,false,false);
select public.fn_seed_order_workflow_step('production_short_8','closed',8,'بسته‌شده','Closed','accountant',null,true,true);

-- ---------------------------------------------------------------------
-- 6) Order events/timeline
-- ---------------------------------------------------------------------
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('created','stage_changed','finance','warehouse','production','rnd','crm','referral','note','closed')),
  title text not null,
  description text,
  old_stage text,
  new_stage text,
  actor_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_events_order on public.order_events(order_id, created_at desc);

create or replace function public.fn_log_order_event(
  p_order_id uuid,
  p_event_type text,
  p_title text,
  p_description text default null,
  p_old_stage text default null,
  p_new_stage text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.order_events (order_id, event_type, title, description, old_stage, new_stage, actor_id, metadata)
  values (p_order_id, p_event_type, p_title, p_description, p_old_stage, p_new_stage, auth.uid(), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Apply workflow template to orders
-- ---------------------------------------------------------------------
create or replace function public.fn_default_order_workflow_template(p_sales_path public.order_sales_path)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.order_workflow_templates
  where is_active
    and (sales_path = p_sales_path or sales_path is null)
  order by (sales_path = p_sales_path) desc, is_default desc, created_at
  limit 1;
$$;

create or replace function public.fn_prepare_order_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_stage text;
begin
  if new.workflow_template_id is null then
    new.workflow_template_id := public.fn_default_order_workflow_template(new.sales_path);
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

  return new;
end;
$$;

drop trigger if exists trg_a_orders_prepare_workflow on public.orders;
create trigger trg_a_orders_prepare_workflow
before insert on public.orders
for each row execute function public.fn_prepare_order_workflow();

create or replace function public.fn_create_order_stage_instances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workflow_template_id is not null then
    insert into public.order_stage_instances (
      order_id, template_step_id, stage_key, stage_order, stage_name_fa, stage_name_en,
      responsible_role, status, started_at, completed_at
    )
    select
      new.id,
      s.id,
      s.stage_key,
      s.stage_order,
      s.stage_name_fa,
      s.stage_name_en,
      s.responsible_role,
      case
        when s.stage_key = new.current_stage then 'current'::public.order_stage_instance_status
        when s.stage_order < (select stage_order from public.order_workflow_template_steps where template_id = new.workflow_template_id and stage_key = new.current_stage limit 1) then 'done'::public.order_stage_instance_status
        else 'pending'::public.order_stage_instance_status
      end,
      case when s.stage_key = new.current_stage then now() else null end,
      case when s.stage_order < (select stage_order from public.order_workflow_template_steps where template_id = new.workflow_template_id and stage_key = new.current_stage limit 1) then now() else null end
    from public.order_workflow_template_steps s
    where s.template_id = new.workflow_template_id and s.is_active
    order by s.stage_order
    on conflict (order_id, stage_key) do nothing;
  end if;

  perform public.fn_log_order_event(new.id, 'created', 'سفارش ایجاد شد', new.order_code, null, new.current_stage);
  return new;
end;
$$;

drop trigger if exists trg_create_order_stage_instances on public.orders;
create trigger trg_create_order_stage_instances
after insert on public.orders
for each row execute function public.fn_create_order_stage_instances();

-- Override stage validator: validate against the selected workflow template first, fallback to old definitions.
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

create or replace function public.fn_set_order_stage(
  p_order_id uuid,
  p_stage_key text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_old_stage text;
  v_target_order int;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','production','rnd','warehouse','accountant']) then
    raise exception 'Not allowed to change order stage';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  select stage_order into v_target_order
  from public.order_stage_instances
  where order_id = p_order_id and stage_key = p_stage_key;

  if v_target_order is null then
    raise exception 'Stage % is not part of this order workflow', p_stage_key;
  end if;

  v_old_stage := v_order.current_stage;

  update public.order_stage_instances
  set status = case
      when stage_order < v_target_order then 'done'::public.order_stage_instance_status
      when stage_order = v_target_order then 'current'::public.order_stage_instance_status
      else 'pending'::public.order_stage_instance_status
    end,
    started_at = case when stage_order = v_target_order then coalesce(started_at, now()) else started_at end,
    completed_at = case when stage_order < v_target_order then coalesce(completed_at, now()) else null end
  where order_id = p_order_id;

  update public.orders
  set current_stage = p_stage_key,
      updated_at = now()
  where id = p_order_id;

  perform public.fn_log_order_event(
    p_order_id,
    'stage_changed',
    'مرحله سفارش تغییر کرد',
    p_note,
    v_old_stage,
    p_stage_key
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Inventory visibility and reservations for Sales
-- ---------------------------------------------------------------------
create table if not exists public.order_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  warehouse_item_id uuid not null references public.warehouse_items(id),
  quantity numeric not null check (quantity > 0),
  status public.order_inventory_reservation_status not null default 'reserved',
  reserved_by uuid references public.profiles(id),
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  notes text
);

create index if not exists idx_order_inventory_reservations_order on public.order_inventory_reservations(order_id, status);
create index if not exists idx_order_inventory_reservations_item on public.order_inventory_reservations(warehouse_item_id, status);

create or replace view public.v_sales_stock_overview
with (security_invoker = true)
as
select
  s.item_id,
  s.item_code,
  s.item_name_fa,
  s.item_name_en,
  s.unit,
  s.category,
  s.current_qty,
  s.min_stock_threshold,
  coalesce(r.reserved_qty, 0) as reserved_qty,
  (s.current_qty - coalesce(r.reserved_qty, 0)) as available_for_sale_qty,
  ((s.current_qty - coalesce(r.reserved_qty, 0)) < s.min_stock_threshold) as is_low_stock,
  s.last_synced_at
from public.v_warehouse_current_stock s
left join (
  select warehouse_item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
) r on r.warehouse_item_id = s.item_id;

create or replace view public.v_order_stock_status
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  oi.id as order_item_id,
  oi.item_name_fa,
  oi.warehouse_item_code,
  wi.id as warehouse_item_id,
  oi.quantity as requested_qty,
  coalesce(s.available_for_sale_qty, 0) as available_for_sale_qty,
  coalesce(s.current_qty, 0) as current_qty,
  coalesce(s.reserved_qty, 0) as reserved_qty,
  s.unit as stock_unit,
  case
    when oi.warehouse_item_code is null or oi.warehouse_item_code = '' then 'no_code'
    when wi.id is null then 'invalid_code'
    when coalesce(s.available_for_sale_qty, 0) >= oi.quantity then 'available'
    when coalesce(s.current_qty, 0) >= oi.quantity then 'reserved_by_others'
    else 'short'
  end as stock_status
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
left join public.v_sales_stock_overview s on s.item_id = wi.id;

create or replace function public.fn_reserve_order_inventory(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','warehouse']) then
    raise exception 'Not allowed to reserve inventory';
  end if;

  for r in
    select oi.id as order_item_id, wi.id as warehouse_item_id, oi.quantity
    from public.order_items oi
    join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
    where oi.order_id = p_order_id
  loop
    insert into public.order_inventory_reservations (
      order_id, order_item_id, warehouse_item_id, quantity, reserved_by
    ) values (
      p_order_id, r.order_item_id, r.warehouse_item_id, r.quantity, auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  perform public.fn_log_order_event(p_order_id, 'warehouse', 'موجودی سفارش رزرو شد', v_count::text || ' قلم رزرو شد');
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
-- 9) Finance integration for orders
-- ---------------------------------------------------------------------
create or replace function public.fn_create_sales_proforma_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_party_id uuid;
  v_doc_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Not allowed to create proforma from order';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  select id into v_doc_id
  from public.finance_documents
  where related_order_id = p_order_id
    and document_type = 'sales_proforma'
    and status <> 'void'
  order by created_at desc
  limit 1;

  if v_doc_id is not null then
    return v_doc_id;
  end if;

  v_party_id := public.fn_finance_party_for_customer(v_order.customer_id);

  insert into public.finance_documents (
    doc_number, document_type, status, party_id, related_order_id,
    source_module, source_record_id, issue_date, due_date, description, created_by
  ) values (
    null, 'sales_proforma', 'draft', v_party_id, v_order.id,
    'orders', v_order.id, current_date, coalesce(v_order.expected_delivery_date, current_date + 7),
    'پیش‌فاکتور برای سفارش ' || v_order.order_code, auth.uid()
  ) returning id into v_doc_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, warehouse_item_id, order_item_id
  )
  select
    v_doc_id,
    row_number() over (order by oi.created_at, oi.id),
    'goods',
    oi.item_name_fa,
    oi.item_name_en,
    oi.quantity,
    oi.unit,
    oi.unit_price,
    wi.id,
    oi.id
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  where oi.order_id = p_order_id;

  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  perform public.fn_log_order_event(p_order_id, 'finance', 'پیش‌فاکتور از سفارش ساخته شد', null, null, null, jsonb_build_object('finance_document_id', v_doc_id));
  return v_doc_id;
end;
$$;

-- Override invoice creation to be idempotent and timeline-aware.
create or replace function public.fn_create_sales_invoice_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_party_id uuid;
  v_doc_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Not allowed to create invoice from order';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  select id into v_doc_id
  from public.finance_documents
  where related_order_id = p_order_id
    and document_type = 'sales_invoice'
    and status <> 'void'
  order by created_at desc
  limit 1;

  if v_doc_id is not null then
    return v_doc_id;
  end if;

  v_party_id := public.fn_finance_party_for_customer(v_order.customer_id);

  insert into public.finance_documents (
    doc_number, document_type, status, party_id, related_order_id,
    source_module, source_record_id, issue_date, due_date, description, created_by
  ) values (
    null, 'sales_invoice', 'draft', v_party_id, v_order.id,
    'orders', v_order.id, current_date, coalesce(v_order.expected_delivery_date, current_date + 7),
    'فاکتور فروش برای سفارش ' || v_order.order_code, auth.uid()
  ) returning id into v_doc_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, warehouse_item_id, order_item_id
  )
  select
    v_doc_id,
    row_number() over (order by oi.created_at, oi.id),
    'goods',
    oi.item_name_fa,
    oi.item_name_en,
    oi.quantity,
    oi.unit,
    oi.unit_price,
    wi.id,
    oi.id
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  where oi.order_id = p_order_id;

  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  perform public.fn_log_order_event(p_order_id, 'finance', 'فاکتور فروش از سفارش ساخته شد', null, null, null, jsonb_build_object('finance_document_id', v_doc_id));
  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) Cross-module referrals from order
-- ---------------------------------------------------------------------
create or replace function public.fn_create_order_referral(
  p_order_id uuid,
  p_target_module text,
  p_title_fa text,
  p_description_fa text default null,
  p_target_role public.user_role default null,
  p_priority smallint default 2,
  p_due_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_active_user() then
    raise exception 'Not allowed to create order referral';
  end if;

  insert into public.automation_referrals (
    referral_number, source_module, target_module, target_role, referral_type,
    priority, status, title_fa, description_fa, related_order_id, created_by, due_date
  ) values (
    null, 'orders', p_target_module, p_target_role, 'request',
    coalesce(p_priority, 2), 'open', p_title_fa, p_description_fa, p_order_id, auth.uid(), p_due_date
  ) returning id into v_referral_id;

  perform public.fn_log_order_event(p_order_id, 'referral', 'ارجاع سفارش ایجاد شد', p_title_fa, null, null, jsonb_build_object('referral_id', v_referral_id, 'target_module', p_target_module));
  return v_referral_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 11) Lifecycle / CRM / reporting views
-- ---------------------------------------------------------------------
create or replace view public.v_order_lifecycle_overview
with (security_invoker = true)
as
with stage_counts as (
  select
    order_id,
    count(*) as total_stages,
    count(*) filter (where status = 'done') as done_stages,
    count(*) filter (where status = 'current') as current_stage_count,
    max(stage_order) filter (where status = 'current') as current_stage_order
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
  c.contact_phone,
  c.city as customer_city,
  c.preferred_contact_channel,
  c.acquisition_source,
  o.sales_path,
  o.current_stage,
  coalesce(osi.stage_name_fa, osd.stage_name_fa, o.current_stage) as current_stage_name_fa,
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
left join public.order_status_definitions osd on osd.sales_path = o.sales_path and osd.stage_key = o.current_stage;

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
where f.is_done = false;


-- Compatibility tracking view updated for workflow-template stages.
create or replace view public.v_order_tracking
with (security_invoker = true)
as
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
  coalesce(tpl_step.is_terminal, d.is_terminal, false) as is_terminal,
  o.priority,
  o.expected_delivery_date,
  o.is_cancelled,
  o.created_at,
  o.updated_at,
  p.full_name as sales_officer_name
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_stage_instances osi on osi.order_id = o.id and osi.stage_key = o.current_stage
left join public.order_workflow_template_steps tpl_step on tpl_step.id = osi.template_step_id
left join public.order_status_definitions d on d.sales_path = o.sales_path and d.stage_key = o.current_stage
left join public.profiles p on p.id = o.sales_officer_id;

-- ---------------------------------------------------------------------
-- 12) RLS
-- ---------------------------------------------------------------------
alter table public.crm_interactions enable row level security;
alter table public.crm_followups enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.order_workflow_templates enable row level security;
alter table public.order_workflow_template_steps enable row level security;
alter table public.order_stage_instances enable row level security;
alter table public.order_events enable row level security;
alter table public.order_inventory_reservations enable row level security;

drop policy if exists crm_interactions_select on public.crm_interactions;
create policy crm_interactions_select on public.crm_interactions for select using (public.has_role(array['admin','sales','accountant']));
drop policy if exists crm_interactions_write on public.crm_interactions;
create policy crm_interactions_write on public.crm_interactions for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists crm_followups_select on public.crm_followups;
create policy crm_followups_select on public.crm_followups for select using (public.has_role(array['admin','sales','accountant']));
drop policy if exists crm_followups_write on public.crm_followups;
create policy crm_followups_write on public.crm_followups for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists crm_opportunities_select on public.crm_opportunities;
create policy crm_opportunities_select on public.crm_opportunities for select using (public.has_role(array['admin','sales','accountant']));
drop policy if exists crm_opportunities_write on public.crm_opportunities;
create policy crm_opportunities_write on public.crm_opportunities for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists order_workflow_templates_select on public.order_workflow_templates;
create policy order_workflow_templates_select on public.order_workflow_templates for select using (public.is_active_user());
drop policy if exists order_workflow_templates_write on public.order_workflow_templates;
create policy order_workflow_templates_write on public.order_workflow_templates for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists order_workflow_steps_select on public.order_workflow_template_steps;
create policy order_workflow_steps_select on public.order_workflow_template_steps for select using (public.is_active_user());
drop policy if exists order_workflow_steps_write on public.order_workflow_template_steps;
create policy order_workflow_steps_write on public.order_workflow_template_steps for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists order_stage_instances_select on public.order_stage_instances;
create policy order_stage_instances_select on public.order_stage_instances for select using (public.fn_user_can_access_order(order_id));
drop policy if exists order_stage_instances_write on public.order_stage_instances;
create policy order_stage_instances_write on public.order_stage_instances for all using (public.fn_user_can_access_order(order_id) and public.is_active_user()) with check (public.fn_user_can_access_order(order_id) and public.is_active_user());

drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events for select using (public.fn_user_can_access_order(order_id));
drop policy if exists order_events_insert on public.order_events;
create policy order_events_insert on public.order_events for insert with check (public.fn_user_can_access_order(order_id));

drop policy if exists order_inventory_reservations_select on public.order_inventory_reservations;
create policy order_inventory_reservations_select on public.order_inventory_reservations for select using (public.fn_user_can_access_order(order_id) or public.has_role(array['admin','warehouse']));
drop policy if exists order_inventory_reservations_write on public.order_inventory_reservations;
create policy order_inventory_reservations_write on public.order_inventory_reservations for all using (public.has_role(array['admin','sales','warehouse'])) with check (public.has_role(array['admin','sales','warehouse']));
