-- ============================================================================
-- CHECK_139_DIAGNOSTIC.sql
-- بررسی سلامت کامل دیتابیس برای نسخه ۱۳۹.۰.۲
-- محل اجرا: Supabase → SQL Editor (کل فایل را یک‌جا اجرا کن)
-- این اسکریپت فقط خواندنی است؛ هیچ داده‌ای را تغییر نمی‌دهد.
-- خروجی: جدول وضعیت همه جدول‌ها/Viewها/تابع‌های مورد نیاز برنامه.
-- هر ردیفی که به‌جای «OK ✓» چیزی دیگر نوشته شد = همان شیء در دیتابیس فعلی
-- ساخته نشده یا دسترسی ندارد؛ یعنی فایل SQL مربوطه کامل اجرا نشده است.
-- ============================================================================

with expected(object_kind, object_name, needed_columns, hint) as (
  values
    -- جدول‌های پایه مالی
    ('table', 'finance_parties', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_documents', array['paid_amount', 'balance_amount'], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_document_items', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_payments', array['loan_id', 'batch_id', 'category_id', 'category_note', 'transfer_to_bank_account_id'], 'ستون‌های 062 / 079 / 084 / 087'),
    ('table', 'finance_payment_allocations', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_bank_accounts', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_cashboxes', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_checks', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_journal_entries', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_journal_lines', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_loans', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_loan_installments', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_payroll_employees', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_payroll_slips', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_payroll_lines', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_fiscal_years', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_fiscal_periods', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_io_documents', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_numbering_rules', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_order_costs', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_income_expense_categories', '{}'::text[], 'Migration 062'),
    ('table', 'automation_referrals', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('table', 'finance_direct_expense_offsets', array['idempotency_key', 'replaces_settlement_id', 'replaced_by_settlement_id', 'revision_reason', 'void_reason'], 'Migrationهای 133 و 137'),
    ('table', 'finance_direct_expense_offset_lines', array['line_type', 'target_party_id', 'target_payment_id'], 'Migration 137'),

    -- Viewهایی که برنامه مستقیم می‌خواند
    ('view', 'v_finance_dashboard', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_document_summary', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_purchase_invoice_inventory_reconciliation', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_party_balances', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_party_statement', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_numbering_overview', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_account_turnover', '{}'::text[], 'Migrationهای 080 و 099'),
    ('view', 'v_finance_payment_ledger', array['bank_name', 'source_record_id', 'transfer_to_bank_account_id'], 'ستون bank_name = Migration 136'),
    ('view', 'v_finance_income_expense_categories', '{}'::text[], 'Migration 062'),
    ('view', 'v_finance_income_expense_ledger', '{}'::text[], 'Migration 062'),
    ('view', 'v_finance_direct_expense_offset_details', array['line_type', 'target_party_name'], 'Migrationهای 133 و 137'),
    ('view', 'v_finance_investment_portfolio', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_loan_overview', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_loan_installments', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_payroll_slips', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_payroll_payments', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_item_last_sale', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_receivable_forecast', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_finance_document_timeline', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_dashboard_important_payables', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_order_tracking', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_order_profitability', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_order_unified_costs', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_order_lifecycle_overview', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_warehouse_kardex', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_app_inventory_catalog', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_production_order_overview', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('view', 'v_rnd_project_overview', '{}'::text[], 'اجرای کامل supabase/migrations'),

    -- تابع‌های RPC که برنامه صدا می‌زند
    ('function', 'fn_post_finance_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_post_finance_document', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_void_finance_document', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_update_confirmed_finance_document', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_update_document_paid_amount', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_recalculate_document_totals', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_settle_check', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_apply_loan_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_reverse_loan_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_update_loan', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_update_loan_installment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_archive_loan', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_register_payroll_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_update_payroll_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_void_payroll_payment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_balance_sheet_lines', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_finance_create_party_and_customer', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_convert_finance_proforma_to_invoice', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_create_sales_invoice_from_order', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_create_sales_return_from_invoice', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_sync_order_reservation_for_finance_document', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_sync_purchase_invoice_inventory', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_close_fiscal_year', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_reopen_fiscal_year', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_close_fiscal_period', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_reopen_fiscal_period', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_create_finance_fiscal_year_with_periods', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_purchase_finance_investment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_update_finance_investment_metadata', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_sell_finance_investment_full', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_archive_finance_investment', '{}'::text[], 'اجرای کامل supabase/migrations'),
    ('function', 'fn_create_direct_transfer', '{}'::text[], 'Migration 137'),
    ('function', 'fn_revise_direct_transfer', '{}'::text[], 'Migration 137'),
    ('function', 'fn_void_direct_transfer', '{}'::text[], 'Migration 137')
),
existing_columns as (
  select table_name, array_agg(column_name::text order by ordinal_position) as cols
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
),
existing_functions as (
  select p.proname::text as proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
report as (
  select
    case e.object_kind when 'table' then 'جدول' when 'view' then 'View' else 'تابع' end as "بخش",
    e.object_name as "شیء",
    case
      when e.object_kind in ('table', 'view') and to_regclass(format('public.%I', e.object_name)) is null then 'موجود نیست'
      when e.object_kind = 'function' and not exists (select 1 from existing_functions f where f.proname = e.object_name) then 'موجود نیست'
      when exists (
        select 1
        from unnest(e.needed_columns) as c
        where not (c = any (coalesce((select x.cols from existing_columns x where x.table_name = e.object_name), '{}'::text[])))
      ) then 'ستون ناقص'
      when e.object_kind in ('table', 'view') and not has_table_privilege('authenticated', format('public.%I', e.object_name), 'SELECT') then 'بدون دسترسی خواندن'
      else 'OK ✓'
    end as "وضعیت",
    coalesce((
      select string_agg(c, ', ')
      from unnest(e.needed_columns) as c
      where not (c = any (coalesce((select x.cols from existing_columns x where x.table_name = e.object_name), '{}'::text[])))
    ), '—') as "ستون‌های گمشده",
    e.hint as "راهکار"
  from expected e
)
select * from report
union all
select
  'خلاصه' as "بخش",
  'نتیجه نهایی' as "شیء",
  case
    when count(*) filter (where "وضعیت" <> 'OK ✓') = 0 then 'OK ✓ همه اشیاء موجود و قابل دسترسی‌اند'
    else 'ناقص: ' || (count(*) filter (where "وضعیت" <> 'OK ✓'))::text || ' مورد مشکل دارد'
  end as "وضعیت",
  '—' as "ستون‌های گمشده",
  case when count(*) filter (where "وضعیت" <> 'OK ✓') = 0
    then 'دیتابیس سالم است؛ اگر بنر خطا در برنامه ماند، یک‌بار Deploy/Refresh انجام بده.'
    else 'فایل‌های supabase/migrations را به‌ترتیب شماره و کامل اجرا کن (مخصوصاً فایل‌های ستون «راهکار»).'
  end as "راهکار"
from report
order by 1 desc, 2;

-- ============================================================================
-- ۲) مقادیر Enum روش پرداخت (بدون این‌ها ثبت/ویرایش تراکنش خطا می‌دهد)
-- ============================================================================
select
  w.label as "مقدار لازم",
  coalesce(e.enumlabel, 'موجود نیست') as "وضعیت",
  w.hint as "راهکار"
from (values
  ('bank_transfer', 'Migration پایه 007'),
  ('card', 'Migration پایه 007'),
  ('pos', 'Migration پایه 007'),
  ('cash', 'Migration پایه 007'),
  ('check', 'Migration پایه 007'),
  ('offset', 'Migration پایه 007'),
  ('loan_payment', 'Migration 084'),
  ('account_transfer', 'Migration 079'),
  ('opening_balance', 'Migration 099'),
  ('direct_expense_offset', 'Migration 132')
) as w(label, hint)
left join pg_type t on t.typname = 'finance_payment_method'
left join pg_enum e on e.enumtypid = t.oid and e.enumlabel = w.label
order by e.enumsortorder nulls last;

-- ============================================================================
-- ۳) وضعیت RLS روی جدول‌های مالی (اطلاعی)
-- ============================================================================
select
  c.relname as "جدول",
  case when c.relrowsecurity then 'فعال' else 'خاموش' end as "RLS"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'finance%'
order by 1;

-- ============================================================================
-- ۴) تازه‌سازی کش Schema پستگریست (بدون اثر جانبی؛ اجرای آن بی‌ضرر است)
-- ============================================================================
notify pgrst, 'reload schema';
