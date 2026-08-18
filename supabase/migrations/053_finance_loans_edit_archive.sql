-- =====================================================================
-- 053_FINANCE_LOANS_EDIT_ARCHIVE
-- Adds safe edit/archive RPCs for the Finance Loans module.
-- - Edit loan header information
-- - Optionally rebuild unpaid installments from updated amount/count/dates
-- - Preserve paid installments
-- - Archive/delete a loan safely without deleting payment history
-- =====================================================================

create or replace function public.fn_finance_add_months(p_date date, p_months int)
returns date
language sql
immutable
as $$
  select (p_date + make_interval(months => coalesce(p_months, 0)))::date;
$$;

create or replace function public.fn_finance_update_loan(
  p_loan_id uuid,
  p_loan jsonb,
  p_regenerate_installments boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.finance_loans%rowtype;
  v_total numeric;
  v_principal numeric;
  v_count int;
  v_interval int;
  v_first_due date;
  v_paid_total numeric;
  v_unpaid_count int;
  v_unpaid_amount numeric;
  v_installment_amount numeric;
  v_no int;
  v_remaining_index int := 0;
  v_status text;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ویرایش وام ندارید';
  end if;

  select * into v_loan
  from public.finance_loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'وام یافت نشد';
  end if;

  v_principal := greatest(coalesce(nullif(p_loan->>'principal_amount','')::numeric, v_loan.principal_amount), 0);
  v_total := greatest(coalesce(nullif(p_loan->>'total_payable_amount','')::numeric, v_loan.total_payable_amount, v_principal), 0);
  v_count := greatest(coalesce(nullif(p_loan->>'installment_count','')::int, v_loan.installment_count, 1), 1);
  v_interval := greatest(coalesce(nullif(p_loan->>'installment_interval_months','')::int, v_loan.installment_interval_months, 1), 1);
  v_first_due := coalesce(nullif(p_loan->>'first_due_date','')::date, v_loan.first_due_date, current_date);
  v_status := coalesce(nullif(p_loan->>'status',''), v_loan.status, 'active');
  if v_status not in ('active','closed','cancelled','archived') then
    v_status := 'active';
  end if;

  update public.finance_loans
  set title_fa = coalesce(nullif(trim(p_loan->>'title_fa'), ''), v_loan.title_fa),
      lender_name = coalesce(nullif(trim(p_loan->>'lender_name'), ''), v_loan.lender_name),
      lender_type = coalesce(nullif(p_loan->>'lender_type', ''), v_loan.lender_type, 'bank'),
      bank_name = nullif(trim(coalesce(p_loan->>'bank_name', v_loan.bank_name)), ''),
      principal_amount = v_principal,
      total_payable_amount = v_total,
      installment_count = v_count,
      installment_interval_months = v_interval,
      interest_rate = greatest(coalesce(nullif(p_loan->>'interest_rate','')::numeric, v_loan.interest_rate, 0), 0),
      received_date = coalesce(nullif(p_loan->>'received_date','')::date, v_loan.received_date, current_date),
      first_due_date = v_first_due,
      status = v_status,
      notes = nullif(trim(coalesce(p_loan->>'notes', v_loan.notes)), ''),
      updated_at = now()
  where id = p_loan_id;

  if p_regenerate_installments then
    select coalesce(sum(paid_amount), 0), count(*)
    into v_paid_total, v_remaining_index
    from public.finance_loan_installments
    where loan_id = p_loan_id
      and status = 'paid';

    v_unpaid_count := greatest(v_count - coalesce(v_remaining_index, 0), 0);
    v_unpaid_amount := greatest(v_total - coalesce(v_paid_total, 0), 0);
    v_installment_amount := case when v_unpaid_count > 0 then round(v_unpaid_amount / v_unpaid_count) else 0 end;

    delete from public.finance_loan_installments
    where loan_id = p_loan_id
      and status <> 'paid';

    v_remaining_index := 0;
    for v_no in 1..v_count loop
      if exists (
        select 1 from public.finance_loan_installments
        where loan_id = p_loan_id and installment_no = v_no and status = 'paid'
      ) then
        continue;
      end if;

      v_remaining_index := v_remaining_index + 1;
      insert into public.finance_loan_installments (
        loan_id, installment_no, due_date, principal_amount, interest_amount,
        fee_amount, amount_due, status, notes
      ) values (
        p_loan_id,
        v_no,
        public.fn_finance_add_months(v_first_due, (v_no - 1) * v_interval),
        case when v_unpaid_count > 0 then (case when v_remaining_index = v_unpaid_count then v_unpaid_amount - (v_installment_amount * (v_unpaid_count - 1)) else v_installment_amount end) else 0 end,
        0,
        0,
        case when v_unpaid_count > 0 then (case when v_remaining_index = v_unpaid_count then v_unpaid_amount - (v_installment_amount * (v_unpaid_count - 1)) else v_installment_amount end) else 0 end,
        case when public.fn_finance_add_months(v_first_due, (v_no - 1) * v_interval) < current_date then 'overdue' else 'pending' end,
        'بازسازی خودکار بعد از ویرایش وام'
      );
    end loop;
  end if;

  perform public.fn_finance_refresh_loan_installment_statuses();
  return p_loan_id;
end;
$$;

create or replace function public.fn_finance_archive_loan(
  p_loan_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی حذف/بایگانی وام ندارید';
  end if;

  if not exists (select 1 from public.finance_loans where id = p_loan_id) then
    raise exception 'وام یافت نشد';
  end if;

  v_reason := 'حذف/بایگانی وام'
    || case when nullif(trim(p_reason), '') is not null then ': ' || trim(p_reason) else '' end;

  update public.finance_loans
  set status = 'archived',
      notes = concat_ws(E'\n', nullif(notes, ''), v_reason),
      updated_at = now()
  where id = p_loan_id;

  update public.finance_loan_installments
  set status = 'cancelled',
      notes = concat_ws(E'\n', nullif(notes, ''), v_reason),
      updated_at = now()
  where loan_id = p_loan_id
    and status <> 'paid';

  return p_loan_id;
end;
$$;

grant execute on function public.fn_finance_update_loan(uuid,jsonb,boolean) to authenticated;
grant execute on function public.fn_finance_archive_loan(uuid,text) to authenticated;
grant execute on function public.fn_finance_add_months(date,int) to authenticated;

notify pgrst, 'reload schema';
