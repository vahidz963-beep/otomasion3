-- =====================================================================
-- 004_PRODUCTION
-- Factory production module with flexible per-category stages.
-- Depends on: 001_core, 002_orders, 003_warehouse
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'production_source_type') then
    create type public.production_source_type as enum ('direct_order', 'rnd_project');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'production_order_status') then
    create type public.production_order_status as enum ('draft','planned','in_progress','qc_pending','qc_rejected','completed','delivered_to_warehouse','cancelled');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'production_stage_status') then
    create type public.production_stage_status as enum ('pending','in_progress','completed','on_hold','rejected');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'production_stage_type') then
    create type public.production_stage_type as enum ('planning','material_prep','assembly','soldering','winding','programming_test','assembly_final','qc','packaging','final_output','custom');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'production_qc_result') then
    create type public.production_qc_result as enum ('passed','failed','rework');
  end if;
end $$;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_fa text not null,
  name_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.product_categories (code, name_fa, name_en) values
  ('PCB_ASSY', 'برد آرایه‌شده (اسمبلی)', 'Assembled PCB'),
  ('PCB_SPEC', 'برد با مشخصات معین', 'Specified Board'),
  ('TRANSFORMER', 'ترانس سوئیچینگ', 'Switching Transformer'),
  ('FULL_PRODUCT', 'محصول کامل', 'Full Product')
on conflict (code) do nothing;

create table if not exists public.production_stage_templates (
  id uuid primary key default gen_random_uuid(),
  product_category_id uuid not null references public.product_categories(id),
  stage_type public.production_stage_type not null,
  name_fa text not null,
  name_en text not null,
  order_index int not null,
  requires_material_issue boolean not null default false,
  requires_qc boolean not null default false,
  is_final_stage boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(product_category_id, order_index)
);

insert into public.production_stage_templates (product_category_id, stage_type, name_fa, name_en, order_index, requires_material_issue, requires_qc, is_final_stage)
select id, 'material_prep'::public.production_stage_type, 'آماده‌سازی هسته و سیم', 'Core & Wire Prep', 1, true, false, false from public.product_categories where code='TRANSFORMER'
union all select id, 'winding'::public.production_stage_type, 'سیم‌پیچی', 'Winding', 2, false, false, false from public.product_categories where code='TRANSFORMER'
union all select id, 'qc'::public.production_stage_type, 'تست الکتریکی', 'Electrical Test', 3, false, true, false from public.product_categories where code='TRANSFORMER'
union all select id, 'final_output'::public.production_stage_type, 'خروجی به انبار', 'Warehouse Output', 4, false, false, true from public.product_categories where code='TRANSFORMER'
on conflict (product_category_id, order_index) do nothing;

insert into public.production_stage_templates (product_category_id, stage_type, name_fa, name_en, order_index, requires_material_issue, requires_qc, is_final_stage)
select id, 'material_prep'::public.production_stage_type, 'آماده‌سازی قطعات SMD/THT', 'Component Prep', 1, true, false, false from public.product_categories where code='PCB_ASSY'
union all select id, 'assembly'::public.production_stage_type, 'چیدن قطعات', 'Pick & Place', 2, false, false, false from public.product_categories where code='PCB_ASSY'
union all select id, 'soldering'::public.production_stage_type, 'ری‌فلو/ویو سولدر', 'Reflow/Wave Soldering', 3, false, false, false from public.product_categories where code='PCB_ASSY'
union all select id, 'qc'::public.production_stage_type, 'بازرسی بصری', 'Visual Inspection', 4, false, true, false from public.product_categories where code='PCB_ASSY'
union all select id, 'programming_test'::public.production_stage_type, 'برنامه‌ریزی و تست عملکردی', 'Programming & Functional Test', 5, false, false, false from public.product_categories where code='PCB_ASSY'
union all select id, 'qc'::public.production_stage_type, 'کنترل کیفیت نهایی', 'Final QC', 6, false, true, false from public.product_categories where code='PCB_ASSY'
union all select id, 'final_output'::public.production_stage_type, 'خروجی به انبار', 'Warehouse Output', 7, false, false, true from public.product_categories where code='PCB_ASSY'
on conflict (product_category_id, order_index) do nothing;

