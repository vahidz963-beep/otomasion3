-- 084 loan payments from bank/cash account, linked to one finance payment.
alter type public.finance_payment_method add value if not exists 'loan_payment';
insert into public.finance_accounts(code,name_fa,name_en,account_type,is_system) values('2010','وام‌ها و تسهیلات پرداختنی','Loans Payable','liability',true) on conflict(code) do update set name_fa=excluded.name_fa,is_system=true;
alter table public.finance_payments add column if not exists loan_id uuid references public.finance_loans(id) on delete set null;

create or replace function public.fn_finance_apply_loan_payment(p_loan_id uuid,p_start_installment_id uuid default null,p_paid_amount numeric default 0,p_paid_at date default current_date,p_payment_id uuid default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_remaining numeric:=coalesce(p_paid_amount,0);v_total numeric;v_allocated numeric:=0;v_row record;v_start_no int;v_count int:=0;v_apply numeric;
begin
 if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی ثبت پرداخت قسط ندارید'; end if;
 if v_remaining<=0 then raise exception 'مبلغ پرداخت باید بزرگ‌تر از صفر باشد'; end if;
 if p_start_installment_id is not null then select installment_no into v_start_no from public.finance_loan_installments where id=p_start_installment_id and loan_id=p_loan_id and status<>'cancelled' for update; else select min(installment_no) into v_start_no from public.finance_loan_installments where loan_id=p_loan_id and status not in ('paid','cancelled'); end if;
 if v_start_no is null then raise exception 'برای این وام قسط باز وجود ندارد'; end if;
 for v_row in select * from public.finance_loan_installments where loan_id=p_loan_id and installment_no>=v_start_no and status not in ('paid','cancelled') order by installment_no for update loop
   exit when v_remaining<=0; v_total:=greatest(coalesce(v_row.amount_due,0)-coalesce(v_row.paid_amount,0),0); if v_total<=0 then continue; end if; v_apply:=least(v_remaining,v_total);
   update public.finance_loan_installments set paid_amount=coalesce(paid_amount,0)+v_apply,paid_at=coalesce(p_paid_at,current_date),payment_id=coalesce(p_payment_id,payment_id),status=case when coalesce(paid_amount,0)+v_apply>=coalesce(amount_due,0) then 'paid' else 'pending' end,notes=concat_ws(E'\n',notes,p_notes),updated_at=now() where id=v_row.id;
   v_remaining:=v_remaining-v_apply;v_allocated:=v_allocated+v_apply;v_count:=v_count+1;
 end loop;
 if v_remaining>0 then raise exception 'مبلغ پرداخت از مانده کل اقساط بیشتر است'; end if;
 update public.finance_loans l set status=case when not exists(select 1 from public.finance_loan_installments i where i.loan_id=l.id and i.status not in ('paid','cancelled')) then 'closed' else l.status end,updated_at=now() where l.id=p_loan_id;
 return jsonb_build_object('loan_id',p_loan_id,'allocated_amount',v_allocated,'installment_count',v_count,'payment_id',p_payment_id);
end; $$;
grant execute on function public.fn_finance_apply_loan_payment(uuid,uuid,numeric,date,uuid,text) to authenticated;

create or replace function public.fn_post_finance_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_payment public.finance_payments%rowtype;v_entry_id uuid;v_cash_account uuid;v_to_account uuid;v_loan uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' and not public.has_role(array['admin','accountant']) then raise exception 'Only accountant/admin can post finance payments';end if;
 select * into v_payment from public.finance_payments where id=p_payment_id for update;if not found then raise exception 'Finance payment not found';end if;
 if v_payment.status in ('cancelled','void') then raise exception 'Cancelled/void payment cannot be posted';end if;
 if exists(select 1 from public.finance_journal_entries where related_payment_id=p_payment_id and status='posted') then return(select id from public.finance_journal_entries where related_payment_id=p_payment_id and status='posted' limit 1);end if;
 if v_payment.method='account_transfer' then v_cash_account:=public.fn_finance_account_id('1010');v_to_account:=public.fn_finance_account_id('1010');
 elsif v_payment.method='loan_payment' then v_cash_account:=case when v_payment.cashbox_id is not null then public.fn_finance_account_id('1000') else public.fn_finance_account_id('1010') end;
 else v_cash_account:=case when v_payment.method='cash' then public.fn_finance_account_id('1000') when v_payment.method='check' and v_payment.direction='receipt' then public.fn_finance_account_id('1120') when v_payment.method='check' and v_payment.direction='payment' then public.fn_finance_account_id('2020') else public.fn_finance_account_id('1010') end;end if;
 insert into public.finance_journal_entries(entry_date,description,source_module,source_id,related_payment_id,created_by,status,posted_by,posted_at) values(v_payment.payment_date,case when v_payment.method='loan_payment' then 'پرداخت قسط وام '||v_payment.payment_number when v_payment.method='account_transfer' then 'انتقال وجه بین حساب‌ها '||v_payment.payment_number else 'ثبت دریافت/پرداخت '||v_payment.payment_number end,coalesce(v_payment.source_module,'accounting'),v_payment.id,v_payment.id,coalesce(v_payment.created_by,auth.uid()),'posted',auth.uid(),now()) returning id into v_entry_id;
 if v_payment.method='loan_payment' then
   v_loan:=coalesce(v_payment.loan_id,v_payment.source_record_id);if v_loan is null then raise exception 'وام برای سند پرداخت انتخاب نشده است';end if;
   insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description) values(v_entry_id,public.fn_finance_account_id('2010'),v_payment.amount,'کاهش بدهی وام');
   insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description) values(v_entry_id,v_cash_account,v_payment.amount,'پرداخت قسط وام از بانک/صندوق');
 elsif v_payment.method='account_transfer' then
   if v_payment.bank_account_id is null or v_payment.transfer_to_bank_account_id is null or v_payment.bank_account_id=v_payment.transfer_to_bank_account_id then raise exception 'حساب مبدأ و مقصد انتقال را متفاوت انتخاب کنید';end if;
   insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description) values(v_entry_id,v_to_account,v_payment.amount,'افزایش موجودی حساب مقصد');
   insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description) values(v_entry_id,v_cash_account,v_payment.amount,'کاهش موجودی حساب مبدأ');
 elsif v_payment.direction='receipt' then
   insert into public.finance_journal_lines(entry_id,account_id,party_id,debit_amount,description,related_order_id) values(v_entry_id,v_cash_account,v_payment.party_id,v_payment.amount,'دریافت وجه',v_payment.related_order_id);
   insert into public.finance_journal_lines(entry_id,account_id,party_id,credit_amount,description,related_order_id) values(v_entry_id,public.fn_finance_account_id('1100'),v_payment.party_id,v_payment.amount,'کاهش دریافتنی',v_payment.related_order_id);
 else
   insert into public.finance_journal_lines(entry_id,account_id,party_id,debit_amount,description,related_order_id) values(v_entry_id,public.fn_finance_account_id('2000'),v_payment.party_id,v_payment.amount,'کاهش پرداختنی',v_payment.related_order_id);
   insert into public.finance_journal_lines(entry_id,account_id,party_id,credit_amount,description,related_order_id) values(v_entry_id,v_cash_account,v_payment.party_id,v_payment.amount,'پرداخت وجه',v_payment.related_order_id);
 end if;
 if not public.fn_finance_assert_journal_balanced(v_entry_id) then raise exception 'Journal entry is not balanced';end if;
 update public.finance_payments set status='confirmed',updated_at=now() where id=p_payment_id;return v_entry_id;
end; $$;
grant execute on function public.fn_post_finance_payment(uuid) to authenticated;
notify pgrst,'reload schema';
