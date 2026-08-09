-- =====================================================================
-- 022_RND_MODULE_WORKFLOW_AND_SHARED_FILES
-- R&D production-ready backend:
-- - incoming projects from Orders or internal projects
-- - configurable R&D workflow templates (4-15 stages)
-- - project costs: man-hours, time, materials, services
-- - prototype tests
-- - shared files visible from referrals/all modules
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared files used by referrals and all modules
-- ---------------------------------------------------------------------
create table if not exists public.shared_files (
  id uuid primary key default gen_random_uuid(),
  file_number text unique,
  title_fa text,
  file_name text not null,
  mime_type text,
  file_size bigint,
  data_url text,
  source_module text not null default 'manual' check (source_module in ('orders','sales','rnd','production','warehouse','accounting','admin','office','manual')),
  related_order_id uuid references public.orders(id) on delete set null,
  related_record_id uuid,
  visibility text not null default 'all' check (visibility in ('all','module','private')),
  description_fa text,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create sequence if not exists public.shared_file_seq;

create or replace function public.fn_generate_shared_file_number()
returns trigger
language plpgsql
as $$
begin
  if new.file_number is null or new.file_number = '' then
    new.file_number := 'SHF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.shared_file_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_shared_file_number on public.shared_files;
create trigger trg_generate_shared_file_number
before insert on public.shared_files
for each row execute function public.fn_generate_shared_file_number();

-- ---------------------------------------------------------------------
-- Configurable R&D workflow templates
-- ---------------------------------------------------------------------
create table if not exists public.rnd_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  name_fa text not null,
  name_en text,
  project_type text not null default 'custom',
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_rnd_workflow_templates_updated_at on public.rnd_workflow_templates;
create trigger trg_rnd_workflow_templates_updated_at
before update on public.rnd_workflow_templates
for each row execute function public.set_updated_at();

create table if not exists public.rnd_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.rnd_workflow_templates(id) on delete cascade,
  stage_key text not null,
  stage_order int not null check (stage_order between 1 and 15),
  stage_name_fa text not null,
  stage_name_en text,
  responsible_role public.user_role,
  requires_material boolean not null default false,
  requires_test boolean not null default false,
  is_final_stage boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(template_id, stage_key),
  unique(template_id, stage_order)
);

insert into public.rnd_workflow_templates (template_key, name_fa, name_en, project_type, description, is_default, is_active)
values
  ('rnd_pcb_10', 'R&D برد ۱۰ مرحله‌ای', 'R&D PCB 10-stage', 'pcb', 'نیازسنجی، شماتیک، PCB، نمونه‌سازی و تست', true, true),
  ('rnd_transformer_8', 'R&D ترانس ۸ مرحله‌ای', 'R&D Transformer 8-stage', 'transformer', 'طراحی، نمونه‌سازی و تست ترانس/پاور', false, true),
  ('rnd_service_6', 'خدمات فنی R&D شش مرحله‌ای', 'Technical R&D service 6-stage', 'service', 'تحلیل، تست، گزارش و تحویل خدمات فنی', false, true)
on conflict (template_key) do nothing;

