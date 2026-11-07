begin;

-- Version 139.0.5 — Calculator: computed Mylar tape and core glue materials.
-- [1] Mylar tape (workshop item «چسب دوازده», one roll = 66 m in any width)
--     is metered from real geometry and priced from a meter-unit warehouse
--     item configured in the formula: insulation_wraps_per_layer turns
--     (default 3 × 0.05 mm = 0.15 mm per layer) after EVERY physical layer of
--     every winding, plus finishing_tape_wraps turns around the finished
--     transformer. Rolls are shared across many transformers, so fractional
--     meters accumulate and are deducted in meters from the warehouse.
-- [2] Insulation geometry: the old single 0.05mm inter-layer separator is
--     replaced by per-layer insulation = insulation_wraps_per_layer ×
--     inter_winding_insulation_mm (default 3 × 0.05 = 0.15mm per layer);
--     the last layer's wraps also separate adjacent windings.
-- [3] Core glue between the two core halves is computed from the center-leg
--     perimeter and a configurable bead section, priced from a gram-unit
--     warehouse item.
-- All of them are real BOM rows (quote_requirements) and flow through
-- reserve / consume / release like any other component.

-- ------------------------------------------------------------------
-- 1) quote_requirements may now carry tape/glue rows.
-- ------------------------------------------------------------------
alter table calculator.quote_requirements
  drop constraint if exists quote_requirements_component_role_check;
alter table calculator.quote_requirements
  add constraint quote_requirements_component_role_check
  check(component_role in ('core','bobbin','wire','tape','glue','material'));

-- Per-bobbin Mylar tape choice: the bobbin's window length determines which
-- tape width («چسب دوازده», «چسب بیست» …) is used; the selected warehouse
-- item (meter unit) is deducted for that bobbin's requirement. NULL falls
-- back to the formula's default tape item.
alter table calculator.transformer_bobbins
  add column if not exists mylar_tape_warehouse_item_id uuid references public.warehouse_items(id);

