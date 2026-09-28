-- 107 restore loan installment balances when a linked payment is voided.
create or replace function public.fn_finance_reverse_loan_payment(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_total numeric:=0;v_loan uuid;v_row record;
begin
 if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی ابطال پرداخت وام ندارید'; end if;
 for v_row in select id,loan_id,paid_amount,amount_due,due_date from public.finance_loan_installments where payment_id=p_payment_id for update loop
   v_total:=v_total+coalesce(v_row.paid_amount,0);
   update public.finance_loan_installments set paid_amount=0,paid_at=null,payment_id=null,status=case when due_date<current_date then 'overdue' else 'pending' end,notes=concat_ws(E'\n',notes,'ابطال سند پرداخت مرتبط'),updated_at=now() where id=v_row.id;
   v_loan:=v_row.loan_id;
 end loop;
 if v_loan is not null then update public.finance_loans set status='active',updated_at=now() where id=v_loan and status='closed'; end if;
 return jsonb_build_object('payment_id',p_payment_id,'restored_amount',v_total,'loan_id',v_loan);
end; $$;
grant execute on function public.fn_finance_reverse_loan_payment(uuid) to authenticated;
notify pgrst,'reload schema';
