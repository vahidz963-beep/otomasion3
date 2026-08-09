-- =====================================================================
-- 021_PRODUCTION_MODULE_BACKEND_WORKFLOW
-- Production module backend for online app:
-- - incoming orders from Orders module
-- - accept order into production
-- - configurable production workflow templates (4-15 stages)
-- - planning feedback to Orders timeline
-- - production BOM/formula with costs and finance referral
-- - QC, production documents, views and grants
-- Depends on: 004_production, 007_accounting_finance, 009_orders_backend_workflow
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) New configurable production workflow templates
-- ---------------------------------------------------------------------
create table if not exists public.production_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  name_fa text not null,
  name_en text,
  product_type text not null default 'custom',
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_production_workflow_templates_updated_at on public.production_workflow_templates;
create trigger trg_production_workflow_templates_updated_at
before update on public.production_workflow_templates
for each row execute function public.set_updated_at();

create table if not exists public.production_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.production_workflow_templates(id) on delete cascade,
  stage_key text not null,
  stage_order int not null check (stage_order between 1 and 15),
  stage_name_fa text not null,
  stage_name_en text,
  responsible_role public.user_role,
  requires_material_issue boolean not null default false,
  requires_qc boolean not null default false,
  is_final_stage boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(template_id, stage_key),
  unique(template_id, stage_order)
);

-- ---------------------------------------------------------------------
-- 2) Seed useful templates
-- ---------------------------------------------------------------------
insert into public.production_workflow_templates (template_key, name_fa, name_en, product_type, description, is_default, is_active)
values
  ('power_switching_10', 'تولید پاور سوئیچینگ ۱۰ مرحله‌ای', 'Switching power supply 10-stage', 'power_switching', 'قالب تولید پاور سوئیچینگ از آماده‌سازی تا خروجی نهایی', true, true),
  ('pcb_board_8', 'تولید برد ۸ مرحله‌ای', 'PCB production 8-stage', 'pcb_board', 'قالب تولید برد و تست عملکردی', false, true),
  ('full_product_12', 'تولید محصول کامل ۱۲ مرحله‌ای', 'Full product 12-stage', 'full_product', 'قالب مونتاژ محصول کامل، QC و بسته‌بندی', false, true)
on conflict (template_key) do nothing;

