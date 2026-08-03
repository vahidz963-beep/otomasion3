-- =====================================================================
-- 007_ACCOUNTING_FINANCE
-- Professional-but-simple finance/accounting module for Otomasion2.
-- Inspired by common Iranian accounting workflows: invoices/proformas,
-- purchases, receipts/payments, checks, party statements, profit/loss,
-- aging, and cross-module referrals.
-- Depends on: 001..006 migrations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_party_type') then
    create type public.finance_party_type as enum ('customer','supplier','employee','shareholder','other');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_account_type') then
    create type public.finance_account_type as enum ('asset','liability','equity','revenue','expense','cost_of_goods_sold');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_document_type') then
    create type public.finance_document_type as enum (
      'sales_proforma',
      'sales_invoice',
      'purchase_invoice',
      'sales_return',
      'purchase_return',
      'expense_invoice',
      'credit_note',
      'debit_note',
      'opening_balance'
    );
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_document_status') then
    create type public.finance_document_status as enum ('draft','pending_approval','approved','sent','partially_paid','paid','cancelled','void');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_payment_direction') then
    create type public.finance_payment_direction as enum ('receipt','payment');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_payment_method') then
    create type public.finance_payment_method as enum ('cash','bank_transfer','card','pos','check','offset','other');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_payment_status') then
    create type public.finance_payment_status as enum ('draft','confirmed','cancelled','void');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_check_type') then
    create type public.finance_check_type as enum ('received','issued');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_check_status') then
    create type public.finance_check_status as enum ('in_hand','deposited','cleared','returned','spent','issued','cancelled','void');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'finance_journal_status') then
    create type public.finance_journal_status as enum ('draft','posted','void');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'automation_referral_status') then
    create type public.automation_referral_status as enum ('open','in_progress','answered','done','cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Fiscal years and chart of accounts
-- ---------------------------------------------------------------------
create table if not exists public.finance_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_fa text not null,
  name_en text,
  account_type public.finance_account_type not null,
  parent_id uuid references public.finance_accounts(id),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_accounts_type on public.finance_accounts(account_type);
create index if not exists idx_finance_accounts_parent on public.finance_accounts(parent_id);

insert into public.finance_accounts (code, name_fa, name_en, account_type, is_system) values
  ('1000', 'صندوق', 'Cash', 'asset', true),
  ('1010', 'بانک', 'Bank', 'asset', true),
  ('1100', 'حساب‌های دریافتنی', 'Accounts Receivable', 'asset', true),
  ('1120', 'اسناد دریافتنی / چک‌های دریافتی', 'Checks Receivable', 'asset', true),
  ('1200', 'موجودی کالا', 'Inventory', 'asset', true),
  ('1300', 'مالیات ارزش افزوده دریافتنی', 'VAT Receivable', 'asset', true),
  ('2000', 'حساب‌های پرداختنی', 'Accounts Payable', 'liability', true),
  ('2020', 'اسناد پرداختنی / چک‌های پرداختی', 'Checks Payable', 'liability', true),
  ('2100', 'مالیات ارزش افزوده پرداختنی', 'VAT Payable', 'liability', true),
  ('3000', 'سرمایه / افتتاحیه', 'Equity / Opening', 'equity', true),
  ('4000', 'درآمد فروش', 'Sales Revenue', 'revenue', true),
  ('4100', 'برگشت از فروش و تخفیفات', 'Sales Returns and Allowances', 'revenue', true),
  ('5000', 'بهای تمام‌شده / خرید', 'COGS / Purchases', 'cost_of_goods_sold', true),
  ('6000', 'هزینه‌های عمومی', 'General Expenses', 'expense', true),
  ('6100', 'هزینه تولید', 'Production Expenses', 'expense', true),
  ('6200', 'هزینه R&D', 'R&D Expenses', 'expense', true),
  ('6300', 'هزینه اداری', 'Office Expenses', 'expense', true)
on conflict (code) do update set
  name_fa = excluded.name_fa,
  name_en = excluded.name_en,
  account_type = excluded.account_type,
  is_system = true;

create or replace function public.fn_finance_account_id(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.finance_accounts where code = p_code;
$$;

-- ---------------------------------------------------------------------
-- 3) Parties / contacts
--    A party can be a customer, supplier, employee, shareholder, or any person.
-- ---------------------------------------------------------------------
create table if not exists public.finance_parties (
  id uuid primary key default gen_random_uuid(),
  party_type public.finance_party_type not null default 'customer',
  display_name text not null,
  display_name_en text,
  linked_customer_id uuid references public.customers(id) on delete set null,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  phone text,
  email text,
  address text,
  national_id text,
  economic_code text,
  credit_limit numeric not null default 0,
  opening_balance numeric not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_finance_parties_customer on public.finance_parties(linked_customer_id) where linked_customer_id is not null;
create unique index if not exists uq_finance_parties_profile on public.finance_parties(linked_profile_id) where linked_profile_id is not null;
create index if not exists idx_finance_parties_name on public.finance_parties(display_name);
create index if not exists idx_finance_parties_type on public.finance_parties(party_type);

drop trigger if exists trg_finance_parties_updated_at on public.finance_parties;
create trigger trg_finance_parties_updated_at
before update on public.finance_parties
for each row execute function public.set_updated_at();

create or replace function public.fn_finance_party_for_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_party_id uuid;
begin
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Customer not found';
  end if;

  insert into public.finance_parties (
    party_type,
    display_name,
    linked_customer_id,
    phone,
    email,
    address,
    created_by
  ) values (
    'customer',
    v_customer.company_name,
    v_customer.id,
    v_customer.contact_phone,
    v_customer.contact_email,
    v_customer.address,
    auth.uid()
  )
  on conflict (linked_customer_id) do update set
    display_name = excluded.display_name,
    phone = excluded.phone,
    email = excluded.email,
    address = excluded.address,
    updated_at = now()
  returning id into v_party_id;

  return v_party_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Cost centers and expense categories
-- ---------------------------------------------------------------------
create table if not exists public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_fa text not null,
  name_en text,
  module text check (module in ('orders','rnd','production','warehouse','accounting','admin','general')) default 'general',
  related_order_id uuid references public.orders(id) on delete set null,
  related_rnd_project_id uuid references public.rnd_projects(id) on delete set null,
  related_production_order_id uuid references public.production_orders(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.finance_cost_centers (code, name_fa, name_en, module) values
  ('GEN', 'عمومی', 'General', 'general'),
  ('SALES', 'فروش', 'Sales', 'orders'),
  ('RND', 'تحقیق و توسعه', 'R&D', 'rnd'),
  ('PROD', 'تولید', 'Production', 'production'),
  ('WH', 'انبار', 'Warehouse', 'warehouse'),
  ('ADMIN', 'اداری', 'Office/Admin', 'admin')
on conflict (code) do nothing;

create table if not exists public.finance_expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_fa text not null,
  name_en text,
  default_account_id uuid references public.finance_accounts(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.finance_expense_categories (code, name_fa, name_en, default_account_id) values
  ('GENERAL', 'هزینه عمومی', 'General expense', public.fn_finance_account_id('6000')),
  ('PRODUCTION', 'هزینه تولید', 'Production expense', public.fn_finance_account_id('6100')),
  ('RND', 'هزینه R&D', 'R&D expense', public.fn_finance_account_id('6200')),
  ('OFFICE', 'هزینه اداری', 'Office expense', public.fn_finance_account_id('6300')),
  ('PURCHASE', 'خرید / بهای تمام‌شده', 'Purchase / COGS', public.fn_finance_account_id('5000'))
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 5) Cash and bank
-- ---------------------------------------------------------------------
create table if not exists public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  bank_name text,
  account_number text,
  iban text,
  card_number text,
  currency text not null default 'IRR',
  opening_balance numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_cashboxes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'IRR',
  opening_balance numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_finance_bank_accounts_updated_at on public.finance_bank_accounts;
create trigger trg_finance_bank_accounts_updated_at
before update on public.finance_bank_accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_cashboxes_updated_at on public.finance_cashboxes;
create trigger trg_finance_cashboxes_updated_at
before update on public.finance_cashboxes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6) Finance documents: invoices, proformas, purchases, returns, expenses
-- ---------------------------------------------------------------------
create table if not exists public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  doc_number text unique not null,
  document_type public.finance_document_type not null,
  status public.finance_document_status not null default 'draft',

  party_id uuid references public.finance_parties(id),

  related_order_id uuid references public.orders(id) on delete set null,
  related_quotation_id uuid references public.quotations(id) on delete set null,
  related_rnd_project_id uuid references public.rnd_projects(id) on delete set null,
  related_production_order_id uuid references public.production_orders(id) on delete set null,

  source_module text check (source_module in ('orders','sales','rnd','production','warehouse','accounting','manual')) default 'manual',
  source_record_id uuid,

  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'IRR',
  exchange_rate numeric not null default 1 check (exchange_rate > 0),

  description text,
  subtotal_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  total_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  balance_amount numeric generated always as (total_amount - paid_amount) stored,

  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (subtotal_amount >= 0),
  check (discount_amount >= 0),
  check (tax_amount >= 0),
  check (total_amount >= 0),
  check (paid_amount >= 0)
);

create index if not exists idx_finance_documents_party on public.finance_documents(party_id);
create index if not exists idx_finance_documents_type_status on public.finance_documents(document_type, status);
create index if not exists idx_finance_documents_order on public.finance_documents(related_order_id);
create index if not exists idx_finance_documents_due on public.finance_documents(due_date) where status in ('approved','sent','partially_paid');

create table if not exists public.finance_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.finance_documents(id) on delete cascade,
  line_no int not null default 1,
  item_type text not null default 'service' check (item_type in ('goods','service','expense','tax','discount','other')),
  description_fa text not null,
  description_en text,
  quantity numeric not null default 1 check (quantity > 0),
  unit text not null default 'عدد',
  unit_price numeric not null default 0 check (unit_price >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  tax_rate numeric not null default 0 check (tax_rate >= 0),
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,

  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  expense_category_id uuid references public.finance_expense_categories(id) on delete set null,
  cost_center_id uuid references public.finance_cost_centers(id) on delete set null,

  created_at timestamptz not null default now(),
  unique(document_id, line_no)
);

create index if not exists idx_finance_document_items_doc on public.finance_document_items(document_id);

create sequence if not exists public.finance_document_seq;

create or replace function public.fn_generate_finance_document_number()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.doc_number is null or new.doc_number = '' then
    v_prefix := case new.document_type
      when 'sales_proforma' then 'PF'
      when 'sales_invoice' then 'SI'
      when 'purchase_invoice' then 'PI'
      when 'sales_return' then 'SR'
      when 'purchase_return' then 'PR'
      when 'expense_invoice' then 'EX'
      when 'credit_note' then 'CN'
      when 'debit_note' then 'DN'
      when 'opening_balance' then 'OB'
      else 'FD'
    end;
    new.doc_number := v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.finance_document_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_document_number on public.finance_documents;
create trigger trg_generate_finance_document_number
before insert on public.finance_documents
for each row execute function public.fn_generate_finance_document_number();

drop trigger if exists trg_finance_documents_updated_at on public.finance_documents;
create trigger trg_finance_documents_updated_at
before update on public.finance_documents
for each row execute function public.set_updated_at();

create or replace function public.fn_finance_calculate_document_item()
returns trigger
language plpgsql
as $$
declare
  v_base numeric;
begin
  v_base := greatest((new.quantity * new.unit_price) - coalesce(new.discount_amount, 0), 0);
  new.tax_amount := round(v_base * coalesce(new.tax_rate, 0) / 100.0, 2);
  new.line_total := round(v_base + new.tax_amount, 2);
  return new;
end;
$$;

drop trigger if exists trg_finance_calculate_document_item on public.finance_document_items;
create trigger trg_finance_calculate_document_item
before insert or update on public.finance_document_items
for each row execute function public.fn_finance_calculate_document_item();

create or replace function public.fn_finance_recalculate_document_totals(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_tax numeric;
  v_discount numeric;
begin
  select
    coalesce(sum(greatest((quantity * unit_price) - discount_amount, 0)), 0),
    coalesce(sum(tax_amount), 0)
  into v_subtotal, v_tax
  from public.finance_document_items
  where document_id = p_document_id;

  select discount_amount into v_discount
  from public.finance_documents
  where id = p_document_id;

  update public.finance_documents
  set subtotal_amount = v_subtotal,
      tax_amount = v_tax,
      total_amount = greatest(v_subtotal - coalesce(v_discount, 0) + v_tax, 0),
      updated_at = now()
  where id = p_document_id;
end;
$$;

create or replace function public.fn_finance_recalculate_document_totals_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
begin
  v_doc_id := coalesce(new.document_id, old.document_id);
  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_finance_recalculate_document_totals on public.finance_document_items;
create trigger trg_finance_recalculate_document_totals
after insert or update or delete on public.finance_document_items
for each row execute function public.fn_finance_recalculate_document_totals_trigger();

-- ---------------------------------------------------------------------
-- 7) Payments, allocations, and checks
-- ---------------------------------------------------------------------
create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text unique not null,
  direction public.finance_payment_direction not null,
  method public.finance_payment_method not null default 'bank_transfer',
  status public.finance_payment_status not null default 'draft',
  party_id uuid references public.finance_parties(id),
  payment_date date not null default current_date,
  amount numeric not null check (amount > 0),
  currency text not null default 'IRR',
  bank_account_id uuid references public.finance_bank_accounts(id) on delete set null,
  cashbox_id uuid references public.finance_cashboxes(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  source_module text check (source_module in ('orders','sales','rnd','production','warehouse','accounting','manual')) default 'manual',
  source_record_id uuid,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.finance_payments(id) on delete cascade,
  document_id uuid not null references public.finance_documents(id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(payment_id, document_id)
);

create table if not exists public.finance_checks (
  id uuid primary key default gen_random_uuid(),
  check_type public.finance_check_type not null,
  status public.finance_check_status not null default 'in_hand',
  party_id uuid references public.finance_parties(id),
  related_payment_id uuid references public.finance_payments(id) on delete set null,
  check_number text not null,
  bank_name text,
  branch_name text,
  owner_name text,
  due_date date not null,
  amount numeric not null check (amount > 0),
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_payments_party on public.finance_payments(party_id);
create index if not exists idx_finance_payments_order on public.finance_payments(related_order_id);
create index if not exists idx_finance_payment_allocations_doc on public.finance_payment_allocations(document_id);
create index if not exists idx_finance_checks_due on public.finance_checks(due_date, status);
create index if not exists idx_finance_checks_party on public.finance_checks(party_id);

create sequence if not exists public.finance_payment_seq;

create or replace function public.fn_generate_finance_payment_number()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.payment_number is null or new.payment_number = '' then
    v_prefix := case when new.direction = 'receipt' then 'RC' else 'PY' end;
    new.payment_number := v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.finance_payment_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_payment_number on public.finance_payments;
create trigger trg_generate_finance_payment_number
before insert on public.finance_payments
for each row execute function public.fn_generate_finance_payment_number();

drop trigger if exists trg_finance_payments_updated_at on public.finance_payments;
create trigger trg_finance_payments_updated_at
before update on public.finance_payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_checks_updated_at on public.finance_checks;
create trigger trg_finance_checks_updated_at
before update on public.finance_checks
for each row execute function public.set_updated_at();

create or replace function public.fn_finance_update_document_paid_amount(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_total numeric;
  v_status public.finance_document_status;
begin
  select coalesce(sum(a.amount), 0)
  into v_paid
  from public.finance_payment_allocations a
  join public.finance_payments p on p.id = a.payment_id
  where a.document_id = p_document_id
    and p.status = 'confirmed';

  select total_amount, status into v_total, v_status
  from public.finance_documents
  where id = p_document_id;

  update public.finance_documents
  set paid_amount = least(coalesce(v_paid, 0), coalesce(v_total, 0)),
      status = case
        when v_status in ('cancelled','void','draft','pending_approval') then v_status
        when coalesce(v_paid, 0) <= 0 then v_status
        when coalesce(v_paid, 0) >= coalesce(v_total, 0) then 'paid'::public.finance_document_status
        else 'partially_paid'::public.finance_document_status
      end,
      updated_at = now()
  where id = p_document_id;
end;
$$;

create or replace function public.fn_finance_update_document_paid_amount_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
begin
  v_doc_id := coalesce(new.document_id, old.document_id);
  perform public.fn_finance_update_document_paid_amount(v_doc_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_finance_update_document_paid_amount on public.finance_payment_allocations;
create trigger trg_finance_update_document_paid_amount
after insert or update or delete on public.finance_payment_allocations
for each row execute function public.fn_finance_update_document_paid_amount_trigger();

-- ---------------------------------------------------------------------
-- 8) Journal entries: simple double-entry core
-- ---------------------------------------------------------------------
create table if not exists public.finance_journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text unique not null,
  status public.finance_journal_status not null default 'draft',
  entry_date date not null default current_date,
  description text,
  source_module text check (source_module in ('orders','sales','rnd','production','warehouse','accounting','manual')) default 'accounting',
  source_id uuid,
  related_document_id uuid references public.finance_documents(id) on delete set null,
  related_payment_id uuid references public.finance_payments(id) on delete set null,
  created_by uuid references public.profiles(id),
  posted_by uuid references public.profiles(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.finance_journal_entries(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id),
  party_id uuid references public.finance_parties(id),
  debit_amount numeric not null default 0 check (debit_amount >= 0),
  credit_amount numeric not null default 0 check (credit_amount >= 0),
  description text,
  cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0))
);

create index if not exists idx_finance_journal_entries_doc on public.finance_journal_entries(related_document_id);
create index if not exists idx_finance_journal_entries_payment on public.finance_journal_entries(related_payment_id);
create index if not exists idx_finance_journal_lines_entry on public.finance_journal_lines(entry_id);
create index if not exists idx_finance_journal_lines_account on public.finance_journal_lines(account_id);

create sequence if not exists public.finance_journal_seq;

create or replace function public.fn_generate_finance_journal_number()
returns trigger
language plpgsql
as $$
begin
  if new.entry_number is null or new.entry_number = '' then
    new.entry_number := 'JE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.finance_journal_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_journal_number on public.finance_journal_entries;
create trigger trg_generate_finance_journal_number
before insert on public.finance_journal_entries
for each row execute function public.fn_generate_finance_journal_number();

drop trigger if exists trg_finance_journal_entries_updated_at on public.finance_journal_entries;
create trigger trg_finance_journal_entries_updated_at
before update on public.finance_journal_entries
for each row execute function public.set_updated_at();

create or replace function public.fn_finance_assert_journal_balanced(p_entry_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
begin
  select coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
  into v_debit, v_credit
  from public.finance_journal_lines
  where entry_id = p_entry_id;
  return round(v_debit, 2) = round(v_credit, 2) and v_debit > 0;
end;
$$;

create or replace function public.fn_post_finance_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_entry_id uuid;
  v_revenue_or_cost numeric;
  v_tax numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can post finance documents';
  end if;

  select * into v_doc from public.finance_documents where id = p_document_id for update;
  if not found then
    raise exception 'Finance document not found';
  end if;
  if v_doc.document_type = 'sales_proforma' then
    raise exception 'Sales proforma has no accounting journal';
  end if;
  if v_doc.status in ('cancelled','void') then
    raise exception 'Cancelled/void document cannot be posted';
  end if;

  if exists (select 1 from public.finance_journal_entries where related_document_id = p_document_id and status = 'posted') then
    return (select id from public.finance_journal_entries where related_document_id = p_document_id and status = 'posted' limit 1);
  end if;

  v_tax := coalesce(v_doc.tax_amount, 0);
  v_revenue_or_cost := greatest(coalesce(v_doc.total_amount, 0) - v_tax, 0);

  insert into public.finance_journal_entries (
    entry_date, description, source_module, source_id, related_document_id, created_by, status, posted_by, posted_at
  ) values (
    v_doc.issue_date,
    'ثبت سند مالی برای ' || v_doc.doc_number,
    coalesce(v_doc.source_module, 'accounting'),
    v_doc.id,
    v_doc.id,
    coalesce(v_doc.created_by, auth.uid()),
    'posted',
    auth.uid(),
    now()
  ) returning id into v_entry_id;

  if v_doc.document_type in ('sales_invoice','debit_note') then
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('1100'), v_doc.party_id, v_doc.total_amount, 'بدهکار شخص / فروش', v_doc.related_order_id);

    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('4000'), v_doc.party_id, v_revenue_or_cost, 'درآمد فروش', v_doc.related_order_id);

    if v_tax > 0 then
      insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
      values (v_entry_id, public.fn_finance_account_id('2100'), v_doc.party_id, v_tax, 'مالیات ارزش افزوده فروش', v_doc.related_order_id);
    end if;

  elsif v_doc.document_type in ('purchase_invoice','expense_invoice') then
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (
      v_entry_id,
      case when v_doc.document_type = 'purchase_invoice' then public.fn_finance_account_id('5000') else public.fn_finance_account_id('6000') end,
      v_doc.party_id,
      v_revenue_or_cost,
      'خرید / هزینه',
      v_doc.related_order_id
    );

    if v_tax > 0 then
      insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
      values (v_entry_id, public.fn_finance_account_id('1300'), v_doc.party_id, v_tax, 'مالیات ارزش افزوده خرید', v_doc.related_order_id);
    end if;

    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('2000'), v_doc.party_id, v_doc.total_amount, 'بستانکار شخص / خرید', v_doc.related_order_id);

  elsif v_doc.document_type in ('sales_return','credit_note') then
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('4100'), v_doc.party_id, v_revenue_or_cost, 'برگشت از فروش / اعتبار', v_doc.related_order_id);
    if v_tax > 0 then
      insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
      values (v_entry_id, public.fn_finance_account_id('2100'), v_doc.party_id, v_tax, 'کاهش مالیات فروش', v_doc.related_order_id);
    end if;
    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('1100'), v_doc.party_id, v_doc.total_amount, 'کاهش دریافتنی', v_doc.related_order_id);

  elsif v_doc.document_type = 'purchase_return' then
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('2000'), v_doc.party_id, v_doc.total_amount, 'کاهش پرداختنی', v_doc.related_order_id);
    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('5000'), v_doc.party_id, v_revenue_or_cost, 'برگشت از خرید', v_doc.related_order_id);
    if v_tax > 0 then
      insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
      values (v_entry_id, public.fn_finance_account_id('1300'), v_doc.party_id, v_tax, 'کاهش مالیات خرید', v_doc.related_order_id);
    end if;
  end if;

  if not public.fn_finance_assert_journal_balanced(v_entry_id) then
    raise exception 'Journal entry is not balanced';
  end if;

  update public.finance_documents
  set status = case when status in ('draft','pending_approval') then 'approved'::public.finance_document_status else status end,
      approved_by = coalesce(approved_by, auth.uid()),
      approved_at = coalesce(approved_at, now()),
      updated_at = now()
  where id = p_document_id;

  return v_entry_id;
