-- =====================================================================
-- 062_ACCOUNTING_INCOME_EXPENSE_CATEGORIES
-- Adds Accounting sub-section: «هزینه‌ها و درآمدها»
-- - Expense and income categories with optional parent/sub-category
-- - Link receipts/payments to category
-- - Dashboard/list view for categorized cashflow
-- =====================================================================

create table if not exists public.finance_income_expense_categories (
  id uuid primary key default gen_random_uuid(),
  category_type text not null check (category_type in ('expense','income')),
  parent_id uuid references public.finance_income_expense_categories(id) on delete set null,
  code text unique,
  name_fa text not null,
  name_en text,
  default_account_id uuid references public.finance_accounts(id),
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_payments
  add column if not exists category_id uuid references public.finance_income_expense_categories(id) on delete set null,
  add column if not exists category_note text;

create index if not exists idx_income_expense_categories_type_parent
  on public.finance_income_expense_categories(category_type, parent_id, is_active);
create index if not exists idx_income_expense_categories_name
  on public.finance_income_expense_categories(name_fa);
create index if not exists idx_finance_payments_category_date
  on public.finance_payments(category_id, payment_date desc);

-- Keep updated_at fresh.
drop trigger if exists trg_income_expense_categories_updated_at on public.finance_income_expense_categories;
create trigger trg_income_expense_categories_updated_at
before update on public.finance_income_expense_categories
for each row execute function public.set_updated_at();

insert into public.finance_income_expense_categories (category_type, code, name_fa, default_account_id, notes)
values
  ('expense', 'EXP-PETTY-CASH', 'هزینه تنخواه', public.fn_finance_account_id('6000'), 'هزینه‌های تنخواه و پرداخت‌های خرد'),
  ('expense', 'EXP-REPAIR', 'هزینه تعمیرات', public.fn_finance_account_id('6000'), 'تعمیر دستگاه، تجهیزات و ابزار'),
  ('expense', 'EXP-SALARY', 'حقوق و دستمزد', public.fn_finance_account_id('6300'), 'پرداخت حقوق، مزایا و هزینه‌های پرسنلی'),
  ('expense', 'EXP-SHIPPING', 'حمل و ارسال', public.fn_finance_account_id('6000'), 'باربری، پیک، بسته‌بندی و ارسال'),
  ('income', 'INC-SALES', 'درآمد فروش', public.fn_finance_account_id('4000'), 'دریافت‌های فروش کالا و خدمات'),
  ('income', 'INC-SERVICE', 'درآمد خدمات', public.fn_finance_account_id('4000'), 'درآمد خدمات فنی، تست و مشاوره'),
  ('income', 'INC-OTHER', 'سایر درآمدها', public.fn_finance_account_id('4000'), 'درآمدهای متفرقه')
on conflict (code) do nothing;

create or replace view public.v_finance_income_expense_categories
with (security_invoker = true)
as
select
  c.id,
  c.category_type,
  c.parent_id,
  p.name_fa as parent_name_fa,
  c.code,
  c.name_fa,
  c.name_en,
  c.default_account_id,
  fa.code as account_code,
  fa.name_fa as account_name_fa,
  c.is_active,
  c.notes,
  c.created_by,
  c.created_at,
  c.updated_at
from public.finance_income_expense_categories c
left join public.finance_income_expense_categories p on p.id = c.parent_id
left join public.finance_accounts fa on fa.id = c.default_account_id;

create or replace view public.v_finance_income_expense_ledger
with (security_invoker = true)
as
select
  p.id,
  p.payment_number,
  p.direction,
  case when p.direction = 'receipt' then 'income' else 'expense' end as flow_type,
  p.method,
  p.status,
  p.party_id,
  fp.display_name as party_name,
  p.payment_date,
  p.amount,
  p.currency,
  p.bank_account_id,
  ba.account_name as bank_account_name,
  ba.bank_name,
  p.cashbox_id,
  cb.name as cashbox_name,
  p.category_id,
  c.category_type,
  c.name_fa as category_name_fa,
  pc.name_fa as parent_category_name_fa,
  p.category_note,
  p.description,
  p.source_module,
  p.source_record_id,
  p.related_order_id,
  o.order_code,
  p.created_at
from public.finance_payments p
left join public.finance_parties fp on fp.id = p.party_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
left join public.finance_income_expense_categories c on c.id = p.category_id
left join public.finance_income_expense_categories pc on pc.id = c.parent_id
left join public.orders o on o.id = p.related_order_id
where p.status <> 'void'
  and (p.category_id is not null or p.source_module = 'accounting');

grant select, insert, update on public.finance_income_expense_categories to authenticated;
grant select on public.v_finance_income_expense_categories to authenticated;
grant select on public.v_finance_income_expense_ledger to authenticated;

alter table public.finance_income_expense_categories enable row level security;

drop policy if exists income_expense_categories_select on public.finance_income_expense_categories;
create policy income_expense_categories_select on public.finance_income_expense_categories
for select using (public.has_role(array['admin','accountant','sales_manager']))
;

drop policy if exists income_expense_categories_write on public.finance_income_expense_categories;
create policy income_expense_categories_write on public.finance_income_expense_categories
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

notify pgrst, 'reload schema';
