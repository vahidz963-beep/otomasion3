-- Migration 152: آزادسازی کامل انتخاب چسب — بدون گارد واحد انبار (دستور کاربر)
--
-- کاربر: «برای انتخاب چسب، همهٔ کالاها را بالا بیاور؛ خودم قلم مورد نظر را انتخاب می‌کنم.
--          لازم نیست واحد تعریف شود.»
-- پس هر گارد واحد «متر» روی قلم چسب حذف می‌شود:
--   ۱) fn_calculator_save_bobbin: دیگر گارد واحد چسب ندارد؛ فقط فعال‌بودن قلم چک می‌شود.
--   ۲) fn_calculator_get_context: tape_item بدون فیلتر واحد برمی‌گردد (هر قلمی که کاربر لینک کرده).
-- نرخ‌گذاری همچنان «قیمت روز قلم انتخابی» است؛ مصرف فیزیکی همیشه متراژ محاسبه‌شده است.
-- idempotent: اجرای مجدد بی‌اثر.

-- ---------- ۱) ذخیرهٔ بوبین: بدون گارد واحد چسب ----------
create or replace function public.fn_calculator_save_bobbin(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid; v_core uuid; v_tape uuid; v_tape_id uuid;
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
  if v_tape is not null and not exists(select 1 from public.warehouse_items where id=v_tape and is_active) then raise exception 'قلم چسب انتخابی در انبار فعال نیست'; end if;
  v_tape_id:=nullif(trim(coalesce(p_payload->>'tape_id','')),'')::uuid;
  if v_tape_id is not null and not exists(select 1 from calculator.mylar_tapes where id=v_tape_id and is_active) then raise exception 'عرض چسب انتخابی معتبر نیست'; end if;
  insert into calculator.transformer_bobbins(id,core_id,mount_orientation,pins_left,pins_right,window_width_mm,window_height_mm,mean_turn_length_mm,flange_length_mm,flange_width_mm,weight_g,warehouse_item_id,mylar_tape_warehouse_item_id,tape_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),v_core,p_payload->>'mount_orientation',(p_payload->>'pins_left')::int,(p_payload->>'pins_right')::int,(p_payload->>'window_width_mm')::numeric,(p_payload->>'window_height_mm')::numeric,(p_payload->>'mean_turn_length_mm')::numeric,nullif(p_payload->>'flange_length_mm','')::numeric,nullif(p_payload->>'flange_width_mm','')::numeric,nullif(p_payload->>'weight_g','')::numeric,v_wh,v_tape,v_tape_id,auth.uid(),auth.uid())
  on conflict(id) do update set core_id=excluded.core_id,mount_orientation=excluded.mount_orientation,pins_left=excluded.pins_left,pins_right=excluded.pins_right,window_width_mm=excluded.window_width_mm,window_height_mm=excluded.window_height_mm,mean_turn_length_mm=excluded.mean_turn_length_mm,flange_length_mm=excluded.flange_length_mm,flange_width_mm=excluded.flange_width_mm,weight_g=excluded.weight_g,warehouse_item_id=excluded.warehouse_item_id,mylar_tape_warehouse_item_id=coalesce(excluded.mylar_tape_warehouse_item_id,calculator.transformer_bobbins.mylar_tape_warehouse_item_id),tape_id=excluded.tape_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'bobbin',v_id::text,jsonb_build_object('warehouse_item_id',v_wh,'core_id',v_core,'tape_id',v_tape_id,'tape_warehouse_item_id',v_tape));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;

-- ---------- ۲) Context: tape_item بدون فیلتر واحد ----------
create or replace function public.fn_calculator_get_context(p_core_id uuid,p_bobbin_id uuid,p_wire_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
declare v_formula calculator.formula_versions%rowtype; v_tape uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'این تابع فقط در موتور امن سرور قابل اجرا است'; end if;
  select * into v_formula from calculator.formula_versions where calculator_type='transformer' and status='internal_active' limit 1;
  if not found then raise exception 'نسخه فعال فرمول ترانس یافت نشد'; end if;
  select coalesce(tp.warehouse_item_id, b.mylar_tape_warehouse_item_id) into v_tape
    from calculator.transformer_bobbins b
    left join calculator.mylar_tapes tp on tp.id=b.tape_id
    where b.id=p_bobbin_id;
  v_tape:=coalesce(v_tape, nullif(trim(coalesce(v_formula.config->>'mylar_tape_warehouse_item_id','')),'')::uuid);
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
      'tape_id',b.tape_id,'mylar_tape_warehouse_item_id',b.mylar_tape_warehouse_item_id,
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
      where wi.id=v_tape and wi.is_active
    ) end
  );
