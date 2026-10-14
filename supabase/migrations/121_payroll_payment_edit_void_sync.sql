-- 121: Safe payroll-payment edit/void with full finance synchronization.
-- Editing a payroll payment rebuilds its journal entry and immediately updates
-- the payroll slip, cash/bank ledger and account balance. Deletion is a safe
-- void operation; no financial row is physically deleted.

begin;

alter table public.finance_payroll_payments
  add column if not exists status text not null default 'active',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id),
  add column if not exists void_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_payroll_payments_status_check'
      and conrelid = 'public.finance_payroll_payments'::regclass
  ) then
    alter table public.finance_payroll_payments
      add constraint finance_payroll_payments_status_check
      check (status in ('active', 'void'));
  end if;
end $$;

create index if not exists idx_payroll_payments_active_slip
  on public.finance_payroll_payments(slip_id, paid_at desc)
  where status = 'active';

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
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی محاسبه مجدد پرداخت حقوق ندارید';
  end if;

  select coalesce(sum(paid_amount), 0)
  into v_paid
  from public.finance_payroll_payments
  where slip_id = p_slip_id
    and status = 'active';

  select net_payable
  into v_net
  from public.finance_payroll_slips
  where id = p_slip_id;

  if not found then
    return;
  end if;

  update public.finance_payroll_slips
  set paid_amount = coalesce(v_paid, 0),
      remaining_balance = coalesce(v_net, 0) - coalesce(v_paid, 0),
      status = case
        when status in ('archived', 'void') then status
        when coalesce(v_net, 0) > 0 and coalesce(v_paid, 0) >= coalesce(v_net, 0) then 'paid'
        else 'approved'
      end,
      updated_at = now()
  where id = p_slip_id;
end;
$$;

-- Reconcile legacy payroll rows that may already have been voided from the
-- cash/bank screen before this migration existed, then normalize every slip
-- that has a payment history using active documents only.
update public.finance_payroll_payments pp
set status = 'void',
    voided_at = coalesce(pp.voided_at, now()),
    void_reason = coalesce(pp.void_reason, 'همگام‌سازی با سند دریافت/پرداخت باطل‌شده'),
    updated_at = now()
from public.finance_payments p
where p.id = pp.payment_id
  and p.status in ('void', 'cancelled')
  and pp.status = 'active';

do $$
declare
  v_slip_id uuid;
begin
  for v_slip_id in
    select distinct slip_id
    from public.finance_payroll_payments
  loop
    perform public.fn_finance_recalc_payroll_slip_payment(v_slip_id);
  end loop;
end $$;

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
  v_already_paid numeric;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت پرداخت حقوق ندارید';
  end if;

  if coalesce(p_paid_amount, 0) <= 0 then
    raise exception 'مبلغ پرداخت حقوق معتبر نیست';
  end if;

  if (p_bank_account_id is null and p_cashbox_id is null)
     or (p_bank_account_id is not null and p_cashbox_id is not null) then
    raise exception 'دقیقاً یک حساب بانکی یا صندوق باید انتخاب شود';
  end if;

  select s.*, e.display_name as employee_name
  into v_slip
  from public.finance_payroll_slips s
  join public.finance_payroll_employees e on e.id = s.employee_id
  where s.id = p_slip_id
  for update of s;

  if not found then
    raise exception 'فیش حقوقی یافت نشد';
  end if;

  if v_slip.status in ('void', 'archived') then
    raise exception 'فیش باطل/بایگانی‌شده قابل پرداخت نیست';
  end if;

  select coalesce(sum(paid_amount), 0)
  into v_already_paid
  from public.finance_payroll_payments
  where slip_id = p_slip_id
    and status = 'active';

  if v_already_paid + p_paid_amount > coalesce(v_slip.net_payable, 0) then
    raise exception 'مبلغ پرداخت از مانده قابل پرداخت فیش بیشتر است';
  end if;

  v_method := case
    when p_cashbox_id is not null then 'cash'::public.finance_payment_method
    else 'bank_transfer'::public.finance_payment_method
  end;

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
    concat_ws(' · ', 'پرداخت حقوق ' || coalesce(v_slip.payroll_month, '') || ' - ' || coalesce(v_slip.employee_name, ''), nullif(p_notes, '')),
    auth.uid()
  ) returning id into v_payment_id;

  perform public.fn_post_finance_payment(v_payment_id);

  insert into public.finance_payroll_payments (
    slip_id,
    payment_id,
    paid_amount,
    paid_at,
    notes,
    created_by,
    status,
    updated_at,
    updated_by
  ) values (
    p_slip_id,
    v_payment_id,
    p_paid_amount,
    coalesce(p_paid_at, current_date),
    p_notes,
    auth.uid(),
    'active',
    now(),
    auth.uid()
  ) returning id into v_payroll_payment_id;

  perform public.fn_finance_recalc_payroll_slip_payment(p_slip_id);

  return v_payroll_payment_id;
