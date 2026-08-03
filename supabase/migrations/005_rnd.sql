-- =====================================================================
-- 005_RND
-- R&D module connected to Orders and Production.
-- Depends on: 001_core, 002_orders, 004_production
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'rnd_project_status') then
    create type public.rnd_project_status as enum ('requested','design','prototyping','testing','revision_needed','approved','sent_to_production','rejected','archived');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'rnd_stage_status') then
    create type public.rnd_stage_status as enum ('pending','in_progress','completed','failed','skipped');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'rnd_output_destination') then
    create type public.rnd_output_destination as enum ('internal_production','customer_delivery','both');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'rnd_stage_type') then
    create type public.rnd_stage_type as enum ('requirement_analysis','schematic_design','pcb_layout','bom_finalization','prototype_build','functional_test','customer_review','design_freeze','handoff_production','custom');
  end if;
end $$;

create table if not exists public.rnd_projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title_fa text not null,
  title_en text,
  product_category_id uuid references public.product_categories(id),
  requested_by uuid references public.profiles(id),
  source_order_id uuid references public.orders(id),
  assigned_to uuid references public.profiles(id),
  status public.rnd_project_status not null default 'requested',
  output_destination public.rnd_output_destination not null default 'internal_production',
  customer_requirements text,
  technical_notes text,
  current_revision int not null default 1,
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  progress_percent numeric not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rnd_projects_status on public.rnd_projects(status);
create index if not exists idx_rnd_projects_source_order on public.rnd_projects(source_order_id);

create sequence if not exists public.rnd_project_code_seq;

create or replace function public.fn_generate_rnd_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'RND-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rnd_project_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_rnd_code on public.rnd_projects;
create trigger trg_generate_rnd_code
before insert on public.rnd_projects
for each row execute function public.fn_generate_rnd_code();

drop trigger if exists trg_rnd_projects_updated_at on public.rnd_projects;
create trigger trg_rnd_projects_updated_at
before update on public.rnd_projects
for each row execute function public.set_updated_at();

create table if not exists public.rnd_design_revisions (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  revision_number int not null,
  design_file_url text,
  bom_summary text,
  change_notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(rnd_project_id, revision_number)
);

create table if not exists public.rnd_stage_templates (
  id uuid primary key default gen_random_uuid(),
  product_category_id uuid references public.product_categories(id),
  stage_type public.rnd_stage_type not null,
  name_fa text not null,
  name_en text not null,
  order_index int not null,
  requires_material_issue boolean not null default false,
  is_active boolean not null default true,
  unique(product_category_id, order_index)
);

insert into public.rnd_stage_templates (product_category_id, stage_type, name_fa, name_en, order_index)
select id, 'requirement_analysis', 'تحلیل نیازمندی', 'Requirement Analysis', 1 from public.product_categories where code='PCB_ASSY'
union all select id, 'schematic_design', 'طراحی شماتیک', 'Schematic Design', 2 from public.product_categories where code='PCB_ASSY'
union all select id, 'pcb_layout', 'طراحی لایوت PCB', 'PCB Layout', 3 from public.product_categories where code='PCB_ASSY'
union all select id, 'bom_finalization', 'نهایی‌سازی لیست قطعات', 'BOM Finalization', 4 from public.product_categories where code='PCB_ASSY'
union all select id, 'prototype_build', 'ساخت نمونه اولیه', 'Prototype Build', 5 from public.product_categories where code='PCB_ASSY'
union all select id, 'functional_test', 'تست عملکردی نمونه', 'Prototype Test', 6 from public.product_categories where code='PCB_ASSY'
union all select id, 'design_freeze', 'تثبیت طراحی نهایی', 'Design Freeze', 7 from public.product_categories where code='PCB_ASSY'
on conflict (product_category_id, order_index) do nothing;