end $$;

-- ---------- ۳) کاتالوگ عرض‌ها: بدون فیلتر واحد (هر قلمی لینک شده نمایش داده شود) ----------
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
      'tape_id',b.tape_id,'tape_width_mm',tp.width_mm,
      'mylar_tape_warehouse_item_id',b.mylar_tape_warehouse_item_id,'mylar_tape_code',coalesce(tpw.item_code,tw.item_code),'mylar_tape_name',coalesce(tpw.item_name_fa,tw.item_name_fa),
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),'mapped',b.warehouse_item_id is not null,
      'unit_valid',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc')),
      'priced',coalesce(p.current_cost_rial,0)>0,
      'calculable',(b.warehouse_item_id is not null and coalesce(wi.is_active,false) and lower(trim(wi.unit)) in ('عدد','piece','pieces','pcs','pc') and coalesce(p.current_cost_rial,0)>0)
    ) order by c.model_code,b.mount_orientation,b.pins_left) from calculator.transformer_bobbins b join calculator.transformer_cores c on c.id=b.core_id left join calculator.mylar_tapes tp on tp.id=b.tape_id left join public.warehouse_items tpw on tpw.id=tp.warehouse_item_id left join public.warehouse_items wi on wi.id=b.warehouse_item_id left join public.warehouse_items tw on tw.id=b.mylar_tape_warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=b.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=b.warehouse_item_id where b.is_active),'[]'::jsonb),
    'tapes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'width_mm',t.width_mm,'warehouse_item_id',t.warehouse_item_id,
      'warehouse_code',wi.item_code,'warehouse_name',wi.item_name_fa,'unit',wi.unit,
      'current_qty',coalesce(s.current_qty,0),'available_qty',coalesce(s.available_for_sale_qty,0),
      'mapped',t.warehouse_item_id is not null,
      'unit_valid',(t.warehouse_item_id is not null and coalesce(wi.is_active,false)),
      'priced',coalesce(p.current_cost_rial,0)>0,
      'calculable',(t.warehouse_item_id is not null and coalesce(wi.is_active,false) and coalesce(p.current_cost_rial,0)>0),
      'bobbin_count',(select count(*) from calculator.transformer_bobbins b where b.tape_id=t.id and b.is_active)
    ) order by t.width_mm) from calculator.mylar_tapes t left join public.warehouse_items wi on wi.id=t.warehouse_item_id left join public.v_warehouse_currency_prices p on p.item_id=t.warehouse_item_id left join public.v_sales_stock_overview s on s.item_id=t.warehouse_item_id where t.is_active),'[]'::jsonb),
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

-- ---------- ۴) ذخیرهٔ عرض مایلار: بدون گارد واحد (کاربر هر قلمی را لینک می‌کند) ----------
create or replace function public.fn_calculator_save_tape(p_payload jsonb,p_new_warehouse_item jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_wh uuid; v_existing uuid;
begin
  perform public.fn_calculator_assert_role(array['admin','warehouse','production']);
  v_existing:=nullif(p_payload->>'id','')::uuid;
  if coalesce((p_payload->>'width_mm')::numeric,0)<=0 then raise exception 'عرض چسب (میلی‌متر) الزامی است'; end if;
  v_wh:=calculator.resolve_warehouse_item(nullif(p_payload->>'warehouse_item_id','')::uuid,p_new_warehouse_item,'نوار مایلار عرض '||(p_payload->>'width_mm')||' میلی‌متر','متر','Tape');
  insert into calculator.mylar_tapes(id,width_mm,warehouse_item_id,created_by,updated_by)
  values(coalesce(v_existing,gen_random_uuid()),(p_payload->>'width_mm')::numeric,v_wh,auth.uid(),auth.uid())
  on conflict(id) do update set width_mm=excluded.width_mm,warehouse_item_id=excluded.warehouse_item_id,updated_by=auth.uid()
  returning id into v_id;
  perform calculator.log_event(case when v_existing is null then 'component_created' else 'component_updated' end,'tape',v_id::text,jsonb_build_object('warehouse_item_id',v_wh,'width_mm',p_payload->>'width_mm'));
  return jsonb_build_object('id',v_id,'warehouse_item_id',v_wh);
end $$;