end;
$$;

create or replace function public.fn_finance_update_payroll_payment(
  p_payroll_payment_id uuid,
  p_paid_amount numeric,
  p_paid_at date,
  p_bank_account_id uuid default null,
  p_cashbox_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payroll_payment public.finance_payroll_payments%rowtype;
  v_slip record;
  v_other_paid numeric;
  v_method public.finance_payment_method;
  v_payment_id uuid;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ویرایش پرداخت حقوق ندارید';
  end if;

  if coalesce(p_paid_amount, 0) <= 0 then
    raise exception 'مبلغ پرداخت حقوق معتبر نیست';
  end if;

  if p_paid_at is null then
    raise exception 'تاریخ پرداخت الزامی است';
  end if;

  if (p_bank_account_id is null and p_cashbox_id is null)
     or (p_bank_account_id is not null and p_cashbox_id is not null) then
    raise exception 'دقیقاً یک حساب بانکی یا صندوق باید انتخاب شود';
  end if;

  select *
  into v_payroll_payment
  from public.finance_payroll_payments
  where id = p_payroll_payment_id
  for update;

  if not found then
    raise exception 'سند پرداخت حقوق یافت نشد';
  end if;

  if v_payroll_payment.status <> 'active' then
    raise exception 'سند پرداخت باطل‌شده قابل ویرایش نیست';
  end if;

  select s.*, e.display_name as employee_name
  into v_slip
  from public.finance_payroll_slips s
  join public.finance_payroll_employees e on e.id = s.employee_id
  where s.id = v_payroll_payment.slip_id
  for update of s;

  if not found then
    raise exception 'فیش حقوقی مرتبط یافت نشد';
  end if;

  if v_slip.status in ('void', 'archived') then
    raise exception 'فیش باطل/بایگانی‌شده قابل ویرایش پرداخت نیست';
  end if;

  select coalesce(sum(paid_amount), 0)
  into v_other_paid
  from public.finance_payroll_payments
  where slip_id = v_payroll_payment.slip_id
    and status = 'active'
    and id <> p_payroll_payment_id;

  if v_other_paid + p_paid_amount > coalesce(v_slip.net_payable, 0) then
    raise exception 'مبلغ جدید از مانده قابل پرداخت فیش بیشتر است';
  end if;

  v_method := case
    when p_cashbox_id is not null then 'cash'::public.finance_payment_method
    else 'bank_transfer'::public.finance_payment_method
  end;

  v_payment_id := v_payroll_payment.payment_id;

  if v_payment_id is null then
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
      p_paid_at,
      p_paid_amount,
      'IRR',
      p_bank_account_id,
      p_cashbox_id,
      'accounting',
      v_payroll_payment.slip_id,
      concat_ws(' · ', 'پرداخت حقوق ' || coalesce(v_slip.payroll_month, '') || ' - ' || coalesce(v_slip.employee_name, ''), nullif(p_notes, '')),
      auth.uid()
    ) returning id into v_payment_id;
  else
    update public.finance_journal_entries
    set status = 'void',
        description = concat_ws(E'\n', description, 'ابطال سند حسابداری قبلی به دلیل ویرایش پرداخت حقوق')
    where related_payment_id = v_payment_id
      and status in ('draft', 'posted');

    update public.finance_payments
    set direction = 'payment'::public.finance_payment_direction,
        method = v_method,
        status = 'draft'::public.finance_payment_status,
        payment_date = p_paid_at,
        amount = p_paid_amount,
        currency = 'IRR',
        bank_account_id = p_bank_account_id,
        cashbox_id = p_cashbox_id,
        source_module = 'accounting',
        source_record_id = v_payroll_payment.slip_id,
        description = concat_ws(' · ', 'پرداخت حقوق ' || coalesce(v_slip.payroll_month, '') || ' - ' || coalesce(v_slip.employee_name, ''), nullif(p_notes, '')),
        updated_at = now()
    where id = v_payment_id;

    if not found then
      raise exception 'سند دریافت/پرداخت مرتبط یافت نشد';
    end if;
  end if;

  perform public.fn_post_finance_payment(v_payment_id);

  update public.finance_payroll_payments
  set payment_id = v_payment_id,
      paid_amount = p_paid_amount,
      paid_at = p_paid_at,
      notes = p_notes,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_payroll_payment_id;

  perform public.fn_finance_recalc_payroll_slip_payment(v_payroll_payment.slip_id);

  return p_payroll_payment_id;
