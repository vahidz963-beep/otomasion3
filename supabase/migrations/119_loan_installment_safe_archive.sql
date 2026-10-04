-- 119 safe archive/cancel for loan installments; financial rows are never deleted.
create or replace function public.fn_finance_archive_loan_installment(p_installment_id uuid,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
 if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی حذف/لغو قسط ندارید'; end if;
 select status into v_status from public.finance_loan_installments where id=p_installment_id for update;
 if not found then raise exception 'قسط یافت نشد'; end if;
 if v_status='paid' or exists(select 1 from public.finance_loan_installments where id=p_installment_id and coalesce(paid_amount,0)>0) then
   raise exception 'قسط پرداخت‌شده حذف نمی‌شود؛ ابتدا سند پرداخت را باطل کنید';
 end if;
 update public.finance_loan_installments set status='cancelled',notes=concat_ws(E'\n',notes,coalesce(p_reason,'لغو امن قسط')),updated_at=now() where id=p_installment_id;
 return p_installment_id;
end; $$;
grant execute on function public.fn_finance_archive_loan_installment(uuid,text) to authenticated;
notify pgrst,'reload schema';