create or replace function public.fn_seed_production_workflow_step(
  p_template_key text,
  p_stage_key text,
  p_stage_order int,
  p_stage_name_fa text,
  p_stage_name_en text,
  p_role public.user_role default null,
  p_material boolean default false,
  p_qc boolean default false,
  p_final boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  select id into v_template_id from public.production_workflow_templates where template_key = p_template_key;
  if v_template_id is null then return; end if;

  insert into public.production_workflow_steps (
    template_id, stage_key, stage_order, stage_name_fa, stage_name_en,
    responsible_role, requires_material_issue, requires_qc, is_final_stage, is_active
  ) values (
    v_template_id, p_stage_key, p_stage_order, p_stage_name_fa, p_stage_name_en,
    p_role, p_material, p_qc, p_final, true
  )
  on conflict (template_id, stage_key) do update
  set stage_order = excluded.stage_order,
      stage_name_fa = excluded.stage_name_fa,
      stage_name_en = excluded.stage_name_en,
      responsible_role = excluded.responsible_role,
      requires_material_issue = excluded.requires_material_issue,
      requires_qc = excluded.requires_qc,
      is_final_stage = excluded.is_final_stage,
      is_active = true;
end;
$$;

select public.fn_seed_production_workflow_step('power_switching_10','accept_order',1,'تأیید سفارش تولید','Accept order','production',false,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','planning',2,'برنامه‌ریزی تولید','Planning','production',false,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','bom_material',3,'بررسی فرمول و مواد','BOM and materials','production',true,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','warehouse_issue',4,'خروج مواد از انبار','Material issue','warehouse',true,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','assembly',5,'مونتاژ اولیه','Assembly','production',false,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','wiring',6,'سیم‌کشی و تکمیل','Wiring','production',false,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','test_power',7,'تست توان و حفاظت','Power test','production',false,true,false);
select public.fn_seed_production_workflow_step('power_switching_10','qc',8,'کنترل کیفیت نهایی','QC','production',false,true,false);
select public.fn_seed_production_workflow_step('power_switching_10','packaging',9,'بسته‌بندی','Packaging','warehouse',false,false,false);
select public.fn_seed_production_workflow_step('power_switching_10','output',10,'خروجی به انبار','Warehouse output','warehouse',false,false,true);

select public.fn_seed_production_workflow_step('pcb_board_8','accept_order',1,'تأیید سفارش تولید','Accept order','production',false,false,false);
select public.fn_seed_production_workflow_step('pcb_board_8','planning',2,'برنامه‌ریزی تولید برد','Planning','production',false,false,false);
select public.fn_seed_production_workflow_step('pcb_board_8','bom_material',3,'آماده‌سازی قطعات','Component prep','production',true,false,false);
select public.fn_seed_production_workflow_step('pcb_board_8','warehouse_issue',4,'خروج قطعات از انبار','Material issue','warehouse',true,false,false);
select public.fn_seed_production_workflow_step('pcb_board_8','assembly',5,'مونتاژ برد','PCB assembly','production',false,false,false);
select public.fn_seed_production_workflow_step('pcb_board_8','programming_test',6,'برنامه‌ریزی و تست','Programming and test','production',false,true,false);
select public.fn_seed_production_workflow_step('pcb_board_8','qc',7,'کنترل کیفیت برد','QC','production',false,true,false);
select public.fn_seed_production_workflow_step('pcb_board_8','output',8,'تحویل برد به انبار','Output','warehouse',false,false,true);

select public.fn_seed_production_workflow_step('full_product_12','accept_order',1,'تأیید سفارش تولید','Accept order','production',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','planning',2,'برنامه‌ریزی تولید','Planning','production',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','bom_material',3,'فرمول تولید و مواد','BOM and materials','production',true,false,false);
select public.fn_seed_production_workflow_step('full_product_12','warehouse_issue',4,'خروج مواد از انبار','Material issue','warehouse',true,false,false);
select public.fn_seed_production_workflow_step('full_product_12','sub_assembly',5,'زیرمونتاژها','Sub assemblies','production',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','assembly_final',6,'مونتاژ نهایی','Final assembly','production',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','internal_test',7,'تست داخلی','Internal test','production',false,true,false);
select public.fn_seed_production_workflow_step('full_product_12','qc',8,'کنترل کیفیت','QC','production',false,true,false);
select public.fn_seed_production_workflow_step('full_product_12','rework',9,'اصلاحات احتمالی','Rework','production',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','packaging',10,'بسته‌بندی','Packaging','warehouse',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','warehouse_output',11,'خروجی به انبار','Warehouse output','warehouse',false,false,false);
select public.fn_seed_production_workflow_step('full_product_12','closed',12,'تکمیل تولید','Completed','production',false,false,true);

-- ---------------------------------------------------------------------
-- 3) Extend old production tables safely
-- ---------------------------------------------------------------------
insert into public.product_categories (code, name_fa, name_en)
values
  ('POWER_SWITCHING', 'پاور سوئیچینگ', 'Switching Power'),
  ('PCB_BOARD', 'برد الکترونیک', 'PCB Board'),
  ('GENERAL_PRODUCTION', 'تولید عمومی', 'General Production')
on conflict (code) do nothing;

alter table public.production_orders
  add column if not exists workflow_template_id uuid references public.production_workflow_templates(id),
  add column if not exists current_stage_key text,
  add column if not exists current_stage_name_fa text,
  add column if not exists customer_name_snapshot text,
  add column if not exists source_order_code text,
  add column if not exists work_days numeric,
  add column if not exists labor_people numeric,
  add column if not exists total_man_hours numeric,
  add column if not exists estimated_total_cost numeric not null default 0,
  add column if not exists bom_id uuid,
  add column if not exists output_warehouse_item_id uuid references public.warehouse_items(id);

