-- =====================================================================
-- 006_SALES_EXTENSIONS
-- Quotations, pricing, customer documents, internal requests, follow-ups.
-- Depends on: 001_core, 002_orders, 003_warehouse
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'quotation_status') then
    create type public.quotation_status as enum ('draft','sent','approved','rejected','expired','converted');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'internal_request_target') then
    create type public.internal_request_target as enum ('warehouse','production','rnd');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'internal_request_status') then
    create type public.internal_request_status as enum ('open','answered','closed','cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Customer documents
-- ---------------------------------------------------------------------
create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  document_type text not null default 'other' check (document_type in ('contract','correspondence','other')),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_customer_documents_customer on public.customer_documents(customer_id);

-- ---------------------------------------------------------------------
-- Price calculator
-- ---------------------------------------------------------------------
create table if not exists public.price_margin_settings (
  sales_path public.order_sales_path primary key,
  default_margin_pct numeric not null default 20,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.price_margin_settings (sales_path, default_margin_pct) values
  ('trading', 20),
  ('rnd', 35),
  ('production', 25)
on conflict (sales_path) do nothing;

drop trigger if exists trg_price_margin_settings_updated_at on public.price_margin_settings;
create trigger trg_price_margin_settings_updated_at
before update on public.price_margin_settings
for each row execute function public.set_updated_at();

create or replace function public.fn_calculate_price(
  p_material_cost numeric,
  p_sales_path public.order_sales_path,
  p_override_margin_pct numeric default null
) returns numeric
language plpgsql
stable
as $$
declare
  v_margin numeric;
begin
  if p_override_margin_pct is not null then
    v_margin := p_override_margin_pct;
  else
    select default_margin_pct into v_margin
    from public.price_margin_settings
    where sales_path = p_sales_path;
  end if;
  return round(coalesce(p_material_cost, 0) * (1 + coalesce(v_margin, 0) / 100.0), 2);
end;
$$;

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_code text unique not null,
  customer_id uuid not null references public.customers(id),
  sales_path public.order_sales_path not null,
  status public.quotation_status not null default 'draft',
  title_fa text not null,
  title_en text,
  valid_until date,
  discount_amount numeric not null default 0,
  tax_pct numeric not null default 0,
  sales_officer_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  converted_order_id uuid references public.orders(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quotations_customer on public.quotations(customer_id);
create index if not exists idx_quotations_status on public.quotations(status);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  item_name_fa text not null,
  item_name_en text,
  warehouse_item_code text,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  material_cost numeric not null default 0,
  margin_pct numeric,
  unit_price numeric,
  line_total numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_quotation_items_quotation on public.quotation_items(quotation_id);

create sequence if not exists public.quotation_code_seq;

create or replace function public.fn_generate_quotation_code()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_code is null or new.quotation_code = '' then
    new.quotation_code := 'QUO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quotation_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_quotation_code on public.quotations;
create trigger trg_generate_quotation_code
before insert on public.quotations
for each row execute function public.fn_generate_quotation_code();

drop trigger if exists trg_quotations_updated_at on public.quotations;
create trigger trg_quotations_updated_at
before update on public.quotations
for each row execute function public.set_updated_at();

create or replace function public.fn_recalculate_quotation_item()
returns trigger
language plpgsql
as $$
declare
  v_path public.order_sales_path;
begin
  select sales_path into v_path from public.quotations where id = new.quotation_id;
  new.unit_price := public.fn_calculate_price(new.material_cost, v_path, new.margin_pct);
  new.line_total := round(new.unit_price * new.quantity, 2);
  return new;
end;
$$;

drop trigger if exists trg_recalculate_quotation_item on public.quotation_items;
create trigger trg_recalculate_quotation_item
before insert or update on public.quotation_items
for each row execute function public.fn_recalculate_quotation_item();

create or replace function public.fn_convert_quotation_to_order(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
  v_order_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales']) then
    raise exception 'Only sales or admin can convert quotations';
  end if;

  select * into v_quotation from public.quotations where id = p_quotation_id for update;
  if not found then
    raise exception 'Quotation not found';
  end if;
  if v_quotation.status <> 'approved' then
    raise exception 'Only approved quotations can be converted';
  end if;
  if v_quotation.converted_order_id is not null then
    return v_quotation.converted_order_id;
  end if;

  insert into public.orders (
    order_code,
    customer_id,
    sales_path,
    current_stage,
    title_fa,
    title_en,
    sales_officer_id,
    created_by
  ) values (
    null,
    v_quotation.customer_id,
    v_quotation.sales_path,
    null,
    v_quotation.title_fa,
    v_quotation.title_en,
    v_quotation.sales_officer_id,
    v_quotation.created_by
  ) returning id into v_order_id;

  insert into public.order_items (order_id, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price)
  select v_order_id, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price
  from public.quotation_items
  where quotation_id = p_quotation_id;

  update public.quotations
  set status = 'converted', converted_order_id = v_order_id, updated_at = now()
  where id = p_quotation_id;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Internal requests from sales to R&D/Production/Warehouse
-- ---------------------------------------------------------------------
create table if not exists public.internal_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text unique not null,
  related_order_id uuid references public.orders(id),
  target_department public.internal_request_target not null,
  subject_fa text not null,
  subject_en text,
  message_fa text,
  message_en text,
  response_fa text,
  response_en text,
  status public.internal_request_status not null default 'open',
  requested_by uuid not null references public.profiles(id),
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_requests_target on public.internal_requests(target_department, status);
create index if not exists idx_internal_requests_order on public.internal_requests(related_order_id);

create sequence if not exists public.internal_request_code_seq;

create or replace function public.fn_generate_internal_request_code()
returns trigger
language plpgsql
as $$
begin
  if new.request_code is null or new.request_code = '' then
    new.request_code := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.internal_request_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_internal_request_code on public.internal_requests;
create trigger trg_generate_internal_request_code
before insert on public.internal_requests
for each row execute function public.fn_generate_internal_request_code();

drop trigger if exists trg_internal_requests_updated_at on public.internal_requests;
create trigger trg_internal_requests_updated_at
before update on public.internal_requests
for each row execute function public.set_updated_at();

create or replace function public.fn_notify_internal_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  v_role := case new.target_department
    when 'warehouse' then 'warehouse'::public.user_role
    when 'production' then 'production'::public.user_role
    when 'rnd' then 'rnd'::public.user_role
  end;

  insert into public.notifications (recipient_role, title_fa, title_en, body_fa, related_order_id)
  values (v_role, 'درخواست جدید: ' || new.subject_fa, 'New internal request', new.request_code, new.related_order_id);
  return new;
end;
$$;

drop trigger if exists trg_notify_internal_request on public.internal_requests;
create trigger trg_notify_internal_request
after insert on public.internal_requests
for each row execute function public.fn_notify_internal_request();

create or replace function public.fn_notify_request_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'answered' and new.status = 'answered' then
    new.answered_at := coalesce(new.answered_at, now());
    new.answered_by := coalesce(new.answered_by, auth.uid());
    insert into public.notifications (recipient_id, title_fa, title_en, body_fa, related_order_id)
    values (new.requested_by, 'پاسخ به درخواست ' || new.request_code, 'Your request was answered', new.response_fa, new.related_order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_request_answered on public.internal_requests;
create trigger trg_notify_request_answered
before update on public.internal_requests
for each row execute function public.fn_notify_request_answered();

-- ---------------------------------------------------------------------
-- Follow-up reminders
-- ---------------------------------------------------------------------
create table if not exists public.follow_up_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  related_order_id uuid references public.orders(id),
  reminder_date date not null,
  note text,
  is_done boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_follow_up_customer on public.follow_up_reminders(customer_id);
create index if not exists idx_follow_up_date_pending on public.follow_up_reminders(reminder_date) where is_done = false;

create or replace view public.v_customers_needing_followup
with (security_invoker = true)
as
with threshold as (
  select coalesce((select (value #>> '{}')::int from public.system_settings where key = 'follow_up_threshold_days'), 14) as days
), last_activity as (
  select customer_id, max(created_at) as last_order_at
  from public.orders
  group by customer_id
)
select
  c.id as customer_id,
  c.company_name,
  c.tier,
  la.last_order_at,
  (current_date - la.last_order_at::date) as days_since_last_order
from public.customers c
left join last_activity la on la.customer_id = c.id
cross join threshold t
where c.is_active
  and (la.last_order_at is null or la.last_order_at < now() - (t.days || ' days')::interval);

create or replace function public.get_sales_performance_kpis(
  p_officer_id uuid,
  p_start_date date,
  p_end_date date
) returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result json;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_admin() or p_officer_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;

  select json_build_object(
    'total_orders', (select count(*) from public.orders o where o.sales_officer_id = p_officer_id and o.created_at::date between p_start_date and p_end_date),
    'orders_by_path', coalesce((select json_object_agg(sales_path, cnt) from (select sales_path, count(*) cnt from public.orders where sales_officer_id = p_officer_id and created_at::date between p_start_date and p_end_date group by sales_path) x), '{}'::json),
    'closed_orders', (select count(*) from public.orders o where o.sales_officer_id = p_officer_id and o.current_stage = 'closed' and o.created_at::date between p_start_date and p_end_date),
    'cancelled_orders', (select count(*) from public.orders o where o.sales_officer_id = p_officer_id and o.is_cancelled and o.created_at::date between p_start_date and p_end_date),
    'quotations_sent', (select count(*) from public.quotations q where q.sales_officer_id = p_officer_id and q.status in ('sent','approved','rejected','converted') and q.created_at::date between p_start_date and p_end_date),
    'quotations_converted', (select count(*) from public.quotations q where q.sales_officer_id = p_officer_id and q.status = 'converted' and q.created_at::date between p_start_date and p_end_date),
    'total_order_value', (select coalesce(sum(oi.line_total), 0) from public.order_items oi join public.orders o2 on o2.id = oi.order_id where o2.sales_officer_id = p_officer_id and o2.created_at::date between p_start_date and p_end_date)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customer_documents enable row level security;
alter table public.price_margin_settings enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.internal_requests enable row level security;
alter table public.follow_up_reminders enable row level security;

drop policy if exists customer_documents_access on public.customer_documents;
create policy customer_documents_access on public.customer_documents for all
using (public.has_role(array['admin','sales','accountant']))
with check (public.has_role(array['admin','sales']));

drop policy if exists price_margin_read on public.price_margin_settings;
create policy price_margin_read on public.price_margin_settings for select using (public.is_active_user());
drop policy if exists price_margin_write on public.price_margin_settings;
create policy price_margin_write on public.price_margin_settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists quotations_read on public.quotations;
create policy quotations_read on public.quotations for select using (public.has_role(array['admin','sales','accountant']));
drop policy if exists quotations_write on public.quotations;
create policy quotations_write on public.quotations for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists quotation_items_read on public.quotation_items;
create policy quotation_items_read on public.quotation_items for select using (exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id));
drop policy if exists quotation_items_write on public.quotation_items;
create policy quotation_items_write on public.quotation_items for all using (public.has_role(array['admin','sales'])) with check (public.has_role(array['admin','sales']));

drop policy if exists internal_requests_sales_admin on public.internal_requests;
create policy internal_requests_sales_admin on public.internal_requests for all
using (public.is_admin() or requested_by = auth.uid())
with check (public.is_admin() or requested_by = auth.uid());

drop policy if exists internal_requests_department_select on public.internal_requests;
create policy internal_requests_department_select on public.internal_requests for select using (
  public.is_active_user() and (
    (public.current_role_name() = 'warehouse'::public.user_role and target_department = 'warehouse') or
    (public.current_role_name() = 'production'::public.user_role and target_department = 'production') or
    (public.current_role_name() = 'rnd'::public.user_role and target_department = 'rnd')
  )
);

drop policy if exists internal_requests_department_update on public.internal_requests;
create policy internal_requests_department_update on public.internal_requests for update using (
  public.is_active_user() and (
    (public.current_role_name() = 'warehouse'::public.user_role and target_department = 'warehouse') or
    (public.current_role_name() = 'production'::public.user_role and target_department = 'production') or
    (public.current_role_name() = 'rnd'::public.user_role and target_department = 'rnd')
  )
);

drop policy if exists follow_up_owner on public.follow_up_reminders;
create policy follow_up_owner on public.follow_up_reminders for all
using (public.is_admin() or created_by = auth.uid())
with check (public.is_admin() or created_by = auth.uid());