end;
$$;

create or replace function public.fn_post_finance_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.finance_payments%rowtype;
  v_entry_id uuid;
  v_cash_account uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can post finance payments';
  end if;

  select * into v_payment from public.finance_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Finance payment not found';
  end if;
  if v_payment.status = 'cancelled' or v_payment.status = 'void' then
    raise exception 'Cancelled/void payment cannot be posted';
  end if;

  if exists (select 1 from public.finance_journal_entries where related_payment_id = p_payment_id and status = 'posted') then
    return (select id from public.finance_journal_entries where related_payment_id = p_payment_id and status = 'posted' limit 1);
  end if;

  v_cash_account := case
    when v_payment.method = 'cash' then public.fn_finance_account_id('1000')
    when v_payment.method = 'check' and v_payment.direction = 'receipt' then public.fn_finance_account_id('1120')
    when v_payment.method = 'check' and v_payment.direction = 'payment' then public.fn_finance_account_id('2020')
    else public.fn_finance_account_id('1010')
  end;

  insert into public.finance_journal_entries (
    entry_date, description, source_module, source_id, related_payment_id, created_by, status, posted_by, posted_at
  ) values (
    v_payment.payment_date,
    'ثبت دریافت/پرداخت ' || v_payment.payment_number,
    coalesce(v_payment.source_module, 'accounting'),
    v_payment.id,
    v_payment.id,
    coalesce(v_payment.created_by, auth.uid()),
    'posted',
    auth.uid(),
    now()
  ) returning id into v_entry_id;

  if v_payment.direction = 'receipt' then
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (v_entry_id, v_cash_account, v_payment.party_id, v_payment.amount, 'دریافت وجه', v_payment.related_order_id);
    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('1100'), v_payment.party_id, v_payment.amount, 'کاهش دریافتنی', v_payment.related_order_id);
  else
    insert into public.finance_journal_lines (entry_id, account_id, party_id, debit_amount, description, related_order_id)
    values (v_entry_id, public.fn_finance_account_id('2000'), v_payment.party_id, v_payment.amount, 'کاهش پرداختنی', v_payment.related_order_id);
    insert into public.finance_journal_lines (entry_id, account_id, party_id, credit_amount, description, related_order_id)
    values (v_entry_id, v_cash_account, v_payment.party_id, v_payment.amount, 'پرداخت وجه', v_payment.related_order_id);
  end if;

  if not public.fn_finance_assert_journal_balanced(v_entry_id) then
    raise exception 'Journal entry is not balanced';
  end if;

  update public.finance_payments
  set status = 'confirmed', updated_at = now()
  where id = p_payment_id;

  -- update related document paid totals after payment confirmation
  perform public.fn_finance_update_document_paid_amount(a.document_id)
  from public.finance_payment_allocations a
  where a.payment_id = p_payment_id;

  return v_entry_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) Order costs and cross-module automation referrals
