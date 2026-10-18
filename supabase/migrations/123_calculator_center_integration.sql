-- =====================================================================
-- 123_CALCULATOR_CENTER_INTEGRATION
-- Production calculator center: versioned engineering/pricing snapshots,
-- live Warehouse 130 mappings, website idempotency, and atomic reservation.
-- Public quote API remains OFF until calibration is explicitly approved.
-- =====================================================================

begin;

create schema if not exists calculator;
revoke all on schema calculator from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace='calculator'::regnamespace and typname='quote_status') then
    create type calculator.quote_status as enum ('draft','calculated','submitted','approved','paid','reserved','in_production','produced','cancelled','expired');
  end if;
  if not exists (select 1 from pg_type where typnamespace='calculator'::regnamespace and typname='order_kind') then
    create type calculator.order_kind as enum ('sample','production');
  end if;
  if not exists (select 1 from pg_type where typnamespace='calculator'::regnamespace and typname='calculator_kind') then
    create type calculator.calculator_kind as enum ('transformer','board');
  end if;
end $$;

create table if not exists calculator.settings (
  key text primary key,
  value jsonb not null,
  is_secret boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into calculator.settings(key,value,is_secret) values
  ('public_quote_enabled','false'::jsonb,false),
  ('public_quote_calibrated','false'::jsonb,false),
  ('order_owner_profile_id','null'::jsonb,true),
  ('wordpress_allowed_clock_skew_seconds','300'::jsonb,true)
on conflict (key) do nothing;

create table if not exists calculator.formula_versions (
  id uuid primary key default gen_random_uuid(),
  calculator_type calculator.calculator_kind not null,
  version_code text not null,
  status text not null default 'draft' check (status in ('draft','internal_active','public_active','retired')),
  engine_version text not null,
  config jsonb not null,
  calibration_notes text,
  created_by uuid references public.profiles(id),
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique(calculator_type,version_code)
);
create unique index if not exists uq_calculator_internal_formula
  on calculator.formula_versions(calculator_type) where status='internal_active';
create unique index if not exists uq_calculator_public_formula
  on calculator.formula_versions(calculator_type) where status='public_active';

insert into calculator.formula_versions(calculator_type,version_code,status,engine_version,config,calibration_notes)
values
('transformer','TR-0.1.0','internal_active','calculator-engine-1.1.0',jsonb_build_object(
  'packing_factor',0.35,'inter_winding_insulation_mm',0.05,'profit_percent',30,
  'sample_multiplier',2,'sample_setup_rial',5000000,'winding_speed_turns_per_minute',120,
  'setup_minutes_per_winding',0,'labor_hour_rial',0,'overhead_percent',0,
  'solder_cost_rial',0,'varnish_cost_rial',0,'test_cost_rial',0,'packaging_cost_rial',0,
  'gap_cost_rial',0,'copper_density_g_cm3',8.96,'minimum_production_quantity',100,
  'maximum_sample_quantity',99,'price_rounding_rial',10000
),'نسخه داخلی بتا؛ انتشار عمومی تا تکمیل کالیبراسیون غیرفعال است.'),
('board','PCB-0.1.0','internal_active','calculator-engine-1.1.0',jsonb_build_object(
  'base_design_rial',300000000,'profit_percent',30,'price_rounding_rial',10000
),'برآورد داخلی طراحی برد؛ پیش از انتشار عمومی نیازمند کالیبراسیون است.')
on conflict(calculator_type,version_code) do nothing;

create table if not exists calculator.transformer_cores (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  model_code text not null unique,
  family text not null,
  material text,
  effective_area_mm2 numeric check(effective_area_mm2 is null or effective_area_mm2>0),
  center_leg_mm numeric check(center_leg_mm is null or center_leg_mm>0),
  weight_g numeric check(weight_g is null or weight_g>=0),
  assembly_time_seconds numeric check(assembly_time_seconds is null or assembly_time_seconds>=0),
  assembly_method text,
  warehouse_item_id uuid unique references public.warehouse_items(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calculator.transformer_bobbins (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  core_id uuid not null references calculator.transformer_cores(id),
  mount_orientation text not null check(mount_orientation in ('افقی','عمودی','horizontal','vertical')),
  pins_left integer not null check(pins_left between 1 and 30),
  pins_right integer not null check(pins_right between 1 and 30),
  window_width_mm numeric not null check(window_width_mm>0),
  window_height_mm numeric not null check(window_height_mm>0),
  mean_turn_length_mm numeric not null check(mean_turn_length_mm>0),
  flange_length_mm numeric check(flange_length_mm is null or flange_length_mm>=0),
  flange_width_mm numeric check(flange_width_mm is null or flange_width_mm>=0),
  weight_g numeric check(weight_g is null or weight_g>=0),
  warehouse_item_id uuid unique references public.warehouse_items(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(core_id,mount_orientation,pins_left,pins_right,window_width_mm,window_height_mm,mean_turn_length_mm)
);

create table if not exists calculator.enamel_wires (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  diameter_mm numeric not null unique check(diameter_mm>0),
  awg integer,
  wire_type text not null default 'مسی لاکی',
  warehouse_item_id uuid unique references public.warehouse_items(id),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prices and quantities deliberately are NOT copied into the technical catalog.
-- The warehouse_item_id foreign key is the single live link to Version 130.

insert into calculator.transformer_cores
  (source_key, model_code, family, material, effective_area_mm2, center_leg_mm, weight_g, assembly_time_seconds, assembly_method)
values
  ('c001','EE25/10/5','EE','PC40',40,5,8.5,45,'ماشینی'),
  ('c002','EE28/10/11','EE','PC40',82,11,14.2,70,'دستی'),
  ('c003','EFD15','EFD','PC40',15,5,3.8,90,'دستی'),
  ('c004','EFD20','EFD','PC40',31,7,6.9,90,'دستی'),
  ('c005','EFD25','EFD','PC40',58,9,12.1,90,'دستی'),
  ('c006','EE13/12/5','EE','PC40',17.1,5,3.1,90,'دستی'),
  ('c007','EE16/14/5','EE','PC40',20,4.9,3.9,90,'دستی'),
  ('c008','EE19/16/5','EE','PC40',22.09,4.6,4.6,90,'دستی'),
  ('c009','EE22/18','EE','PC40',27.56,5,5.9,90,'دستی'),
  ('c010','EE33/29/13','EE','PC40',119,13,27.4,90,'دستی'),
  ('c011','EF25(EE25/13/7)','EE','PC40',51.2,7,10.9,70,'دستی'),
  ('c012','ER34/14/11','ER','PC40',97,11,20.2,120,'دستی'),
  ('c013','ER28/14/11','ER','PC40',81,11,16.8,120,'دستی'),
  ('c014','ETD34/17/11','ETD','PC40',97.1,11,21.8,120,'دستی'),
  ('c015','PQ20/20','PQ','PC40',62.6,14,13.4,120,'دستی'),
  ('c016','PQ26/20','PQ','PC40',121,19,22.7,120,'دستی'),
  ('c017','PQ32/20','PQ','PC40',169,22,32.2,120,'دستی'),
  ('c018','PQ32/30','PQ','PC40',167,22,39.8,120,'دستی'),
  ('c019','UU9.8','UU','PC40',11,10,2.2,60,'دستی'),
  ('c020','UU10.5','UU','PC40',13.5,11,3.1,60,'دستی'),
  ('c021','UU16','UU','PC40',28.5,15,6.7,60,'دستی')
on conflict (model_code) do update set
  family=excluded.family, material=excluded.material, effective_area_mm2=excluded.effective_area_mm2,
  center_leg_mm=excluded.center_leg_mm, weight_g=excluded.weight_g,
  assembly_time_seconds=excluded.assembly_time_seconds, assembly_method=excluded.assembly_method;

insert into calculator.transformer_bobbins
  (source_key, core_id, mount_orientation, pins_left, pins_right, window_width_mm, window_height_mm, mean_turn_length_mm, flange_length_mm, flange_width_mm, weight_g)
select v.source_key, c.id, v.mount_orientation, v.pins_left, v.pins_right, v.window_width_mm, v.window_height_mm,
       v.mean_turn_length_mm, v.flange_length_mm, v.flange_width_mm, v.weight_g
from (values
  ('b001','EE25/10/5','افقی',5,5,11,5.2,32,32,25,1.8),
  ('b002','EE25/10/5','عمودی',5,5,10.28,4.3,36,18,25,1.6),
  ('b003','EE28/10/11','عمودی',5,5,10.3,5.25,46.4,21,28,2.1),
  ('b004','EE33/29/13','عمودی',7,7,16.8,5.25,56.4,28,33,4.2),
  ('b005','EFD15','افقی',4,4,8.9,1.8,26,22,15,1.1),
  ('b006','EFD20','افقی',5,5,13.3,2.05,34.9,25,21,1.4),
  ('b007','EFD25','افقی',5,5,16.4,2.4,46.4,30,26,2.3),
  ('b008','PQ32/30','عمودی',6,6,18.7,5.26,51.21,34,32,5.6),
  ('b009','PQ32/20','عمودی',6,6,9.07,5.18,50.27,34,32,5.1),
  ('b010','PQ26/20','عمودی',6,6,13.53,3.76,44.58,28,28,3.8),
  ('b011','PQ20/20','عمودی',8,8,11.9,3.1,34.54,23,23,2.4),
  ('b012','ETD34/17/11','عمودی',7,7,20.9,5.9,41.448,36,28,6.2),
  ('b013','ER28/14/11','عمودی',6,6,16.63,4.9,38.55,32,23,3.4),
  ('b014','ER28/14/11','افقی',6,6,16,5.1,37.68,30,30,3.3),
  ('b015','ER34/14/11','افقی',6,6,21.8,5.1,37.68,35,30,4.1),
  ('b016','EE19/16/5','عمودی',5,5,8.75,4.6,28,22,16,1.3)
) as v(source_key, core_code, mount_orientation, pins_left, pins_right, window_width_mm, window_height_mm, mean_turn_length_mm, flange_length_mm, flange_width_mm, weight_g)
join calculator.transformer_cores c on c.model_code=v.core_code
on conflict (source_key) do update set
  core_id=excluded.core_id, mount_orientation=excluded.mount_orientation, pins_left=excluded.pins_left, pins_right=excluded.pins_right,
  window_width_mm=excluded.window_width_mm, window_height_mm=excluded.window_height_mm,
  mean_turn_length_mm=excluded.mean_turn_length_mm, flange_length_mm=excluded.flange_length_mm,
  flange_width_mm=excluded.flange_width_mm, weight_g=excluded.weight_g;

insert into calculator.enamel_wires (source_key, diameter_mm, awg, wire_type)
values
  ('w001',0.15,34,'مسی لاکی'),
  ('w002',0.2,32,'مسی لاکی'),
  ('w003',0.25,30,'مسی لاکی'),
  ('w004',0.3,28,'مسی لاکی'),
  ('w005',0.35,27,'مسی لاکی'),
  ('w006',0.4,26,'مسی لاکی'),
  ('w007',0.45,25,'مسی لاکی'),
  ('w008',0.5,24,'مسی لاکی'),
  ('w009',0.6,23,'مسی لاکی'),
  ('w010',0.7,21,'مسی لاکی'),
  ('w011',0.8,20,'مسی لاکی'),
  ('w012',1,18,'مسی لاکی')
on conflict (diameter_mm) do update set awg=excluded.awg, wire_type=excluded.wire_type;


create sequence if not exists calculator.quote_number_seq;
create table if not exists calculator.quotes (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('CALC-'||to_char(now(),'YYYYMMDD')||'-'||lpad(nextval('calculator.quote_number_seq')::text,6,'0')),
  calculator_type calculator.calculator_kind not null,
  source text not null default 'internal' check(source in ('internal','wordpress','api')),
  status calculator.quote_status not null default 'draft',
  order_type calculator.order_kind,
  quantity integer not null default 1 check(quantity>0),
  customer_name text,
  customer_phone text,
  customer_email text,
  project_title text,
  formula_version_id uuid not null references calculator.formula_versions(id),
  input_snapshot jsonb not null,
  engineering_snapshot jsonb not null default '{}'::jsonb,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  public_result_snapshot jsonb not null default '{}'::jsonb,
  inventory_snapshot jsonb not null default '[]'::jsonb,
  site_order_id text,
  order_id uuid references public.orders(id),
  production_order_id uuid references public.production_orders(id),
  warehouse_document_id uuid references public.warehouse_documents(id),
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reserved_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text
);
create unique index if not exists uq_calculator_quote_site_order
  on calculator.quotes(source,site_order_id) where site_order_id is not null;
create index if not exists idx_calculator_quotes_status on calculator.quotes(status,created_at desc);
create index if not exists idx_calculator_quotes_order on calculator.quotes(order_id);
create index if not exists idx_calculator_quotes_production on calculator.quotes(production_order_id);

create table if not exists calculator.quote_windings (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references calculator.quotes(id) on delete cascade,
  line_no integer not null check(line_no>0),
  name text not null,
  start_pin integer not null,
  end_pin integer not null,
  turns integer not null check(turns>0),
  wire_id uuid not null references calculator.enamel_wires(id),
  strands integer not null default 1 check(strands between 1 and 20),
  arrangement text not null check(arrangement in ('side','bundle')),
  layer_mode text not null check(layer_mode in ('auto','manual')),
  requested_layers integer,
  calculated_layers integer not null check(calculated_layers>0),
  direction text not null check(direction in ('cw','ccw')),
  length_m numeric not null check(length_m>=0),
  weight_kg numeric not null check(weight_kg>=0),
  window_share_percent numeric not null check(window_share_percent>=0),
  unique(quote_id,line_no)
);

create table if not exists calculator.quote_requirements (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references calculator.quotes(id) on delete cascade,
  component_role text not null check(component_role in ('core','bobbin','wire','material')),
  warehouse_item_id uuid not null references public.warehouse_items(id),
  quantity_per_unit numeric not null check(quantity_per_unit>0),
  quantity_total numeric not null check(quantity_total>0),
  unit text not null,
  unique(quote_id,warehouse_item_id)
);

create table if not exists calculator.site_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'wordpress',
  event_key text not null,
  event_type text not null,
  site_order_id text,
  quote_id uuid references calculator.quotes(id),
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  status text not null default 'processing' check(status in ('processing','processed','failed','ignored')),
  result jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,event_key)
);

create table if not exists calculator.audit_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  actor_id uuid references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists calculator.api_rate_buckets (
  bucket_key text not null,
  bucket_started_at timestamptz not null,
  request_count integer not null default 1,
  primary key(bucket_key,bucket_started_at)
);

-- Extend the existing reservation system instead of introducing a second stock flow.
alter table public.order_inventory_reservations
  add column if not exists calculator_quote_id uuid references calculator.quotes(id) on delete cascade,
  add column if not exists consumed_at timestamptz,
  add column if not exists warehouse_transaction_id uuid references public.warehouse_transactions(id),
  add column if not exists idempotency_key text;
alter table public.order_inventory_reservations alter column order_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='order_inventory_reservation_source_check') then
    alter table public.order_inventory_reservations add constraint order_inventory_reservation_source_check
      check(order_id is not null or calculator_quote_id is not null);
  end if;
end $$;
create unique index if not exists uq_calculator_active_reservation
  on public.order_inventory_reservations(calculator_quote_id,warehouse_item_id)
  where calculator_quote_id is not null and status='reserved';
create unique index if not exists uq_calculator_consumed_reservation_tx
  on public.order_inventory_reservations(warehouse_transaction_id)
  where warehouse_transaction_id is not null;

-- Keep the legacy order reservation route on the same item-row lock contract so
-- website calculator reservations and ordinary order reservations cannot race.
create or replace function public.fn_reserve_order_inventory(p_order_id uuid)
returns int language plpgsql security definer set search_path=public as $$
declare v_count int:=0; v_inserted int; v_available numeric; r record;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_role(array['admin','sales','sales_manager','warehouse']) then raise exception 'Not allowed to reserve inventory'; end if;
  if not exists(select 1 from public.orders where id=p_order_id) then raise exception 'Order not found'; end if;
  perform 1 from public.warehouse_items wi where wi.id in(
    select wi2.id from public.order_items oi join public.warehouse_items wi2 on wi2.item_code=oi.warehouse_item_code where oi.order_id=p_order_id
  ) order by wi.id for update;
  for r in
    select oi.id order_item_id,oi.item_name_fa,oi.quantity,wi.id warehouse_item_id,wi.item_code
    from public.order_items oi join public.warehouse_items wi on wi.item_code=oi.warehouse_item_code
    where oi.order_id=p_order_id and not exists(select 1 from public.order_inventory_reservations e where e.order_item_id=oi.id and e.status='reserved')
    order by wi.id
  loop
    select available_for_sale_qty into v_available from public.v_sales_stock_overview where item_id=r.warehouse_item_id;
    if coalesce(v_available,0)<r.quantity then raise exception 'موجودی قابل فروش برای قلم «%» کافی نیست. کد کالا: %, درخواست: %, قابل فروش: %',r.item_name_fa,r.item_code,r.quantity,coalesce(v_available,0); end if;
    insert into public.order_inventory_reservations(order_id,order_item_id,warehouse_item_id,quantity,reserved_by)
    values(p_order_id,r.order_item_id,r.warehouse_item_id,r.quantity,auth.uid()) on conflict do nothing;
    get diagnostics v_inserted=row_count; v_count:=v_count+v_inserted;
  end loop;
  perform public.fn_log_order_event(p_order_id,'warehouse','موجودی سفارش رزرو شد',v_count::text||' قلم رزرو شد');
  return v_count;
end $$;

create or replace function public.fn_release_order_inventory(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_role(array['admin','sales','sales_manager','warehouse']) then raise exception 'Not allowed to release inventory reservation'; end if;
  update public.order_inventory_reservations set status='released',released_at=now() where order_id=p_order_id and status='reserved';
  perform public.fn_log_order_event(p_order_id,'warehouse','رزرو موجودی آزاد شد');
end $$;

-- Uniform timestamps.
drop trigger if exists trg_calc_cores_updated_at on calculator.transformer_cores;
create trigger trg_calc_cores_updated_at before update on calculator.transformer_cores for each row execute function public.set_updated_at();
drop trigger if exists trg_calc_bobbins_updated_at on calculator.transformer_bobbins;
create trigger trg_calc_bobbins_updated_at before update on calculator.transformer_bobbins for each row execute function public.set_updated_at();
drop trigger if exists trg_calc_wires_updated_at on calculator.enamel_wires;
create trigger trg_calc_wires_updated_at before update on calculator.enamel_wires for each row execute function public.set_updated_at();
drop trigger if exists trg_calc_quotes_updated_at on calculator.quotes;
create trigger trg_calc_quotes_updated_at before update on calculator.quotes for each row execute function public.set_updated_at();

-- Defense in depth: custom-schema tables are never directly writable by clients.
alter table calculator.settings enable row level security;
alter table calculator.formula_versions enable row level security;
alter table calculator.transformer_cores enable row level security;
alter table calculator.transformer_bobbins enable row level security;
alter table calculator.enamel_wires enable row level security;
alter table calculator.quotes enable row level security;
alter table calculator.quote_windings enable row level security;
alter table calculator.quote_requirements enable row level security;
alter table calculator.site_events enable row level security;
alter table calculator.audit_events enable row level security;
alter table calculator.api_rate_buckets enable row level security;
revoke all on all tables in schema calculator from anon, authenticated;
revoke all on all sequences in schema calculator from anon, authenticated;

create or replace function public.fn_calculator_assert_role(p_roles text[])
returns void language plpgsql security definer set search_path=public,calculator as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.has_role(p_roles) then
    raise exception 'دسترسی به مرکز محاسبه مجاز نیست';
  end if;
end $$;

create or replace function calculator.log_event(p_type text,p_entity_type text,p_entity_id text,p_details jsonb default '{}'::jsonb,p_actor uuid default null)
returns void language sql security definer set search_path=public,calculator as $$
  insert into calculator.audit_events(event_type,entity_type,entity_id,actor_id,details)
  values(p_type,p_entity_type,p_entity_id,coalesce(p_actor,auth.uid()),coalesce(p_details,'{}'::jsonb));
$$;

create or replace function public.fn_calculator_get_catalog()
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  return jsonb_build_object(
    'cores',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'model_code',c.model_code,'family',c.family,'material',c.material,'effective_area_mm2',c.effective_area_mm2,
      'center_leg_mm',c.center_leg_mm,'weight_g',c.weight_g,'assembly_time_seconds',c.assembly_time_seconds,'assembly_method',c.assembly_method,
      'warehouse_item_id',c.warehouse_item_id,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),
      'mapped',c.warehouse_item_id is not null,'unit_valid',(c.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
      'priced',coalesce(p.current_cost_rial,0)>0,'technical_complete',(c.effective_area_mm2 is not null and c.center_leg_mm is not null),
      'calculable',(c.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc') and coalesce(p.current_cost_rial,0)>0 and c.effective_area_mm2 is not null and c.center_leg_mm is not null),
      'bobbin_count',(select count(*) from calculator.transformer_bobbins b where b.core_id=c.id and b.is_active)
    ) order by c.model_code) from calculator.transformer_cores c left join public.warehouse_items wi on wi.id=c.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=c.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=c.warehouse_item_id where c.is_active),'[]'::jsonb),
    'bobbins',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'core_id',b.core_id,'core_code',c.model_code,'mount_orientation',b.mount_orientation,'pins_left',b.pins_left,'pins_right',b.pins_right,
      'window_width_mm',b.window_width_mm,'window_height_mm',b.window_height_mm,'mean_turn_length_mm',b.mean_turn_length_mm,
      'flange_length_mm',b.flange_length_mm,'flange_width_mm',b.flange_width_mm,'weight_g',b.weight_g,
      'warehouse_item_id',b.warehouse_item_id,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'mapped',b.warehouse_item_id is not null,
      'unit_valid',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
      'priced',coalesce(p.current_cost_rial,0)>0,
      'calculable',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc') and coalesce(p.current_cost_rial,0)>0)
    ) order by c.model_code,b.mount_orientation,b.pins_left) from calculator.transformer_bobbins b join calculator.transformer_cores c on c.id=b.core_id left join public.warehouse_items wi on wi.id=b.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=b.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=b.warehouse_item_id where b.is_active),'[]'::jsonb),
    'wires',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'diameter_mm',w.diameter_mm,'awg',w.awg,'wire_type',w.wire_type,'warehouse_item_id',w.warehouse_item_id,
      'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,'current_qty',coalesce(s.current_qty,0),
      'available_qty',coalesce(s.available_for_sale_qty,0),'mapped',w.warehouse_item_id is not null,
      'unit_valid',(w.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams')),
      'priced',coalesce(p.current_cost_rial,0)>0,
      'calculable',(w.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams') and coalesce(p.current_cost_rial,0)>0)
    ) order by w.diameter_mm) from calculator.enamel_wires w left join public.warehouse_items wi on wi.id=w.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=w.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=w.warehouse_item_id where w.is_active),'[]'::jsonb),
    'warehouse_items',coalesce((select jsonb_agg(jsonb_build_object('id',v.item_id,'item_code',v.item_code,'item_name_fa',v.item_name_fa,'unit',v.unit,'category',v.category,'current_qty',v.current_qty,'available_qty',v.available_for_sale_qty) order by v.item_code) from public.v_app_inventory_catalog v),'[]'::jsonb),
    'public_quote_enabled',coalesce((select (value#>>'{}')::boolean from calculator.settings where key='public_quote_enabled'),false)
  );
end $$;

create or replace function public.fn_calculator_get_context(p_core_id uuid,p_bobbin_id uuid,p_wire_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_formula calculator.formula_versions%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'این تابع فقط در موتور امن سرور قابل اجرا است'; end if;
  select * into v_formula from calculator.formula_versions where calculator_type='transformer' and status='internal_active' limit 1;
  if not found then raise exception 'نسخه فعال فرمول ترانس یافت نشد'; end if;
  return jsonb_build_object(
    'formula',jsonb_build_object('id',v_formula.id,'version_code',v_formula.version_code,'engine_version',v_formula.engine_version,'config',v_formula.config),
    'core',(select jsonb_build_object('id',c.id,'model_code',c.model_code,'family',c.family,'material',c.material,'effective_area_mm2',c.effective_area_mm2,'center_leg_mm',c.center_leg_mm,'weight_g',c.weight_g,'assembly_time_seconds',c.assembly_time_seconds,'warehouse_item_id',c.warehouse_item_id,'warehouse_code',wi.item_code,'unit',wi.unit,'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at) from calculator.transformer_cores c left join public.warehouse_items wi on wi.id=c.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=c.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=c.warehouse_item_id where c.id=p_core_id and c.is_active and c.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
    'bobbin',(select jsonb_build_object('id',b.id,'core_id',b.core_id,'mount_orientation',b.mount_orientation,'pins_left',b.pins_left,'pins_right',b.pins_right,'window_width_mm',b.window_width_mm,'window_height_mm',b.window_height_mm,'mean_turn_length_mm',b.mean_turn_length_mm,'weight_g',b.weight_g,'warehouse_item_id',b.warehouse_item_id,'warehouse_code',wi.item_code,'unit',wi.unit,'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at) from calculator.transformer_bobbins b left join public.warehouse_items wi on wi.id=b.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=b.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=b.warehouse_item_id where b.id=p_bobbin_id and b.core_id=p_core_id and b.is_active and b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
    'wires',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'diameter_mm',w.diameter_mm,'awg',w.awg,'wire_type',w.wire_type,'warehouse_item_id',w.warehouse_item_id,'warehouse_code',wi.item_code,'unit',wi.unit,'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at) order by w.diameter_mm) from calculator.enamel_wires w left join public.warehouse_items wi on wi.id=w.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=w.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=w.warehouse_item_id where w.id=any(p_wire_ids) and w.is_active and w.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams')),'[]'::jsonb)
  );
end $$;

create or replace function public.fn_calculator_get_board_context()
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_formula calculator.formula_versions%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'این تابع فقط در موتور امن سرور قابل اجرا است'; end if;
  select * into v_formula from calculator.formula_versions where calculator_type='board' and status='internal_active' limit 1;
  if not found then raise exception 'نسخه فعال فرمول طراحی برد یافت نشد'; end if;
  return jsonb_build_object('id',v_formula.id,'version_code',v_formula.version_code,'engine_version',v_formula.engine_version,'config',v_formula.config);
end $$;

create or replace function calculator.resolve_warehouse_item(p_warehouse_item_id uuid,p_new jsonb,p_default_name text,p_default_unit text,p_default_category text)
returns uuid language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_qty numeric; v_currency text;
begin
  if p_warehouse_item_id is not null then
    if not exists(select 1 from public.warehouse_items where id=p_warehouse_item_id and is_active) then raise exception 'قلم انبار انتخاب‌شده معتبر نیست'; end if;
    return p_warehouse_item_id;
  end if;
  if p_new is null or p_new='null'::jsonb then return null; end if;
  if not public.has_role(array['admin','warehouse']) then raise exception 'ایجاد قلم جدید انبار فقط برای مدیر یا انبار مجاز است'; end if;
  insert into public.warehouse_items(item_code,item_name_fa,item_name_en,unit,category,min_stock_threshold,is_active,unit_price_estimate,price_currency)
  values(trim(p_new->>'item_code'),coalesce(nullif(trim(p_new->>'item_name_fa'),''),p_default_name),nullif(trim(p_new->>'item_name_en'),''),coalesce(nullif(trim(p_new->>'unit'),''),p_default_unit),coalesce(nullif(trim(p_new->>'category'),''),p_default_category),greatest(coalesce((p_new->>'min_stock_threshold')::numeric,0),0),true,0,'IRR')
  returning id into v_id;
  v_qty:=greatest(coalesce((p_new->>'initial_quantity')::numeric,0),0);
  if v_qty>0 then perform public.fn_record_stock_movement(v_id,'in',v_qty,'opening_balance','موجودی اولیه ثبت مدل از مرکز محاسبه'); end if;
  v_currency:=upper(coalesce(nullif(trim(p_new->>'price_currency'),''),'IRR'));
  if v_currency in ('USD','CNY') then
    perform public.fn_set_warehouse_item_currency_price(v_id,v_currency,coalesce((p_new->>'base_cost_price')::numeric,0),coalesce((p_new->>'base_sale_price')::numeric,0));
  end if;
  return v_id;
end $$;

create or replace function public.fn_calculator_save_core(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid;
begin
  perform public.fn_calculator_assert_role(array['admin','warehouse','production']);
  v_existing:=nullif(p_payload->>'id','')::uuid;
  v_wh:=calculator.resolve_warehouse_item(nullif(p_payload->>'warehouse_item_id','')::uuid,p_new_warehouse_item,p_payload->>'model_code','عدد','Core');
  if v_wh is not null and not exists(select 1 from public.warehouse_items where id=v_wh and lower(trim(unit)) in ('عدد','piece','pieces','pcs','pc')) then raise exception 'واحد قلم انبار هسته باید عدد باشد'; end if;
  if nullif(trim(p_payload->>'model_code'),'') is null or nullif(trim(p_payload->>'family'),'') is null then raise exception 'مدل و خانواده هسته الزامی است'; end if;
  if coalesce((p_payload->>'effective_area_mm2')::numeric,0)<=0 or coalesce((p_payload->>'center_leg_mm')::numeric,0)<=0 then raise exception 'Ae و عرض پایه مرکزی باید دقیق و مثبت باشند'; end if;
  insert into calculator.transformer_cores(id,model_code,family,material,effective_area_mm2,center_leg_mm,weight_g,assembly_time_seconds,assembly_method,warehouse_item_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),trim(p_payload->>'model_code'),trim(p_payload->>'family'),nullif(trim(p_payload->>'material'),''),(p_payload->>'effective_area_mm2')::numeric,(p_payload->>'center_leg_mm')::numeric,nullif(p_payload->>'weight_g','')::numeric,coalesce(nullif(p_payload->>'assembly_time_seconds','')::numeric,0),nullif(trim(p_payload->>'assembly_method'),''),v_wh,auth.uid(),auth.uid())
  on conflict(id) do update set model_code=excluded.model_code,family=excluded.family,material=excluded.material,effective_area_mm2=excluded.effective_area_mm2,center_leg_mm=excluded.center_leg_mm,weight_g=excluded.weight_g,assembly_time_seconds=excluded.assembly_time_seconds,assembly_method=excluded.assembly_method,warehouse_item_id=excluded.warehouse_item_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'core',v_id::text,jsonb_build_object('warehouse_item_id',v_wh));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;

create or replace function public.fn_calculator_save_bobbin(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid; v_core uuid;
begin
  perform public.fn_calculator_assert_role(array['admin','warehouse','production']);
  v_existing:=nullif(p_payload->>'id','')::uuid; v_core:=(p_payload->>'core_id')::uuid;
  if not exists(select 1 from calculator.transformer_cores where id=v_core and is_active) then raise exception 'هسته انتخاب‌شده معتبر نیست'; end if;
  if (p_payload->>'mount_orientation') not in ('افقی','عمودی','horizontal','vertical') then raise exception 'جهت نصب بوبین معتبر نیست'; end if;
  if coalesce((p_payload->>'pins_left')::int,0)<1 or coalesce((p_payload->>'pins_right')::int,0)<1 then raise exception 'تعداد پایه هر سمت الزامی است'; end if;
  if coalesce((p_payload->>'window_width_mm')::numeric,0)<=0 or coalesce((p_payload->>'window_height_mm')::numeric,0)<=0 or coalesce((p_payload->>'mean_turn_length_mm')::numeric,0)<=0 then raise exception 'BW، HW و MLT واقعی و مثبت الزامی‌اند'; end if;
  v_wh:=calculator.resolve_warehouse_item(nullif(p_payload->>'warehouse_item_id','')::uuid,p_new_warehouse_item,'بوبین '||(select model_code from calculator.transformer_cores where id=v_core),'عدد','Bobbin');
  if v_wh is not null and not exists(select 1 from public.warehouse_items where id=v_wh and lower(trim(unit)) in ('عدد','piece','pieces','pcs','pc')) then raise exception 'واحد قلم انبار بوبین باید عدد باشد'; end if;
  insert into calculator.transformer_bobbins(id,core_id,mount_orientation,pins_left,pins_right,window_width_mm,window_height_mm,mean_turn_length_mm,flange_length_mm,flange_width_mm,weight_g,warehouse_item_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),v_core,p_payload->>'mount_orientation',(p_payload->>'pins_left')::int,(p_payload->>'pins_right')::int,(p_payload->>'window_width_mm')::numeric,(p_payload->>'window_height_mm')::numeric,(p_payload->>'mean_turn_length_mm')::numeric,nullif(p_payload->>'flange_length_mm','')::numeric,nullif(p_payload->>'flange_width_mm','')::numeric,nullif(p_payload->>'weight_g','')::numeric,v_wh,auth.uid(),auth.uid())
  on conflict(id) do update set core_id=excluded.core_id,mount_orientation=excluded.mount_orientation,pins_left=excluded.pins_left,pins_right=excluded.pins_right,window_width_mm=excluded.window_width_mm,window_height_mm=excluded.window_height_mm,mean_turn_length_mm=excluded.mean_turn_length_mm,flange_length_mm=excluded.flange_length_mm,flange_width_mm=excluded.flange_width_mm,weight_g=excluded.weight_g,warehouse_item_id=excluded.warehouse_item_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'bobbin',v_id::text,jsonb_build_object('warehouse_item_id',v_wh,'core_id',v_core));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;

create or replace function public.fn_calculator_save_wire(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid;
begin
  perform public.fn_calculator_assert_role(array['admin','warehouse','production']);
  v_existing:=nullif(p_payload->>'id','')::uuid;
  if coalesce((p_payload->>'diameter_mm')::numeric,0)<=0 then raise exception 'قطر واقعی سیم با احتساب لاک الزامی است'; end if;
  v_wh:=calculator.resolve_warehouse_item(nullif(p_payload->>'warehouse_item_id','')::uuid,p_new_warehouse_item,'سیم مسی لاکی قطر '||(p_payload->>'diameter_mm')||' میلی‌متر','گرم','Wire');
  if v_wh is not null and not exists(select 1 from public.warehouse_items where id=v_wh and lower(trim(unit)) in ('گرم','g','gr','gram','grams')) then raise exception 'واحد قلم انبار سیم باید گرم باشد'; end if;
  insert into calculator.enamel_wires(id,diameter_mm,awg,wire_type,warehouse_item_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),(p_payload->>'diameter_mm')::numeric,nullif(p_payload->>'awg','')::int,coalesce(nullif(trim(p_payload->>'wire_type'),''),'مسی لاکی'),v_wh,auth.uid(),auth.uid())
  on conflict(id) do update set diameter_mm=excluded.diameter_mm,awg=excluded.awg,wire_type=excluded.wire_type,warehouse_item_id=excluded.warehouse_item_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'wire',v_id::text,jsonb_build_object('warehouse_item_id',v_wh));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;

create or replace function public.fn_calculator_save_quote(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_formula uuid; v_actor uuid; v_status calculator.quote_status; v_line jsonb; v_req jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'ثبت Snapshot فقط توسط موتور امن سرور مجاز است'; end if;
  v_id:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  v_formula:=(p_payload->>'formula_version_id')::uuid; v_actor:=nullif(p_payload->>'actor_id','')::uuid;
  select status into v_status from calculator.quotes where id=v_id for update;
  if found and v_status in ('reserved','in_production','produced','cancelled') then raise exception 'سند قطعی قابل بازنویسی نیست'; end if;
  insert into calculator.quotes(id,calculator_type,source,status,order_type,quantity,customer_name,customer_phone,customer_email,project_title,formula_version_id,input_snapshot,engineering_snapshot,pricing_snapshot,public_result_snapshot,inventory_snapshot,site_order_id,expires_at,created_by,updated_by)
  values(v_id,(p_payload->>'calculator_type')::calculator.calculator_kind,coalesce(p_payload->>'source','internal'),'calculated',nullif(p_payload->>'order_type','')::calculator.order_kind,(p_payload->>'quantity')::int,nullif(p_payload->>'customer_name',''),nullif(p_payload->>'customer_phone',''),nullif(p_payload->>'customer_email',''),nullif(p_payload->>'project_title',''),v_formula,p_payload->'input_snapshot',p_payload->'engineering_snapshot',p_payload->'pricing_snapshot',p_payload->'public_result_snapshot',p_payload->'inventory_snapshot',nullif(p_payload->>'site_order_id',''),nullif(p_payload->>'expires_at','')::timestamptz,v_actor,v_actor)
  on conflict(id) do update set calculator_type=excluded.calculator_type,source=excluded.source,status='calculated',order_type=excluded.order_type,quantity=excluded.quantity,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,customer_email=excluded.customer_email,project_title=excluded.project_title,formula_version_id=excluded.formula_version_id,input_snapshot=excluded.input_snapshot,engineering_snapshot=excluded.engineering_snapshot,pricing_snapshot=excluded.pricing_snapshot,public_result_snapshot=excluded.public_result_snapshot,inventory_snapshot=excluded.inventory_snapshot,site_order_id=coalesce(excluded.site_order_id,calculator.quotes.site_order_id),expires_at=excluded.expires_at,updated_by=v_actor;
  delete from calculator.quote_windings where quote_id=v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'windings','[]'::jsonb)) loop
    insert into calculator.quote_windings(quote_id,line_no,name,start_pin,end_pin,turns,wire_id,strands,arrangement,layer_mode,requested_layers,calculated_layers,direction,length_m,weight_kg,window_share_percent)
    values(v_id,(v_line->>'line_no')::int,v_line->>'name',(v_line->>'start_pin')::int,(v_line->>'end_pin')::int,(v_line->>'turns')::int,(v_line->>'wire_id')::uuid,(v_line->>'strands')::int,v_line->>'arrangement',v_line->>'layer_mode',nullif(v_line->>'requested_layers','')::int,(v_line->>'calculated_layers')::int,v_line->>'direction',(v_line->>'length_m')::numeric,(v_line->>'weight_kg')::numeric,(v_line->>'window_share_percent')::numeric);
  end loop;
  delete from calculator.quote_requirements where quote_id=v_id;
  for v_req in select * from jsonb_array_elements(coalesce(p_payload->'requirements','[]'::jsonb)) loop
    insert into calculator.quote_requirements(quote_id,component_role,warehouse_item_id,quantity_per_unit,quantity_total,unit)
    values(v_id,v_req->>'component_role',(v_req->>'warehouse_item_id')::uuid,(v_req->>'quantity_per_unit')::numeric,(v_req->>'quantity_total')::numeric,v_req->>'unit');
  end loop;
  perform calculator.log_event('quote_calculated','quote',v_id::text,jsonb_build_object('formula_version_id',v_formula,'quantity',p_payload->>'quantity'),v_actor);
  return (select jsonb_build_object('id',q.id,'public_code',q.public_code,'status',q.status,'public_result',q.public_result_snapshot) from calculator.quotes q where q.id=v_id);
