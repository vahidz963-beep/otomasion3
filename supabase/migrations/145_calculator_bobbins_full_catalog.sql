-- Migration 145: هم‌گام‌سازی کامل کاتالوگ بوبین‌ها با فایل مرجع کاربر (bobbine_database.txt — ۲۱ ردیف).
-- قواعد پابرجا:
--   * اعداد موجودی فایلِ مرجع هرگز به DB کپی نمی‌شود؛ فقط رکوردِ جاافتاده با موجودی صفر ساخته می‌شود
--     (تعداد واقعی باید از ماژول انبار ثبت شود).
--   * اجرای مجدد امن است (idempotent): رکورد موجود با source_key جدید «BB-*» یا با همان
--     (هسته + جهت + تعداد پایه) رد می‌شود.
--   * هر ۲۱ هستهٔ فایل مرجع طبق ممیزی Migration 144 از قبل در calculator.transformer_cores موجودند؛
--     ردیفی که هسته‌اش پیدا نشود با RAISE NOTICE گزارش می‌شود (سکوت معنا‌دار ندارد).
--   * Migration 144 (پیش‌نیاز ترتیبی) دو ردیف PQ32/30-V-6+6 و PQ20/20-V-8+8 را اضافه می‌کند؛
--     این اسکریپت آن دو را هم با گارد خودش رد می‌کند و فقط جاافتاده‌های باقی‌مانده را می‌سازد.
-- پین‌های غیراستاندارد فایل («6+6y» ردیف ER28/14/11-V) به «6+6» نرمال‌سازی شد.

do $$
declare
  v_rate numeric;
  v_usd numeric;
  v_item uuid;
  v_cost numeric;
  v_old_currency text;
  v_core uuid;
  r record;