-- ---------------------------------------------------------------------
create table if not exists public.finance_order_costs (
  id uuid primary key default gen_random_uuid(),
  related_order_id uuid references public.orders(id) on delete cascade,
  related_rnd_project_id uuid references public.rnd_projects(id) on delete set null,
  related_production_order_id uuid references public.production_orders(id) on delete set null,
  cost_type text not null check (cost_type in ('material','labor','overhead','purchase','rnd','warehouse','shipping','other')),
  amount numeric not null check (amount >= 0),
  document_id uuid references public.finance_documents(id) on delete set null,
  source_module text check (source_module in ('orders','sales','rnd','production','warehouse','accounting','manual')) default 'manual',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_order_costs_order on public.finance_order_costs(related_order_id);

create table if not exists public.automation_referrals (
  id uuid primary key default gen_random_uuid(),
  referral_number text unique not null,
  source_module text not null check (source_module in ('orders','sales','rnd','production','warehouse','accounting','admin','manual')),
  target_module text not null check (target_module in ('orders','sales','rnd','production','warehouse','accounting','admin')),
  target_role public.user_role,
  referral_type text not null default 'request' check (referral_type in ('request','approval','review','invoice','payment','handoff','notice','other')),
  priority smallint not null default 2 check (priority between 1 and 3),
  status public.automation_referral_status not null default 'open',
  title_fa text not null,
  title_en text,
  description_fa text,
  description_en text,
  source_record_id uuid,
  related_order_id uuid references public.orders(id) on delete set null,
  related_document_id uuid references public.finance_documents(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id),
  due_date date,
  response_fa text,
  response_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_referrals_target on public.automation_referrals(target_module, target_role, status);
create index if not exists idx_automation_referrals_order on public.automation_referrals(related_order_id);
create index if not exists idx_automation_referrals_document on public.automation_referrals(related_document_id);

create sequence if not exists public.automation_referral_seq;

create or replace function public.fn_generate_automation_referral_number()
returns trigger
language plpgsql
as $$
begin
  if new.referral_number is null or new.referral_number = '' then
    new.referral_number := 'REF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.automation_referral_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_automation_referral_number on public.automation_referrals;
create trigger trg_generate_automation_referral_number
before insert on public.automation_referrals
for each row execute function public.fn_generate_automation_referral_number();

drop trigger if exists trg_automation_referrals_updated_at on public.automation_referrals;
create trigger trg_automation_referrals_updated_at
before update on public.automation_referrals
for each row execute function public.set_updated_at();

create or replace function public.fn_user_can_access_finance_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.finance_documents d
    where d.id = p_document_id
      and public.is_active_user()
      and (
        public.has_role(array['admin','accountant'])
        or (public.current_role_name() = 'sales'::public.user_role and d.related_order_id is not null and public.fn_user_can_access_order(d.related_order_id))
        or exists (
          select 1
          from public.automation_referrals r
          where r.related_document_id = d.id
            and r.status <> 'cancelled'
            and (
              r.assigned_to = auth.uid()
              or r.created_by = auth.uid()
              or r.target_role = public.current_role_name()
            )
        )
      )
  );
$$;

create or replace function public.fn_create_sales_invoice_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_party_id uuid;
  v_doc_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant','sales']) then
    raise exception 'Not allowed to create invoice from order';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  v_party_id := public.fn_finance_party_for_customer(v_order.customer_id);

  insert into public.finance_documents (
    doc_number,
    document_type,
    status,
    party_id,
    related_order_id,
    related_quotation_id,
    source_module,
    source_record_id,
    issue_date,
    due_date,
    description,
    created_by
  ) values (
    null,
    'sales_invoice',
    'draft',
    v_party_id,
    v_order.id,
    null,
    'orders',
    v_order.id,
    current_date,
    coalesce(v_order.expected_delivery_date, current_date + 7),
    'فاکتور فروش برای سفارش ' || v_order.order_code,
    auth.uid()
  ) returning id into v_doc_id;

  insert into public.finance_document_items (
    document_id,
    line_no,
    item_type,
    description_fa,
    description_en,
    quantity,
    unit,
    unit_price,
    warehouse_item_id,
    order_item_id
  )
  select
    v_doc_id,
    row_number() over (order by oi.created_at, oi.id),
    'goods',
    oi.item_name_fa,
    oi.item_name_en,
    oi.quantity,
    oi.unit,
    oi.unit_price,
    wi.id,
    oi.id
  from public.order_items oi
  left join public.warehouse_items wi on wi.item_code = oi.warehouse_item_code
  where oi.order_id = p_order_id;

  perform public.fn_finance_recalculate_document_totals(v_doc_id);
  return v_doc_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) Views: document summary, statements, balances, profitability, aging
