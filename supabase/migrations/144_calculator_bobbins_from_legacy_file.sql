-- Migration 144: افزودن دو مدل بوبینِ موجود در فایل ماشین‌حساب قدیمی (v1.7) که در اتوماسیون نبودند.
-- دادهٔ استخراج‌شده از CORE_DATABASE / BOBBINS فایل preview_step1_2.html:
--   PQ32/30-V-6+6 : BW=18.7  HW=5.26  MLT=51.21  فلنج 34×32  پایه 6+6  قیمت 0.724 یوان
--   PQ20/20-V-8+8 : BW=11.9  HW=3.1   MLT=34.54  فلنج 23×23  پایه 8+8  قیمت 0.414 یوان
-- تمام ۲۱ هستهٔ فایل قبلاً در اتوماسیون موجود است (مقایسه شد — بدون تغییر).
-- قیمت ارزی طبق نسخهٔ ۱۳۰ (CNY→ریال با نرخ جاری انبار)؛ موجودی اولیه صفر است و
-- تعداد واقعی باید از ماژول انبار ثبت شود (قاعدهٔ موجودی واقعی).

do $$
declare
  v_rate numeric;
  v_usd numeric;
  v_item uuid;
  v_cost numeric;
  v_old_currency text;
  r record;
begin
  select cny_rial, usd_rial into v_rate, v_usd from public.warehouse_exchange_rates where id = true;
  if coalesce(v_rate, 0) <= 0 then
    raise exception 'نرخ یوان انبار تعریف نشده است؛ ابتدا نرخ را در ماژول انبار ثبت کنید';
  end if;

  for r in select * from (values
    ('b015','PQ32/30','BOB-PQ3230-V66','بوبین PQ32/30 عمودی 6+6','Bobbin PQ32/30 Vertical 6+6',6,6,18.7,5.26,51.21,34,32,0.724::numeric),
    ('b016','PQ20/20','BOB-PQ2020-V88','بوبین PQ20/20 عمودی 8+8','Bobbin PQ20/20 Vertical 8+8',8,8,11.9,3.1,34.54,23,23,0.414::numeric)
  ) as t(source_key, core_model, item_code, name_fa, name_en, pins_left, pins_right, bw_mm, hw_mm, mlt_mm, flange_l, flange_w, cost_cny)
  loop
    -- اجرای مجدد (idempotent): اگر بوبین با این source_key هست، رد شو
    if exists(select 1 from calculator.transformer_bobbins where source_key = r.source_key) then
      continue;
    end if;

    -- ۱) قلم انبار بوبین (واحد عدد، دسته Bobbin)
    insert into public.warehouse_items
      (item_code, item_name_fa, item_name_en, category, unit, location, min_stock_threshold, is_active)
    values
      (r.item_code, r.name_fa, r.name_en, 'Bobbin', 'عدد', 'انبار', 0, true)
    on conflict (item_code) do nothing
    returning id into v_item;
    if v_item is null then
      select id into v_item from public.warehouse_items where item_code = r.item_code;
    end if;

    -- ۲) قیمت ارزی نسخهٔ ۱۳۰: هزینهٔ یوانی فایل → ریال با نرخ جاری (ساختار همان fn_set_warehouse_item_currency_price برای کالای معمولی)
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

    -- ۳) ثبت بوبین در کاتالوگ فنی، متصل به هستهٔ موجود
    insert into calculator.transformer_bobbins
      (source_key, core_id, mount_orientation, pins_left, pins_right,
       window_width_mm, window_height_mm, mean_turn_length_mm,
       flange_length_mm, flange_width_mm, warehouse_item_id)
    select r.source_key, c.id, 'عمودی', r.pins_left, r.pins_right,
           r.bw_mm, r.hw_mm, r.mlt_mm, r.flange_l, r.flange_w, v_item
    from calculator.transformer_cores c
    where c.model_code = r.core_model;

    v_item := null;
  end loop;
end $$;