-- ------------------------------------------------------------------
-- 2) Publish function: new material keys + engine version 1.2.0.
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_publish_transformer_formula(p_version_code text,p_config jsonb,p_calibration_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_config jsonb;
begin
  if not public.is_admin() then raise exception 'فقط مدیر می‌تواند نسخه فرمول را منتشر کند'; end if;
  if nullif(trim(p_version_code),'') is null then raise exception 'کد نسخه فرمول الزامی است'; end if;
  v_config:=jsonb_build_object(
    'packing_factor',coalesce((p_config->>'packing_factor')::numeric,0.40),
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
    'mylar_tape_warehouse_item_id',nullif(trim(coalesce(p_config->>'mylar_tape_warehouse_item_id','')),'')::uuid,
    'core_glue_warehouse_item_id',nullif(trim(coalesce(p_config->>'core_glue_warehouse_item_id','')),'')::uuid,
    'insulation_wraps_per_layer',coalesce((p_config->>'insulation_wraps_per_layer')::numeric,3),
    'mylar_tape_roll_length_m',coalesce((p_config->>'mylar_tape_roll_length_m')::numeric,66),
    'finishing_tape_wraps',coalesce((p_config->>'finishing_tape_wraps')::numeric,3),
    'core_glue_bead_section_mm2',coalesce((p_config->>'core_glue_bead_section_mm2')::numeric,6),
    'glue_density_g_cm3',coalesce((p_config->>'glue_density_g_cm3')::numeric,1.3),
    'core_glue_min_g_per_unit',coalesce((p_config->>'core_glue_min_g_per_unit')::numeric,0.5),
    'minimum_production_quantity',100,
    'maximum_sample_quantity',99,
    'price_rounding_rial',coalesce((p_config->>'price_rounding_rial')::numeric,10000),
    'show_internal_pricing_breakdown',coalesce((p_config->>'show_internal_pricing_breakdown')::boolean,false)
  );
  if (v_config->>'packing_factor')::numeric<=0 or (v_config->>'packing_factor')::numeric>1 then raise exception 'ضریب پرشدگی باید بین صفر و یک باشد'; end if;
  if (v_config->>'inter_winding_insulation_mm')::numeric<0 then raise exception 'ضخامت عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'profit_percent')::numeric<0 or (v_config->>'sample_multiplier')::numeric<1 then raise exception 'سود یا ضریب نمونه معتبر نیست'; end if;
  if (v_config->>'winding_speed_turns_per_minute')::numeric<=0 or (v_config->>'copper_density_g_cm3')::numeric<=0 then raise exception 'سرعت سیم‌پیچی یا چگالی مس معتبر نیست'; end if;
  if (v_config->>'insulation_wraps_per_layer')::numeric<0 or (v_config->>'finishing_tape_wraps')::numeric<0 then raise exception 'تعداد دور عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'mylar_tape_roll_length_m')::numeric<=0 then raise exception 'طول رول چسب باید مثبت باشد'; end if;
  if (v_config->>'core_glue_bead_section_mm2')::numeric<0 or (v_config->>'core_glue_min_g_per_unit')::numeric<0 then raise exception 'مشخصات چسب هسته نمی‌تواند منفی باشد'; end if;
  if (v_config->>'glue_density_g_cm3')::numeric<=0 then raise exception 'چگالی چسب باید مثبت باشد'; end if;
  if (v_config->>'mylar_tape_warehouse_item_id') is not null and not exists(
    select 1 from public.warehouse_items
    where id=(v_config->>'mylar_tape_warehouse_item_id')::uuid and is_active
      and lower(trim(unit)) in ('متر','m','meter','meters')
  ) then raise exception 'قلم انبار چسب/نوار مایلار باید فعال و با واحد «متر» باشد'; end if;
  if (v_config->>'core_glue_warehouse_item_id') is not null and not exists(
    select 1 from public.warehouse_items
    where id=(v_config->>'core_glue_warehouse_item_id')::uuid and is_active
      and lower(trim(unit)) in ('گرم','g','gr','gram','grams')
  ) then raise exception 'قلم انبار چسب هسته باید فعال و با واحد «گرم» باشد'; end if;
  if exists(select 1 from jsonb_each_text(v_config-'show_internal_pricing_breakdown'-'mylar_tape_warehouse_item_id'-'core_glue_warehouse_item_id') x where x.value::numeric<0) then raise exception 'مقادیر تنظیمات نمی‌توانند منفی باشند'; end if;
  update calculator.formula_versions set status='retired' where calculator_type='transformer' and status='internal_active';
  insert into calculator.formula_versions(calculator_type,version_code,status,engine_version,config,calibration_notes,created_by,published_by,published_at)
  values('transformer',trim(p_version_code),'internal_active','calculator-engine-1.2.0',v_config,nullif(trim(p_calibration_notes),''),auth.uid(),auth.uid(),now()) returning id into v_id;
  update calculator.settings set value='false'::jsonb,updated_by=auth.uid(),updated_at=now() where key in ('public_quote_enabled','public_quote_calibrated');
  perform calculator.log_event('formula_published','formula',v_id::text,jsonb_build_object('version_code',trim(p_version_code),'public_quote_disabled',true,'show_internal_pricing_breakdown',v_config->'show_internal_pricing_breakdown','mylar_tape_warehouse_item_id',v_config->'mylar_tape_warehouse_item_id','core_glue_warehouse_item_id',v_config->'core_glue_warehouse_item_id'));
  return jsonb_build_object('id',v_id,'version_code',trim(p_version_code),'config',v_config);
end $$;

-- ------------------------------------------------------------------
-- 3b) Save bobbin: persist its Mylar tape item (meter-unit enforced).
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_save_bobbin(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid; v_core uuid; v_tape uuid;
begin
  perform public.fn_calculator_assert_role(array['admin','warehouse','production']);
  v_existing:=nullif(p_payload->>'id','')::uuid; v_core:=(p_payload->>'core_id')::uuid;
  if not exists(select 1 from calculator.transformer_cores where id=v_core and is_active) then raise exception 'هسته انتخاب‌شده معتبر نیست'; end if;
  if (p_payload->>'mount_orientation') not in ('افقی','عمودی','horizontal','vertical') then raise exception 'جهت نصب بوبین معتبر نیست'; end if;
  if coalesce((p_payload->>'pins_left')::int,0)<1 or coalesce((p_payload->>'pins_right')::int,0)<1 then raise exception 'تعداد پایه هر سمت الزامی است'; end if;
  if coalesce((p_payload->>'window_width_mm')::numeric,0)<=0 or coalesce((p_payload->>'window_height_mm')::numeric,0)<=0 or coalesce((p_payload->>'mean_turn_length_mm')::numeric,0)<=0 then raise exception 'BW، HW و MLT واقعی و مثبت الزامی‌اند'; end if;
  v_wh:=calculator.resolve_warehouse_item(nullif(p_payload->>'warehouse_item_id','')::uuid,p_new_warehouse_item,'بوبین '||(select model_code from calculator.transformer_cores where id=v_core),'عدد','Bobbin');
  if v_wh is not null and not exists(select 1 from public.warehouse_items where id=v_wh and lower(trim(unit)) in ('عدد','piece','pieces','pcs','pc')) then raise exception 'واحد قلم انبار بوبین باید عدد باشد'; end if;
  v_tape:=nullif(trim(coalesce(p_payload->>'mylar_tape_warehouse_item_id','')),'')::uuid;
  if v_tape is not null and not exists(select 1 from public.warehouse_items where id=v_tape and is_active and lower(trim(unit)) in ('متر','m','meter','meters')) then raise exception 'قلم چسب بوبین باید فعال و با واحد «متر» باشد'; end if;
  insert into calculator.transformer_bobbins(id,core_id,mount_orientation,pins_left,pins_right,window_width_mm,window_height_mm,mean_turn_length_mm,flange_length_mm,flange_width_mm,weight_g,warehouse_item_id,mylar_tape_warehouse_item_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),v_core,p_payload->>'mount_orientation',(p_payload->>'pins_left')::int,(p_payload->>'pins_right')::int,(p_payload->>'window_width_mm')::numeric,(p_payload->>'window_height_mm')::numeric,(p_payload->>'mean_turn_length_mm')::numeric,nullif(p_payload->>'flange_length_mm','')::numeric,nullif(p_payload->>'flange_width_mm','')::numeric,nullif(p_payload->>'weight_g','')::numeric,v_wh,v_tape,auth.uid(),auth.uid())
  on conflict(id) do update set core_id=excluded.core_id,mount_orientation=excluded.mount_orientation,pins_left=excluded.pins_left,pins_right=excluded.pins_right,window_width_mm=excluded.window_width_mm,window_height_mm=excluded.window_height_mm,mean_turn_length_mm=excluded.mean_turn_length_mm,flange_length_mm=excluded.flange_length_mm,flange_width_mm=excluded.flange_width_mm,weight_g=excluded.weight_g,warehouse_item_id=excluded.warehouse_item_id,mylar_tape_warehouse_item_id=excluded.mylar_tape_warehouse_item_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'bobbin',v_id::text,jsonb_build_object('warehouse_item_id',v_wh,'core_id',v_core,'mylar_tape_warehouse_item_id',v_tape));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;

