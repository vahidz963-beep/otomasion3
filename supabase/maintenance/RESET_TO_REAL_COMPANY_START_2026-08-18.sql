-- =====================================================================
-- RESET_TO_REAL_COMPANY_START_2026-08-18
-- پاک‌سازی داده‌های تستی/عملیاتی برای شروع واقعی شرکت آریامن
-- =====================================================================
-- خیلی مهم:
-- 1) این فایل را فقط وقتی اجرا کنید که Backup کامل گرفته‌اید.
-- 2) این فایل کاربران و نقش‌ها را حذف نمی‌کند.
-- 3) این فایل ساختار دیتابیس، قالب مراحل، تنظیمات پایه و شماره‌گذاری را نگه می‌دارد.
-- 4) این فایل داده‌های عملیاتی/تستی مثل سفارش، مشتری، کالا، فاکتور، انبار، تولید، R&D، چک، وام، پرداخت و ارجاعات را پاک می‌کند.
-- 5) فایل‌های Storage ممکن است نیاز به پاک‌سازی دستی از Supabase Storage داشته باشند.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) نمایش هشدار قبل از اجرا
-- ---------------------------------------------------------------------
do $$
begin
  raise notice 'شروع پاک‌سازی داده‌های عملیاتی/تستی. اگر Backup نگرفته‌اید، همین حالا اجرای SQL را متوقف کنید.';
end $$;

-- ---------------------------------------------------------------------
-- 1) حذف داده‌های عملیاتی/تستی از جدول‌های اصلی
--    جدول‌هایی که وجود نداشته باشند، نادیده گرفته می‌شوند.
-- ---------------------------------------------------------------------
do $$
declare
  v_table text;
  v_tables text[] := array[
    -- پیام‌ها/ارجاعات/فایل‌ها/اعلان‌ها
    'automation_referral_messages',
    'automation_referrals',
    'notifications',
    'shared_files',
    'internal_requests',

    -- CRM / مشتری / سفارش / فروش
    'follow_up_reminders',
    'crm_followups',
    'crm_interactions',
    'crm_opportunities',
    'customer_documents',
    'order_attachments',
    'order_events',
    'order_status_history',
    'order_inventory_reservations',
    'order_stage_instances',
    'order_items',
    'quotation_items',
    'quotations',
    'orders',
    'customers',

    -- مالی / حسابداری
    'finance_payment_allocations',
    'finance_document_events',
    'finance_document_items',
    'finance_journal_lines',
    'finance_journal_entries',
    'finance_payments',
    'finance_checks',
    'finance_order_costs',
    'finance_io_documents',
    'finance_investments',
    'finance_loan_installments',
    'finance_loans',
    'finance_documents',
    'finance_parties',
    'finance_bank_accounts',
    'finance_cashboxes',

    -- انبار
    'warehouse_document_lines',
    'warehouse_documents',
    'warehouse_transactions',
    'warehouse_snapshot_items',
    'warehouse_snapshots',
    'warehouse_shipments',
    'warehouse_items',

    -- تولید
    'production_progress_logs',
    'production_qc_checks',
    'production_documents',
    'production_material_usage',
    'production_output',
    'production_plans',
    'production_order_stages',
    'production_bom_items',
    'production_boms',
    'production_orders',

    -- R&D
    'rnd_progress_logs',
    'rnd_test_records',
    'rnd_prototype_tests',
    'rnd_design_revisions',
    'rnd_material_usage',
    'rnd_production_handoffs',
    'rnd_cost_items',
    'rnd_project_stages',
    'rnd_projects',

    -- شمارنده‌های مرکزی شماره‌گذاری؛ قانون‌ها حفظ می‌شوند ولی شمارنده‌ها صفر می‌شوند
    'finance_numbering_counters'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('truncate table public.%I restart identity cascade', v_table);
      raise notice 'پاک شد: public.%', v_table;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) ریست Sequenceهای شماره‌گذاری قدیمی/کمکی
--    قوانین شماره‌گذاری اصلی در finance_numbering_rules باقی می‌مانند.
-- ---------------------------------------------------------------------
do $$
declare
  v_seq text;
  v_sequences text[] := array[
    'order_code_seq',
    'quotation_code_seq',
    'internal_request_code_seq',
    'finance_document_seq',
    'finance_payment_seq',
    'finance_journal_seq',
    'automation_referral_seq',
    'warehouse_in_doc_seq',
    'warehouse_out_doc_seq',
    'warehouse_shipment_seq',
    'production_order_code_seq',
    'production_document_seq',
    'production_item_code_seq',
    'rnd_project_code_seq',
    'shared_file_seq',
    'finance_loan_seq'
  ];
begin
  foreach v_seq in array v_sequences loop
    if to_regclass('public.' || v_seq) is not null then
      execute format('alter sequence public.%I restart with 1', v_seq);
      raise notice 'Sequence ریست شد: public.%', v_seq;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) اطمینان از فعال ماندن کاربران و نقش‌ها
--    این بخش هیچ کاربری را حذف نمی‌کند.
-- ---------------------------------------------------------------------
update public.profiles
set is_active = coalesce(is_active, true),
    additional_roles = case
      when additional_roles is null or array_length(additional_roles, 1) is null
        then array[role::text]
      else additional_roles
    end,
    updated_at = now()
where id is not null;

-- ---------------------------------------------------------------------
-- 4) یادآوری پاک‌سازی Storage
-- ---------------------------------------------------------------------
do $$
begin
  raise notice 'اگر فایل تستی در Storage دارید، محتوای bucket های automation-shared-files و order-attachments را از Supabase Storage به صورت دستی پاک کنید.';
end $$;

commit;

-- ---------------------------------------------------------------------
-- 5) چک بعد از پاک‌سازی
-- این Queryها را بعد از اجرای موفق، جداگانه اجرا کنید تا مطمئن شوید داده‌های عملیاتی پاک شده‌اند.
-- ---------------------------------------------------------------------
-- select 'orders' as table_name, count(*) from public.orders
-- union all select 'customers', count(*) from public.customers
-- union all select 'finance_documents', count(*) from public.finance_documents
-- union all select 'finance_parties', count(*) from public.finance_parties
-- union all select 'warehouse_items', count(*) from public.warehouse_items
-- union all select 'production_orders', count(*) from public.production_orders
-- union all select 'rnd_projects', count(*) from public.rnd_projects;
