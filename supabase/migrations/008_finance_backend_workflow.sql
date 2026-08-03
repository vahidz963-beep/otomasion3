-- =====================================================================
-- 008_FINANCE_BACKEND_WORKFLOW
-- Backend completion for finance/accounting workflows:
-- - Central numbering rules for all important documents
-- - Incoming/outgoing document registry
-- - Finance document history/timeline
-- - Convert proforma -> invoice
-- - Void/cancel documents with reason
-- - Create sales return invoice
-- - Print/PDF template settings
-- - Official / unofficial bank account usage
-- - Fiscal year + fiscal periods closing workflow
-- Depends on migrations 001..007.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) New supporting types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_numbering_reset_scope') then
    create type public.finance_numbering_reset_scope as enum ('never', 'yearly', 'monthly');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_io_type') then
    create type public.finance_io_type as enum ('incoming', 'outgoing');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_io_status') then
    create type public.finance_io_status as enum ('draft', 'registered', 'archived', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_bank_account_usage') then
    create type public.finance_bank_account_usage as enum ('official', 'unofficial', 'cash', 'other');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Central system settings for finance/accounting
-- ---------------------------------------------------------------------
insert into public.system_settings (key, value) values
  ('currency_display_unit', '"toman"'::jsonb),
  ('base_currency', '"IRR"'::jsonb),
  ('default_calendar', '"jalali"'::jsonb),
  ('default_vat_percent', '10'::jsonb),
  ('invoice_footer_fa', '"این فاکتور بدون مهر و امضای شرکت معتبر نیست."'::jsonb),
  ('finance_numbering_mode', '"central"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3) Official / unofficial accounts
-- ---------------------------------------------------------------------
alter table public.finance_bank_accounts
  add column if not exists account_usage public.finance_bank_account_usage not null default 'official';

insert into public.finance_bank_accounts (account_name, bank_name, currency, account_usage, opening_balance)
select 'حساب رسمی', 'بانک اصلی شرکت', 'IRR', 'official', 0
where not exists (
  select 1 from public.finance_bank_accounts where account_usage = 'official' and is_active
);

insert into public.finance_bank_accounts (account_name, bank_name, currency, account_usage, opening_balance)
select 'حساب غیررسمی', 'حساب داخلی شرکت', 'IRR', 'unofficial', 0
where not exists (
  select 1 from public.finance_bank_accounts where account_usage = 'unofficial' and is_active
);

create index if not exists idx_finance_bank_accounts_usage on public.finance_bank_accounts(account_usage, is_active);

-- ---------------------------------------------------------------------
-- 4) Central numbering engine
-- ---------------------------------------------------------------------
create table if not exists public.finance_numbering_rules (
  rule_key text primary key,
  label_fa text not null,
  label_en text,
  prefix text not null,
  reset_scope public.finance_numbering_reset_scope not null default 'yearly',
  padding int not null default 5 check (padding between 3 and 10),
  include_year boolean not null default true,
  separator text not null default '-',
  is_active boolean not null default true,
  is_editable boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_numbering_counters (
  rule_key text not null references public.finance_numbering_rules(rule_key) on delete cascade,
  period_key text not null,
  counter int not null default 0 check (counter >= 0),
  updated_at timestamptz not null default now(),
  primary key (rule_key, period_key)
);

drop trigger if exists trg_finance_numbering_rules_updated_at on public.finance_numbering_rules;
create trigger trg_finance_numbering_rules_updated_at
before update on public.finance_numbering_rules
for each row execute function public.set_updated_at();

insert into public.finance_numbering_rules (rule_key, label_fa, label_en, prefix, reset_scope, padding, include_year, is_editable) values
  ('order',            'سفارش اصلی',                  'Order',                 'ORD',    'yearly', 5, true, true),
  ('sales_proforma',   'پیش‌فاکتور فروش',             'Sales proforma',        'PF',     'yearly', 5, true, true),
  ('sales_invoice',    'فاکتور فروش',                 'Sales invoice',         'SI',     'yearly', 5, true, true),
  ('purchase_invoice', 'فاکتور خرید',                 'Purchase invoice',      'PI',     'yearly', 5, true, true),
  ('expense_invoice',  'سند هزینه',                   'Expense invoice',       'EX',     'yearly', 5, true, true),
  ('sales_return',     'فاکتور برگشتی فروش',          'Sales return',          'SR',     'yearly', 5, true, true),
  ('purchase_return',  'برگشت از خرید',               'Purchase return',       'PR',     'yearly', 5, true, true),
  ('incoming_doc',     'سند / نامه ورودی',             'Incoming document',     'IN',     'yearly', 5, true, true),
  ('outgoing_doc',     'سند / نامه خروجی',             'Outgoing document',     'OUT',    'yearly', 5, true, true),
  ('warehouse_in',     'حواله ورود انبار',             'Warehouse receipt',     'WH-IN',  'yearly', 5, true, true),
  ('warehouse_out',    'حواله خروج انبار',             'Warehouse issue',       'WH-OUT', 'yearly', 5, true, true),
  ('receipt',          'رسید دریافت',                 'Receipt',               'RC',     'yearly', 5, true, true),
  ('payment',          'سند پرداخت',                  'Payment',               'PY',     'yearly', 5, true, true),
  ('check_received',   'کد داخلی چک دریافتی',          'Received check code',   'CHR',    'yearly', 5, true, true),
  ('check_issued',     'کد داخلی چک پرداختی',          'Issued check code',     'CHI',    'yearly', 5, true, true),
  ('journal',          'سند حسابداری',                'Journal entry',         'JE',     'yearly', 5, true, true),
  ('referral',         'ارجاع بین واحدها',             'Referral',              'REF',    'yearly', 5, true, true),
  ('internal_request', 'درخواست داخلی',                'Internal request',      'REQ',    'yearly', 5, true, true),
  ('production',       'سفارش تولید',                 'Production order',      'PRD',    'yearly', 5, true, true),
  ('rnd',              'پروژه R&D',                   'R&D project',           'RND',    'yearly', 5, true, true)
on conflict (rule_key) do update set
  label_fa = excluded.label_fa,
  label_en = excluded.label_en,
  prefix = excluded.prefix,
  reset_scope = excluded.reset_scope,
  padding = excluded.padding,
  include_year = excluded.include_year,
  is_active = true,
  updated_at = now();

create or replace function public.fn_next_document_number(p_rule_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.finance_numbering_rules%rowtype;
  v_period_key text;
  v_counter int;
  v_year text := to_char(now(), 'YYYY');
begin
  select * into v_rule
  from public.finance_numbering_rules
  where rule_key = p_rule_key and is_active
  for update;

  if not found then
    raise exception 'Numbering rule not found: %', p_rule_key;
  end if;

  v_period_key := case v_rule.reset_scope
    when 'monthly' then to_char(now(), 'YYYYMM')
    when 'yearly' then to_char(now(), 'YYYY')
    else 'global'
  end;

  insert into public.finance_numbering_counters (rule_key, period_key, counter, updated_at)
  values (p_rule_key, v_period_key, 1, now())
  on conflict (rule_key, period_key) do update
    set counter = public.finance_numbering_counters.counter + 1,
        updated_at = now()
  returning counter into v_counter;

  return v_rule.prefix
    || v_rule.separator
    || case when v_rule.include_year then v_year || v_rule.separator else '' end
    || lpad(v_counter::text, v_rule.padding, '0');
end;
$$;

-- Helper: map finance document types to central numbering rules.
create or replace function public.fn_finance_document_numbering_key(p_type public.finance_document_type)
returns text
language sql
immutable
as $$
  select case p_type
    when 'sales_proforma' then 'sales_proforma'
    when 'sales_invoice' then 'sales_invoice'
    when 'purchase_invoice' then 'purchase_invoice'
    when 'expense_invoice' then 'expense_invoice'
    when 'sales_return' then 'sales_return'
    when 'purchase_return' then 'purchase_return'
    when 'credit_note' then 'sales_return'
    when 'debit_note' then 'sales_invoice'
    when 'opening_balance' then 'journal'
    else 'journal'
  end;
$$;

-- ---------------------------------------------------------------------
-- 5) Override existing code generators to use the central numbering engine
-- ---------------------------------------------------------------------
create or replace function public.fn_generate_order_code()
returns trigger
language plpgsql
as $$
begin
  if new.order_code is null or new.order_code = '' then
    new.order_code := public.fn_next_document_number('order');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_quotation_code()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_code is null or new.quotation_code = '' then
    new.quotation_code := public.fn_next_document_number('sales_proforma');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_finance_document_number()
returns trigger
language plpgsql
as $$
begin
  if new.doc_number is null or new.doc_number = '' then
    new.doc_number := public.fn_next_document_number(public.fn_finance_document_numbering_key(new.document_type));
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_finance_payment_number()
returns trigger
language plpgsql
as $$
begin
  if new.payment_number is null or new.payment_number = '' then
    new.payment_number := public.fn_next_document_number(
      case when new.direction = 'receipt' then 'receipt' else 'payment' end
    );
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_finance_journal_number()
returns trigger
language plpgsql
as $$
begin
  if new.entry_number is null or new.entry_number = '' then
    new.entry_number := public.fn_next_document_number('journal');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_internal_request_code()
returns trigger
language plpgsql
as $$
begin
  if new.request_code is null or new.request_code = '' then
    new.request_code := public.fn_next_document_number('internal_request');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_automation_referral_number()
returns trigger
language plpgsql
as $$
begin
  if new.referral_number is null or new.referral_number = '' then
    new.referral_number := public.fn_next_document_number('referral');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_production_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.fn_next_document_number('production');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_rnd_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.fn_next_document_number('rnd');
  end if;
  return new;
end;
$$;

-- Internal system code for checks. This is separate from the physical bank check number.
alter table public.finance_checks
  add column if not exists internal_check_code text unique;

create or replace function public.fn_generate_finance_check_internal_code()
returns trigger
language plpgsql
as $$
begin
  if new.internal_check_code is null or new.internal_check_code = '' then
    new.internal_check_code := public.fn_next_document_number(
      case when new.check_type = 'received' then 'check_received' else 'check_issued' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_check_internal_code on public.finance_checks;
create trigger trg_generate_finance_check_internal_code
before insert on public.finance_checks
for each row execute function public.fn_generate_finance_check_internal_code();

-- ---------------------------------------------------------------------
-- 6) Finance document metadata, history/timeline, print settings
-- ---------------------------------------------------------------------
alter table public.finance_documents
  add column if not exists converted_from_document_id uuid references public.finance_documents(id),
  add column if not exists is_official boolean not null default true,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists print_note text;

create index if not exists idx_finance_documents_converted_from on public.finance_documents(converted_from_document_id);

create table if not exists public.finance_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.finance_documents(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'status_changed', 'approved', 'payment_registered',
    'converted_to_invoice', 'voided', 'return_created', 'printed', 'note'
  )),
  description text not null,
  old_status public.finance_document_status,
  new_status public.finance_document_status,
  actor_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_document_events_document on public.finance_document_events(document_id, created_at desc);

create or replace function public.fn_log_finance_document_event(
  p_document_id uuid,
  p_event_type text,
  p_description text,
  p_old_status public.finance_document_status default null,
  p_new_status public.finance_document_status default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.finance_document_events (
    document_id, event_type, description, old_status, new_status, actor_id, metadata
  ) values (
    p_document_id, p_event_type, p_description, p_old_status, p_new_status, auth.uid(), coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.fn_finance_document_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_log_finance_document_event(new.id, 'created', 'سند مالی ایجاد شد', null, new.status);
    return new;
  end if;

  if old.status is distinct from new.status then
    perform public.fn_log_finance_document_event(
      new.id,
      'status_changed',
      'وضعیت سند از ' || old.status::text || ' به ' || new.status::text || ' تغییر کرد',
      old.status,
      new.status
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_finance_document_events_insert on public.finance_documents;
create trigger trg_finance_document_events_insert
after insert on public.finance_documents
for each row execute function public.fn_finance_document_event_trigger();

drop trigger if exists trg_finance_document_events_update on public.finance_documents;
create trigger trg_finance_document_events_update
after update of status on public.finance_documents
for each row execute function public.fn_finance_document_event_trigger();

create table if not exists public.finance_print_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  title_fa text not null,
  title_en text,
  template_type text not null check (template_type in ('invoice', 'proforma', 'receipt', 'payment', 'party_statement', 'check', 'fiscal_report')),
  is_default boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_finance_print_templates_updated_at on public.finance_print_templates;
create trigger trg_finance_print_templates_updated_at
before update on public.finance_print_templates
for each row execute function public.set_updated_at();

insert into public.finance_print_templates (template_key, title_fa, title_en, template_type, is_default, settings) values
  ('default_invoice_fa', 'قالب پیش‌فرض فاکتور', 'Default invoice', 'invoice', true, '{"paper":"A4","language":"fa","show_signature":true,"show_stamp":true}'::jsonb),
  ('default_party_statement_fa', 'قالب صورت‌حساب شخص', 'Default party statement', 'party_statement', true, '{"paper":"A4","language":"fa"}'::jsonb),
  ('default_receipt_fa', 'قالب رسید دریافت', 'Default receipt', 'receipt', true, '{"paper":"A5","language":"fa"}'::jsonb)
on conflict (template_key) do nothing;

-- ---------------------------------------------------------------------
-- 7) Incoming / outgoing document registry
-- ---------------------------------------------------------------------
create table if not exists public.finance_io_documents (
  id uuid primary key default gen_random_uuid(),
  io_number text unique not null,
  io_type public.finance_io_type not null,
  status public.finance_io_status not null default 'registered',
  title_fa text not null,
  title_en text,
  body text,
  source_module text check (source_module in ('orders','sales','rnd','production','warehouse','accounting','admin','manual')) default 'manual',
  target_module text check (target_module in ('orders','sales','rnd','production','warehouse','accounting','admin','manual')),
  party_id uuid references public.finance_parties(id),
  related_order_id uuid references public.orders(id) on delete set null,
  related_document_id uuid references public.finance_documents(id) on delete set null,
  source_record_id uuid,
  attachment_url text,
  registered_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_io_documents_type on public.finance_io_documents(io_type, status, registered_at desc);
create index if not exists idx_finance_io_documents_order on public.finance_io_documents(related_order_id);
create index if not exists idx_finance_io_documents_document on public.finance_io_documents(related_document_id);

drop trigger if exists trg_finance_io_documents_updated_at on public.finance_io_documents;
create trigger trg_finance_io_documents_updated_at
before update on public.finance_io_documents
for each row execute function public.set_updated_at();

create or replace function public.fn_generate_finance_io_number()
returns trigger
language plpgsql
as $$
begin
  if new.io_number is null or new.io_number = '' then
    new.io_number := public.fn_next_document_number(
      case when new.io_type = 'incoming' then 'incoming_doc' else 'outgoing_doc' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_io_number on public.finance_io_documents;
create trigger trg_generate_finance_io_number
before insert on public.finance_io_documents
for each row execute function public.fn_generate_finance_io_number();

-- ---------------------------------------------------------------------
-- 8) Fiscal periods and annual closing workflow
-- ---------------------------------------------------------------------
alter table public.finance_fiscal_years
  add column if not exists opening_entry_id uuid references public.finance_journal_entries(id),
  add column if not exists closing_entry_id uuid references public.finance_journal_entries(id),
  add column if not exists closed_by uuid references public.profiles(id),
  add column if not exists closed_at timestamptz;

create table if not exists public.finance_fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.finance_fiscal_years(id) on delete cascade,
  period_no int not null check (period_no between 1 and 12),
  title_fa text not null,
  title_en text,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (fiscal_year_id, period_no),
  check (end_date >= start_date)
);

create index if not exists idx_finance_fiscal_periods_year on public.finance_fiscal_periods(fiscal_year_id, period_no);

create or replace function public.fn_create_fiscal_periods(p_fiscal_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year public.finance_fiscal_years%rowtype;
  v_i int;
  v_start date;
  v_end date;
  v_title text[] := array['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
begin
  select * into v_year from public.finance_fiscal_years where id = p_fiscal_year_id;
  if not found then
    raise exception 'Fiscal year not found';
  end if;

  for v_i in 1..12 loop
    v_start := (v_year.start_date + ((v_i - 1) || ' month')::interval)::date;
    v_end := least(((v_year.start_date + (v_i || ' month')::interval)::date - 1), v_year.end_date);

    insert into public.finance_fiscal_periods (fiscal_year_id, period_no, title_fa, start_date, end_date)
    values (p_fiscal_year_id, v_i, v_title[v_i], v_start, v_end)
    on conflict (fiscal_year_id, period_no) do nothing;
  end loop;
end;
$$;

insert into public.finance_fiscal_years (title, start_date, end_date)
select 'سال مالی ۱۴۰۵', '2026-03-21'::date, '2027-03-20'::date
where not exists (
  select 1 from public.finance_fiscal_years where start_date = '2026-03-21'::date and end_date = '2027-03-20'::date
);

do $$
declare
  v_year_id uuid;
begin
  select id into v_year_id
  from public.finance_fiscal_years
  where start_date = '2026-03-21'::date and end_date = '2027-03-20'::date
  limit 1;

  if v_year_id is not null then
    perform public.fn_create_fiscal_periods(v_year_id);
  end if;
end $$;

create or replace function public.fn_close_fiscal_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can close fiscal periods';
  end if;

  update public.finance_fiscal_periods
  set is_closed = true,
      closed_by = auth.uid(),
      closed_at = now()
  where id = p_period_id;
end;
$$;

create or replace function public.fn_reopen_fiscal_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Only admin can reopen fiscal periods';
  end if;

  update public.finance_fiscal_periods
  set is_closed = false,
      closed_by = null,
      closed_at = null
  where id = p_period_id;
end;
$$;

create or replace function public.fn_close_fiscal_year(p_fiscal_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can close fiscal years';
  end if;

  update public.finance_fiscal_periods
  set is_closed = true,
      closed_by = auth.uid(),
      closed_at = coalesce(closed_at, now())
  where fiscal_year_id = p_fiscal_year_id;

  update public.finance_fiscal_years
  set is_closed = true,
      closed_by = auth.uid(),
      closed_at = now()
  where id = p_fiscal_year_id;
end;
$$;

create or replace function public.fn_reopen_fiscal_year(p_fiscal_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Only admin can reopen fiscal years';
  end if;

  update public.finance_fiscal_years
  set is_closed = false,
      closed_by = null,
      closed_at = null
  where id = p_fiscal_year_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) Business workflow functions: conversion, void, return
-- ---------------------------------------------------------------------
create or replace function public.fn_convert_finance_proforma_to_invoice(p_proforma_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.finance_documents%rowtype;
  v_invoice_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Only sales/accountant/admin can convert proformas';
  end if;

  select * into v_src
  from public.finance_documents
  where id = p_proforma_id
  for update;

  if not found then
    raise exception 'Proforma not found';
  end if;

  if v_src.document_type <> 'sales_proforma' then
    raise exception 'Only sales proforma can be converted';
  end if;

  if v_src.status in ('cancelled','void') then
    raise exception 'Cancelled/void proforma cannot be converted';
  end if;

  select id into v_invoice_id
  from public.finance_documents
  where converted_from_document_id = p_proforma_id
    and document_type = 'sales_invoice'
    and status <> 'void'
  limit 1;

  if v_invoice_id is not null then
    return v_invoice_id;
  end if;

  insert into public.finance_documents (
    doc_number,
    document_type,
    status,
    party_id,
    related_order_id,
    related_quotation_id,
    related_rnd_project_id,
    related_production_order_id,
    source_module,
    source_record_id,
    issue_date,
    due_date,
    currency,
    exchange_rate,
    description,
    discount_amount,
    is_official,
    converted_from_document_id,
    created_by
  ) values (
    null,
    'sales_invoice',
    'draft',
    v_src.party_id,
    v_src.related_order_id,
    v_src.related_quotation_id,
    v_src.related_rnd_project_id,
    v_src.related_production_order_id,
    v_src.source_module,
    v_src.source_record_id,
    current_date,
    v_src.due_date,
    v_src.currency,
    v_src.exchange_rate,
    'تبدیل‌شده از پیش‌فاکتور ' || v_src.doc_number,
    v_src.discount_amount,
    v_src.is_official,
    p_proforma_id,
    auth.uid()
  ) returning id into v_invoice_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  )
  select
    v_invoice_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  from public.finance_document_items
  where document_id = p_proforma_id
  order by line_no;

  perform public.fn_finance_recalculate_document_totals(v_invoice_id);

  perform public.fn_log_finance_document_event(
    p_proforma_id,
    'converted_to_invoice',
    'پیش‌فاکتور به فاکتور فروش تبدیل شد',
    v_src.status,
    v_src.status,
    jsonb_build_object('invoice_id', v_invoice_id)
  );

  perform public.fn_log_finance_document_event(
    v_invoice_id,
    'converted_to_invoice',
    'فاکتور از پیش‌فاکتور ' || v_src.doc_number || ' ساخته شد',
    null,
    'draft',
    jsonb_build_object('proforma_id', p_proforma_id)
  );

  return v_invoice_id;
end;
$$;

create or replace function public.fn_void_finance_document(
  p_document_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status public.finance_document_status;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can void finance documents';
  end if;

  select status into v_old_status
  from public.finance_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Finance document not found';
  end if;

  update public.finance_documents
  set status = 'void',
      void_reason = p_reason,
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = p_document_id;

  perform public.fn_log_finance_document_event(
    p_document_id,
    'voided',
    'سند باطل شد: ' || coalesce(p_reason, ''),
    v_old_status,
    'void'
  );
end;
$$;

create or replace function public.fn_create_sales_return_from_invoice(
  p_invoice_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.finance_documents%rowtype;
  v_return_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can create sales returns';
  end if;

  select * into v_src
  from public.finance_documents
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Sales invoice not found';
  end if;

  if v_src.document_type <> 'sales_invoice' then
    raise exception 'Only sales invoice can have a sales return';
  end if;

  insert into public.finance_documents (
    doc_number,
    document_type,
    status,
    party_id,
    related_order_id,
    related_quotation_id,
    related_rnd_project_id,
    related_production_order_id,
    source_module,
    source_record_id,
    issue_date,
    due_date,
    currency,
    exchange_rate,
    description,
    discount_amount,
    is_official,
    converted_from_document_id,
    created_by
  ) values (
    null,
    'sales_return',
    'approved',
    v_src.party_id,
    v_src.related_order_id,
    v_src.related_quotation_id,
    v_src.related_rnd_project_id,
    v_src.related_production_order_id,
    v_src.source_module,
    v_src.source_record_id,
    current_date,
    current_date,
    v_src.currency,
    v_src.exchange_rate,
    'فاکتور برگشتی بابت ' || v_src.doc_number || ' - ' || coalesce(p_reason, ''),
    0,
    v_src.is_official,
    p_invoice_id,
    auth.uid()
  ) returning id into v_return_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  )
  select
    v_return_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  from public.finance_document_items
  where document_id = p_invoice_id
  order by line_no;

  perform public.fn_finance_recalculate_document_totals(v_return_id);

  perform public.fn_log_finance_document_event(
    p_invoice_id,
    'return_created',
    'فاکتور برگشتی ایجاد شد',
    v_src.status,
    v_src.status,
    jsonb_build_object('return_id', v_return_id, 'reason', p_reason)
  );

  perform public.fn_log_finance_document_event(
    v_return_id,
    'return_created',
    'فاکتور برگشتی از فاکتور ' || v_src.doc_number || ' ساخته شد',
    null,
    'approved',
    jsonb_build_object('source_invoice_id', p_invoice_id, 'reason', p_reason)
  );

  return v_return_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) Views for UI/reporting
-- ---------------------------------------------------------------------
create or replace view public.v_finance_document_timeline
with (security_invoker = true)
as
select
  e.id,
  e.document_id,
  d.doc_number,
  e.event_type,
  e.description,
  e.old_status,
  e.new_status,
  p.full_name as actor_name,
  e.metadata,
  e.created_at
from public.finance_document_events e
join public.finance_documents d on d.id = e.document_id
left join public.profiles p on p.id = e.actor_id;

create or replace view public.v_finance_numbering_overview
with (security_invoker = true)
as
select
  r.rule_key,
  r.label_fa,
  r.label_en,
  r.prefix,
  r.reset_scope,
  r.padding,
  r.include_year,
  r.separator,
  coalesce(c.period_key,
    case r.reset_scope
      when 'monthly' then to_char(now(), 'YYYYMM')
      when 'yearly' then to_char(now(), 'YYYY')
      else 'global'
    end
  ) as period_key,
  coalesce(c.counter, 0) as current_counter,
  r.prefix || r.separator ||
    case when r.include_year then to_char(now(), 'YYYY') || r.separator else '' end ||
    lpad((coalesce(c.counter, 0) + 1)::text, r.padding, '0') as next_number_preview,
  r.is_active
from public.finance_numbering_rules r
left join public.finance_numbering_counters c
  on c.rule_key = r.rule_key
 and c.period_key = case r.reset_scope
      when 'monthly' then to_char(now(), 'YYYYMM')
      when 'yearly' then to_char(now(), 'YYYY')
      else 'global'
    end;

-- ---------------------------------------------------------------------
-- 11) RLS
-- ---------------------------------------------------------------------
alter table public.finance_numbering_rules enable row level security;
alter table public.finance_numbering_counters enable row level security;
alter table public.finance_document_events enable row level security;
alter table public.finance_print_templates enable row level security;
alter table public.finance_io_documents enable row level security;
alter table public.finance_fiscal_periods enable row level security;

drop policy if exists finance_numbering_rules_read on public.finance_numbering_rules;
create policy finance_numbering_rules_read on public.finance_numbering_rules
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_numbering_rules_write on public.finance_numbering_rules;
create policy finance_numbering_rules_write on public.finance_numbering_rules
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists finance_numbering_counters_read on public.finance_numbering_counters;
create policy finance_numbering_counters_read on public.finance_numbering_counters
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_numbering_counters_write on public.finance_numbering_counters;
create policy finance_numbering_counters_write on public.finance_numbering_counters
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists finance_document_events_select on public.finance_document_events;
create policy finance_document_events_select on public.finance_document_events
for select using (public.fn_user_can_access_finance_document(document_id));

drop policy if exists finance_document_events_insert on public.finance_document_events;
create policy finance_document_events_insert on public.finance_document_events
for insert with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_print_templates_read on public.finance_print_templates;
create policy finance_print_templates_read on public.finance_print_templates
for select using (public.has_role(array['admin','accountant','sales']));

drop policy if exists finance_print_templates_write on public.finance_print_templates;
create policy finance_print_templates_write on public.finance_print_templates
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_io_documents_select on public.finance_io_documents;
create policy finance_io_documents_select on public.finance_io_documents
for select using (public.is_active_user());

drop policy if exists finance_io_documents_write on public.finance_io_documents;
create policy finance_io_documents_write on public.finance_io_documents
for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists finance_fiscal_periods_select on public.finance_fiscal_periods;
create policy finance_fiscal_periods_select on public.finance_fiscal_periods
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_fiscal_periods_write on public.finance_fiscal_periods;
create policy finance_fiscal_periods_write on public.finance_fiscal_periods
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));