create table if not exists public.production_plans (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null unique references public.production_orders(id) on delete cascade,
  planned_start date,
  planned_end date,
  work_days numeric,
  labor_people numeric,
  hours_per_person numeric,
  total_man_hours numeric,
  delivery_note text,
  saved_by uuid references public.profiles(id),
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_production_plans_updated_at on public.production_plans;
create trigger trg_production_plans_updated_at
before update on public.production_plans
for each row execute function public.set_updated_at();

create table if not exists public.production_boms (
  id uuid primary key default gen_random_uuid(),
  warehouse_item_id uuid references public.warehouse_items(id),
  product_name_fa text not null,
  product_name_en text,
  version_no text not null default 'v1',
  status text not null default 'draft' check (status in ('draft','active','archived')),
  unit text not null default 'عدد',
  total_material_cost numeric not null default 0,
  total_labor_cost numeric not null default 0,
  total_overhead_cost numeric not null default 0,
  total_estimated_cost numeric not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_production_boms_updated_at on public.production_boms;
create trigger trg_production_boms_updated_at
before update on public.production_boms
for each row execute function public.set_updated_at();

create table if not exists public.production_bom_items (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.production_boms(id) on delete cascade,
  cost_type text not null default 'material' check (cost_type in ('material','labor','overhead','service')),
  warehouse_item_id uuid references public.warehouse_items(id),
  item_name_fa text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit text not null default 'عدد',
  unit_cost numeric not null default 0,
  total_cost numeric generated always as (quantity * coalesce(unit_cost,0)) stored,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.production_documents (
  id uuid primary key default gen_random_uuid(),
  doc_number text unique,
  production_order_id uuid references public.production_orders(id) on delete set null,
  document_type text not null default 'instruction' check (document_type in ('instruction','material_issue','qc_report','output','cost','other')),
  title_fa text not null,
  description_fa text,
  status text not null default 'draft' check (status in ('draft','registered','void')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.production_document_seq;

create or replace function public.fn_generate_production_document_number()
returns trigger
language plpgsql
as $$
begin
  if new.doc_number is null or new.doc_number = '' then
    new.doc_number := 'PRD-DOC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.production_document_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_production_document_number on public.production_documents;
create trigger trg_generate_production_document_number
before insert on public.production_documents
for each row execute function public.fn_generate_production_document_number();

drop trigger if exists trg_production_documents_updated_at on public.production_documents;
create trigger trg_production_documents_updated_at
before update on public.production_documents
for each row execute function public.set_updated_at();

-- Avoid old category trigger creating duplicate stages when a new workflow template is used.
create or replace function public.fn_create_production_stages()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_template_id is not null then
    return new;
  end if;

  insert into public.production_order_stages (production_order_id, stage_template_id, order_index)
  select new.id, id, order_index
  from public.production_stage_templates
  where is_active and product_category_id = new.product_category_id
  order by order_index;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Helper functions
-- ---------------------------------------------------------------------
create or replace function public.fn_production_recalc_costs(p_bom_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material numeric;
  v_labor numeric;
  v_overhead numeric;
begin
  select
    coalesce(sum(total_cost) filter (where cost_type = 'material'), 0),
    coalesce(sum(total_cost) filter (where cost_type in ('labor','service')), 0),
    coalesce(sum(total_cost) filter (where cost_type = 'overhead'), 0)
  into v_material, v_labor, v_overhead
  from public.production_bom_items
  where bom_id = p_bom_id;

  update public.production_boms
  set total_material_cost = v_material,
      total_labor_cost = v_labor,
      total_overhead_cost = v_overhead,
      total_estimated_cost = v_material + v_labor + v_overhead,
      updated_at = now()
  where id = p_bom_id;
end;
$$;

create or replace function public.fn_production_create_template(
  p_name_fa text,
  p_product_type text default 'custom',
  p_stage_count int default 6
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := least(15, greatest(4, coalesce(p_stage_count, 6)));
  v_key text := 'prod_custom_' || extract(epoch from clock_timestamp())::bigint || '_' || floor(random()*10000)::int;
  v_default_names text[] := array['تأیید سفارش','برنامه‌ریزی تولید','فرمول و مواد','خروج مواد از انبار','اجرای تولید','کنترل کیفیت','اصلاحات','بسته‌بندی','خروجی به انبار','تکمیل تولید','مرحله ۱۱','مرحله ۱۲','مرحله ۱۳','مرحله ۱۴','مرحله ۱۵'];
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  insert into public.production_workflow_templates (template_key, name_fa, name_en, product_type, is_default, is_active, created_by)
  values (v_key, trim(p_name_fa), v_key, coalesce(nullif(p_product_type,''),'custom'), false, true, auth.uid())
  returning id into v_id;

  for i in 1..v_count loop
    insert into public.production_workflow_steps (
      template_id, stage_key, stage_order, stage_name_fa, stage_name_en,
      responsible_role, requires_material_issue, requires_qc, is_final_stage, is_active
    ) values (
      v_id,
      'stage_' || i,
      i,
      v_default_names[i],
      'Stage ' || i,
      case when i in (4,9) then 'warehouse'::public.user_role else 'production'::public.user_role end,
      i in (3,4),
      i in (6),
      i = v_count,
      true
    );
  end loop;

  return v_id;
end;
$$;

create or replace function public.fn_production_accept_order(
  p_order_id uuid,
  p_template_id uuid default null,
  p_product_name_fa text default null,
  p_quantity numeric default 1,
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
  v_prod_id uuid;
  v_first record;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  select o.*, c.company_name
  into v_order
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where o.id = p_order_id
  for update;

  if not found then raise exception 'سفارش یافت نشد'; end if;
  if v_order.is_cancelled then raise exception 'سفارش لغوشده قابل تولید نیست'; end if;
  if v_order.production_order_id is not null then return v_order.production_order_id; end if;

  v_template := p_template_id;
  if v_template is null then
    select id into v_template
    from public.production_workflow_templates
    where is_active
    order by is_default desc, created_at
    limit 1;
  end if;

  select id into v_category from public.product_categories where code = 'GENERAL_PRODUCTION' limit 1;
  if v_category is null then
    select id into v_category from public.product_categories where is_active limit 1;
  end if;

  insert into public.production_orders (
    source_type, source_order_id, product_category_id, workflow_template_id,
    product_name_fa, quantity_planned, unit, status, created_by,
    customer_name_snapshot, source_order_code, notes
  ) values (
    'direct_order', p_order_id, v_category, v_template,
    coalesce(nullif(p_product_name_fa,''), v_order.title_fa, 'تولید سفارش'),
    greatest(coalesce(p_quantity, 1), 1),
    'عدد',
    'planned',
    auth.uid(),
    v_order.company_name,
    v_order.order_code,
    p_notes
  ) returning id into v_prod_id;

  insert into public.production_order_stages (
    production_order_id, stage_template_id, order_index, status,
    assigned_to, is_custom, custom_stage_type, custom_name_fa, custom_name_en
  )
  select
    v_prod_id,
    null,
    s.stage_order,
    case when s.stage_order = 1 then 'in_progress'::public.production_stage_status else 'pending'::public.production_stage_status end,
    null,
    true,
    'custom'::public.production_stage_type,
    s.stage_name_fa,
    s.stage_name_en
  from public.production_workflow_steps s
  where s.template_id = v_template and s.is_active
  order by s.stage_order;

  select * into v_first
  from public.production_order_stages
  where production_order_id = v_prod_id
  order by order_index
  limit 1;

  update public.production_orders
  set current_stage_key = coalesce(v_first.custom_stage_type::text, 'custom'),
      current_stage_name_fa = coalesce(v_first.custom_name_fa, 'تأیید سفارش'),
      progress_percent = 0,
      updated_at = now()
  where id = v_prod_id;

  update public.orders
  set production_order_id = v_prod_id,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_events (order_id, event_type, title, description, created_by)
  values (p_order_id, 'production', 'سفارش در تولید تأیید شد', 'کد تولید: ' || (select code from public.production_orders where id = v_prod_id), auth.uid());

  insert into public.automation_referrals (
    referral_number, source_module, target_module, target_role, referral_type,
    priority, status, title_fa, description_fa, source_record_id, related_order_id, created_by
  ) values (
    null, 'production', 'warehouse', 'warehouse', 'request',
    2, 'open', 'آماده‌سازی مواد تولید سفارش ' || v_order.order_code, 'پس از تکمیل فرمول تولید، مواد مصرفی از انبار خارج شود.', v_prod_id, p_order_id, auth.uid()
  );

  return v_prod_id;
end;
$$;

create or replace function public.fn_production_set_stage(
  p_stage_id uuid,
  p_status text,
  p_note text default null
) returns uuid
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
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  select * into v_stage from public.production_order_stages where id = p_stage_id for update;
  if not found then raise exception 'مرحله تولید یافت نشد'; end if;

  update public.production_order_stages
  set status = p_status::public.production_stage_status,
      started_at = case when p_status in ('in_progress','completed') and started_at is null then now() else started_at end,
      completed_at = case when p_status = 'completed' then now() else completed_at end,
      notes = coalesce(p_note, notes)
  where id = p_stage_id;

  if p_status = 'completed' then
    update public.production_order_stages
    set status = 'in_progress'::public.production_stage_status,
        started_at = coalesce(started_at, now())
    where id = (
      select id from public.production_order_stages
      where production_order_id = v_stage.production_order_id
        and order_index > v_stage.order_index
        and status = 'pending'
      order by order_index
      limit 1
    );
  end if;

  select count(*), count(*) filter (where status = 'completed')
  into v_total, v_done
  from public.production_order_stages
  where production_order_id = v_stage.production_order_id;

  v_progress := coalesce(round((v_done::numeric / nullif(v_total, 0)) * 100, 1), 0);

  select * into v_next
  from public.production_order_stages
  where production_order_id = v_stage.production_order_id
    and status <> 'completed'
  order by order_index
  limit 1;

  update public.production_orders
  set progress_percent = v_progress,
      current_stage_name_fa = coalesce(v_next.custom_name_fa, (select pst.name_fa from public.production_stage_templates pst where pst.id = v_next.stage_template_id), 'تکمیل تولید'),
      status = case when v_progress >= 100 then 'completed'::public.production_order_status else 'in_progress'::public.production_order_status end,
      actual_end = case when v_progress >= 100 then current_date else actual_end end,
      updated_at = now()
  where id = v_stage.production_order_id
  returning source_order_id into v_order_id;

  insert into public.production_progress_logs (production_order_id, stage_id, logged_by, progress_percent, description)
  values (v_stage.production_order_id, p_stage_id, auth.uid(), v_progress, coalesce(p_note, 'تغییر مرحله تولید'));

  if v_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (v_order_id, 'production', 'تغییر مرحله تولید', 'پیشرفت تولید: ' || v_progress || '٪', auth.uid());
  end if;

  return v_stage.production_order_id;
end;
$$;

create or replace function public.fn_production_save_plan(
  p_production_order_id uuid,
  p_planned_start date,
  p_planned_end date,
  p_work_days numeric,
  p_labor_people numeric,
  p_hours_per_person numeric,
  p_total_man_hours numeric,
  p_delivery_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  select * into v_order from public.production_orders where id = p_production_order_id for update;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  insert into public.production_plans (
    production_order_id, planned_start, planned_end, work_days, labor_people,
    hours_per_person, total_man_hours, delivery_note, saved_by
  ) values (
    p_production_order_id, p_planned_start, p_planned_end, p_work_days, p_labor_people,
    p_hours_per_person, p_total_man_hours, p_delivery_note, auth.uid()
  )
  on conflict (production_order_id) do update
  set planned_start = excluded.planned_start,
      planned_end = excluded.planned_end,
      work_days = excluded.work_days,
      labor_people = excluded.labor_people,
      hours_per_person = excluded.hours_per_person,
      total_man_hours = excluded.total_man_hours,
      delivery_note = excluded.delivery_note,
      saved_by = auth.uid(),
      updated_at = now();

  update public.production_orders
  set planned_start = p_planned_start,
      planned_end = p_planned_end,
      work_days = p_work_days,
      labor_people = p_labor_people,
      total_man_hours = p_total_man_hours,
      status = case when status = 'draft' then 'planned'::public.production_order_status else status end,
      updated_at = now()
  where id = p_production_order_id;

  if v_order.source_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (
      v_order.source_order_id,
      'production',
      'برنامه‌ریزی تولید ثبت شد',
      'زمان تولید: ' || coalesce(p_work_days::text,'—') || ' روز کاری، نفر-ساعت: ' || coalesce(p_total_man_hours::text,'—'),
      auth.uid()
    );
  end if;

  return p_production_order_id;
end;
$$;

create or replace function public.fn_production_send_bom_cost_to_finance(p_bom_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom record;
  v_ref uuid;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  perform public.fn_production_recalc_costs(p_bom_id);
  select * into v_bom from public.production_boms where id = p_bom_id;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  insert into public.automation_referrals (
    referral_number, source_module, target_module, target_role, referral_type,
    priority, status, title_fa, description_fa, source_record_id, created_by
  ) values (
    null,
    'production',
    'accounting',
    'accountant',
    'notice',
    2,
    'open',
    'ثبت هزینه تولید کالا: ' || v_bom.product_name_fa,
    'جمع هزینه برآوردی: ' || v_bom.total_estimated_cost || ' ریال. مواد: ' || v_bom.total_material_cost || '، نیرو/خدمات: ' || v_bom.total_labor_cost || '، سربار: ' || v_bom.total_overhead_cost,
    p_bom_id,
    auth.uid()
  ) returning id into v_ref;

  return v_ref;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Views
-- ---------------------------------------------------------------------
create or replace view public.v_production_incoming_orders
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
  coalesce(sum(oi.quantity), 1) as total_quantity,
  count(oi.id) as item_count,
  max(o.created_at) as created_at
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_items oi on oi.order_id = o.id
where o.sales_path = 'production'
  and coalesce(o.is_cancelled, false) = false
  and o.production_order_id is null
group by o.id, c.id;

create or replace view public.v_production_order_overview
with (security_invoker = true)
as
select
  po.id,
  po.code,
  po.source_order_id,
  po.source_order_code,
  o.order_code,
  po.customer_name_snapshot as customer_name,
  po.product_name_fa,
  po.quantity_planned,
  po.quantity_produced,
  po.unit,
  po.status,
  po.progress_percent,
  po.current_stage_name_fa,
  po.planned_start,
  po.planned_end,
  (po.planned_end - current_date) as days_to_delivery,
  case
    when po.status = 'cancelled' then 'cancelled'
    when po.status in ('completed','delivered_to_warehouse') then 'completed'
    when po.planned_end is not null and po.planned_end < current_date then 'late'
    when po.planned_end is not null and po.planned_end <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as delivery_status,
  po.work_days,
  po.labor_people,
  po.total_man_hours,
  po.estimated_total_cost,
  po.workflow_template_id,
  pwt.name_fa as workflow_template_name,
  coalesce(count(pos.id), 0) as total_stages,
  coalesce(count(pos.id) filter (where pos.status = 'completed'), 0) as completed_stages,
  coalesce(count(pmu.id) filter (where pmu.status = 'short'), 0) as material_shortages,
  coalesce(count(qc.id) filter (where qc.result = 'failed'), 0) as qc_failures,
  po.created_at,
  po.updated_at
from public.production_orders po
left join public.orders o on o.id = po.source_order_id
left join public.production_workflow_templates pwt on pwt.id = po.workflow_template_id
left join public.production_order_stages pos on pos.production_order_id = po.id
left join public.production_material_usage pmu on pmu.production_order_id = po.id
left join public.production_qc_checks qc on qc.production_order_id = po.id
group by po.id, o.order_code, pwt.name_fa;

create or replace view public.v_production_bom_summary
with (security_invoker = true)
as
select
  b.*,
  wi.item_code as warehouse_item_code,
  wi.item_name_fa as warehouse_item_name,
  count(i.id) as item_count
from public.production_boms b
left join public.warehouse_items wi on wi.id = b.warehouse_item_id
left join public.production_bom_items i on i.bom_id = b.id
group by b.id, wi.item_code, wi.item_name_fa;

-- ---------------------------------------------------------------------
-- 6) RLS, policies, grants
-- ---------------------------------------------------------------------
alter table public.production_workflow_templates enable row level security;
alter table public.production_workflow_steps enable row level security;
alter table public.production_plans enable row level security;
alter table public.production_boms enable row level security;
alter table public.production_bom_items enable row level security;
alter table public.production_documents enable row level security;

drop policy if exists production_workflow_templates_read on public.production_workflow_templates;
create policy production_workflow_templates_read on public.production_workflow_templates for select using (public.is_active_user());
drop policy if exists production_workflow_templates_write on public.production_workflow_templates;
create policy production_workflow_templates_write on public.production_workflow_templates for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_workflow_steps_read on public.production_workflow_steps;
create policy production_workflow_steps_read on public.production_workflow_steps for select using (public.is_active_user());
drop policy if exists production_workflow_steps_write on public.production_workflow_steps;
create policy production_workflow_steps_write on public.production_workflow_steps for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_plans_read on public.production_plans;
create policy production_plans_read on public.production_plans for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_plans_write on public.production_plans;
create policy production_plans_write on public.production_plans for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_boms_read on public.production_boms;
create policy production_boms_read on public.production_boms for select using (public.has_role(array['admin','production','warehouse','accountant','sales']));
drop policy if exists production_boms_write on public.production_boms;
create policy production_boms_write on public.production_boms for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_bom_items_read on public.production_bom_items;
create policy production_bom_items_read on public.production_bom_items for select using (public.has_role(array['admin','production','warehouse','accountant','sales']));
drop policy if exists production_bom_items_write on public.production_bom_items;
create policy production_bom_items_write on public.production_bom_items for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

drop policy if exists production_documents_read on public.production_documents;
create policy production_documents_read on public.production_documents for select using (public.has_role(array['admin','production','warehouse','accountant','sales','rnd']));
drop policy if exists production_documents_write on public.production_documents;
create policy production_documents_write on public.production_documents for all using (public.has_role(array['admin','production'])) with check (public.has_role(array['admin','production']));

grant select, insert, update, delete on public.production_workflow_templates to authenticated;
grant select, insert, update, delete on public.production_workflow_steps to authenticated;
grant select, insert, update, delete on public.production_plans to authenticated;
grant select, insert, update, delete on public.production_boms to authenticated;
grant select, insert, update, delete on public.production_bom_items to authenticated;
grant select, insert, update, delete on public.production_documents to authenticated;
grant usage, select on sequence public.production_document_seq to authenticated;

grant select on public.v_production_incoming_orders to authenticated;
grant select on public.v_production_order_overview to authenticated;
grant select on public.v_production_bom_summary to authenticated;

grant execute on function public.fn_seed_production_workflow_step(text,text,int,text,text,public.user_role,boolean,boolean,boolean) to authenticated;
grant execute on function public.fn_production_create_template(text,text,int) to authenticated;
grant execute on function public.fn_production_accept_order(uuid,uuid,text,numeric,text) to authenticated;
grant execute on function public.fn_production_set_stage(uuid,text,text) to authenticated;
grant execute on function public.fn_production_save_plan(uuid,date,date,numeric,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.fn_production_recalc_costs(uuid) to authenticated;
grant execute on function public.fn_production_send_bom_cost_to_finance(uuid) to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

notify pgrst, 'reload schema';