end;
$$;

create or replace function public.fn_finance_void_payroll_payment(
  p_payroll_payment_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payroll_payment public.finance_payroll_payments%rowtype;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی حذف/ابطال پرداخت حقوق ندارید';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'دلیل حذف/ابطال الزامی است';
  end if;

  select *
  into v_payroll_payment
  from public.finance_payroll_payments
  where id = p_payroll_payment_id
  for update;

  if not found then
    raise exception 'سند پرداخت حقوق یافت نشد';
  end if;

  if v_payroll_payment.status = 'void' then
    return p_payroll_payment_id;
  end if;

  if v_payroll_payment.payment_id is not null then
    update public.finance_journal_entries
    set status = 'void',
        description = concat_ws(E'\n', description, 'ابطال پرداخت حقوق: ' || p_reason)
    where related_payment_id = v_payroll_payment.payment_id
      and status in ('draft', 'posted');

    update public.finance_payments
    set status = 'void'::public.finance_payment_status,
        description = concat_ws(E'\n', description, 'ابطال/حذف امن پرداخت حقوق: ' || p_reason),
        updated_at = now()
    where id = v_payroll_payment.payment_id;
  end if;

  update public.finance_payroll_payments
  set status = 'void',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = p_reason,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_payroll_payment_id;

  perform public.fn_finance_recalc_payroll_slip_payment(v_payroll_payment.slip_id);

  return p_payroll_payment_id;
end;
$$;

-- If a payroll finance payment is voided from Cash & Bank, keep the payroll
-- file synchronized automatically.
create or replace function public.trg_sync_payroll_payment_void_from_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip_id uuid;
begin
  if new.status in ('void', 'cancelled')
     and old.status is distinct from new.status then
    for v_slip_id in
      update public.finance_payroll_payments
      set status = 'void',
          voided_at = coalesce(voided_at, now()),
          voided_by = coalesce(voided_by, auth.uid()),
          void_reason = coalesce(void_reason, 'ابطال سند از صندوق و گردش حساب'),
          updated_at = now(),
          updated_by = auth.uid()
      where payment_id = new.id
        and status = 'active'
      returning slip_id
    loop
      perform public.fn_finance_recalc_payroll_slip_payment(v_slip_id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_payroll_payment_void_from_finance on public.finance_payments;
create trigger trg_sync_payroll_payment_void_from_finance
after update of status on public.finance_payments
for each row execute function public.trg_sync_payroll_payment_void_from_finance();

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
  pp.created_at,
  pp.status as payroll_payment_status,
  pp.updated_at,
  pp.updated_by
from public.finance_payroll_payments pp
join public.finance_payroll_slips s on s.id = pp.slip_id
join public.finance_payroll_employees e on e.id = s.employee_id
left join public.finance_payments p on p.id = pp.payment_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
where pp.status = 'active';

revoke insert, update, delete on public.finance_payroll_payments from authenticated;
grant select on public.finance_payroll_payments to authenticated;
grant select on public.v_finance_payroll_payments to authenticated;
grant execute on function public.fn_finance_recalc_payroll_slip_payment(uuid) to authenticated;
grant execute on function public.fn_finance_register_payroll_payment(uuid,numeric,date,uuid,uuid,text) to authenticated;
grant execute on function public.fn_finance_update_payroll_payment(uuid,numeric,date,uuid,uuid,text) to authenticated;
grant execute on function public.fn_finance_void_payroll_payment(uuid,text) to authenticated;

notify pgrst, 'reload schema';

commit;