-- ------------------------------------------------------------------
-- 3c) Catalog: expose each bobbin's tape item so the UI can show and
--     edit the window-length → tape-width choice.
-- ------------------------------------------------------------------
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
      'mylar_tape_warehouse_item_id',b.mylar_tape_warehouse_item_id,'mylar_tape_code',tw.item_code,'mylar_tape_name',tw.item_name_fa,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'mapped',b.warehouse_item_id is not null,
      'unit_valid',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
      'priced',coalesce(p.current_cost_rial,0)>0,
      'calculable',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc') and coalesce(p.current_cost_rial,0)>0)
    ) order by c.model_code,b.mount_orientation,b.pins_left) from calculator.transformer_bobbins b join calculator.transformer_cores c on c.id=b.core_id left join public.warehouse_items wi on wi.id=b.warehouse_item_id left join public.warehouse_items tw on tw.id=b.mylar_tape_warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=b.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=b.warehouse_item_id where b.is_active),'[]'::jsonb),
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

-- ------------------------------------------------------------------
-- 3d) Context function: resolve configured tape/glue warehouse items
--    (service-role only, unit-enforced, null when not configured).
--    The effective tape item is the BOBBIN's own choice when set
--    (window-length → tape width rule), otherwise the formula default.
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_get_context(p_core_id uuid,p_bobbin_id uuid,p_wire_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_formula calculator.formula_versions%rowtype; v_tape uuid; v_glue uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'این تابع فقط در موتور امن سرور قابل اجرا است'; end if;
  select * into v_formula from calculator.formula_versions where calculator_type='transformer' and status='internal_active' limit 1;
  if not found then raise exception 'نسخه فعال فرمول ترانس یافت نشد'; end if;
  v_tape:=nullif(trim(coalesce(v_formula.config->>'mylar_tape_warehouse_item_id','')),'')::uuid;
  select b.mylar_tape_warehouse_item_id into v_tape
    from calculator.transformer_bobbins b
    where b.id=p_bobbin_id and b.mylar_tape_warehouse_item_id is not null;
  v_tape:=coalesce(v_tape, nullif(trim(coalesce(v_formula.config->>'mylar_tape_warehouse_item_id','')),'')::uuid);
  v_glue:=nullif(trim(coalesce(v_formula.config->>'core_glue_warehouse_item_id','')),'')::uuid;
  return jsonb_build_object(
    'formula',jsonb_build_object('id',v_formula.id,'version_code',v_formula.version_code,'engine_version',v_formula.engine_version,'config',v_formula.config),
    'core',(select jsonb_build_object(
      'id',c.id,'model_code',c.model_code,'family',c.family,'material',c.material,
      'effective_area_mm2',c.effective_area_mm2,'center_leg_mm',c.center_leg_mm,'weight_g',c.weight_g,
      'assembly_time_seconds',c.assembly_time_seconds,'assembly_method',c.assembly_method,
      'warehouse_item_id',c.warehouse_item_id,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at
    ) from calculator.transformer_cores c
      left join public.warehouse_items wi on wi.id=c.warehouse_item_id
      left join public.v_warehouse_currency_prices p on p.item_id=c.warehouse_item_id
      left join public.v_sales_stock_overview s on s.item_id=c.warehouse_item_id
      where c.id=p_core_id and c.is_active and c.warehouse_item_id is not null and coalesce(wi.is_active,false)
        and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
    'bobbin',(select jsonb_build_object(
      'id',b.id,'core_id',b.core_id,'mount_orientation',b.mount_orientation,'pins_left',b.pins_left,'pins_right',b.pins_right,
      'window_width_mm',b.window_width_mm,'window_height_mm',b.window_height_mm,'mean_turn_length_mm',b.mean_turn_length_mm,
      'flange_length_mm',b.flange_length_mm,'flange_width_mm',b.flange_width_mm,'weight_g',b.weight_g,
      'mylar_tape_warehouse_item_id',b.mylar_tape_warehouse_item_id,
      'warehouse_item_id',b.warehouse_item_id,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at
    ) from calculator.transformer_bobbins b
      left join public.warehouse_items wi on wi.id=b.warehouse_item_id
      left join public.v_warehouse_currency_prices p on p.item_id=b.warehouse_item_id
      left join public.v_sales_stock_overview s on s.item_id=b.warehouse_item_id
      where b.id=p_bobbin_id and b.core_id=p_core_id and b.is_active and b.warehouse_item_id is not null and coalesce(wi.is_active,false)
        and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
    'wires',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'diameter_mm',w.diameter_mm,'awg',w.awg,'wire_type',w.wire_type,
      'warehouse_item_id',w.warehouse_item_id,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_cost_rial',p.current_cost_rial,'current_sale_rial',p.current_sale_rial,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at
    ) order by w.diameter_mm) from calculator.enamel_wires w
      left join public.warehouse_items wi on wi.id=w.warehouse_item_id
      left join public.v_warehouse_currency_prices p on p.item_id=w.warehouse_item_id
      left join public.v_sales_stock_overview s on s.item_id=w.warehouse_item_id
      where w.id=any(p_wire_ids) and w.is_active and w.warehouse_item_id is not null and coalesce(wi.is_active,false)
        and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams')),'[]'::jsonb),
    'tape_item',case when v_tape is null then null::jsonb else (
      select jsonb_build_object(
        'id',wi.id,'warehouse_item_id',wi.id,'model_code',wi.item_name_fa,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
        'current_cost_rial',p.current_cost_rial,
        'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at
      ) from public.warehouse_items wi
        left join public.v_warehouse_currency_prices p on p.item_id=wi.id
        left join public.v_sales_stock_overview s on s.item_id=wi.id
      where wi.id=v_tape and wi.is_active and lower(trim(wi.unit)) in ('متر','m','meter','meters')
    ) end,
    'glue_item',case when v_glue is null then null::jsonb else (
      select jsonb_build_object(
        'id',wi.id,'warehouse_item_id',wi.id,'model_code',wi.item_name_fa,'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
        'current_cost_rial',p.current_cost_rial,
        'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'pricing_updated_at',p.pricing_updated_at
      ) from public.warehouse_items wi
        left join public.v_warehouse_currency_prices p on p.item_id=wi.id
        left join public.v_sales_stock_overview s on s.item_id=wi.id
      where wi.id=v_glue and wi.is_active and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams')
    ) end
  );
end $$;

-- ------------------------------------------------------------------
-- 4) Backfill the currently active formula: new keys with defaults and
--    engine bump so the deployed 1.2.0 engine stays in sync. The board
--    formula shares the engine-version guard and is bumped too.
-- ------------------------------------------------------------------
update calculator.formula_versions
set config = config || jsonb_build_object(
  'packing_factor', 0.40,
  'mylar_tape_warehouse_item_id', null,
  'core_glue_warehouse_item_id', null,
  'insulation_wraps_per_layer', 3,
  'mylar_tape_roll_length_m', 66,
  'finishing_tape_wraps', 3,
  'core_glue_bead_section_mm2', 6,
  'glue_density_g_cm3', 1.3,
  'core_glue_min_g_per_unit', 0.5
)
where calculator_type='transformer' and status='internal_active'
  and not (config ? 'insulation_wraps_per_layer');

-- Adopt the new workshop-approved default packing factor (0.40) on the active
-- formula version when it still carries the legacy default 0.35.
update calculator.formula_versions
set config = jsonb_set(config,'{packing_factor}','0.40'::jsonb,true)
where calculator_type='transformer' and status='internal_active'
  and coalesce((config->>'packing_factor')::numeric,0.35)=0.35;

update calculator.formula_versions
set engine_version='calculator-engine-1.2.0'
where status='internal_active' and engine_version='calculator-engine-1.1.0';

revoke all on function public.fn_calculator_get_context(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.fn_calculator_get_context(uuid,uuid,uuid[]) to service_role;
revoke all on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) from public,anon;
grant execute on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) to authenticated;

notify pgrst,'reload schema';
commit;
