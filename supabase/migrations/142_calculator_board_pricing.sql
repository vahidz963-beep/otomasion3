-- Migration 142: Board pricing knobs (formula-configurable) + public board actions support.
-- Adds board_* keys to the publish whitelist so the automation UI can tune board prices,
-- and refreshes the seeded board formula to the current engine version.

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
    'show_internal_pricing_breakdown',coalesce((p_config->>'show_internal_pricing_breakdown')::boolean,false),
    'board_base_design_rial',coalesce((p_config->>'board_base_design_rial')::numeric,300000000),
    'board_area_cost_1_rial',coalesce((p_config->>'board_area_cost_1_rial')::numeric,30000000),
    'board_area_cost_2_rial',coalesce((p_config->>'board_area_cost_2_rial')::numeric,70000000),
    'board_area_cost_3_rial',coalesce((p_config->>'board_area_cost_3_rial')::numeric,120000000),
    'board_power_cost_1_rial',coalesce((p_config->>'board_power_cost_1_rial')::numeric,50000000),
    'board_power_cost_2_rial',coalesce((p_config->>'board_power_cost_2_rial')::numeric,100000000),
    'board_power_cost_3_rial',coalesce((p_config->>'board_power_cost_3_rial')::numeric,180000000),
    'board_extra_layer_rial',coalesce((p_config->>'board_extra_layer_rial')::numeric,0),
    'board_complexity_medium_rial',coalesce((p_config->>'board_complexity_medium_rial')::numeric,80000000),
    'board_complexity_advanced_rial',coalesce((p_config->>'board_complexity_advanced_rial')::numeric,180000000),
    'board_feature_isolation_rial',coalesce((p_config->>'board_feature_isolation_rial')::numeric,30000000),
    'board_feature_pfc_rial',coalesce((p_config->>'board_feature_pfc_rial')::numeric,70000000),
    'board_feature_digital_rial',coalesce((p_config->>'board_feature_digital_rial')::numeric,80000000),
    'board_feature_communication_rial',coalesce((p_config->>'board_feature_communication_rial')::numeric,50000000),
    'board_feature_protection_rial',coalesce((p_config->>'board_feature_protection_rial')::numeric,40000000),
    'board_feature_emi_rial',coalesce((p_config->>'board_feature_emi_rial')::numeric,50000000),
    'board_feature_thermal_rial',coalesce((p_config->>'board_feature_thermal_rial')::numeric,40000000),
    'board_profit_percent',coalesce((p_config->>'board_profit_percent')::numeric,30),
    'board_price_rounding_rial',coalesce((p_config->>'board_price_rounding_rial')::numeric,10000)
  );
  if (v_config->>'packing_factor')::numeric<=0 or (v_config->>'packing_factor')::numeric>1 then raise exception 'ضریب پرشدگی باید بین صفر و یک باشد'; end if;
  if (v_config->>'inter_winding_insulation_mm')::numeric<0 then raise exception 'ضخامت عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'profit_percent')::numeric<0 or (v_config->>'sample_multiplier')::numeric<1 then raise exception 'سود یا ضریب نمونه معتبر نیست'; end if;
  if (v_config->>'winding_speed_turns_per_minute')::numeric<=0 or (v_config->>'copper_density_g_cm3')::numeric<=0 then raise exception 'سرعت سیم‌پیچی یا چگالی مس معتبر نیست'; end if;
  if (v_config->>'insulation_wraps_per_layer')::numeric<0 or (v_config->>'finishing_tape_wraps')::numeric<0 then raise exception 'تعداد دور عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'mylar_tape_roll_length_m')::numeric<=0 then raise exception 'طول رول چسب باید مثبت باشد'; end if;
  if (v_config->>'board_profit_percent')::numeric<0 then raise exception 'سود برد نمی‌تواند منفی باشد'; end if;
  if (v_config->>'board_price_rounding_rial')::numeric<1000 then raise exception 'گرد کردن قیمت برد باید حداقل ۱۰۰۰ ریال باشد'; end if;
  if exists(select 1 from jsonb_each_text(v_config) x where x.value is not null and x.value::numeric<0) then raise exception 'مقادیر تنظیمات نمی‌توانند منفی باشند'; end if;
  update calculator.formula_versions set status='retired' where calculator_type='transformer' and status='internal_active';
  insert into calculator.formula_versions(calculator_type,version_code,status,engine_version,config,calibration_notes,created_by,published_by,published_at)
  values('transformer',trim(p_version_code),'internal_active','calculator-engine-1.2.0',v_config,nullif(trim(p_calibration_notes),''),auth.uid(),auth.uid(),now()) returning id into v_id;
  update calculator.settings set value='false'::jsonb,updated_by=auth.uid(),updated_at=now() where key in ('public_quote_enabled','public_quote_calibrated');
  perform calculator.log_event('formula_published','formula',v_id::text,jsonb_build_object('version_code',trim(p_version_code),'public_quote_disabled',true));
  return jsonb_build_object('id',v_id,'version_code',trim(p_version_code),'config',v_config);
end $$;

revoke all on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) from public,anon;
grant execute on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) to authenticated;

-- Refresh the seeded board formula: current engine version + board pricing defaults,
-- so the public board actions work immediately after migration without a manual publish.
update calculator.formula_versions
set engine_version='calculator-engine-1.2.0',
    config=config || jsonb_build_object(
      'board_base_design_rial',coalesce((config->>'board_base_design_rial')::numeric,coalesce((config->>'base_design_rial')::numeric,300000000)),
      'board_area_cost_1_rial',coalesce((config->>'board_area_cost_1_rial')::numeric,30000000),
      'board_area_cost_2_rial',coalesce((config->>'board_area_cost_2_rial')::numeric,70000000),
      'board_area_cost_3_rial',coalesce((config->>'board_area_cost_3_rial')::numeric,120000000),
      'board_power_cost_1_rial',coalesce((config->>'board_power_cost_1_rial')::numeric,50000000),
      'board_power_cost_2_rial',coalesce((config->>'board_power_cost_2_rial')::numeric,100000000),
      'board_power_cost_3_rial',coalesce((config->>'board_power_cost_3_rial')::numeric,180000000),
      'board_extra_layer_rial',coalesce((config->>'board_extra_layer_rial')::numeric,0),
      'board_complexity_medium_rial',coalesce((config->>'board_complexity_medium_rial')::numeric,80000000),
      'board_complexity_advanced_rial',coalesce((config->>'board_complexity_advanced_rial')::numeric,180000000),
      'board_feature_isolation_rial',coalesce((config->>'board_feature_isolation_rial')::numeric,30000000),
      'board_feature_pfc_rial',coalesce((config->>'board_feature_pfc_rial')::numeric,70000000),
      'board_feature_digital_rial',coalesce((config->>'board_feature_digital_rial')::numeric,80000000),
      'board_feature_communication_rial',coalesce((config->>'board_feature_communication_rial')::numeric,50000000),
      'board_feature_protection_rial',coalesce((config->>'board_feature_protection_rial')::numeric,40000000),
      'board_feature_emi_rial',coalesce((config->>'board_feature_emi_rial')::numeric,50000000),
      'board_feature_thermal_rial',coalesce((config->>'board_feature_thermal_rial')::numeric,40000000),
      'board_profit_percent',coalesce((config->>'board_profit_percent')::numeric,coalesce((config->>'profit_percent')::numeric,30)),
      'board_price_rounding_rial',coalesce((config->>'board_price_rounding_rial')::numeric,10000)
    )
where calculator_type='board' and status='internal_active';