begin
  select cny_rial, usd_rial into v_rate, v_usd from public.warehouse_exchange_rates where id = true;
  if coalesce(v_rate, 0) <= 0 then
    raise exception 'نرخ یوان انبار تعریف نشده است؛ ابتدا نرخ را در ماژول انبار ثبت کنید';
  end if;

  for r in select * from (values
    ('BB-EE25-10-5-H-55'   ,'EE25/10/5'      ,'افقی' ,5,5,11.00,5.20,32.000,0.241::numeric),
    ('BB-EE25-10-5-V-55'   ,'EE25/10/5'      ,'عمودی',5,5,10.28,4.30,36.000,0.241::numeric),
    ('BB-EE28-10-11-V-55'  ,'EE28/10/11'     ,'عمودی',5,5,10.30,5.25,46.400,0.000::numeric),
    ('BB-EE33-29-13-V-77'  ,'EE33/29/13'     ,'عمودی',7,7,16.80,5.25,56.400,0.552::numeric),
    ('BB-EF25-V-55'        ,'EF25(EE25/13/7)','عمودی',5,5,15.40,5.00,38.800,0.724::numeric),
    ('BB-EE22-18-V-55'     ,'EE22/18'        ,'عمودی',5,5, 8.75,3.20,31.600,0.190::numeric),
    ('BB-EE19-16-5-V-55'   ,'EE19/16/5'      ,'عمودی',5,5, 8.75,4.60,28.000,0.166::numeric),
    ('BB-EE19-16-5-V-33'   ,'EE19/16/5'      ,'عمودی',3,3, 8.75,3.80,31.200,0.105::numeric),
    ('BB-EE19-16-5-V-43'   ,'EE19/16/5'      ,'عمودی',4,3, 8.75,3.80,31.200,0.115::numeric),
    ('BB-EE19-16-5-H-55'   ,'EE19/16/5'      ,'افقی' ,5,5, 9.70,3.70,31.200,0.166::numeric),
    ('BB-EFD15-H-44'       ,'EFD15'          ,'افقی' ,4,4, 8.90,1.80,26.000,0.200::numeric),
    ('BB-EFD20-H-55'       ,'EFD20'          ,'افقی' ,5,5,13.30,2.05,34.900,0.250::numeric),
    ('BB-EFD25-H-55'       ,'EFD25'          ,'افقی' ,5,5,16.40,2.40,46.400,0.375::numeric),
    ('BB-PQ32-30-V-66'     ,'PQ32/30'        ,'عمودی',6,6,18.70,5.26,51.210,0.724::numeric),
    ('BB-PQ32-20-V-66'     ,'PQ32/20'        ,'عمودی',6,6, 9.07,5.18,50.270,0.0586::numeric),
    ('BB-PQ26-20-V-66'     ,'PQ26/20'        ,'عمودی',6,6,13.53,3.76,44.580,0.0414::numeric),
    ('BB-PQ20-20-V-88'     ,'PQ20/20'        ,'عمودی',8,8,11.90,3.10,34.540,0.414::numeric),
    ('BB-ETD34-17-11-V-77' ,'ETD34/17/11'    ,'عمودی',7,7,20.90,5.90,41.448,1.040::numeric),
    ('BB-ER28-14-11-V-66'  ,'ER28/14/11'     ,'عمودی',6,6,16.63,4.90,38.550,0.328::numeric),
    ('BB-ER28-14-11-H-66'  ,'ER28/14/11'     ,'افقی' ,6,6,16.00,5.10,37.680,0.328::numeric),
    ('BB-ER34-14-11-H-66'  ,'ER34/14/11'     ,'افقی' ,6,6,21.80,5.10,37.680,0.379::numeric)
  ) as t(source_key, core_model, mount, pins_left, pins_right, bw_mm, hw_mm, mlt_mm, cost_cny)
  loop
    -- گارد ۱: با این source_key قبلاً ساخته شده؟
    if exists(select 1 from calculator.transformer_bobbins where source_key = r.source_key) then
      continue;
    end if;
    -- گارد ۲: همان (هسته + جهت + پایه‌ها) از قبل هست (مثلاً با کلید b0xx از نسخه‌های قبل)؟
    if exists(
      select 1 from calculator.transformer_bobbins b
      join calculator.transformer_cores c on c.id = b.core_id
      where c.model_code = r.core_model
        and b.mount_orientation = r.mount
        and b.pins_left = r.pins_left and b.pins_right = r.pins_right
    ) then
      continue;
    end if;

    select id into v_core from calculator.transformer_cores where model_code = r.core_model;
    if v_core is null then
      raise notice 'هستهٔ % در کاتالوگ نیست؛ ردیف بوبین % ساخته نشد', r.core_model, r.source_key;
      continue;
    end if;

    -- ۱) قلم انبار بوبین (واحد عدد، دسته Bobbin) — موجودی صفر
    insert into public.warehouse_items
      (item_code, item_name_fa, item_name_en, category, unit, location, min_stock_threshold, is_active)
    values
      (r.source_key,
       'بوبین ' || r.core_model || ' ' || r.mount || ' ' || r.pins_left || '+' || r.pins_right,
       'Bobbin ' || r.core_model || ' ' || (case when r.mount = 'عمودی' then 'Vertical' else 'Horizontal' end) || ' ' || r.pins_left || '+' || r.pins_right,
       'Bobbin', 'عدد', 'انبار', 0, true)
    on conflict (item_code) do nothing
    returning id into v_item;
    if v_item is null then
      select id into v_item from public.warehouse_items where item_code = r.source_key;
    end if;

    -- ۲) قیمت ارزی نسخهٔ ۱۳۰ (قیمت فایل مرجع — نه موجودی)
    select price_currency into v_old_currency from public.warehouse_items where id = v_item;
    v_cost := public.fn_round_warehouse_price_rial(r.cost_cny * v_rate);

    insert into public.warehouse_item_currency_price_history
      (item_id, action, old_currency, new_currency,
       old_base_cost, new_base_cost, old_base_sale, new_base_sale,
       old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
       usd_rial, cny_rial, changed_by)
    values
      (v_item, 'manual_edit', v_old_currency, 'CNY',
       null, r.cost_cny, null, r.cost_cny,
       null, v_cost, null, v_cost,
       v_usd, v_rate, null);

    update public.warehouse_items
    set price_currency = 'CNY',
        base_cost_price = r.cost_cny,
        base_sale_price = r.cost_cny,
        unit_price_estimate = v_cost,
        unit_sale_price_estimate = v_cost,
        pricing_margin_pct = null,
        pricing_updated_at = now(),
        updated_at = now()
    where id = v_item;

    -- ۳) ثبت بوبین در کاتالوگ فنی
    insert into calculator.transformer_bobbins
      (source_key, core_id, mount_orientation, pins_left, pins_right,
       window_width_mm, window_height_mm, mean_turn_length_mm, warehouse_item_id)
    values
      (r.source_key, v_core, r.mount, r.pins_left, r.pins_right,
       r.bw_mm, r.hw_mm, r.mlt_mm, v_item);

    v_item := null; v_core := null;
  end loop;
end $$;