-- ---------------------------------------------------------------------
create or replace view public.v_finance_document_summary
with (security_invoker = true)
as
select
  d.id,
  d.doc_number,
  d.document_type,
  d.status,
  d.issue_date,
  d.due_date,
  d.party_id,
  p.display_name as party_name,
  p.party_type,
  d.related_order_id,
  o.order_code,
  d.source_module,
  d.subtotal_amount,
  d.discount_amount,
  d.tax_amount,
  d.total_amount,
  d.paid_amount,
  d.balance_amount,
  case when d.due_date < current_date and d.balance_amount > 0 and d.status in ('approved','sent','partially_paid') then true else false end as is_overdue
from public.finance_documents d
left join public.finance_parties p on p.id = d.party_id
left join public.orders o on o.id = d.related_order_id;

create or replace view public.v_party_statement
with (security_invoker = true)
as
with rows as (
  select
    d.party_id,
    d.issue_date as entry_date,
    d.doc_number as ref_number,
    d.document_type::text as entry_type,
    d.description,
    case when d.document_type in ('sales_invoice','debit_note') then d.total_amount
         when d.document_type in ('purchase_return') then d.total_amount
         else 0 end as debit_amount,
    case when d.document_type in ('purchase_invoice','expense_invoice','sales_return','credit_note') then d.total_amount
         else 0 end as credit_amount,
    d.related_order_id,
    d.id as document_id,
    null::uuid as payment_id,
    d.created_at
  from public.finance_documents d
  where d.status not in ('draft','cancelled','void')

  union all

  select
    p.party_id,
    p.payment_date,
    p.payment_number,
    p.direction::text,
    p.description,
    case when p.direction = 'payment' then p.amount else 0 end as debit_amount,
    case when p.direction = 'receipt' then p.amount else 0 end as credit_amount,
    p.related_order_id,
    null::uuid,
    p.id,
    p.created_at
  from public.finance_payments p
  where p.status = 'confirmed'
)
select
  party_id,
  entry_date,
  ref_number,
  entry_type,
  description,
  debit_amount,
  credit_amount,
  related_order_id,
  document_id,
  payment_id,
  sum(debit_amount - credit_amount) over (partition by party_id order by entry_date, created_at, ref_number rows unbounded preceding) as running_balance
