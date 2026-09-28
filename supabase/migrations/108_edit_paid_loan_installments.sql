-- 108 allow safe edits on every installment, including paid installments.
create or replace function public.fn_finance_update_loan_installment(p_installment_id uuid,p_amount_due numeric,p_due_date date,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_paid numeric;
begin
 if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی ویرایش قسط ندارید'; end if;
 select paid_amount into v_paid from public.finance_loan_installments where id=p_installment_id for update;
 if not found then raise exception 'قسط یافت نشد'; end if;
 if coalesce(p_amount_due,0)<coalesce(v_paid,0) then raise exception 'مبلغ قسط نمی‌تواند کمتر از مبلغ پرداخت‌شده باشد'; end if;
 update public.finance_loan_installments set amount_due=p_amount_due,due_date=p_due_date,notes=p_notes,updated_at=now(),status=case when coalesce(paid_amount,0)>=p_amount_due then 'paid' when p_due_date<current_date then 'overdue' else 'pending' end where id=p_installment_id;
 return p_installment_id;
end; $$;
grant execute on function public.fn_finance_update_loan_installment(uuid,numeric,date,text) to authenticated;
notify pgrst,'reload schema';
