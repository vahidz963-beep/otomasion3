-- =====================================================================
-- 002_ORDERS_CORE
-- Executable order/customer/tracking foundation using the unified role set.
-- Depends on: 001_core_auth_profiles.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'order_sales_path') then
    create type public.order_sales_path as enum ('trading', 'rnd', 'production');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'customer_tier') then
    create type public.customer_tier as enum ('normal', 'vip');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Customers / CRM lite
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_person_name text,
  contact_phone text,
  contact_email text,
  address text,
  tier public.customer_tier not null default 'normal',
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_company_name on public.customers(company_name);
create index if not exists idx_customers_tier on public.customers(tier);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Data-driven stage definitions. n مراحل: add/reorder rows, no code change.
-- ---------------------------------------------------------------------
create table if not exists public.order_status_definitions (
  id uuid primary key default gen_random_uuid(),
  sales_path public.order_sales_path not null,
  stage_key text not null,
  stage_order numeric not null,
  stage_name_fa text not null,
  stage_name_en text not null,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  notify_role_on_enter public.user_role,
  is_active boolean not null default true,
  unique (sales_path, stage_key),
  unique (sales_path, stage_order)
);

create unique index if not exists uq_order_status_one_initial_per_path
on public.order_status_definitions(sales_path) where is_initial;

insert into public.order_status_definitions
  (sales_path, stage_key, stage_order, stage_name_fa, stage_name_en, is_initial, is_terminal, notify_role_on_enter)
values
  ('trading','draft',             1,'ثبت سفارش',                   'Draft',                true,  false, null),
  ('trading','procurement',       2,'خرید کالا',                    'Procurement',          false, false, null),
  ('trading','warehouse_receipt', 3,'ورود کالا به انبار',            'Warehouse Receipt',    false, false, 'warehouse'),
  ('trading','delivered',         4,'تحویل به مشتری',               'Delivered',            false, false, null),
  ('trading','closed',            5,'تسویه و بسته‌شده',             'Closed',               false, true,  'accountant'),

  ('rnd','draft',                 1,'ثبت سفارش',                   'Draft',                true,  false, null),
  ('rnd','in_rnd',                2,'در حال انجام R&D',             'In R&D',               false, false, 'rnd'),
  ('rnd','handoff_or_delivery',   3,'تحویل خروجی / انتقال به تولید', 'Delivery / Handoff',   false, false, null),
  ('rnd','closed',                4,'تسویه و بسته‌شده',             'Closed',               false, true,  'accountant'),

  ('production','draft',          1,'ثبت سفارش',                   'Draft',                true,  false, null),
  ('production','planning',       2,'برنامه‌ریزی تولید',            'Planning',             false, false, 'production'),
  ('production','execution',      3,'اجرای تولید',                 'Execution',            false, false, null),
  ('production','qc',             4,'کنترل کیفیت',                  'QC',                   false, false, null),
  ('production','final_output',   5,'خروجی نهایی',                 'Final Output',          false, false, 'warehouse'),
  ('production','closed',         6,'تحویل و تسویه',                'Delivered & Closed',    false, true,  'accountant')
on conflict (sales_path, stage_key) do nothing;

-- ---------------------------------------------------------------------
-- Orders and line items
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  customer_id uuid not null references public.customers(id),
  sales_path public.order_sales_path not null,
  current_stage text not null,

  title_fa text not null,
  title_en text,
  description_fa text,
  description_en text,
  priority smallint not null default 2 check (priority between 1 and 3),
  expected_delivery_date date,

  sales_officer_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),

  -- Cross-module links, filled by R&D/Production screens/functions after those modules exist.
  rnd_project_id uuid,
  production_order_id uuid,

  is_cancelled boolean not null default false,
  cancelled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_path_stage on public.orders(sales_path, current_stage);