create table if not exists public.rnd_project_stages (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  stage_template_id uuid references public.rnd_stage_templates(id),
  order_index int not null,
  status public.rnd_stage_status not null default 'pending',
  assigned_to uuid references public.profiles(id),
  is_custom boolean not null default false,
  custom_stage_type public.rnd_stage_type,
  custom_name_fa text,
  custom_name_en text,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rnd_project_stages_project on public.rnd_project_stages(rnd_project_id);

create or replace function public.fn_create_rnd_stages()
returns trigger
language plpgsql
as $$
begin
  insert into public.rnd_project_stages (rnd_project_id, stage_template_id, order_index)
  select new.id, id, order_index
  from public.rnd_stage_templates
  where is_active = true and product_category_id = new.product_category_id
  order by order_index;
  return new;
end;
$$;

drop trigger if exists trg_create_rnd_stages on public.rnd_projects;
create trigger trg_create_rnd_stages
after insert on public.rnd_projects
for each row execute function public.fn_create_rnd_stages();

create table if not exists public.rnd_material_usage (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  stage_id uuid references public.rnd_project_stages(id),
  item_description text not null,
  quantity numeric,
  unit text,
  estimated_cost numeric,
  future_rnd_warehouse_item_id uuid,
  requested_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  notes text
);

create table if not exists public.rnd_prototype_tests (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  revision_id uuid references public.rnd_design_revisions(id),
  test_description text,
  result text check (result in ('passed','failed','needs_revision')),
  tested_by uuid references public.profiles(id),
  tested_at timestamptz not null default now(),
  attachment_url text
);

create table if not exists public.rnd_production_handoffs (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id),
  final_revision_id uuid references public.rnd_design_revisions(id),
  production_order_id uuid references public.production_orders(id),
  quantity_to_produce numeric not null check (quantity_to_produce > 0),
  handed_off_by uuid references public.profiles(id),
  handed_off_at timestamptz not null default now(),
  notes text
);

create table if not exists public.rnd_progress_logs (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  stage_id uuid references public.rnd_project_stages(id),
  logged_by uuid references public.profiles(id),
  progress_percent numeric,
  description text,
  logged_at timestamptz not null default now()
);

create or replace function public.fn_update_rnd_progress()
returns trigger
language plpgsql
as $$
declare
  total_stages int;
  completed_stages int;
begin
  select count(*), count(*) filter (where status = 'completed')
  into total_stages, completed_stages
  from public.rnd_project_stages
  where rnd_project_id = new.rnd_project_id;

  update public.rnd_projects
  set progress_percent = coalesce(round((completed_stages::numeric / nullif(total_stages,0)) * 100, 1), 0),
      updated_at = now()
  where id = new.rnd_project_id;

  return new;
end;
$$;

drop trigger if exists trg_update_rnd_progress on public.rnd_project_stages;
create trigger trg_update_rnd_progress
after update of status on public.rnd_project_stages
for each row execute function public.fn_update_rnd_progress();