end $$;

create or replace function public.fn_calculator_list_quotes(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select q.id,q.public_code,q.calculator_type::text,q.source,q.status::text,q.order_type::text,q.quantity,q.customer_name,q.customer_phone,q.project_title,q.site_order_id,q.order_id,q.production_order_id,q.public_result_snapshot,q.inventory_snapshot,q.created_at,q.reserved_at,q.consumed_at from calculator.quotes q order by q.created_at desc limit least(greatest(p_limit,1),300)) x),'[]'::jsonb);
end $$;

create or replace function public.fn_calculator_get_quote(p_quote_id uuid,p_include_costs boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_admin boolean:=public.is_admin();
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  return (select to_jsonb(q)-'pricing_snapshot'||jsonb_build_object(
    'pricing_snapshot',case when p_include_costs and v_admin then q.pricing_snapshot else '{}'::jsonb end,
    'windings',coalesce((select jsonb_agg(to_jsonb(w) order by w.line_no) from calculator.quote_windings w where w.quote_id=q.id),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.component_role) from calculator.quote_requirements r where r.quote_id=q.id),'[]'::jsonb),
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('warehouse_item_id',r.warehouse_item_id,'quantity',r.quantity,'status',r.status,'reserved_at',r.reserved_at,'released_at',r.released_at,'consumed_at',r.consumed_at)) from public.order_inventory_reservations r where r.calculator_quote_id=q.id),'[]'::jsonb)
  ) from calculator.quotes q where q.id=p_quote_id);
