-- 080 expose account transfers in existing views without changing view columns.
-- Important: v_finance_account_turnover and v_finance_payment_ledger keep their
-- historical column order so CREATE OR REPLACE VIEW remains compatible.

create or replace function public.fn_post_finance_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_payment public.finance_payments%rowtype; v_entry_id uuid; v_cash_account uuid; v_to_account uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.has_role(array['admin','accountant']) then raise exception 'Only accountant/admin can post finance payments'; end if;
  select * into v_payment from public.finance_payments where id=p_payment_id for update;
  if not found then raise exception 'Finance payment not found'; end if;
  if v_payment.status in ('cancelled','void') then raise exception 'Cancelled/void payment cannot be posted'; end if;
  if exists(select 1 from public.finance_journal_entries where related_payment_id=p_payment_id and status='posted') then return (select id from public.finance_journal_entries where related_payment_id=p_payment_id and status='posted' limit 1); end if;
  if v_payment.method='account_transfer' then
    if v_payment.bank_account_id is null or v_payment.transfer_to_bank_account_id is null or v_payment.bank_account_id=v_payment.transfer_to_bank_account_id then raise exception 'حساب مبدأ و مقصد انتقال را به‌صورت متفاوت انتخاب کنید'; end if;
    v_cash_account := public.fn_finance_account_id('1010'); v_to_account := public.fn_finance_account_id('1010');
  else
    v_cash_account := case when v_payment.method='cash' then public.fn_finance_account_id('1000') when v_payment.method='check' and v_payment.direction='receipt' then public.fn_finance_account_id('1120') when v_payment.method='check' and v_payment.direction='payment' then public.fn_finance_account_id('2020') else public.fn_finance_account_id('1010') end;
  end if;
  insert into public.finance_journal_entries(entry_date,description,source_module,source_id,related_payment_id,created_by,status,posted_by,posted_at) values(v_payment.payment_date,case when v_payment.method='account_transfer' then 'انتقال وجه بین حساب‌ها '||v_payment.payment_number else 'ثبت دریافت/پرداخت '||v_payment.payment_number end,coalesce(v_payment.source_module,'accounting'),v_payment.id,v_payment.id,coalesce(v_payment.created_by,auth.uid()),'posted',auth.uid(),now()) returning id into v_entry_id;
  if v_payment.method='account_transfer' then
    insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description) values(v_entry_id,v_to_account,v_payment.amount,'افزایش موجودی حساب مقصد');
    insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description) values(v_entry_id,v_cash_account,v_payment.amount,'کاهش موجودی حساب مبدأ');
  elsif v_payment.direction='receipt' then
    insert into public.finance_journal_lines(entry_id,account_id,party_id,debit_amount,description,related_order_id) values(v_entry_id,v_cash_account,v_payment.party_id,v_payment.amount,'دریافت وجه',v_payment.related_order_id);
    insert into public.finance_journal_lines(entry_id,account_id,party_id,credit_amount,description,related_order_id) values(v_entry_id,public.fn_finance_account_id('1100'),v_payment.party_id,v_payment.amount,'کاهش دریافتنی',v_payment.related_order_id);
  else
    insert into public.finance_journal_lines(entry_id,account_id,party_id,debit_amount,description,related_order_id) values(v_entry_id,public.fn_finance_account_id('2000'),v_payment.party_id,v_payment.amount,'کاهش پرداختنی',v_payment.related_order_id);
    insert into public.finance_journal_lines(entry_id,account_id,party_id,credit_amount,description,related_order_id) values(v_entry_id,v_cash_account,v_payment.party_id,v_payment.amount,'پرداخت وجه',v_payment.related_order_id);
  end if;
  if not public.fn_finance_assert_journal_balanced(v_entry_id) then raise exception 'Journal entry is not balanced'; end if;
  update public.finance_payments set status='confirmed',updated_at=now() where id=p_payment_id;
  perform public.fn_finance_update_document_paid_amount(a.document_id) from public.finance_payment_allocations a where a.payment_id=p_payment_id;
  return v_entry_id;