insert into public.production_stage_templates (product_category_id, stage_type, name_fa, name_en, order_index, requires_material_issue, requires_qc, is_final_stage)
select id, 'material_prep'::public.production_stage_type, 'دریافت زیرمجموعه‌ها از انبار', 'Sub-assembly Retrieval', 1, true, false, false from public.product_categories where code='FULL_PRODUCT'
union all select id, 'assembly_final'::public.production_stage_type, 'مونتاژ نهایی محصول', 'Final Assembly', 2, false, false, false from public.product_categories where code='FULL_PRODUCT'
union all select id, 'qc'::public.production_stage_type, 'تست نهایی محصول', 'Final Product Test', 3, false, true, false from public.product_categories where code='FULL_PRODUCT'
union all select id, 'packaging'::public.production_stage_type, 'بسته‌بندی', 'Packaging', 4, false, false, false from public.product_categories where code='FULL_PRODUCT'
union all select id, 'final_output'::public.production_stage_type, 'خروجی به انبار', 'Warehouse Output', 5, false, false, true from public.product_categories where code='FULL_PRODUCT'
on conflict (product_category_id, order_index) do nothing;

create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  source_type public.production_source_type not null default 'direct_order',
  source_order_id uuid references public.orders(id),
  source_rnd_id uuid,
  product_category_id uuid not null references public.product_categories(id),
  product_name_fa text not null,
  product_name_en text,
  quantity_planned numeric not null check (quantity_planned > 0),
  quantity_produced numeric not null default 0,
  unit text not null default 'عدد',
  status public.production_order_status not null default 'draft',
  assigned_to uuid references public.profiles(id),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  progress_percent numeric not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_production_orders_status on public.production_orders(status);
create index if not exists idx_production_orders_source on public.production_orders(source_type, source_order_id, source_rnd_id);

create sequence if not exists public.production_order_code_seq;

create or replace function public.fn_generate_production_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'PRD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.production_order_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_production_code on public.production_orders;
create trigger trg_generate_production_code
before insert on public.production_orders
for each row execute function public.fn_generate_production_code();

drop trigger if exists trg_production_orders_updated_at on public.production_orders;
create trigger trg_production_orders_updated_at
before update on public.production_orders
for each row execute function public.set_updated_at();

