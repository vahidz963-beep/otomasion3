-- =====================================================================
-- 061_PAYROLL_PAYMENT_DOCUMENTS
-- Adds payment document registration for payroll slips.
-- Each payroll payment creates/links a finance_payments record and reduces the
-- remaining salary balance of that employee/month.
-- =====================================================================

create table if not exists public.finance_payroll_payments (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.finance_payroll_slips(id) on delete cascade,
  payment_id uuid references public.finance_payments(id) on delete set null,
  paid_amount numeric not null check (paid_amount > 0),
  paid_at date not null default current_date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_payroll_payments_slip_created
  on public.finance_payroll_payments(slip_id, created_at desc);
create index if not exists idx_payroll_payments_payment
  on public.finance_payroll_payments(payment_id);

create or replace function public.fn_finance_recalc_payroll_slip_payment(p_slip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_net numeric;
begin
  select coalesce(sum(paid_amount), 0)
  into v_paid
  from public.finance_payroll_payments
  where slip_id = p_slip_id;

  select net_payable into v_net
  from public.finance_payroll_slips
  where id = p_slip_id;

  update public.finance_payroll_slips
  set paid_amount = coalesce(v_paid, 0),
      remaining_balance = coalesce(v_net, 0) - coalesce(v_paid, 0),
      status = case
        when status = 'archived' then status
        when status = 'void' then status
        when coalesce(v_net, 0) > 0 and coalesce(v_paid, 0) >= coalesce(v_net, 0) then 'paid'
        when status = 'draft' then 'approved'
        else status
      end,
      updated_at = now()
  where id = p_slip_id;
end;
$$;

create or replace function public.fn_finance_register_payroll_payment(
  p_slip_id uuid,
  p_paid_amount numeric,
  p_paid_at date default current_date,
  p_bank_account_id uuid default null,
  p_cashbox_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip record;
  v_payment_id uuid;
  v_payroll_payment_id uuid;
  v_method public.finance_payment_method;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت پرداخت حقوق ندارید';
  end if;

  if coalesce(p_paid_amount, 0) <= 0 then
    raise exception 'مبلغ پرداخت حقوق معتبر نیست';
  end if;

  select s.*, e.display_name as employee_name
  into v_slip
  from public.finance_payroll_slips s
  join public.finance_payroll_employees e on e.id = s.employee_id
  where s.id = p_slip_id
  for update;

  if not found then
    raise exception 'فیش حقوقی یافت نشد';
  end if;

  if v_slip.status in ('void','archived') then
    raise exception 'فیش باطل/بایگانی‌شده قابل پرداخت نیست';
  end if;

  v_method := case when p_cashbox_id is not null then 'cash'::public.finance_payment_method else 'bank_transfer'::public.finance_payment_method end;

  insert into public.finance_payments (
    payment_number,
    direction,
    method,
    status,
    party_id,
    payment_date,
    amount,
    currency,
    bank_account_id,
    cashbox_id,
    source_module,
    source_record_id,
    description,
    created_by
  ) values (
    null,
    'payment'::public.finance_payment_direction,
    v_method,
    'draft'::public.finance_payment_status,
    null,
    coalesce(p_paid_at, current_date),
    p_paid_amount,
    'IRR',
    p_bank_account_id,
    p_cashbox_id,
    'accounting',
    p_slip_id,
    'پرداخت حقوق ' || coalesce(v_slip.payroll_month, '') || ' - ' || coalesce(v_slip.employee_name, ''),
    auth.uid()
  ) returning id into v_payment_id;

  perform public.fn_post_finance_payment(v_payment_id);

  insert into public.finance_payroll_payments (
    slip_id,
    payment_id,
    paid_amount,
    paid_at,
    notes,
    created_by
  ) values (
    p_slip_id,
    v_payment_id,
    p_paid_amount,
    coalesce(p_paid_at, current_date),
    p_notes,
    auth.uid()
  ) returning id into v_payroll_payment_id;

  perform public.fn_finance_recalc_payroll_slip_payment(p_slip_id);

  return v_payroll_payment_id;
end;
$$;

create or replace view public.v_finance_payroll_payments
with (security_invoker = true)
as
select
  pp.id,
  pp.slip_id,
  s.slip_number,
  s.employee_id,
  e.employee_code,
  e.display_name as employee_name,
  s.payroll_month,
  pp.payment_id,
  p.payment_number,
  p.method,
  p.status as payment_status,
  pp.paid_amount,
  pp.paid_at,
  p.bank_account_id,
  ba.account_name as bank_account_name,
  p.cashbox_id,
  cb.name as cashbox_name,
  pp.notes,
  pp.created_by,
  pp.created_at
from public.finance_payroll_payments pp
join public.finance_payroll_slips s on s.id = pp.slip_id
join public.finance_payroll_employees e on e.id = s.employee_id
left join public.finance_payments p on p.id = pp.payment_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id;

grant select, insert, update, delete on public.finance_payroll_payments to authenticated;
grant select on public.v_finance_payroll_payments to authenticated;
grant execute on function public.fn_finance_recalc_payroll_slip_payment(uuid) to authenticated;
grant execute on function public.fn_finance_register_payroll_payment(uuid,numeric,date,uuid,uuid,text) to authenticated;

alter table public.finance_payroll_payments enable row level security;

drop policy if exists payroll_payments_select on public.finance_payroll_payments;
create policy payroll_payments_select on public.finance_payroll_payments
for select using (public.has_role(array['admin','accountant']));

drop policy if exists payroll_payments_write on public.finance_payroll_payments;
create policy payroll_payments_write on public.finance_payroll_payments
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

notify pgrst, 'reload schema';