create or replace function public.fn_seed_rnd_workflow_step(
  p_template_key text,
  p_stage_key text,
  p_stage_order int,
  p_stage_name_fa text,
  p_stage_name_en text,
  p_role public.user_role default 'rnd',
  p_material boolean default false,
  p_test boolean default false,
  p_final boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  select id into v_template_id from public.rnd_workflow_templates where template_key = p_template_key;
  if v_template_id is null then return; end if;

  insert into public.rnd_workflow_steps (
    template_id, stage_key, stage_order, stage_name_fa, stage_name_en,
    responsible_role, requires_material, requires_test, is_final_stage, is_active
  ) values (
    v_template_id, p_stage_key, p_stage_order, p_stage_name_fa, p_stage_name_en,
    p_role, p_material, p_test, p_final, true
  )
  on conflict (template_id, stage_key) do update
  set stage_order = excluded.stage_order,
      stage_name_fa = excluded.stage_name_fa,
      stage_name_en = excluded.stage_name_en,
      responsible_role = excluded.responsible_role,
      requires_material = excluded.requires_material,
      requires_test = excluded.requires_test,
      is_final_stage = excluded.is_final_stage,
      is_active = true;
end;
$$;

select public.fn_seed_rnd_workflow_step('rnd_pcb_10','accept',1,'تأیید پروژه R&D','Accept','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','requirements',2,'تحلیل نیازمندی','Requirements','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','schematic',3,'طراحی شماتیک','Schematic','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','pcb_layout',4,'طراحی PCB','PCB layout','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','bom',5,'BOM و مواد نمونه','BOM','rnd',true,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','prototype',6,'ساخت نمونه اولیه','Prototype','rnd',true,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','functional_test',7,'تست عملکردی','Functional test','rnd',false,true,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','revision',8,'اصلاح و بازبینی','Revision','rnd',false,true,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','approval',9,'تأیید نهایی','Approval','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_pcb_10','handoff',10,'تحویل/انتقال به تولید','Handoff','production',false,false,true);

select public.fn_seed_rnd_workflow_step('rnd_transformer_8','accept',1,'تأیید پروژه','Accept','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','requirements',2,'بررسی مشخصات فنی','Specs','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','design',3,'طراحی هسته و سیم‌پیچ','Design','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','material',4,'مواد نمونه','Materials','rnd',true,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','prototype',5,'ساخت نمونه','Prototype','rnd',true,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','test',6,'تست الکتریکی/حرارتی','Test','rnd',false,true,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','approval',7,'تأیید نمونه','Approval','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_transformer_8','handoff',8,'تحویل خروجی','Handoff','production',false,false,true);

select public.fn_seed_rnd_workflow_step('rnd_service_6','accept',1,'تأیید درخواست','Accept','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_service_6','analysis',2,'تحلیل مسئله','Analysis','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_service_6','test_plan',3,'طرح تست','Test plan','rnd',false,true,false);
select public.fn_seed_rnd_workflow_step('rnd_service_6','execution',4,'اجرای تست/خدمت','Execution','rnd',false,true,false);
select public.fn_seed_rnd_workflow_step('rnd_service_6','report',5,'گزارش فنی','Report','rnd',false,false,false);
select public.fn_seed_rnd_workflow_step('rnd_service_6','delivery',6,'تحویل نتیجه','Delivery','rnd',false,false,true);

-- ---------------------------------------------------------------------
-- Extend existing R&D tables
-- ---------------------------------------------------------------------
alter table public.rnd_projects
  add column if not exists workflow_template_id uuid references public.rnd_workflow_templates(id),
  add column if not exists current_stage_name_fa text,
  add column if not exists customer_name_snapshot text,
  add column if not exists source_order_code text,
  add column if not exists requester_name text,
  add column if not exists work_days numeric,
  add column if not exists total_man_hours numeric,
  add column if not exists estimated_total_cost numeric not null default 0,
  add column if not exists actual_total_cost numeric not null default 0;

-- Skip old category stages when new workflow is used.
create or replace function public.fn_create_rnd_stages()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_template_id is not null then
    return new;
  end if;

  insert into public.rnd_project_stages (rnd_project_id, stage_template_id, order_index)
  select new.id, id, order_index
  from public.rnd_stage_templates
  where is_active = true and product_category_id = new.product_category_id
  order by order_index;
  return new;
end;
$$;

create table if not exists public.rnd_cost_items (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  cost_type text not null default 'labor' check (cost_type in ('labor','material','service','overhead','test')),
  warehouse_item_id uuid references public.warehouse_items(id),
  title_fa text not null,
  quantity numeric not null default 1,
  unit text not null default 'عدد',
  unit_cost numeric not null default 0,
  hours numeric,
  total_cost numeric generated always as (quantity * coalesce(unit_cost,0)) stored,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.rnd_test_records (
  id uuid primary key default gen_random_uuid(),
  rnd_project_id uuid not null references public.rnd_projects(id) on delete cascade,
  stage_id uuid references public.rnd_project_stages(id),
  test_title text not null,
  test_type text,
  result text not null default 'pending' check (result in ('pending','passed','failed','needs_revision')),
  quantity_tested numeric,
  test_duration_hours numeric,
  test_conditions text,
  result_notes text,
  tested_by uuid references public.profiles(id),
  tested_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------
create or replace function public.fn_rnd_recalc_costs(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_hours numeric;
begin
  select coalesce(sum(total_cost),0), coalesce(sum(hours),0)
  into v_total, v_hours
  from public.rnd_cost_items
  where rnd_project_id = p_project_id;

  update public.rnd_projects
  set actual_total_cost = v_total,
      total_man_hours = v_hours,
      updated_at = now()
  where id = p_project_id;
end;
$$;

create or replace function public.fn_rnd_create_template(
  p_name_fa text,
  p_project_type text default 'custom',
  p_stage_count int default 6
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := least(15, greatest(4, coalesce(p_stage_count, 6)));
  v_key text := 'rnd_custom_' || extract(epoch from clock_timestamp())::bigint || '_' || floor(random()*10000)::int;
  v_names text[] := array['تأیید پروژه','تحلیل نیازمندی','طراحی اولیه','BOM و مواد','ساخت نمونه','تست نمونه','اصلاحات','تأیید نهایی','تحویل/انتقال','بایگانی','مرحله ۱۱','مرحله ۱۲','مرحله ۱۳','مرحله ۱۴','مرحله ۱۵'];
begin
  if not public.has_role(array['admin','rnd']) then raise exception 'دسترسی R&D ندارید'; end if;

  insert into public.rnd_workflow_templates (template_key, name_fa, name_en, project_type, is_active, created_by)
  values (v_key, trim(p_name_fa), v_key, coalesce(nullif(p_project_type,''),'custom'), true, auth.uid())
  returning id into v_id;

  for i in 1..v_count loop
    insert into public.rnd_workflow_steps (template_id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, requires_material, requires_test, is_final_stage)
    values (v_id, 'stage_'||i, i, v_names[i], 'Stage '||i, 'rnd', i in (4,5), i in (6,7), i = v_count);
  end loop;

  return v_id;
end;
$$;

create or replace function public.fn_rnd_accept_order(
  p_order_id uuid,
  p_template_id uuid default null,
  p_title_fa text default null,
  p_requester_name text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_template uuid;
  v_category uuid;
  v_project_id uuid;
  v_first record;
begin
  if not public.has_role(array['admin','rnd']) then raise exception 'دسترسی R&D ندارید'; end if;

  select o.*, c.company_name
  into v_order
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where o.id = p_order_id
  for update;

  if not found then raise exception 'سفارش یافت نشد'; end if;
  if v_order.is_cancelled then raise exception 'سفارش لغوشده قابل R&D نیست'; end if;
  if v_order.rnd_project_id is not null then return v_order.rnd_project_id; end if;

  v_template := p_template_id;
  if v_template is null then
    select id into v_template from public.rnd_workflow_templates where is_active order by is_default desc, created_at limit 1;
  end if;

  select id into v_category from public.product_categories where code='PCB_ASSY' limit 1;
  if v_category is null then select id into v_category from public.product_categories where is_active limit 1; end if;

  insert into public.rnd_projects (
    title_fa, title_en, product_category_id, requested_by, source_order_id, assigned_to,
    status, output_destination, customer_requirements, technical_notes, workflow_template_id,
    customer_name_snapshot, source_order_code, requester_name, created_by
  ) values (
    coalesce(nullif(p_title_fa,''), v_order.title_fa, 'پروژه R&D'),
    null,
    v_category,
    auth.uid(),
    p_order_id,
    null,
    'design',
    'internal_production',
    v_order.description_fa,
    p_notes,
    v_template,
    v_order.company_name,
    v_order.order_code,
    coalesce(nullif(p_requester_name,''), v_order.company_name),
    auth.uid()
  ) returning id into v_project_id;

  insert into public.rnd_project_stages (rnd_project_id, stage_template_id, order_index, status, is_custom, custom_stage_type, custom_name_fa, custom_name_en)
  select v_project_id, null, s.stage_order,
         case when s.stage_order = 1 then 'in_progress'::public.rnd_stage_status else 'pending'::public.rnd_stage_status end,
         true, 'custom'::public.rnd_stage_type, s.stage_name_fa, s.stage_name_en
  from public.rnd_workflow_steps s
  where s.template_id = v_template and s.is_active
  order by s.stage_order;

  select * into v_first from public.rnd_project_stages where rnd_project_id = v_project_id order by order_index limit 1;

  update public.rnd_projects
  set current_stage_name_fa = coalesce(v_first.custom_name_fa, 'تأیید پروژه'), progress_percent = 0
  where id = v_project_id;

  update public.orders set rnd_project_id = v_project_id, updated_at = now() where id = p_order_id;

  insert into public.order_events (order_id, event_type, title, description, created_by)
  values (p_order_id, 'rnd', 'سفارش وارد R&D شد', 'کد پروژه: ' || (select code from public.rnd_projects where id = v_project_id), auth.uid());

  return v_project_id;
end;
$$;

create or replace function public.fn_rnd_create_internal_project(
  p_title_fa text,
  p_template_id uuid default null,
  p_requester_name text default null,
  p_requirements text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_category uuid;
  v_project_id uuid;
  v_first record;
begin
  if not public.has_role(array['admin','rnd']) then raise exception 'دسترسی R&D ندارید'; end if;

  v_template := p_template_id;
  if v_template is null then select id into v_template from public.rnd_workflow_templates where is_active order by is_default desc, created_at limit 1; end if;
  select id into v_category from public.product_categories where code='PCB_ASSY' limit 1;
  if v_category is null then select id into v_category from public.product_categories where is_active limit 1; end if;

  insert into public.rnd_projects (title_fa, product_category_id, requested_by, status, output_destination, customer_requirements, technical_notes, workflow_template_id, requester_name, created_by)
  values (p_title_fa, v_category, auth.uid(), 'requested', 'internal_production', p_requirements, p_notes, v_template, p_requester_name, auth.uid())
  returning id into v_project_id;

  insert into public.rnd_project_stages (rnd_project_id, order_index, status, is_custom, custom_stage_type, custom_name_fa, custom_name_en)
  select v_project_id, s.stage_order,
         case when s.stage_order = 1 then 'in_progress'::public.rnd_stage_status else 'pending'::public.rnd_stage_status end,
         true, 'custom'::public.rnd_stage_type, s.stage_name_fa, s.stage_name_en
  from public.rnd_workflow_steps s where s.template_id = v_template and s.is_active order by s.stage_order;

  select * into v_first from public.rnd_project_stages where rnd_project_id = v_project_id order by order_index limit 1;
  update public.rnd_projects set current_stage_name_fa = coalesce(v_first.custom_name_fa, 'تأیید پروژه'), progress_percent = 0 where id = v_project_id;
  return v_project_id;
end;
$$;

create or replace function public.fn_rnd_set_stage(p_stage_id uuid, p_status text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage record;
  v_total int;
  v_done int;
  v_next record;
  v_progress numeric;
  v_order_id uuid;
begin
  if not public.has_role(array['admin','rnd']) then raise exception 'دسترسی R&D ندارید'; end if;

  select * into v_stage from public.rnd_project_stages where id = p_stage_id for update;
  if not found then raise exception 'مرحله R&D یافت نشد'; end if;

  update public.rnd_project_stages
  set status = p_status::public.rnd_stage_status,
      started_at = case when p_status in ('in_progress','completed') and started_at is null then now() else started_at end,
      completed_at = case when p_status = 'completed' then now() else completed_at end,
      notes = coalesce(p_note, notes)
  where id = p_stage_id;

  if p_status = 'completed' then
    update public.rnd_project_stages
    set status = 'in_progress'::public.rnd_stage_status,
        started_at = coalesce(started_at, now())
    where id = (
      select id from public.rnd_project_stages
      where rnd_project_id = v_stage.rnd_project_id and order_index > v_stage.order_index and status = 'pending'
      order by order_index limit 1
    );
  end if;

  select count(*), count(*) filter (where status = 'completed') into v_total, v_done from public.rnd_project_stages where rnd_project_id = v_stage.rnd_project_id;
  v_progress := coalesce(round((v_done::numeric / nullif(v_total,0)) * 100, 1), 0);

  select * into v_next from public.rnd_project_stages where rnd_project_id = v_stage.rnd_project_id and status <> 'completed' order by order_index limit 1;

  update public.rnd_projects
  set progress_percent = v_progress,
      current_stage_name_fa = coalesce(v_next.custom_name_fa, 'تکمیل پروژه'),
      status = case when v_progress >= 100 then 'approved'::public.rnd_project_status else status end,
      updated_at = now()
  where id = v_stage.rnd_project_id
  returning source_order_id into v_order_id;

  insert into public.rnd_progress_logs (rnd_project_id, stage_id, logged_by, progress_percent, description)
  values (v_stage.rnd_project_id, p_stage_id, auth.uid(), v_progress, coalesce(p_note, 'تغییر مرحله R&D'));

  if v_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (v_order_id, 'rnd', 'تغییر مرحله R&D', 'پیشرفت R&D: ' || v_progress || '٪', auth.uid());
  end if;

  return v_stage.rnd_project_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create or replace view public.v_rnd_incoming_orders
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.description_fa,
  o.expected_delivery_date,
  o.priority,
  c.company_name as customer_name,
  c.contact_phone,
  count(oi.id) as item_count,
  coalesce(sum(oi.quantity),1) as total_quantity,
  o.created_at
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_items oi on oi.order_id = o.id
where o.sales_path = 'rnd'
  and coalesce(o.is_cancelled,false) = false
  and o.rnd_project_id is null
group by o.id, c.id;

create or replace view public.v_rnd_project_overview
with (security_invoker = true)
as
select
  rp.id,
  rp.code,
  rp.title_fa,
  rp.title_en,
  rp.source_order_id,
  o.order_code,
  rp.source_order_code,
  rp.customer_name_snapshot as customer_name,
  rp.requester_name,
  rp.status,
  rp.progress_percent,
  rp.current_stage_name_fa,
  rp.output_destination,
  rp.planned_start,
  rp.planned_end,
  (rp.planned_end - current_date) as days_to_delivery,
  case
    when rp.status in ('approved','sent_to_production','archived') then 'completed'
    when rp.status = 'rejected' then 'cancelled'
    when rp.planned_end is not null and rp.planned_end < current_date then 'late'
    when rp.planned_end is not null and rp.planned_end <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as delivery_status,
  rp.work_days,
  rp.total_man_hours,
  rp.estimated_total_cost,
  rp.actual_total_cost,
  rp.workflow_template_id,
  rwt.name_fa as workflow_template_name,
  coalesce(count(rs.id),0) as total_stages,
  coalesce(count(rs.id) filter (where rs.status = 'completed'),0) as completed_stages,
  rp.created_at,
  rp.updated_at
from public.rnd_projects rp
left join public.orders o on o.id = rp.source_order_id
left join public.rnd_workflow_templates rwt on rwt.id = rp.workflow_template_id
left join public.rnd_project_stages rs on rs.rnd_project_id = rp.id
group by rp.id, o.order_code, rwt.name_fa;

create or replace view public.v_rnd_cost_summary
with (security_invoker = true)
as
select
  rp.id as rnd_project_id,
  rp.code,
  rp.title_fa,
  coalesce(sum(ci.total_cost),0) as total_cost,
  coalesce(sum(ci.total_cost) filter (where ci.cost_type = 'material'),0) as material_cost,
  coalesce(sum(ci.total_cost) filter (where ci.cost_type = 'labor'),0) as labor_cost,
  coalesce(sum(ci.total_cost) filter (where ci.cost_type in ('service','overhead','test')),0) as other_cost,
  coalesce(sum(ci.hours),0) as total_hours,
  count(ci.id) as item_count
from public.rnd_projects rp
left join public.rnd_cost_items ci on ci.rnd_project_id = rp.id
group by rp.id;

-- ---------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------
alter table public.shared_files enable row level security;
alter table public.rnd_workflow_templates enable row level security;
alter table public.rnd_workflow_steps enable row level security;
alter table public.rnd_cost_items enable row level security;
alter table public.rnd_test_records enable row level security;

drop policy if exists shared_files_read on public.shared_files;
create policy shared_files_read on public.shared_files for select using (public.is_active_user());
drop policy if exists shared_files_write on public.shared_files;
create policy shared_files_write on public.shared_files for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists rnd_workflow_templates_read on public.rnd_workflow_templates;
create policy rnd_workflow_templates_read on public.rnd_workflow_templates for select using (public.is_active_user());
drop policy if exists rnd_workflow_templates_write on public.rnd_workflow_templates;
create policy rnd_workflow_templates_write on public.rnd_workflow_templates for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_workflow_steps_read on public.rnd_workflow_steps;
create policy rnd_workflow_steps_read on public.rnd_workflow_steps for select using (public.is_active_user());
drop policy if exists rnd_workflow_steps_write on public.rnd_workflow_steps;
create policy rnd_workflow_steps_write on public.rnd_workflow_steps for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_cost_items_read on public.rnd_cost_items;
create policy rnd_cost_items_read on public.rnd_cost_items for select using (public.has_role(array['admin','rnd','accountant','sales','production']));
drop policy if exists rnd_cost_items_write on public.rnd_cost_items;
create policy rnd_cost_items_write on public.rnd_cost_items for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

drop policy if exists rnd_test_records_read on public.rnd_test_records;
create policy rnd_test_records_read on public.rnd_test_records for select using (public.has_role(array['admin','rnd','sales','production','accountant']));
drop policy if exists rnd_test_records_write on public.rnd_test_records;
create policy rnd_test_records_write on public.rnd_test_records for all using (public.has_role(array['admin','rnd'])) with check (public.has_role(array['admin','rnd']));

grant select, insert, update, delete on public.shared_files to authenticated;
grant usage, select on sequence public.shared_file_seq to authenticated;
grant select, insert, update, delete on public.rnd_workflow_templates to authenticated;
grant select, insert, update, delete on public.rnd_workflow_steps to authenticated;
grant select, insert, update, delete on public.rnd_cost_items to authenticated;
grant select, insert, update, delete on public.rnd_test_records to authenticated;

grant select on public.v_rnd_incoming_orders to authenticated;
grant select on public.v_rnd_project_overview to authenticated;
grant select on public.v_rnd_cost_summary to authenticated;

grant execute on function public.fn_rnd_create_template(text,text,int) to authenticated;
grant execute on function public.fn_rnd_accept_order(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.fn_rnd_create_internal_project(text,uuid,text,text,text) to authenticated;
grant execute on function public.fn_rnd_set_stage(uuid,text,text) to authenticated;
grant execute on function public.fn_rnd_recalc_costs(uuid) to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

notify pgrst, 'reload schema';
