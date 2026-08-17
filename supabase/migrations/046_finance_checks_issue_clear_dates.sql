-- =====================================================================
-- 046_FINANCE_CHECKS_ISSUE_CLEAR_DATES
-- Adds issue/clear dates for checks and updates check settlement RPC.
-- =====================================================================

alter table public.finance_checks
  add column if not exists issue_date date not null default current_date,
  add column if not exists cleared_date date;

create index if not exists idx_finance_checks_issue on public.finance_checks(issue_date);
create index if not exists idx_finance_checks_cleared on public.finance_checks(cleared_date);

create or replace function public.fn_finance_settle_check(
  p_check_id uuid,
  p_bank_account_id uuid,
  p_status text default 'cleared',
  p_note text default null,
  p_cleared_date date default current_date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check public.finance_checks%rowtype;
  v_payment_id uuid;
  v_direction public.finance_payment_direction;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی مالی ندارید';
  end if;

  select * into v_check from public.finance_checks where id = p_check_id for update;
  if not found then raise exception 'چک یافت نشد'; end if;

  if p_status not in ('deposited','cleared','returned','cancelled') then
    raise exception 'وضعیت چک نامعتبر است';
  end if;

  update public.finance_checks
  set status = p_status,
      cleared_date = case when p_status = 'cleared' then coalesce(p_cleared_date, current_date) else cleared_date end,
      updated_at = now()
  where id = p_check_id;

  -- When a check clears, create and post the actual bank movement if not already linked.
  if p_status = 'cleared' and v_check.related_payment_id is null then
    v_direction := case when v_check.check_type = 'received' then 'receipt'::public.finance_payment_direction else 'payment'::public.finance_payment_direction end;

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
      description,
      source_module,
      source_record_id,
      created_by
    ) values (
      null,
      v_direction,
      'check',
      'draft',
      v_check.party_id,
      coalesce(p_cleared_date, current_date),
      v_check.amount,
      'IRR',
      p_bank_account_id,
      coalesce(p_note, '') || ' وصول/تسویه چک ' || coalesce(v_check.check_number, v_check.internal_check_code, ''),
      'accounting',
      p_check_id,
      auth.uid()
    ) returning id into v_payment_id;

    update public.finance_checks
    set related_payment_id = v_payment_id,
        cleared_date = coalesce(p_cleared_date, current_date)
    where id = p_check_id;

    perform public.fn_post_finance_payment(v_payment_id);
  else
    v_payment_id := v_check.related_payment_id;
  end if;

  return coalesce(v_payment_id, p_check_id);
end;
$$;

grant execute on function public.fn_finance_settle_check(uuid,uuid,text,text,date) to authenticated;

notify pgrst, 'reload schema';