create or replace function public.fn_handoff_rnd_to_production(
  p_rnd_project_id uuid,
  p_quantity numeric,
  p_handed_off_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.rnd_projects%rowtype;
  v_revision_id uuid;
  v_order_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','rnd']) then
    raise exception 'Only R&D or admin can hand off to production';
  end if;

  select * into v_project from public.rnd_projects where id = p_rnd_project_id for update;
  if not found then
    raise exception 'R&D project not found';
  end if;
  if v_project.status <> 'approved' then
    raise exception 'R&D project must be approved before production handoff';
  end if;
  if v_project.product_category_id is null then
    raise exception 'R&D project must have a product category before production handoff';
  end if;

  select id into v_revision_id
  from public.rnd_design_revisions
  where rnd_project_id = p_rnd_project_id
  order by revision_number desc
  limit 1;

  insert into public.production_orders (
    code,
    source_type,
    source_order_id,
    source_rnd_id,
    product_category_id,
    product_name_fa,
    product_name_en,
    quantity_planned,
    status,
    created_by
  ) values (
    null,
    'rnd_project',
    v_project.source_order_id,
    p_rnd_project_id,
    v_project.product_category_id,
    v_project.title_fa,
    v_project.title_en,
    p_quantity,
    'planned',
    coalesce(p_handed_off_by, auth.uid())
  ) returning id into v_order_id;

  insert into public.rnd_production_handoffs (
    rnd_project_id,
    final_revision_id,
    production_order_id,
    quantity_to_produce,
    handed_off_by
  ) values (
    p_rnd_project_id,
    v_revision_id,
    v_order_id,
    p_quantity,
    coalesce(p_handed_off_by, auth.uid())
  );

  update public.rnd_projects
  set status = 'sent_to_production', updated_at = now()
  where id = p_rnd_project_id;

  update public.orders
  set production_order_id = v_order_id,
      rnd_project_id = p_rnd_project_id,
      current_stage = case when sales_path = 'rnd' then 'handoff_or_delivery' else current_stage end,
      updated_at = now()
  where id = v_project.source_order_id;

  return v_order_id;
end;
$$;

-- Cross-module FK constraints after R&D table exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_orders_rnd_project') then
    alter table public.orders
      add constraint fk_orders_rnd_project
      foreign key (rnd_project_id) references public.rnd_projects(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fk_production_orders_source_rnd') then
    alter table public.production_orders
      add constraint fk_production_orders_source_rnd
      foreign key (source_rnd_id) references public.rnd_projects(id);
  end if;
end $$;

create or replace view public.v_rnd_dashboard
with (security_invoker = true)
as
select
  rp.id,
  rp.code,
  rp.title_fa,
  rp.title_en,
  pc.name_fa as category_fa,
  pc.name_en as category_en,
  rp.status,
  rp.progress_percent,
  rp.current_revision,
  rp.output_destination,
  rp.source_order_id,
  h.production_order_id,
  h.handed_off_at
from public.rnd_projects rp
left join public.product_categories pc on pc.id = rp.product_category_id
left join public.rnd_production_handoffs h on h.rnd_project_id = rp.id;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.rnd_projects enable row level security;
alter table public.rnd_design_revisions enable row level security;
alter table public.rnd_stage_templates enable row level security;
alter table public.rnd_project_stages enable row level security;
alter table public.rnd_material_usage enable row level security;
alter table public.rnd_prototype_tests enable row level security;
alter table public.rnd_production_handoffs enable row level security;
alter table public.rnd_progress_logs enable row level security;

drop policy if exists rnd_projects_read on public.rnd_projects;
create policy rnd_projects_read on public.rnd_projects
for select using (public.has_role(array['admin','rnd','sales','production','accountant']));

drop policy if exists rnd_projects_write on public.rnd_projects;
create policy rnd_projects_write on public.rnd_projects
for all using (public.has_role(array['admin','rnd']))
with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_templates_read on public.rnd_stage_templates;
create policy rnd_templates_read on public.rnd_stage_templates for select using (public.is_active_user());
drop policy if exists rnd_templates_write on public.rnd_stage_templates;
create policy rnd_templates_write on public.rnd_stage_templates for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_revisions_read on public.rnd_design_revisions;
create policy rnd_revisions_read on public.rnd_design_revisions for select using (exists (select 1 from public.rnd_projects p where p.id = rnd_design_revisions.rnd_project_id));
drop policy if exists rnd_revisions_write on public.rnd_design_revisions;
create policy rnd_revisions_write on public.rnd_design_revisions for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_stages_read on public.rnd_project_stages;
create policy rnd_stages_read on public.rnd_project_stages for select using (exists (select 1 from public.rnd_projects p where p.id = rnd_project_stages.rnd_project_id));
drop policy if exists rnd_stages_write on public.rnd_project_stages;
create policy rnd_stages_write on public.rnd_project_stages for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_material_read on public.rnd_material_usage;
create policy rnd_material_read on public.rnd_material_usage for select using (exists (select 1 from public.rnd_projects p where p.id = rnd_material_usage.rnd_project_id));
drop policy if exists rnd_material_write on public.rnd_material_usage;
create policy rnd_material_write on public.rnd_material_usage for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_tests_read on public.rnd_prototype_tests;
create policy rnd_tests_read on public.rnd_prototype_tests for select using (exists (select 1 from public.rnd_projects p where p.id = rnd_prototype_tests.rnd_project_id));
drop policy if exists rnd_tests_write on public.rnd_prototype_tests;
create policy rnd_tests_write on public.rnd_prototype_tests for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_handoffs_read on public.rnd_production_handoffs;
create policy rnd_handoffs_read on public.rnd_production_handoffs for select using (public.has_role(array['admin','rnd','production','accountant']));
drop policy if exists rnd_handoffs_write on public.rnd_production_handoffs;
create policy rnd_handoffs_write on public.rnd_production_handoffs for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_progress_read on public.rnd_progress_logs;
create policy rnd_progress_read on public.rnd_progress_logs for select using (exists (select 1 from public.rnd_projects p where p.id = rnd_progress_logs.rnd_project_id));
drop policy if exists rnd_progress_write on public.rnd_progress_logs;
create policy rnd_progress_write on public.rnd_progress_logs for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));
