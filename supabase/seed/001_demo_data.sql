-- =====================================================================
-- DEMO DATA — Otomasion2
-- Run after all migrations and after creating the first admin profile.
-- Creates sample customers, warehouse stock, orders, finance documents,
-- payments, CRM follow-ups, opportunities, and referrals.
-- Safe to run more than once; it tries to avoid duplicates.
-- =====================================================================

do $$
declare
  v_admin uuid;

  v_c_arman uuid;
  v_c_behin uuid;
  v_c_pars uuid;
  v_c_rayan uuid;
  v_c_niroo uuid;

  v_item_tr uuid;
  v_item_pcb uuid;
  v_item_ctrl uuid;
  v_item_pack uuid;

  v_snapshot uuid;

  v_tpl_prod uuid;
  v_tpl_rnd uuid;
  v_tpl_trading uuid;
  v_tpl_fast uuid;

  v_o_arman uuid;
  v_o_behin uuid;
  v_o_pars uuid;
  v_o_rayan uuid;
  v_o_niroo uuid;

  v_doc uuid;
  v_payment uuid;
  v_party uuid;
  v_order_item uuid;
begin
  select id into v_admin
  from public.profiles
  where role = 'admin' and is_active
  order by created_at
  limit 1;

  if v_admin is null then
    raise exception 'No active admin profile found. Create the first admin before running demo seed.';
  end if;

  -- The SQL editor is not an authenticated app session. Several SECURITY DEFINER
  -- functions intentionally check auth.uid()/auth.role(). For demo seeding only,
  -- we impersonate the first active admin inside this transaction so SECURITY DEFINER
  -- functions that use auth.uid()/auth.role() behave like an admin user action.
  -- Important: do NOT SET ROLE to authenticated here; SQL Editor should remain postgres
  -- so demo inserts are allowed while auth.uid() still returns the admin UUID.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- -------------------------------------------------------------------
  -- Customers / CRM
  -- -------------------------------------------------------------------
  insert into public.customers (
    company_name, contact_person_name, contact_phone, contact_email,
    city, address, tier, preferred_contact_channel, acquisition_source,
    assigned_sales_id, crm_status, lead_score, next_follow_up_at,
    last_contacted_at, created_by
  )
  values
    ('شرکت آرمان نیرو', 'خانم رضایی', '021-88445566', 'finance@arman.example', 'تهران', 'تهران، خیابان مطهری', 'vip', 'whatsapp', 'معرفی مشتری', v_admin, 'vip', 92, now() + interval '6 days', now() - interval '1 day', v_admin),
    ('صنایع بهین کنترل', 'آقای نادری', '031-33221100', 'info@behin.example', 'اصفهان', 'اصفهان، شهرک صنعتی', 'normal', 'website', 'وب‌سایت', v_admin, 'lead', 68, now() + interval '2 days', now() - interval '3 days', v_admin),
    ('پارس الکترونیک', 'خانم شریفی', '021-44550022', 'acc@pars.example', 'تهران', 'تهران، ستارخان', 'vip', 'phone', 'مشتری قدیمی', v_admin, 'vip', 88, now() + interval '18 days', now() - interval '8 days', v_admin),
    ('رایان صنعت', 'آقای امیری', '026-34567890', 'rayansanat@example.com', 'کرج', 'کرج، عظیمیه', 'normal', 'in_person', 'نمایشگاه', v_admin, 'at_risk', 42, now(), now() - interval '10 days', v_admin),
    ('نیرو پرداز شرق', 'خانم کاظمی', '051-33001234', 'contact@niroo.example', 'مشهد', 'مشهد، بلوار وکیل‌آباد', 'normal', 'telegram', 'تماس ورودی', v_admin, 'lead', 75, now() + interval '1 day', now() - interval '1 day', v_admin)
  on conflict do nothing;

  select id into v_c_arman from public.customers where company_name = 'شرکت آرمان نیرو' limit 1;
  select id into v_c_behin from public.customers where company_name = 'صنایع بهین کنترل' limit 1;
  select id into v_c_pars from public.customers where company_name = 'پارس الکترونیک' limit 1;
  select id into v_c_rayan from public.customers where company_name = 'رایان صنعت' limit 1;
  select id into v_c_niroo from public.customers where company_name = 'نیرو پرداز شرق' limit 1;

  -- -------------------------------------------------------------------
  -- Warehouse demo stock
  -- -------------------------------------------------------------------
  insert into public.warehouse_items (item_code, item_name_fa, item_name_en, unit, category, min_stock_threshold)
  values
    ('TR-220-12', 'ترانس سفارشی ۲۲۰ به ۱۲ ولت', 'Custom 220-12V transformer', 'عدد', 'transformer', 2),
    ('PCB-CTRL', 'برد کنترلر دور موتور', 'Motor controller PCB', 'عدد', 'pcb', 3),
    ('CTRL-FULL', 'محصول کامل کنترلر', 'Full controller product', 'عدد', 'product', 2),
    ('PACK-S', 'بسته‌بندی استاندارد', 'Standard packaging', 'عدد', 'packaging', 20)
  on conflict (item_code) do update set
    item_name_fa = excluded.item_name_fa,
    item_name_en = excluded.item_name_en,
    unit = excluded.unit,
    category = excluded.category,
    min_stock_threshold = excluded.min_stock_threshold,
    is_active = true,
    updated_at = now();

  select id into v_item_tr from public.warehouse_items where item_code = 'TR-220-12';
  select id into v_item_pcb from public.warehouse_items where item_code = 'PCB-CTRL';
  select id into v_item_ctrl from public.warehouse_items where item_code = 'CTRL-FULL';
  select id into v_item_pack from public.warehouse_items where item_code = 'PACK-S';

  insert into public.warehouse_snapshots (file_name, imported_by, row_count, notes)
  values ('demo-stock.xlsx', v_admin, 4, 'Demo initial stock')
  returning id into v_snapshot;

  insert into public.warehouse_snapshot_items (snapshot_id, item_code, quantity, unit)
  values
    (v_snapshot, 'TR-220-12', 5, 'عدد'),
    (v_snapshot, 'PCB-CTRL', 1, 'عدد'),
    (v_snapshot, 'CTRL-FULL', 0, 'عدد'),
    (v_snapshot, 'PACK-S', 80, 'عدد');

  -- -------------------------------------------------------------------
  -- Workflow templates
  -- -------------------------------------------------------------------
  select id into v_tpl_prod from public.order_workflow_templates where template_key = 'production_full_12';
  select id into v_tpl_rnd from public.order_workflow_templates where template_key = 'rnd_prototype_10';
  select id into v_tpl_trading from public.order_workflow_templates where template_key = 'trading_standard_10';
  select id into v_tpl_fast from public.order_workflow_templates where template_key = 'trading_fast_6';

  -- -------------------------------------------------------------------
  -- Orders + items
  -- -------------------------------------------------------------------
  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, description_fa, priority, expected_delivery_date,
    sales_officer_id, created_by, contact_channel, customer_phone_snapshot,
    customer_city_snapshot
  ) values (
    'DEMO-ORD-0001', v_c_arman, 'production', v_tpl_prod, 'execution',
    current_date - 8, 'ترانس سفارشی ۲۲۰ به ۱۲ ولت', 'سفارش تولیدی نمونه برای تست چرخه تولید', 1, current_date + 6,
    v_admin, v_admin, 'whatsapp', '021-88445566', 'تهران'
  )
  on conflict (order_code) do update set
    current_stage = excluded.current_stage,
    expected_delivery_date = excluded.expected_delivery_date,
    updated_at = now()
  returning id into v_o_arman;

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, description_fa, priority, expected_delivery_date,
    sales_officer_id, created_by, contact_channel, customer_phone_snapshot,
    customer_city_snapshot
  ) values (
    'DEMO-ORD-0002', v_c_behin, 'rnd', v_tpl_rnd, 'in_rnd',
    current_date - 5, 'برد کنترلر دور موتور', 'سفارش R&D نمونه برای تست طراحی و نمونه‌سازی', 2, current_date + 12,
    v_admin, v_admin, 'website', '031-33221100', 'اصفهان'
  )
  on conflict (order_code) do update set
    current_stage = excluded.current_stage,
    expected_delivery_date = excluded.expected_delivery_date,
    updated_at = now()
  returning id into v_o_behin;

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, description_fa, priority, expected_delivery_date,
    sales_officer_id, created_by, contact_channel, customer_phone_snapshot,
    customer_city_snapshot
  ) values (
    'DEMO-ORD-0003', v_c_pars, 'trading', v_tpl_fast, 'closed',
    current_date - 15, 'خدمات طراحی PCB', 'سفارش بسته‌شده برای تست گزارش‌ها', 3, current_date - 3,
    v_admin, v_admin, 'phone', '021-44550022', 'تهران'
  )
  on conflict (order_code) do update set
    current_stage = excluded.current_stage,
    updated_at = now()
  returning id into v_o_pars;

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, description_fa, priority, expected_delivery_date,
    sales_officer_id, created_by, contact_channel, customer_phone_snapshot,
    customer_city_snapshot
  ) values (
    'DEMO-ORD-0004', v_c_rayan, 'trading', v_tpl_trading, 'procurement',
    current_date - 11, 'خرید محصول کامل کنترلر', 'سفارش عقب‌افتاده برای تست هشدارها', 2, current_date - 4,
    v_admin, v_admin, 'in_person', '026-34567890', 'کرج'
  )
  on conflict (order_code) do update set
    current_stage = excluded.current_stage,
    expected_delivery_date = excluded.expected_delivery_date,
    updated_at = now()
  returning id into v_o_rayan;

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, description_fa, priority, expected_delivery_date,
    sales_officer_id, created_by, contact_channel, customer_phone_snapshot,
    customer_city_snapshot
  ) values (
    'DEMO-ORD-0005', v_c_niroo, 'production', v_tpl_prod, 'planning',
    current_date - 1, 'مونتاژ محصول کامل', 'سفارش جدید برای تست موجودی و تولید', 1, current_date + 16,
    v_admin, v_admin, 'telegram', '051-33001234', 'مشهد'
  )
  on conflict (order_code) do update set
    current_stage = excluded.current_stage,
    expected_delivery_date = excluded.expected_delivery_date,
    updated_at = now()
  returning id into v_o_niroo;

  -- Keep order items deterministic on re-run.
  delete from public.order_items where order_id in (v_o_arman, v_o_behin, v_o_pars, v_o_rayan, v_o_niroo);

  insert into public.order_items (order_id, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price, notes)
  values
    (v_o_arman, 'ترانس سفارشی ۲۲۰ به ۱۲ ولت', 'Custom transformer', 'TR-220-12', 2, 'عدد', 740000000, 'Demo item'),
    (v_o_arman, 'خدمات تست و بسته‌بندی', 'Testing and packing', 'PACK-S', 2, 'عدد', 100000000, 'Demo service'),
    (v_o_behin, 'برد کنترلر دور موتور', 'Motor controller PCB', 'PCB-CTRL', 5, 'عدد', 110000000, 'Demo item'),
    (v_o_pars, 'خدمات طراحی PCB', 'PCB design service', null, 1, 'پروژه', 863636364, 'Demo service'),
    (v_o_rayan, 'محصول کامل کنترلر', 'Full controller product', 'CTRL-FULL', 1, 'عدد', 390909091, 'Demo item'),
    (v_o_niroo, 'محصول کامل کنترلر', 'Full controller product', 'CTRL-FULL', 3, 'عدد', 240000000, 'Demo item');

  -- Reserve part of Arman order for stock visibility demo.
  select id into v_order_item
  from public.order_items
  where order_id = v_o_arman and warehouse_item_code = 'TR-220-12'
  limit 1;

  if v_order_item is not null and not exists (
    select 1 from public.order_inventory_reservations
    where order_item_id = v_order_item and status = 'reserved'
  ) then
    insert into public.order_inventory_reservations (order_id, order_item_id, warehouse_item_id, quantity, reserved_by, notes)
    values (v_o_arman, v_order_item, v_item_tr, 2, v_admin, 'Demo reservation');
  end if;

  -- -------------------------------------------------------------------
  -- Finance documents and payment demo
  -- -------------------------------------------------------------------
  v_party := public.fn_finance_party_for_customer(v_c_arman);

  select id into v_doc
  from public.finance_documents
  where related_order_id = v_o_arman and document_type = 'sales_invoice' and status <> 'void'
  limit 1;

  if v_doc is null then
    insert into public.finance_documents (
      doc_number, document_type, status, party_id, related_order_id,
      source_module, source_record_id, issue_date, due_date, description,
      created_by
    ) values (
      null, 'sales_invoice', 'approved', v_party, v_o_arman,
      'orders', v_o_arman, current_date - 1, current_date + 6,
      'Demo invoice for Arman order', v_admin
    ) returning id into v_doc;

    insert into public.finance_document_items (
      document_id, line_no, item_type, description_fa, quantity, unit, unit_price, tax_rate
    ) values
      (v_doc, 1, 'goods', 'ترانس سفارشی ۲۲۰ به ۱۲ ولت', 2, 'عدد', 740000000, 10),
      (v_doc, 2, 'service', 'خدمات تست و بسته‌بندی', 1, 'سرویس', 200000000, 10);

    perform public.fn_finance_recalculate_document_totals(v_doc);
  end if;

  select p.id into v_payment
  from public.finance_payments p
  join public.finance_payment_allocations a on a.payment_id = p.id
  where a.document_id = v_doc
  limit 1;

  if v_payment is null then
    insert into public.finance_payments (
      payment_number, direction, method, status, party_id, payment_date,
      amount, related_order_id, source_module, source_record_id,
      description, created_by
    ) values (
      null, 'receipt', 'bank_transfer', 'confirmed', v_party, current_date,
      900000000, v_o_arman, 'orders', v_o_arman,
      'Demo partial payment', v_admin
    ) returning id into v_payment;

    insert into public.finance_payment_allocations (payment_id, document_id, amount)
    values (v_payment, v_doc, 900000000)
    on conflict do nothing;

    perform public.fn_finance_update_document_paid_amount(v_doc);
  end if;

  -- Proforma demo for Behin.
  perform public.fn_create_sales_proforma_from_order(v_o_behin);

  -- -------------------------------------------------------------------
  -- CRM interactions / follow-ups / opportunities
  -- -------------------------------------------------------------------
  insert into public.crm_interactions (customer_id, related_order_id, activity_type, contact_channel, title, description, activity_at, created_by)
  values
    (v_c_arman, v_o_arman, 'call', 'whatsapp', 'پیگیری تسویه و تحویل', 'تماس با مشتری برای زمان تحویل نهایی', now() - interval '1 day', v_admin),
    (v_c_behin, v_o_behin, 'email', 'website', 'ارسال پیش‌فاکتور', 'پیش‌فاکتور و مشخصات اولیه ارسال شد', now() - interval '2 days', v_admin),
    (v_c_niroo, v_o_niroo, 'meeting', 'telegram', 'جلسه بررسی تولید', 'نیازهای مونتاژ بررسی شد', now() - interval '1 day', v_admin)
  on conflict do nothing;

  insert into public.crm_followups (customer_id, related_order_id, title, due_at, assigned_to, created_by)
  select v_c_rayan, v_o_rayan, 'پیگیری مشتری در معرض ریزش', now() + interval '1 day', v_admin, v_admin
  where not exists (select 1 from public.crm_followups where customer_id = v_c_rayan and title = 'پیگیری مشتری در معرض ریزش');

  insert into public.crm_followups (customer_id, related_order_id, title, due_at, assigned_to, created_by)
  select v_c_niroo, v_o_niroo, 'پیگیری پیشنهاد تولید', now() + interval '2 days', v_admin, v_admin
  where not exists (select 1 from public.crm_followups where customer_id = v_c_niroo and title = 'پیگیری پیشنهاد تولید');

  insert into public.crm_opportunities (customer_id, related_order_id, title, stage, estimated_amount, probability_percent, expected_close_date, assigned_to, source, created_by)
  values
    (v_c_behin, v_o_behin, 'فرصت فروش برد کنترلر', 'proposal', 620000000, 60, current_date + 14, v_admin, 'وب‌سایت', v_admin),
    (v_c_niroo, v_o_niroo, 'فرصت مونتاژ محصول کامل', 'negotiation', 780000000, 70, current_date + 18, v_admin, 'تماس ورودی', v_admin)
  on conflict do nothing;

  -- -------------------------------------------------------------------
  -- Referrals
  -- -------------------------------------------------------------------
  perform public.fn_create_order_referral(v_o_arman, 'accounting'::text, 'پیگیری تسویه باقیمانده سفارش'::text, 'Demo referral to finance'::text, 'accountant'::public.user_role, 1::smallint, (current_date + 6)::date);
  perform public.fn_create_order_referral(v_o_behin, 'rnd'::text, 'بررسی امکان‌سنجی برد کنترلر'::text, 'Demo referral to R&D'::text, 'rnd'::public.user_role, 2::smallint, (current_date + 8)::date);
  perform public.fn_create_order_referral(v_o_niroo, 'warehouse'::text, 'بررسی موجودی محصول کامل'::text, 'Demo referral to warehouse'::text, 'warehouse'::public.user_role, 1::smallint, (current_date + 3)::date);

  raise notice 'Demo data inserted/updated successfully.';
end $$;
