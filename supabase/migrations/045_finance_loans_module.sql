-- =====================================================================
-- 045_FINANCE_LOANS_MODULE
-- Adds company loans management to accounting/finance.
-- - Loans list
-- - Installment schedule
-- - Paid / overdue / pending status
-- - Link installment payment to finance_payments
-- =====================================================================

create sequence if not exists public.finance_loan_seq;

create table if not exists public.finance_loans (
  id uuid primary key default gen_random_uuid(),
  loan_number text unique,
  title_fa text not null,
  lender_name text not null,
  lender_type text not null default 'bank' check (lender_type in ('bank','person','company','other')),
  bank_name text,
  principal_amount numeric not null default 0 check (principal_amount >= 0),
  total_payable_amount numeric not null default 0 check (total_payable_amount >= 0),
  installment_count int not null default 1 check (installment_count > 0),
  installment_interval_months int not null default 1 check (installment_interval_months > 0),
  interest_rate numeric not null default 0 check (interest_rate >= 0),
  received_date date not null default current_date,
  first_due_date date not null default current_date,
  status text not null default 'active' check (status in ('active','closed','cancelled','archived')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.finance_loans(id) on delete cascade,
  installment_no int not null check (installment_no > 0),
  due_date date not null,
  principal_amount numeric not null default 0 check (principal_amount >= 0),
  interest_amount numeric not null default 0 check (interest_amount >= 0),
  fee_amount numeric not null default 0 check (fee_amount >= 0),
  amount_due numeric not null default 0 check (amount_due >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  paid_at date,
  payment_id uuid references public.finance_payments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','paid','overdue','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(loan_id, installment_no)
);

create index if not exists idx_finance_loans_status on public.finance_loans(status);
create index if not exists idx_finance_loan_installments_loan on public.finance_loan_installments(loan_id, installment_no);
create index if not exists idx_finance_loan_installments_due on public.finance_loan_installments(due_date, status);
create index if not exists idx_finance_loan_installments_payment on public.finance_loan_installments(payment_id);

create or replace function public.fn_generate_finance_loan_number()
returns trigger
language plpgsql
as $$
begin
  if new.loan_number is null or new.loan_number = '' then
    new.loan_number := 'LN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.finance_loan_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_finance_loan_number on public.finance_loans;
create trigger trg_generate_finance_loan_number
before insert on public.finance_loans
for each row execute function public.fn_generate_finance_loan_number();

drop trigger if exists trg_finance_loans_updated_at on public.finance_loans;
create trigger trg_finance_loans_updated_at
before update on public.finance_loans
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_loan_installments_updated_at on public.finance_loan_installments;
create trigger trg_finance_loan_installments_updated_at
before update on public.finance_loan_installments
for each row execute function public.set_updated_at();

create or replace function public.fn_finance_refresh_loan_installment_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.finance_loan_installments
  set status = 'overdue',
      updated_at = now()
  where status = 'pending'
    and paid_at is null
    and due_date < current_date;
end;
$$;

grant execute on function public.fn_finance_refresh_loan_installment_statuses() to authenticated;

create or replace function public.fn_finance_mark_loan_installment_paid(
  p_installment_id uuid,
  p_payment_id uuid default null,
  p_paid_amount numeric default null,
  p_paid_at date default current_date,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.finance_loan_installments%rowtype;
  v_paid numeric;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت پرداخت قسط وام ندارید';
  end if;

  select * into v_inst
  from public.finance_loan_installments
  where id = p_installment_id
  for update;

  if not found then raise exception 'قسط وام یافت نشد'; end if;

  v_paid := coalesce(p_paid_amount, v_inst.amount_due);
  if v_paid <= 0 then raise exception 'مبلغ پرداخت قسط معتبر نیست'; end if;

  update public.finance_loan_installments
  set status = 'paid',
      paid_amount = v_paid,
      paid_at = coalesce(p_paid_at, current_date),
      payment_id = p_payment_id,
      notes = concat_ws(E'\n', notes, p_notes),
      updated_at = now()
  where id = p_installment_id;

  update public.finance_loans l
  set status = case
      when not exists (
        select 1 from public.finance_loan_installments i
        where i.loan_id = l.id and i.status not in ('paid','cancelled')
      ) then 'closed'
      else l.status
    end,
    updated_at = now()
  where l.id = v_inst.loan_id;

  return p_installment_id;
end;
$$;

grant execute on function public.fn_finance_mark_loan_installment_paid(uuid,uuid,numeric,date,text) to authenticated;

create or replace view public.v_finance_loan_installments
with (security_invoker = true)
as
select
  i.id,
  i.loan_id,
  l.loan_number,
  l.title_fa as loan_title,
  l.lender_name,
  l.bank_name,
  i.installment_no,
  i.due_date,
  i.principal_amount,
  i.interest_amount,
  i.fee_amount,
  i.amount_due,
  i.paid_amount,
  i.paid_at,
  i.payment_id,
  p.payment_number,
  p.payment_date,
  p.description as payment_description,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'cancelled' then 'cancelled'
    when i.due_date < current_date then 'overdue'
    else i.status
  end as status,
  i.notes,
  i.created_at,
  i.updated_at
from public.finance_loan_installments i
join public.finance_loans l on l.id = i.loan_id
left join public.finance_payments p on p.id = i.payment_id;

create or replace view public.v_finance_loan_overview
with (security_invoker = true)
as
select
  l.id,
  l.loan_number,
  l.title_fa,
  l.lender_name,
  l.lender_type,
  l.bank_name,
  l.principal_amount,
  l.total_payable_amount,
  l.installment_count,
  l.installment_interval_months,
  l.interest_rate,
  l.received_date,
  l.first_due_date,
  l.status,
  l.notes,
  l.created_by,
  l.created_at,
  l.updated_at,
  count(i.id) as installment_rows,
  count(i.id) filter (where i.status = 'paid') as paid_installments,
  count(i.id) filter (where i.status <> 'paid' and i.status <> 'cancelled') as remaining_installments,
  count(i.id) filter (where i.status <> 'paid' and i.status <> 'cancelled' and i.due_date < current_date) as overdue_installments,
  coalesce(sum(i.amount_due), 0) as scheduled_total,
  coalesce(sum(i.paid_amount), 0) as paid_total,
  coalesce(sum(i.amount_due - coalesce(i.paid_amount,0)) filter (where i.status <> 'paid' and i.status <> 'cancelled'), 0) as remaining_debt,
  min(i.due_date) filter (where i.status <> 'paid' and i.status <> 'cancelled') as next_due_date,
  coalesce(sum(i.amount_due) filter (where i.status <> 'paid' and i.status <> 'cancelled' and i.due_date < current_date), 0) as overdue_amount
from public.finance_loans l
left join public.finance_loan_installments i on i.loan_id = l.id
group by l.id;

grant select, insert, update on public.finance_loans to authenticated;
grant select, insert, update on public.finance_loan_installments to authenticated;
grant select on public.v_finance_loan_overview to authenticated;
grant select on public.v_finance_loan_installments to authenticated;

alter table public.finance_loans enable row level security;
alter table public.finance_loan_installments enable row level security;

drop policy if exists finance_loans_select on public.finance_loans;
create policy finance_loans_select on public.finance_loans
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_loans_write on public.finance_loans;
create policy finance_loans_write on public.finance_loans
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

drop policy if exists finance_loan_installments_select on public.finance_loan_installments;
create policy finance_loan_installments_select on public.finance_loan_installments
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_loan_installments_write on public.finance_loan_installments;
create policy finance_loan_installments_write on public.finance_loan_installments
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

notify pgrst, 'reload schema';
