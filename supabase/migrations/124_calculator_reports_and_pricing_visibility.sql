begin;

-- Version 133: richer reports and an administrator-controlled internal cost breakdown.
-- Public/customer responses remain cost-free; this flag applies only to authenticated
-- calculator staff and is versioned with the active transformer formula.
update calculator.formula_versions
set config = config || jsonb_build_object('show_internal_pricing_breakdown', false)
where calculator_type='transformer'
  and not (config ? 'show_internal_pricing_breakdown');

create or replace function public.fn_calculator_get_context(p_core_id uuid,p_bobbin_id uuid,p_wire_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_formula calculator.formula_versions%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'این تابع فقط در موتور امن سرور قابل اجرا است'; end if;
  select * into v_formula from calculator.formula_versions where calculator_type='transformer' and status='internal_active' limit 1;
  if not found then raise exception 'نسخه فعال فرمول ترانس یافت نشد'; end if;
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
        and lower(trim(wi.unit)) in ('گرم','g','gr','gram','grams')),'[]'::jsonb)
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
    'price_rounding_rial',coalesce((p_config->>'price_rounding_rial')::numeric,10000),
    'show_internal_pricing_breakdown',coalesce((p_config->>'show_internal_pricing_breakdown')::boolean,false)
  );
  if (v_config->>'packing_factor')::numeric<=0 or (v_config->>'packing_factor')::numeric>1 then raise exception 'ضریب پرشدگی باید بین صفر و یک باشد'; end if;
  if (v_config->>'inter_winding_insulation_mm')::numeric<0 then raise exception 'ضخامت عایق نمی‌تواند منفی باشد'; end if;
  if (v_config->>'profit_percent')::numeric<0 or (v_config->>'sample_multiplier')::numeric<1 then raise exception 'سود یا ضریب نمونه معتبر نیست'; end if;
  if (v_config->>'winding_speed_turns_per_minute')::numeric<=0 or (v_config->>'copper_density_g_cm3')::numeric<=0 then raise exception 'سرعت سیم‌پیچی یا چگالی مس معتبر نیست'; end if;
  if exists(select 1 from jsonb_each_text(v_config-'show_internal_pricing_breakdown') x where x.value::numeric<0) then raise exception 'مقادیر تنظیمات نمی‌توانند منفی باشند'; end if;
  update calculator.formula_versions set status='retired' where calculator_type='transformer' and status='internal_active';
  insert into calculator.formula_versions(calculator_type,version_code,status,engine_version,config,calibration_notes,created_by,published_by,published_at)
  values('transformer',trim(p_version_code),'internal_active','calculator-engine-1.1.0',v_config,nullif(trim(p_calibration_notes),''),auth.uid(),auth.uid(),now()) returning id into v_id;
  update calculator.settings set value='false'::jsonb,updated_by=auth.uid(),updated_at=now() where key in ('public_quote_enabled','public_quote_calibrated');
  perform calculator.log_event('formula_published','formula',v_id::text,jsonb_build_object('version_code',trim(p_version_code),'public_quote_disabled',true,'show_internal_pricing_breakdown',v_config->'show_internal_pricing_breakdown'));
  return jsonb_build_object('id',v_id,'version_code',trim(p_version_code),'config',v_config);
end $$;

create or replace function public.fn_calculator_get_quote(p_quote_id uuid,p_include_costs boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare
  v_admin boolean:=public.is_admin();
  v_staff_breakdown boolean:=false;
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  select coalesce((config->>'show_internal_pricing_breakdown')::boolean,false)
    into v_staff_breakdown
    from calculator.formula_versions
    where calculator_type='transformer' and status='internal_active'
    limit 1;
  return (select to_jsonb(q)-'pricing_snapshot'||jsonb_build_object(
    'pricing_snapshot',case when p_include_costs and (v_admin or v_staff_breakdown) then q.pricing_snapshot else '{}'::jsonb end,
    'pricing_breakdown_visible',(v_admin or v_staff_breakdown),
    'windings',coalesce((select jsonb_agg(to_jsonb(w) order by w.line_no) from calculator.quote_windings w where w.quote_id=q.id),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.component_role) from calculator.quote_requirements r where r.quote_id=q.id),'[]'::jsonb),
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('warehouse_item_id',r.warehouse_item_id,'quantity',r.quantity,'status',r.status,'reserved_at',r.reserved_at,'released_at',r.released_at,'consumed_at',r.consumed_at)) from public.order_inventory_reservations r where r.calculator_quote_id=q.id),'[]'::jsonb)
  ) from calculator.quotes q where q.id=p_quote_id);
end $$;

revoke all on function public.fn_calculator_get_context(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.fn_calculator_get_context(uuid,uuid,uuid[]) to service_role;
revoke all on function public.fn_calculator_get_quote(uuid,boolean) from public,anon;
grant execute on function public.fn_calculator_get_quote(uuid,boolean) to authenticated;
grant execute on function public.fn_calculator_publish_transformer_formula(text,jsonb,text) to authenticated;

notify pgrst,'reload schema';
commit;