end; $$;

grant execute on function public.fn_post_finance_payment(uuid) to authenticated;

-- The previous draft of 080 may have added transfer columns to the ledger view.
-- Drop and recreate only these read-only views so their schema is deterministic.
drop view if exists public.v_finance_account_turnover;
drop view if exists public.v_finance_payment_ledger;

create view public.v_finance_account_turnover with (security_invoker=true) as
select 'bank'::text account_kind,ba.id account_id,ba.account_name,ba.bank_name,ba.account_number,ba.iban,ba.currency,ba.account_usage::text account_usage,ba.opening_balance,
coalesce(sum(case when p.status='confirmed' and ((p.direction='receipt' and p.bank_account_id=ba.id) or (p.method='account_transfer' and p.transfer_to_bank_account_id=ba.id)) then p.amount else 0 end),0) total_receipts,
coalesce(sum(case when p.status='confirmed' and ((p.direction='payment' and p.bank_account_id=ba.id) or (p.method='account_transfer' and p.bank_account_id=ba.id)) then p.amount else 0 end),0) total_payments,
ba.opening_balance+coalesce(sum(case when p.status='confirmed' and ((p.direction='receipt' and p.bank_account_id=ba.id) or (p.method='account_transfer' and p.transfer_to_bank_account_id=ba.id)) then p.amount else 0 end),0)-coalesce(sum(case when p.status='confirmed' and ((p.direction='payment' and p.bank_account_id=ba.id) or (p.method='account_transfer' and p.bank_account_id=ba.id)) then p.amount else 0 end),0) current_balance,max(case when p.bank_account_id=ba.id or p.transfer_to_bank_account_id=ba.id then p.payment_date end) last_movement_date,
ba.card_number,ba.branch_name,ba.account_holder_name,ba.notes,ba.is_active
from public.finance_bank_accounts ba left join public.finance_payments p on p.bank_account_id=ba.id or p.transfer_to_bank_account_id=ba.id
where ba.is_active is true
group by ba.id
union all
select 'cashbox'::text,cb.id,cb.name,'صندوق'::text,null::text,null::text,cb.currency,'cash'::text,cb.opening_balance,
coalesce(sum(case when p.direction='receipt' and p.status='confirmed' then p.amount else 0 end),0),coalesce(sum(case when p.direction='payment' and p.status='confirmed' then p.amount else 0 end),0),cb.opening_balance+coalesce(sum(case when p.direction='receipt' and p.status='confirmed' then p.amount else 0 end),0)-coalesce(sum(case when p.direction='payment' and p.status='confirmed' then p.amount else 0 end),0),max(p.payment_date),null::text,null::text,null::text,null::text,cb.is_active
from public.finance_cashboxes cb left join public.finance_payments p on p.cashbox_id=cb.id
where cb.is_active is true
group by cb.id;

create view public.v_finance_payment_ledger with (security_invoker=true) as
select p.id,p.payment_number,p.direction,p.method,p.status,p.party_id,fp.display_name party_name,p.payment_date,p.amount,p.currency,case when p.bank_account_id is not null then 'bank' else 'cashbox' end account_kind,coalesce(p.bank_account_id,p.cashbox_id) account_id,coalesce(ba.account_name,cb.name) account_name,coalesce(ba.bank_name,'صندوق') bank_name,p.related_order_id,o.order_code,p.source_module,p.source_record_id,p.description,p.created_at
from public.finance_payments p left join public.finance_parties fp on fp.id=p.party_id left join public.finance_bank_accounts ba on ba.id=p.bank_account_id left join public.finance_cashboxes cb on cb.id=p.cashbox_id left join public.orders o on o.id=p.related_order_id;

notify pgrst,'reload schema';