create index if not exists idx_orders_created_by on public.orders(created_by);
create index if not exists idx_orders_sales_officer on public.orders(sales_officer_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_name_fa text not null,
  item_name_en text,
  warehouse_item_code text,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_price numeric not null default 0,
  line_total numeric generated always as (quantity * coalesce(unit_price, 0)) stored,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items(order_id);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid references public.profiles(id),
  note text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_order_status_history_order on public.order_status_history(order_id, changed_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role public.user_role,
  recipient_id uuid references public.profiles(id),
  title_fa text not null,
  title_en text,
  body_fa text,
  body_en text,
  related_order_id uuid references public.orders(id),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_id on public.notifications(recipient_id, is_read);
create index if not exists idx_notifications_recipient_role on public.notifications(recipient_role, is_read);

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  attachment_type text not null default 'other',
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_order_attachments_order on public.order_attachments(order_id);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create sequence if not exists public.order_code_seq;

create or replace function public.fn_generate_order_code()
returns trigger
language plpgsql
as $$
begin
  if new.order_code is null or new.order_code = '' then
    new.order_code := 'ORD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_order_code on public.orders;
create trigger trg_generate_order_code
before insert on public.orders
for each row execute function public.fn_generate_order_code();

create or replace function public.fn_validate_order_stage()
returns trigger
language plpgsql
as $$
declare
  v_valid boolean;
begin
  if tg_op = 'INSERT' and (new.current_stage is null or new.current_stage = '') then
    select stage_key into new.current_stage
    from public.order_status_definitions
    where sales_path = new.sales_path and is_initial and is_active
    limit 1;
  end if;

  select exists (
    select 1
    from public.order_status_definitions
    where sales_path = new.sales_path
      and stage_key = new.current_stage
      and is_active
  ) into v_valid;

  if not v_valid then
    raise exception 'Invalid stage % for sales_path %', new.current_stage, new.sales_path;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_validate_order_stage on public.orders;
create trigger trg_validate_order_stage
before insert or update on public.orders
for each row execute function public.fn_validate_order_stage();

create or replace function public.fn_log_order_stage_change()
returns trigger
language plpgsql
as $$
begin
  if old.current_stage is distinct from new.current_stage then
    insert into public.order_status_history (order_id, from_stage, to_stage, changed_by)
    values (new.id, old.current_stage, new.current_stage, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_order_stage_change on public.orders;
create trigger trg_log_order_stage_change
after update of current_stage on public.orders
for each row execute function public.fn_log_order_stage_change();

create or replace function public.fn_notify_on_order_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notify_role public.user_role;
  v_stage_name_fa text;
begin
  if old.current_stage is distinct from new.current_stage then
    select notify_role_on_enter, stage_name_fa
    into v_notify_role, v_stage_name_fa
    from public.order_status_definitions
    where sales_path = new.sales_path and stage_key = new.current_stage;

    if v_notify_role is not null then
      insert into public.notifications (recipient_role, title_fa, title_en, body_fa, related_order_id)
      values (
        v_notify_role,
        'سفارش ' || new.order_code || ' وارد مرحله «' || v_stage_name_fa || '» شد',
        'Order ' || new.order_code || ' entered stage: ' || coalesce(v_stage_name_fa, new.current_stage),
        new.order_code,
        new.id
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_order_stage_change on public.orders;
create trigger trg_notify_on_order_stage_change
after update of current_stage on public.orders
for each row execute function public.fn_notify_on_order_stage_change();

-- ---------------------------------------------------------------------
-- Access helper used by tables and storage policies.
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
        or (public.current_role_name() = 'sales'::public.user_role and (o.created_by = auth.uid() or o.sales_officer_id = auth.uid() or public.sales_can_view_all_orders()))
        or (public.current_role_name() = 'rnd'::public.user_role and o.sales_path = 'rnd')
        or (public.current_role_name() = 'production'::public.user_role and o.sales_path = 'production')
        or (public.current_role_name() = 'warehouse'::public.user_role and (o.current_stage in ('warehouse_receipt','final_output','delivered') or o.sales_path in ('trading','production')))
        or (public.current_role_name() = 'accountant'::public.user_role)
      )
  );
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.order_status_definitions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.notifications enable row level security;
alter table public.order_attachments enable row level security;

drop policy if exists customers_read_active on public.customers;
create policy customers_read_active on public.customers
for select using (public.is_active_user());

drop policy if exists customers_write_sales_admin on public.customers;
create policy customers_write_sales_admin on public.customers
for all using (public.has_role(array['admin','sales']))
with check (public.has_role(array['admin','sales']));

drop policy if exists order_status_read_active on public.order_status_definitions;
create policy order_status_read_active on public.order_status_definitions
for select using (public.is_active_user());

drop policy if exists order_status_write_admin on public.order_status_definitions;
create policy order_status_write_admin on public.order_status_definitions
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_select_access on public.orders;
create policy orders_select_access on public.orders
for select using (public.fn_user_can_access_order(id));

drop policy if exists orders_insert_sales_admin on public.orders;
create policy orders_insert_sales_admin on public.orders
for insert with check (
  public.is_admin()
  or (public.current_role_name() = 'sales'::public.user_role and public.is_active_user() and created_by = auth.uid() and (sales_officer_id is null or sales_officer_id = auth.uid()))
);

drop policy if exists orders_update_authorized on public.orders;
create policy orders_update_authorized on public.orders
for update using (
  public.is_admin()
  or (public.current_role_name() = 'sales'::public.user_role and public.is_active_user() and created_by = auth.uid())
  or (public.current_role_name() = 'rnd'::public.user_role and public.is_active_user() and sales_path = 'rnd')
  or (public.current_role_name() = 'production'::public.user_role and public.is_active_user() and sales_path = 'production')
  or (public.current_role_name() = 'warehouse'::public.user_role and public.is_active_user() and current_stage in ('warehouse_receipt','final_output','delivered'))
)
with check (
  public.is_admin()
  or (public.current_role_name() = 'sales'::public.user_role and public.is_active_user())
  or (public.current_role_name() in ('rnd'::public.user_role,'production'::public.user_role,'warehouse'::public.user_role) and public.is_active_user())
);

drop policy if exists order_items_select_via_order on public.order_items;
create policy order_items_select_via_order on public.order_items
for select using (public.fn_user_can_access_order(order_id));

drop policy if exists order_items_write_sales_admin on public.order_items;
create policy order_items_write_sales_admin on public.order_items
for all using (public.fn_user_can_access_order(order_id) and public.has_role(array['admin','sales']))
with check (public.fn_user_can_access_order(order_id) and public.has_role(array['admin','sales']));

drop policy if exists order_history_select_via_order on public.order_status_history;
create policy order_history_select_via_order on public.order_status_history
for select using (public.fn_user_can_access_order(order_id));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
for select using (
  public.is_active_user() and (
    recipient_id = auth.uid()
    or recipient_role = public.current_role_name()
    or public.is_admin()
  )
);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
for update using (
  public.is_active_user() and (
    recipient_id = auth.uid()
    or recipient_role = public.current_role_name()
    or public.is_admin()
  )
);

drop policy if exists order_attachments_access on public.order_attachments;
create policy order_attachments_access on public.order_attachments
for all using (public.fn_user_can_access_order(order_id))
with check (public.fn_user_can_access_order(order_id));

-- ---------------------------------------------------------------------
-- Tracking view. security_invoker keeps underlying table RLS active.
-- ---------------------------------------------------------------------
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
  d.stage_name_fa,
  d.stage_name_en,
  d.stage_order,
  d.is_terminal,
  o.priority,
  o.expected_delivery_date,
  o.is_cancelled,
  o.created_at,
  o.updated_at,
  p.full_name as sales_officer_name
from public.orders o
join public.customers c on c.id = o.customer_id
join public.order_status_definitions d on d.sales_path = o.sales_path and d.stage_key = o.current_stage
left join public.profiles p on p.id = o.sales_officer_id;

-- ---------------------------------------------------------------------
-- Storage bucket notes:
-- Create private bucket `order-attachments` and add policies on storage.objects
-- using public.fn_user_can_access_order(((storage.foldername(name))[1])::uuid).
-- ---------------------------------------------------------------------
