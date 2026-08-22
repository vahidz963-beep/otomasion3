-- =====================================================================
-- 060_DASHBOARD_IMPORTANT_PAYABLES
-- Adds CEO dashboard section: «پرداختی‌های مهم»
-- - Manual important payable/reminder notes
-- - Automatic upcoming payables from purchase/expense invoices
-- - Automatic upcoming issued checks
-- - Automatic upcoming loan installments
-- - Automatic unpaid payroll slips (if payroll module exists)
-- =====================================================================

create table if not exists public.finance_payment_reminders (
  id uuid primary key default gen_random_uuid(),
  due_date date not null default current_date,
  party_name text,
  subject text not null,
  amount numeric not null default 0 check (amount >= 0),
  priority smallint not null default 2 check (priority between 1 and 3),
  status text not null default 'pending' check (status in ('pending','paid','cancelled','archived')),
  source_type text not null default 'manual' check (source_type in ('manual','payroll','purchase_invoice','expense_invoice','check','loan','other')),
  source_id uuid,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_payment_reminders_status_due
  on public.finance_payment_reminders(status, due_date, priority);

create index if not exists idx_finance_payment_reminders_source
  on public.finance_payment_reminders(source_type, source_id);

drop trigger if exists trg_finance_payment_reminders_updated_at on public.finance_payment_reminders;
create trigger trg_finance_payment_reminders_updated_at
before update on public.finance_payment_reminders
for each row execute function public.set_updated_at();

-- View for dashboard. It is safe if payroll tables exist from migration 059.
create or replace view public.v_dashboard_important_payables
with (security_invoker = true)
as
with manual_rows as (
  select
    r.id,
    r.due_date,
    r.party_name,
    r.subject,
    r.amount,
    r.priority,
    r.status,
    r.source_type,
    r.source_id,
    r.notes,
    r.created_at
  from public.finance_payment_reminders r
  where r.status = 'pending'
), document_rows as (
  select
    d.id,
    d.due_date,
    fp.display_name as party_name,
    case
      when d.document_type = 'purchase_invoice' then 'پرداخت فاکتور خرید ' || d.doc_number
      when d.document_type = 'expense_invoice' then 'پرداخت سند هزینه ' || d.doc_number
      else 'پرداخت سند ' || d.doc_number
    end as subject,
    greatest(coalesce(d.balance_amount, d.total_amount, 0), 0) as amount,
    case when d.due_date <= current_date + 3 then 1 else 2 end as priority,
    'pending'::text as status,
    d.document_type::text as source_type,
    d.id as source_id,
    d.description as notes,
    d.created_at
  from public.finance_documents d
  left join public.finance_parties fp on fp.id = d.party_id
  where d.document_type in ('purchase_invoice','expense_invoice')
    and d.status not in ('draft','cancelled','void','paid')
    and greatest(coalesce(d.balance_amount, d.total_amount, 0), 0) > 0
    and d.due_date is not null
    and d.due_date <= current_date + 10
), check_rows as (
  select
    c.id,
    coalesce(c.due_date, current_date) as due_date,
    coalesce(fp.display_name, c.owner_name, c.bank_name) as party_name,
    'پرداخت/پیگیری چک ' || coalesce(c.internal_check_code, c.check_number, '') as subject,
    coalesce(c.amount, 0) as amount,
    case when c.due_date <= current_date + 3 then 1 else 2 end as priority,
    'pending'::text as status,
    'check'::text as source_type,
    c.id as source_id,
    concat_ws(' · ', c.bank_name, c.branch_name, c.owner_name, c.description) as notes,
    c.created_at
  from public.finance_checks c
  left join public.finance_parties fp on fp.id = c.party_id
  where c.check_type = 'issued'
    and c.status not in ('cleared','cancelled','void')
    and c.due_date is not null
    and c.due_date <= current_date + 10
), loan_rows as (
  select
    i.id,
    i.due_date,
    l.lender_name as party_name,
    'قسط وام ' || l.loan_number || ' - قسط ' || i.installment_no::text as subject,
    greatest(coalesce(i.amount_due, 0) - coalesce(i.paid_amount, 0), 0) as amount,
    case when i.due_date <= current_date + 3 then 1 else 2 end as priority,
    'pending'::text as status,
    'loan'::text as source_type,
    i.id as source_id,
    concat_ws(' · ', l.title_fa, l.bank_name, i.notes) as notes,
    i.created_at
  from public.finance_loan_installments i
  join public.finance_loans l on l.id = i.loan_id
  where i.status not in ('paid','cancelled')
    and greatest(coalesce(i.amount_due, 0) - coalesce(i.paid_amount, 0), 0) > 0
    and i.due_date <= current_date + 10
), payroll_rows as (
  select
    s.id,
    s.issue_date as due_date,
    e.display_name as party_name,
    'پرداخت حقوق ' || coalesce(s.payroll_month, '') || ' - ' || e.display_name as subject,
    greatest(coalesce(s.remaining_balance, s.net_payable, 0), 0) as amount,
    1::smallint as priority,
    'pending'::text as status,
    'payroll'::text as source_type,
    s.id as source_id,
    s.notes,
    s.created_at
  from public.finance_payroll_slips s
  join public.finance_payroll_employees e on e.id = s.employee_id
  where to_regclass('public.finance_payroll_slips') is not null
    and to_regclass('public.finance_payroll_employees') is not null
    and s.status not in ('paid','void','archived')
    and greatest(coalesce(s.remaining_balance, s.net_payable, 0), 0) > 0
    and s.issue_date <= current_date + 10
)
select * from manual_rows
union all select * from document_rows
union all select * from check_rows
union all select * from loan_rows
union all select * from payroll_rows;

grant select, insert, update on public.finance_payment_reminders to authenticated;
grant select on public.v_dashboard_important_payables to authenticated;

alter table public.finance_payment_reminders enable row level security;

drop policy if exists payment_reminders_select on public.finance_payment_reminders;
create policy payment_reminders_select on public.finance_payment_reminders
for select using (public.has_role(array['admin','accountant','sales_manager']))
;

drop policy if exists payment_reminders_write on public.finance_payment_reminders;
create policy payment_reminders_write on public.finance_payment_reminders
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

notify pgrst, 'reload schema';