create table if not exists public.production_order_stages (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  stage_template_id uuid references public.production_stage_templates(id),
  order_index int not null,
  status public.production_stage_status not null default 'pending',
  assigned_to uuid references public.profiles(id),
  is_custom boolean not null default false,
  custom_stage_type public.production_stage_type,
  custom_name_fa text,
  custom_name_en text,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_production_order_stages_order on public.production_order_stages(production_order_id);

create or replace function public.fn_create_production_stages()
returns trigger
language plpgsql
as $$
begin
  insert into public.production_order_stages (production_order_id, stage_template_id, order_index)
  select new.id, id, order_index
  from public.production_stage_templates
  where is_active and product_category_id = new.product_category_id
  order by order_index;
  return new;
end;
$$;

drop trigger if exists trg_create_production_stages on public.production_orders;
create trigger trg_create_production_stages
after insert on public.production_orders
for each row execute function public.fn_create_production_stages();

create table if not exists public.production_material_usage (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  stage_id uuid references public.production_order_stages(id),
  warehouse_item_id uuid not null references public.warehouse_items(id),
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_issued numeric check (quantity_issued > 0),
  status text not null default 'pending' check (status in ('pending','issued','short','cancelled')),
  requested_by uuid references public.profiles(id),
  issued_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  issued_at timestamptz
);

create or replace function public.fn_issue_production_material_to_warehouse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantity_issued is not null and old.quantity_issued is null then
    perform public.fn_warehouse_issue(
      new.warehouse_item_id,
      new.quantity_issued,
      'production_order',
      new.production_order_id,
      coalesce(new.issued_by, auth.uid()),
      'Production material issue'
    );
    new.status := 'issued';
    new.issued_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_production_material on public.production_material_usage;
create trigger trg_issue_production_material
before update on public.production_material_usage
for each row execute function public.fn_issue_production_material_to_warehouse();

create table if not exists public.production_qc_checks (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  stage_id uuid references public.production_order_stages(id),
  checked_by uuid references public.profiles(id),
  result public.production_qc_result not null,
  quantity_checked numeric,
  quantity_passed numeric,
  quantity_rejected numeric,
  rejection_reason text,
  checked_at timestamptz not null default now()
);

create table if not exists public.production_output (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  warehouse_item_id uuid not null references public.warehouse_items(id),
  quantity numeric not null check (quantity > 0),
  registered_by uuid references public.profiles(id),
  registered_at timestamptz not null default now()
);

create or replace function public.fn_register_production_output_to_warehouse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_warehouse_receipt(
    new.warehouse_item_id,
    new.quantity,
    'production_order',
    new.production_order_id,
    coalesce(new.registered_by, auth.uid()),
    'Production output receipt'
  );

  update public.production_orders
  set quantity_produced = quantity_produced + new.quantity,
      status = case when quantity_produced + new.quantity >= quantity_planned then 'delivered_to_warehouse'::public.production_order_status else 'in_progress'::public.production_order_status end,
      updated_at = now()
  where id = new.production_order_id;

  return new;
end;
$$;

drop trigger if exists trg_register_production_output on public.production_output;
create trigger trg_register_production_output
after insert on public.production_output
for each row execute function public.fn_register_production_output_to_warehouse();

create table if not exists public.production_progress_logs (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  stage_id uuid references public.production_order_stages(id),
  logged_by uuid references public.profiles(id),
  progress_percent numeric,
  description text,
  logged_at timestamptz not null default now()
);

create or replace function public.fn_update_production_progress()
returns trigger
language plpgsql
as $$
declare
  total_stages int;
  completed_stages int;
begin
  select count(*), count(*) filter (where status = 'completed')
  into total_stages, completed_stages
  from public.production_order_stages
  where production_order_id = new.production_order_id;

  update public.production_orders
  set progress_percent = coalesce(round((completed_stages::numeric / nullif(total_stages,0)) * 100, 1), 0),
      updated_at = now()
  where id = new.production_order_id;

  return new;
end;
$$;

drop trigger if exists trg_update_production_progress on public.production_order_stages;
create trigger trg_update_production_progress
after update of status on public.production_order_stages
for each row execute function public.fn_update_production_progress();

-- Link orders.production_order_id after production table exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_orders_production_order') then
    alter table public.orders
      add constraint fk_orders_production_order
      foreign key (production_order_id) references public.production_orders(id);
  end if;
end $$;

create or replace view public.v_production_dashboard
with (security_invoker = true)
as
select
  po.id,
  po.code,
  po.product_name_fa,
  po.product_name_en,
  po.source_type,
  po.status,
  po.progress_percent,
  po.quantity_planned,
  po.quantity_produced,
  po.planned_start,
  po.planned_end,
  count(pmu.id) filter (where pmu.status = 'short') as material_shortages,
  count(qc.id) filter (where qc.result = 'failed') as qc_failures
from public.production_orders po
left join public.production_material_usage pmu on pmu.production_order_id = po.id
left join public.production_qc_checks qc on qc.production_order_id = po.id
group by po.id;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.production_stage_templates enable row level security;
alter table public.production_orders enable row level security;
alter table public.production_order_stages enable row level security;
alter table public.production_material_usage enable row level security;
alter table public.production_qc_checks enable row level security;
alter table public.production_output enable row level security;
alter table public.production_progress_logs enable row level security;

drop policy if exists product_categories_read on public.product_categories;
create policy product_categories_read on public.product_categories for select using (public.is_active_user());
drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists production_templates_read on public.production_stage_templates;
create policy production_templates_read on public.production_stage_templates for select using (public.is_active_user());
drop policy if exists production_templates_write on public.production_stage_templates;
create policy production_templates_write on public.production_stage_templates for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_orders_read on public.production_orders;
create policy production_orders_read on public.production_orders for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_orders_write on public.production_orders;
create policy production_orders_write on public.production_orders for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_stages_read on public.production_order_stages;
create policy production_stages_read on public.production_order_stages for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_stages_write on public.production_order_stages;
create policy production_stages_write on public.production_order_stages for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_material_read on public.production_material_usage;
create policy production_material_read on public.production_material_usage for select using (public.has_role(array['admin','production','warehouse','accountant']));
drop policy if exists production_material_write on public.production_material_usage;
create policy production_material_write on public.production_material_usage for all using (public.has_role(array['admin','production','warehouse'])) with check (public.has_role(array['admin','production','warehouse']));

drop policy if exists production_qc_read on public.production_qc_checks;
create policy production_qc_read on public.production_qc_checks for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_qc_write on public.production_qc_checks;
create policy production_qc_write on public.production_qc_checks for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_output_read on public.production_output;
create policy production_output_read on public.production_output for select using (public.has_role(array['admin','production','warehouse','accountant']));
drop policy if exists production_output_write on public.production_output;
create policy production_output_write on public.production_output for all using (public.has_role(array['admin','production','warehouse'])) with check (public.has_role(array['admin','production','warehouse']));

drop policy if exists production_progress_read on public.production_progress_logs;
create policy production_progress_read on public.production_progress_logs for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_progress_write on public.production_progress_logs;
create policy production_progress_write on public.production_progress_logs for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));