from rows;

create or replace view public.v_party_balances
with (security_invoker = true)
as
select
  p.id as party_id,
  p.display_name,
  p.party_type,
  p.phone,
  p.email,
  coalesce(p.opening_balance, 0) + coalesce(sum(s.debit_amount - s.credit_amount), 0) as balance,
  coalesce(sum(s.debit_amount), 0) as total_debit,
  coalesce(sum(s.credit_amount), 0) as total_credit
from public.finance_parties p
left join public.v_party_statement s on s.party_id = p.id
group by p.id;

create or replace view public.v_order_profitability
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.sales_path,
  c.company_name,
  coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('sales_invoice') and d.status not in ('draft','cancelled','void')), 0) as revenue_before_tax,
  coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('purchase_invoice','expense_invoice') and d.status not in ('draft','cancelled','void')), 0)
    + coalesce((select sum(amount) from public.finance_order_costs oc where oc.related_order_id = o.id), 0) as cost_before_tax,
  coalesce(sum(d.tax_amount) filter (where d.status not in ('draft','cancelled','void')), 0) as tax_total,
  coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('sales_invoice') and d.status not in ('draft','cancelled','void')), 0)
    - (
      coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('purchase_invoice','expense_invoice') and d.status not in ('draft','cancelled','void')), 0)
      + coalesce((select sum(amount) from public.finance_order_costs oc where oc.related_order_id = o.id), 0)
    ) as gross_profit,
  case
    when coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('sales_invoice') and d.status not in ('draft','cancelled','void')), 0) > 0
    then round(
      (
        coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('sales_invoice') and d.status not in ('draft','cancelled','void')), 0)
        - (
          coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('purchase_invoice','expense_invoice') and d.status not in ('draft','cancelled','void')), 0)
          + coalesce((select sum(amount) from public.finance_order_costs oc where oc.related_order_id = o.id), 0)
        )
      ) / nullif(coalesce(sum(d.subtotal_amount - d.discount_amount) filter (where d.document_type in ('sales_invoice') and d.status not in ('draft','cancelled','void')), 0), 0) * 100,
      2
    )
    else null
  end as gross_margin_pct
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.finance_documents d on d.related_order_id = o.id
group by o.id, c.company_name;