end $$;

create or replace function public.fn_calculator_reserve_quote(p_quote_id uuid,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_q calculator.quotes%rowtype; r record; v_available numeric;
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','warehouse']);
  select * into v_q from calculator.quotes where id=p_quote_id for update;
  if not found then raise exception 'محاسبه یافت نشد'; end if;
  if v_q.status in ('reserved','in_production','produced') then return jsonb_build_object('quote_id',v_q.id,'status',v_q.status,'idempotent',true); end if;
  if v_q.status in ('cancelled','expired') or (v_q.expires_at is not null and v_q.expires_at<now()) then raise exception 'محاسبه لغوشده یا منقضی قابل رزرو نیست'; end if;
  if not exists(select 1 from calculator.quote_requirements where quote_id=p_quote_id) then raise exception 'اقلام مصرفی محاسبه ثبت نشده‌اند'; end if;
  perform 1 from public.warehouse_items wi where wi.id in(select warehouse_item_id from calculator.quote_requirements where quote_id=p_quote_id) order by wi.id for update;
  for r in select qr.*,wi.item_name_fa,coalesce(s.available_for_sale_qty,0) as available from calculator.quote_requirements qr join public.warehouse_items wi on wi.id=qr.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=qr.warehouse_item_id where qr.quote_id=p_quote_id order by qr.warehouse_item_id loop
    v_available:=r.available;
    if v_available<r.quantity_total then raise exception 'موجودی قابل رزرو % کافی نیست؛ نیاز: %، قابل رزرو: %',r.item_name_fa,r.quantity_total,v_available; end if;
    insert into public.order_inventory_reservations(order_id,warehouse_item_id,quantity,status,reserved_by,notes,calculator_quote_id,idempotency_key)
    values(v_q.order_id,r.warehouse_item_id,r.quantity_total,'reserved',auth.uid(),'رزرو مواد مرکز محاسبه '||v_q.public_code,p_quote_id,p_idempotency_key)
    on conflict(calculator_quote_id,warehouse_item_id) where calculator_quote_id is not null and status='reserved' do nothing;
  end loop;
  update calculator.quotes set status='reserved',reserved_at=coalesce(reserved_at,now()),updated_by=coalesce(auth.uid(),updated_by) where id=p_quote_id;
  perform calculator.log_event('inventory_reserved','quote',p_quote_id::text,jsonb_build_object('idempotency_key',p_idempotency_key));
  return jsonb_build_object('quote_id',p_quote_id,'status','reserved','idempotent',false);
end $$;

create or replace function public.fn_calculator_release_quote(p_quote_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_count int;
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  perform 1 from calculator.quotes where id=p_quote_id for update;
  update public.order_inventory_reservations set status='released',released_at=now(),notes=concat_ws(' — ',notes,nullif(p_reason,'')) where calculator_quote_id=p_quote_id and status='reserved';
  get diagnostics v_count=row_count;
  update calculator.quotes set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),cancellation_reason=coalesce(nullif(p_reason,''),cancellation_reason),updated_by=coalesce(auth.uid(),updated_by) where id=p_quote_id and status<>'produced';
  perform calculator.log_event('inventory_released','quote',p_quote_id::text,jsonb_build_object('count',v_count,'reason',p_reason));
  return jsonb_build_object('quote_id',p_quote_id,'status','cancelled','released_count',v_count);
end $$;

create or replace function public.fn_calculator_consume_quote(p_quote_id uuid,p_production_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_q calculator.quotes%rowtype; r record; v_tx uuid; v_count int:=0; v_current numeric; v_doc uuid; v_actor uuid; v_doc_number text;
begin
  perform public.fn_calculator_assert_role(array['admin','production','warehouse']);
  select * into v_q from calculator.quotes where id=p_quote_id for update;
  if not found then raise exception 'محاسبه یافت نشد'; end if;
  if v_q.status='produced' then return jsonb_build_object('quote_id',p_quote_id,'status','produced','idempotent',true); end if;
  if v_q.status='cancelled' then raise exception 'سفارش لغوشده قابل مصرف نیست'; end if;
  perform 1 from public.warehouse_items wi where wi.id in(select warehouse_item_id from public.order_inventory_reservations where calculator_quote_id=p_quote_id and status='reserved') order by wi.id for update;
  if not exists(select 1 from public.order_inventory_reservations where calculator_quote_id=p_quote_id and status='reserved') then
    if exists(select 1 from public.order_inventory_reservations where calculator_quote_id=p_quote_id and status='consumed') then return jsonb_build_object('quote_id',p_quote_id,'status','produced','idempotent',true); end if;
    raise exception 'رزرو فعالی برای مصرف وجود ندارد';
  end if;
  v_actor:=coalesce(auth.uid(),v_q.updated_by,v_q.created_by);
  if v_actor is null then raise exception 'کاربر ثبت‌کننده سند خروج انبار مشخص نیست'; end if;
  v_doc_number:='WH-OUT-CALC-'||to_char(now() at time zone 'Asia/Tehran','YYYY')||'-'||lpad(nextval('public.warehouse_out_doc_seq')::text,6,'0');
  insert into public.warehouse_documents(doc_number,type,status,created_by,finalized_at,note)
  values(v_doc_number,'out'::public.warehouse_document_type,'final'::public.warehouse_document_status,v_actor,now(),'مصرف قطعی مواد پس از پایان تولید '||v_q.public_code)
  returning id into v_doc;
  for r in select * from public.order_inventory_reservations where calculator_quote_id=p_quote_id and status='reserved' order by warehouse_item_id for update loop
    select current_qty into v_current from public.v_warehouse_current_stock where item_id=r.warehouse_item_id;
    if coalesce(v_current,0)<r.quantity then raise exception 'موجودی قطعی قلم % برای مصرف کافی نیست؛ نیاز: %، موجودی: %',r.warehouse_item_id,r.quantity,coalesce(v_current,0); end if;
    insert into public.warehouse_transactions(item_id,transaction_type,quantity,reference_type,reference_id,document_id,created_by,note)
    values(r.warehouse_item_id,'issue'::public.warehouse_transaction_type,r.quantity,'calculator_quote',p_quote_id,v_doc,v_actor,'مصرف قطعی پس از پایان تولید '||v_q.public_code)
    returning id into v_tx;
    insert into public.warehouse_document_lines(document_id,item_id,quantity,reason,note,tx_id)
    values(v_doc,r.warehouse_item_id,r.quantity,'production_output','مصرف محاسبه '||v_q.public_code,v_tx);
    update public.order_inventory_reservations set status='consumed',consumed_at=now(),warehouse_transaction_id=v_tx where id=r.id;
    v_count:=v_count+1;
  end loop;
  update calculator.quotes set status='produced',production_order_id=coalesce(p_production_order_id,production_order_id),warehouse_document_id=v_doc,consumed_at=coalesce(consumed_at,now()),updated_by=v_actor where id=p_quote_id;
  perform calculator.log_event('inventory_consumed','quote',p_quote_id::text,jsonb_build_object('count',v_count,'production_order_id',p_production_order_id));
  return jsonb_build_object('quote_id',p_quote_id,'status','produced','consumed_count',v_count,'warehouse_document_id',v_doc,'warehouse_document_number',v_doc_number,'idempotent',false);
end $$;

create or replace function public.fn_calculator_promote_quote_to_order(p_quote_id uuid,p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,calculator as $$
declare v_q calculator.quotes%rowtype; v_actor uuid; v_customer uuid; v_order uuid; v_code text;
begin
  if coalesce(auth.role(),'')<>'service_role' then perform public.fn_calculator_assert_role(array['admin','sales','sales_manager']); end if;
  select * into v_q from calculator.quotes where id=p_quote_id for update;
  if not found then raise exception 'محاسبه یافت نشد'; end if;
  if v_q.order_id is not null then return v_q.order_id; end if;
  v_actor:=coalesce(p_actor_id,auth.uid(),nullif((select value#>>'{}' from calculator.settings where key='order_owner_profile_id'),'')::uuid);
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and is_active) then return null; end if;
  select id into v_customer from public.customers where (v_q.customer_phone is not null and contact_phone=v_q.customer_phone) or (v_q.customer_email is not null and contact_email=v_q.customer_email) order by updated_at desc limit 1;
  if v_customer is null then insert into public.customers(company_name,contact_person_name,contact_phone,contact_email,created_by,notes) values(coalesce(nullif(v_q.customer_name,''),'مشتری سایت'),v_q.customer_name,v_q.customer_phone,v_q.customer_email,v_actor,'ایجاد خودکار از مرکز محاسبه') returning id into v_customer; end if;
  v_code:='WEB-'||regexp_replace(coalesce(v_q.site_order_id,v_q.public_code),'[^A-Za-z0-9_-]','','g');
  insert into public.orders(order_code,customer_id,sales_path,current_stage,title_fa,description_fa,created_by,sales_officer_id)
  values(v_code,v_customer,'production','draft',coalesce(v_q.project_title,'سفارش ترانس '||v_q.public_code),'ایجادشده از مرکز محاسبه؛ شناسه '||v_q.public_code,v_actor,v_actor)
  on conflict(order_code) do update set updated_at=now() returning id into v_order;
  if not exists(select 1 from public.order_items where order_id=v_order) then
    insert into public.order_items(order_id,item_name_fa,quantity,unit,unit_price,notes)
    values(v_order,'ترانس سفارشی '||coalesce(v_q.input_snapshot->>'core_model',''),v_q.quantity,'عدد',coalesce((v_q.public_result_snapshot->>'unit_sale_rial')::numeric,0),'Snapshot محاسبه '||v_q.public_code);
  end if;
  update calculator.quotes set order_id=v_order,updated_by=v_actor where id=p_quote_id;
  update public.order_inventory_reservations set order_id=v_order where calculator_quote_id=p_quote_id and order_id is null;
  perform calculator.log_event('quote_promoted_to_order','quote',p_quote_id::text,jsonb_build_object('order_id',v_order),v_actor);
  return v_order;
end $$;

create or replace function public.fn_calculator_process_site_event(p_event_key text,p_event_type text,p_site_order_id text,p_quote_id uuid,p_payload jsonb,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_event calculator.site_events%rowtype; v_result jsonb; v_order uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'رویداد سایت فقط از API امن پذیرفته می‌شود'; end if;
  insert into calculator.site_events(provider,event_key,event_type,site_order_id,quote_id,payload,payload_hash)
  values('wordpress',p_event_key,p_event_type,p_site_order_id,p_quote_id,coalesce(p_payload,'{}'::jsonb),p_payload_hash)
  on conflict(provider,event_key) do nothing returning * into v_event;
  if not found then
    select * into v_event from calculator.site_events where provider='wordpress' and event_key=p_event_key;
    return coalesce(v_event.result,jsonb_build_object('event_id',v_event.id,'status',v_event.status,'idempotent',true));
  end if;
  update calculator.quotes set site_order_id=coalesce(p_site_order_id,site_order_id),source='wordpress',status=case when p_event_type='payment_confirmed' then 'paid'::calculator.quote_status when p_event_type='order_approved' then 'approved'::calculator.quote_status else status end where id=p_quote_id;
  if p_event_type in ('payment_confirmed','order_approved') then
    v_order:=public.fn_calculator_promote_quote_to_order(p_quote_id,null);
    v_result:=public.fn_calculator_reserve_quote(p_quote_id,p_event_key)||jsonb_build_object('order_id',v_order);
  elsif p_event_type='order_cancelled' then
    v_result:=public.fn_calculator_release_quote(p_quote_id,coalesce(p_payload->>'reason','لغو از سایت'));
  else
    v_result:=jsonb_build_object('quote_id',p_quote_id,'status','ignored');
  end if;
  update calculator.site_events set status=case when p_event_type in ('payment_confirmed','order_approved','order_cancelled') then 'processed' else 'ignored' end,result=v_result,processed_at=now() where id=v_event.id;
  return v_result||jsonb_build_object('event_id',v_event.id,'idempotent',false);
exception when others then
  update calculator.site_events set status='failed',error_message=sqlerrm,processed_at=now() where id=v_event.id;
  raise;
end $$;

create or replace function public.fn_calculator_get_admin_settings()
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
begin
  if not public.is_admin() then raise exception 'فقط مدیر به تنظیمات محرمانه محاسبه دسترسی دارد'; end if;
  return jsonb_build_object(
    'transformer_formula',(select jsonb_build_object('id',id,'version_code',version_code,'engine_version',engine_version,'config',config,'calibration_notes',calibration_notes,'published_at',published_at) from calculator.formula_versions where calculator_type='transformer' and status='internal_active' limit 1),
    'board_formula',(select jsonb_build_object('id',id,'version_code',version_code,'engine_version',engine_version,'config',config,'calibration_notes',calibration_notes,'published_at',published_at) from calculator.formula_versions where calculator_type='board' and status='internal_active' limit 1),
    'public_quote_enabled',coalesce((select (value#>>'{}')::boolean from calculator.settings where key='public_quote_enabled'),false),
    'public_quote_calibrated',coalesce((select (value#>>'{}')::boolean from calculator.settings where key='public_quote_calibrated'),false)
  );
end $$;

create or replace function public.fn_calculator_publish_transformer_formula(p_version_code text,p_config jsonb,p_calibration_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_config jsonb;
begin
  if not public.is_admin() then raise exception 'فقط مدیر می‌تواند نسخه فرمول را منتشر کند'; end if;
  if nullif(trim(p_version_code),'') is null then raise exception 'کد نسخه فرمول الزامی است'; end if;
  v_config:=jsonb_build_object(
    'packing_factor',coalesce((p_config->>'packing_factor')::numeric,0.35),
    'inter_winding_insulation_mm',coalesce((p_config->>'inter_winding_insulation_mm')::numeric,0.05),
    'profit_percent',coalesce((p_config->>'profit_percent')::numeric,30),
    'sample_multiplier',coalesce((p_config->>'sample_multiplier')::numeric,2),
    'sample_setup_rial',coalesce((p_config->>'sample_setup_rial')::numeric,0),
    'winding_speed_turns_per_minute',coalesce((p_config->>'winding_speed_turns_per_minute')::numeric,120),
    'setup_minutes_per_winding',coalesce((p_config->>'setup_minutes_per_winding')::numeric,0),
    'labor_hour_rial',coalesce((p_config->>'labor_hour_rial')::numeric,0),
    'overhead_percent',coalesce((p_config->>'overhead_percent')::numeric,0),
    'solder_cost_rial',coalesce((p_config->>'solder_cost_rial')::numeric,0),
    'varnish_cost_rial',coalesce((p_config->>'varnish_cost_rial')::numeric,0),
    'test_cost_rial',coalesce((p_config->>'test_cost_rial')::numeric,0),
    'packaging_cost_rial',coalesce((p_config->>'packaging_cost_rial')::numeric,0),
    'gap_cost_rial',coalesce((p_config->>'gap_cost_rial')::numeric,0),
    'copper_density_g_cm3',coalesce((p_config->>'copper_density_g_cm3')::numeric,8.96),
    'minimum_production_quantity',100,
    'maximum_sample_quantity',99,
    'price_rounding_rial',coalesce((p_config->>'price_rounding_rial')::numeric,10000)
  );
  if (v_config->>'packing_factor')::numeric<=0 or (v_config->>'packing_factor')::numeric>1 then raise exception 'ضریب پرشدگی باید بین صفر و یک باشد'; end if;
  if (v_config->>'inter_winding_insulation_mm')::numeric<0 then raise exception 'ضخامت عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'profit_percent')::numeric<0 or (v_config->>'sample_multiplier')::numeric<1 then raise exception 'سود یا ضریب نمونه معتبر نیست'; end if;
  if (v_config->>'winding_speed_turns_per_minute')::numeric<=0 or (v_config->>'copper_density_g_cm3')::numeric<=0 then raise exception 'سرعت سیم‌پیچی یا چگالی مس معتبر نیست'; end if;
  if exists(select 1 from jsonb_each_text(v_config) x where x.value::numeric<0) then raise exception 'مقادیر تنظیمات نمی‌توانند منفی باشند'; end if;
  update calculator.formula_versions set status='retired' where calculator_type='transformer' and status='internal_active';
  insert into calculator.formula_versions(calculator_type,version_code,status,engine_version,config,calibration_notes,created_by,published_by,published_at)
  values('transformer',trim(p_version_code),'internal_active','calculator-engine-1.1.0',v_config,nullif(trim(p_calibration_notes),''),auth.uid(),auth.uid(),now()) returning id into v_id;
  update calculator.settings set value='false'::jsonb,updated_by=auth.uid(),updated_at=now() where key in ('public_quote_enabled','public_quote_calibrated');
  perform calculator.log_event('formula_published','formula',v_id::text,jsonb_build_object('version_code',trim(p_version_code),'public_quote_disabled',true));
  return jsonb_build_object('id',v_id,'version_code',trim(p_version_code),'config',v_config);
end $$;

create or replace function public.fn_calculator_set_public_flag(p_enabled boolean,p_calibrated boolean default false)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
begin
  if not public.is_admin() then raise exception 'فقط مدیر می‌تواند انتشار عمومی را تغییر دهد'; end if;
  if p_enabled and not p_calibrated then raise exception 'فعال‌سازی عمومی بدون تأیید کالیبراسیون مجاز نیست'; end if;
  insert into calculator.settings(key,value,updated_by) values('public_quote_calibrated',to_jsonb(p_calibrated),auth.uid()) on conflict(key) do update set value=excluded.value,updated_by=auth.uid(),updated_at=now();
  insert into calculator.settings(key,value,updated_by) values('public_quote_enabled',to_jsonb(p_enabled),auth.uid()) on conflict(key) do update set value=excluded.value,updated_by=auth.uid(),updated_at=now();
  perform calculator.log_event('public_flag_changed','setting','public_quote_enabled',jsonb_build_object('enabled',p_enabled,'calibrated',p_calibrated));
  return jsonb_build_object('enabled',p_enabled,'calibrated',p_calibrated);
end $$;

create or replace function public.fn_calculator_public_status()
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'تابع داخلی API'; end if;
  return jsonb_build_object('enabled',coalesce((select (value#>>'{}')::boolean from calculator.settings where key='public_quote_enabled'),false),'calibrated',coalesce((select (value#>>'{}')::boolean from calculator.settings where key='public_quote_calibrated'),false));
end $$;

create or replace function public.fn_calculator_rate_limit(p_bucket_key text,p_limit integer default 30,p_window_seconds integer default 60)
returns boolean language plpgsql security definer set search_path=public,calculator as $$
declare v_start timestamptz:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds); v_count int;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'تابع داخلی API'; end if;
  insert into calculator.api_rate_buckets(bucket_key,bucket_started_at,request_count) values(left(p_bucket_key,200),v_start,1)
  on conflict(bucket_key,bucket_started_at) do update set request_count=calculator.api_rate_buckets.request_count+1 returning request_count into v_count;
  delete from calculator.api_rate_buckets where bucket_started_at<now()-interval '1 day';
  return v_count<=p_limit;
end $$;

create or replace function calculator.sync_production_link()
returns trigger language plpgsql security definer set search_path=public,calculator as $$
declare v_quote uuid;
begin
  update calculator.quotes set production_order_id=new.id,status=case when status in ('reserved','approved','paid') then 'in_production'::calculator.quote_status else status end
  where order_id=new.source_order_id and (production_order_id is null or production_order_id=new.id)
  returning id into v_quote;
  if v_quote is not null and new.status::text in ('completed','delivered_to_warehouse') then perform public.fn_calculator_consume_quote(v_quote,new.id); end if;
  if v_quote is not null and new.status::text='cancelled' then perform public.fn_calculator_release_quote(v_quote,'لغو سفارش تولید'); end if;
  return new;
end $$;
drop trigger if exists trg_calculator_sync_production on public.production_orders;
create trigger trg_calculator_sync_production after insert or update of status,source_order_id on public.production_orders for each row execute function calculator.sync_production_link();

create or replace function calculator.sync_order_cancellation()
returns trigger language plpgsql security definer set search_path=public,calculator as $$
declare v_quote uuid;
begin
  if new.is_cancelled and not coalesce(old.is_cancelled,false) then
    for v_quote in select id from calculator.quotes where order_id=new.id and status not in ('produced','cancelled') loop perform public.fn_calculator_release_quote(v_quote,coalesce(new.cancelled_reason,'لغو سفارش')); end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_calculator_order_cancellation on public.orders;
create trigger trg_calculator_order_cancellation after update of is_cancelled on public.orders for each row execute function calculator.sync_order_cancellation();

-- Calculator reservation rows must be visible to operational roles as part of the shared stock system.
drop policy if exists order_inventory_reservations_select on public.order_inventory_reservations;
create policy order_inventory_reservations_select on public.order_inventory_reservations for select using(
  (order_id is not null and public.fn_user_can_access_order(order_id))
  or public.has_role(array['admin','warehouse','production'])
  or (calculator_quote_id is not null and public.has_role(array['sales','sales_manager']))
);

revoke all on function public.fn_calculator_get_context(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.fn_calculator_get_context(uuid,uuid,uuid[]) to service_role;
revoke all on function public.fn_calculator_get_board_context() from public,anon,authenticated;
grant execute on function public.fn_calculator_get_board_context() to service_role;
revoke all on function public.fn_calculator_save_quote(jsonb) from public,anon,authenticated;
grant execute on function public.fn_calculator_save_quote(jsonb) to service_role;
revoke all on function public.fn_calculator_process_site_event(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_calculator_process_site_event(text,text,text,uuid,jsonb,text) to service_role;
revoke all on function public.fn_calculator_public_status() from public,anon,authenticated;
grant execute on function public.fn_calculator_public_status() to service_role;
revoke all on function public.fn_calculator_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.fn_calculator_rate_limit(text,integer,integer) to service_role;

revoke all on function public.fn_calculator_get_quote(uuid,boolean) from public,anon;
grant execute on function public.fn_calculator_get_catalog() to authenticated;
grant execute on function public.fn_calculator_list_quotes(integer) to authenticated;
grant execute on function public.fn_calculator_get_quote(uuid,boolean) to authenticated;
grant execute on function public.fn_calculator_save_core(jsonb,jsonb) to authenticated;
grant execute on function public.fn_calculator_save_bobbin(jsonb,jsonb) to authenticated;
grant execute on function public.fn_calculator_save_wire(jsonb,jsonb) to authenticated;
grant execute on function public.fn_calculator_reserve_quote(uuid,text) to authenticated;
grant execute on function public.fn_calculator_release_quote(uuid,text) to authenticated;
grant execute on function public.fn_calculator_consume_quote(uuid,uuid) to authenticated;
grant execute on function public.fn_calculator_promote_quote_to_order(uuid,uuid) to authenticated;
grant execute on function public.fn_calculator_get_admin_settings() to authenticated;
grant execute on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) to authenticated;
grant execute on function public.fn_calculator_set_public_flag(boolean,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
