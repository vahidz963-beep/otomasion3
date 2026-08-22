-- =====================================================================
-- 059_ACCOUNTING_PAYROLL_MODULE
-- Adds Payroll (حقوق و دستمزد) as a sub-module of Accounting/Finance.
-- - Employees
-- - Monthly payroll slips
-- - Editable slip lines
-- - Carry-over unpaid balance
-- - Safe archive/delete
-- =====================================================================

create sequence if not exists public.finance_payroll_seq;

create table if not exists public.finance_payroll_employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  display_name text not null,
  role_title text,
  department text,
  national_id text,
  phone text,
  bank_account_number text,
  bank_iban text,
  base_salary numeric not null default 0 check (base_salary >= 0),
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_payroll_slips (
  id uuid primary key default gen_random_uuid(),
  slip_number text unique,
  employee_id uuid not null references public.finance_payroll_employees(id) on delete cascade,
  payroll_month text not null,
  issue_date date not null default current_date,
  base_salary numeric not null default 0 check (base_salary >= 0),
  carried_balance numeric not null default 0,
  benefits_total numeric not null default 0,
  deductions_total numeric not null default 0,
  gross_amount numeric not null default 0,
  net_payable numeric not null default 0,
  paid_amount numeric not null default 0,
  remaining_balance numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','approved','paid','void','archived')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, payroll_month)
);

create table if not exists public.finance_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.finance_payroll_slips(id) on delete cascade,
  line_no int not null default 1,
  line_type text not null default 'earning' check (line_type in ('earning','deduction','carry','payment','note')),
  title_fa text not null,
  amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique(slip_id, line_no)
);

create index if not exists idx_payroll_employees_active_name on public.finance_payroll_employees(is_active, display_name);
create index if not exists idx_payroll_slips_month_status on public.finance_payroll_slips(payroll_month, status);
create index if not exists idx_payroll_slips_employee_month on public.finance_payroll_slips(employee_id, payroll_month);
create index if not exists idx_payroll_lines_slip on public.finance_payroll_lines(slip_id, line_no);

create or replace function public.fn_generate_finance_payroll_number()
returns trigger
language plpgsql
as $$
begin
  if new.slip_number is null or new.slip_number = '' then
    new.slip_number := 'PAY-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.finance_payroll_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_payroll_number on public.finance_payroll_slips;
create trigger trg_generate_finance_payroll_number
before insert on public.finance_payroll_slips
for each row execute function public.fn_generate_finance_payroll_number();

drop trigger if exists trg_finance_payroll_employees_updated_at on public.finance_payroll_employees;
create trigger trg_finance_payroll_employees_updated_at
before update on public.finance_payroll_employees
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_payroll_slips_updated_at on public.finance_payroll_slips;
create trigger trg_finance_payroll_slips_updated_at
before update on public.finance_payroll_slips
for each row execute function public.set_updated_at();

create or replace view public.v_finance_payroll_slips
with (security_invoker = true)
as
select
  s.*,
  e.employee_code,
  e.display_name as employee_name,
  e.role_title,
  e.department,
  e.national_id,
  e.phone,
  e.bank_account_number,
  e.bank_iban
from public.finance_payroll_slips s
join public.finance_payroll_employees e on e.id = s.employee_id
where e.is_active is true
  and s.status <> 'archived';

grant select, insert, update on public.finance_payroll_employees to authenticated;
grant select, insert, update on public.finance_payroll_slips to authenticated;
grant select, insert, update, delete on public.finance_payroll_lines to authenticated;
grant select on public.v_finance_payroll_slips to authenticated;

alter table public.finance_payroll_employees enable row level security;
alter table public.finance_payroll_slips enable row level security;
alter table public.finance_payroll_lines enable row level security;

drop policy if exists payroll_employees_select on public.finance_payroll_employees;
create policy payroll_employees_select on public.finance_payroll_employees
for select using (public.has_role(array['admin','accountant']));

drop policy if exists payroll_employees_write on public.finance_payroll_employees;
create policy payroll_employees_write on public.finance_payroll_employees
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

drop policy if exists payroll_slips_select on public.finance_payroll_slips;
create policy payroll_slips_select on public.finance_payroll_slips
for select using (public.has_role(array['admin','accountant']));

drop policy if exists payroll_slips_write on public.finance_payroll_slips;
create policy payroll_slips_write on public.finance_payroll_slips
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

drop policy if exists payroll_lines_select on public.finance_payroll_lines;
create policy payroll_lines_select on public.finance_payroll_lines
for select using (public.has_role(array['admin','accountant']));

drop policy if exists payroll_lines_write on public.finance_payroll_lines;
create policy payroll_lines_write on public.finance_payroll_lines
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

notify pgrst, 'reload schema';