create or replace view public.v_accounts_aging
with (security_invoker = true)
as
select
  d.id,
  d.doc_number,
  d.document_type,
  d.party_id,
  p.display_name as party_name,
  d.due_date,
  d.balance_amount,
  greatest(current_date - coalesce(d.due_date, d.issue_date), 0) as days_overdue,
  case
    when d.balance_amount <= 0 then 'settled'
    when current_date <= coalesce(d.due_date, d.issue_date) then 'not_due'
    when current_date - coalesce(d.due_date, d.issue_date) <= 30 then '1_30'
    when current_date - coalesce(d.due_date, d.issue_date) <= 60 then '31_60'
    when current_date - coalesce(d.due_date, d.issue_date) <= 90 then '61_90'
    else '90_plus'
  end as aging_bucket
from public.finance_documents d
left join public.finance_parties p on p.id = d.party_id
where d.document_type in ('sales_invoice','purchase_invoice','expense_invoice','debit_note','credit_note')
  and d.status in ('approved','sent','partially_paid','paid')
  and d.balance_amount <> 0;

create or replace view public.v_finance_dashboard
with (security_invoker = true)
as
select
  coalesce(sum(balance_amount) filter (where document_type in ('sales_invoice','debit_note') and status in ('approved','sent','partially_paid')), 0) as receivable_total,
  coalesce(sum(balance_amount) filter (where document_type in ('purchase_invoice','expense_invoice','credit_note') and status in ('approved','sent','partially_paid')), 0) as payable_total,
  coalesce(sum(balance_amount) filter (where due_date < current_date and status in ('approved','sent','partially_paid')), 0) as overdue_total,
  coalesce(sum(total_amount) filter (where document_type = 'sales_invoice' and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_sales,
  coalesce(sum(total_amount) filter (where document_type in ('purchase_invoice','expense_invoice') and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_costs,
  coalesce(sum(total_amount) filter (where document_type = 'sales_invoice' and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0)
  - coalesce(sum(total_amount) filter (where document_type in ('purchase_invoice','expense_invoice') and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_profit,
  (select count(*) from public.automation_referrals r where r.target_module = 'accounting' and r.status in ('open','in_progress')) as open_accounting_referrals
from public.finance_documents;

-- ---------------------------------------------------------------------
-- 11) RLS
-- ---------------------------------------------------------------------
alter table public.finance_fiscal_years enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_parties enable row level security;
alter table public.finance_cost_centers enable row level security;
alter table public.finance_expense_categories enable row level security;
alter table public.finance_bank_accounts enable row level security;
alter table public.finance_cashboxes enable row level security;
alter table public.finance_documents enable row level security;
alter table public.finance_document_items enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_payment_allocations enable row level security;
alter table public.finance_checks enable row level security;
alter table public.finance_journal_entries enable row level security;
alter table public.finance_journal_lines enable row level security;
alter table public.finance_order_costs enable row level security;
alter table public.automation_referrals enable row level security;

-- Finance master data: accountant/admin maintain, active users can read selected basics.
drop policy if exists finance_fiscal_years_read on public.finance_fiscal_years;
create policy finance_fiscal_years_read on public.finance_fiscal_years for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_fiscal_years_write on public.finance_fiscal_years;
create policy finance_fiscal_years_write on public.finance_fiscal_years for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_accounts_read on public.finance_accounts;
create policy finance_accounts_read on public.finance_accounts for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_accounts_write on public.finance_accounts;
create policy finance_accounts_write on public.finance_accounts for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_parties_read on public.finance_parties;
create policy finance_parties_read on public.finance_parties for select using (public.has_role(array['admin','accountant','sales']));
drop policy if exists finance_parties_write on public.finance_parties;
create policy finance_parties_write on public.finance_parties for all using (public.has_role(array['admin','accountant','sales'])) with check (public.has_role(array['admin','accountant','sales']));

drop policy if exists finance_cost_centers_read on public.finance_cost_centers;
create policy finance_cost_centers_read on public.finance_cost_centers for select using (public.is_active_user());
drop policy if exists finance_cost_centers_write on public.finance_cost_centers;
create policy finance_cost_centers_write on public.finance_cost_centers for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_expense_categories_read on public.finance_expense_categories;
create policy finance_expense_categories_read on public.finance_expense_categories for select using (public.has_role(array['admin','accountant','production','rnd','warehouse']));
drop policy if exists finance_expense_categories_write on public.finance_expense_categories;
create policy finance_expense_categories_write on public.finance_expense_categories for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_bank_accounts_read on public.finance_bank_accounts;
create policy finance_bank_accounts_read on public.finance_bank_accounts for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_bank_accounts_write on public.finance_bank_accounts;
create policy finance_bank_accounts_write on public.finance_bank_accounts for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_cashboxes_read on public.finance_cashboxes;
create policy finance_cashboxes_read on public.finance_cashboxes for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_cashboxes_write on public.finance_cashboxes;
create policy finance_cashboxes_write on public.finance_cashboxes for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

-- Documents and items
drop policy if exists finance_documents_select on public.finance_documents;
create policy finance_documents_select on public.finance_documents for select using (public.fn_user_can_access_finance_document(id));
drop policy if exists finance_documents_write on public.finance_documents;
create policy finance_documents_write on public.finance_documents for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_document_items_select on public.finance_document_items;
create policy finance_document_items_select on public.finance_document_items for select using (public.fn_user_can_access_finance_document(document_id));
drop policy if exists finance_document_items_write on public.finance_document_items;
create policy finance_document_items_write on public.finance_document_items for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

-- Treasury, checks, journals
drop policy if exists finance_payments_select on public.finance_payments;
create policy finance_payments_select on public.finance_payments for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_payments_write on public.finance_payments;
create policy finance_payments_write on public.finance_payments for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_payment_allocations_select on public.finance_payment_allocations;
create policy finance_payment_allocations_select on public.finance_payment_allocations for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_payment_allocations_write on public.finance_payment_allocations;
create policy finance_payment_allocations_write on public.finance_payment_allocations for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_checks_select on public.finance_checks;
create policy finance_checks_select on public.finance_checks for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_checks_write on public.finance_checks;
create policy finance_checks_write on public.finance_checks for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_journal_entries_select on public.finance_journal_entries;
create policy finance_journal_entries_select on public.finance_journal_entries for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_journal_entries_write on public.finance_journal_entries;
create policy finance_journal_entries_write on public.finance_journal_entries for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_journal_lines_select on public.finance_journal_lines;
create policy finance_journal_lines_select on public.finance_journal_lines for select using (public.has_role(array['admin','accountant']));
drop policy if exists finance_journal_lines_write on public.finance_journal_lines;
create policy finance_journal_lines_write on public.finance_journal_lines for all using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_order_costs_select on public.finance_order_costs;
create policy finance_order_costs_select on public.finance_order_costs for select using (public.has_role(array['admin','accountant','production','rnd','warehouse']));
drop policy if exists finance_order_costs_write on public.finance_order_costs;
create policy finance_order_costs_write on public.finance_order_costs for all using (public.has_role(array['admin','accountant','production','rnd','warehouse'])) with check (public.has_role(array['admin','accountant','production','rnd','warehouse']));

-- Automation referrals: readable/writable by source/target users and responsible roles.
drop policy if exists automation_referrals_select on public.automation_referrals;
create policy automation_referrals_select on public.automation_referrals for select using (
  public.is_active_user() and (
    public.has_role(array['admin','accountant'])
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or target_role = public.current_role_name()
    or (related_order_id is not null and public.fn_user_can_access_order(related_order_id))
  )
);

drop policy if exists automation_referrals_insert on public.automation_referrals;
create policy automation_referrals_insert on public.automation_referrals for insert with check (public.is_active_user());

drop policy if exists automation_referrals_update on public.automation_referrals;
create policy automation_referrals_update on public.automation_referrals for update using (
  public.is_active_user() and (
    public.has_role(array['admin','accountant'])
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or target_role = public.current_role_name()
  )
);
