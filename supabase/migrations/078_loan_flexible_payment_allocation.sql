-- 078 FLEXIBLE LOAN PAYMENT ALLOCATION
-- One accounting payment can fully/partially settle one or more installments.
-- No existing payment or installment is deleted.

create or replace function public.fn_finance_apply_loan_payment(
  p_loan_id uuid,
  p_start_installment_id uuid,
  p_paid_amount numeric,
  p_paid_at date default current_date,
  p_payment_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_remaining numeric := coalesce(p_paid_amount, 0);
  v_total numeric := 0;
  v_allocated numeric := 0;
  v_row record;
  v_start_no int;
  v_count int := 0;
begin
  if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی ثبت پرداخت قسط ندارید'; end if;
  if v_remaining <= 0 then raise exception 'مبلغ پرداخت باید بزرگ‌تر از صفر باشد'; end if;

  select installment_no into v_start_no
  from public.finance_loan_installments
  where id = p_start_installment_id and loan_id = p_loan_id and status <> 'cancelled'
  for update;
  if v_start_no is null then raise exception 'قسط انتخاب‌شده یافت نشد'; end if;

  for v_row in
    select * from public.finance_loan_installments
    where loan_id = p_loan_id
      and installment_no >= v_start_no
      and status not in ('paid','cancelled')
    order by installment_no
    for update
  loop
    exit when v_remaining <= 0;
    v_total := greatest(coalesce(v_row.amount_due,0) - coalesce(v_row.paid_amount,0), 0);
    if v_total <= 0 then continue; end if;
    declare v_apply numeric := least(v_remaining, v_total);
    begin
      update public.finance_loan_installments
      set paid_amount = coalesce(paid_amount,0) + v_apply,
          paid_at = coalesce(p_paid_at, current_date),
          payment_id = coalesce(p_payment_id, payment_id),
          status = case when coalesce(paid_amount,0) + v_apply >= coalesce(amount_due,0) then 'paid' else 'pending' end,
          notes = concat_ws(E'\n', notes, p_notes),
          updated_at = now()
      where id = v_row.id;
      v_remaining := v_remaining - v_apply;
      v_allocated := v_allocated + v_apply;
      v_count := v_count + 1;
    end;
  end loop;

  if v_remaining > 0 then raise exception 'مبلغ پرداخت از مانده اقساط انتخاب‌شده بیشتر است'; end if;

  update public.finance_loans l
  set status = case when not exists (select 1 from public.finance_loan_installments i where i.loan_id=l.id and i.status not in ('paid','cancelled')) then 'closed' else l.status end,
      updated_at = now()
  where l.id = p_loan_id;

  return jsonb_build_object('loan_id',p_loan_id,'allocated_amount',v_allocated,'installment_count',v_count,'payment_id',p_payment_id);
end;
$$;

grant execute on function public.fn_finance_apply_loan_payment(uuid,uuid,numeric,date,uuid,text) to authenticated;
notify pgrst, 'reload schema';
