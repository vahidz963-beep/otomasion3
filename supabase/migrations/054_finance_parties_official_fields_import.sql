-- =====================================================================
-- 054_FINANCE_PARTIES_OFFICIAL_FIELDS_IMPORT
-- Adds official identity fields for finance parties/customers so invoices can
-- use them for official print output and Excel imports.
-- =====================================================================

alter table public.finance_parties
  add column if not exists registration_number text,
  add column if not exists postal_code text;

comment on column public.finance_parties.economic_code is 'کد اقتصادی شخص/شرکت برای فاکتور رسمی';
comment on column public.finance_parties.registration_number is 'شماره ثبت شرکت/شخص حقوقی برای فاکتور رسمی';
comment on column public.finance_parties.national_id is 'شناسه ملی برای فاکتور رسمی';
comment on column public.finance_parties.postal_code is 'کد پستی برای فاکتور رسمی';

notify pgrst, 'reload schema';
