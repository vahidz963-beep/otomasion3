-- 103 accounting-style opening balance rows.
-- 1405/05/30 = 2026-08-21.
-- These rows are read-only opening-balance entries, not receipts/payments.

drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger with (security_invoker=true) as
select p.id,p.payment_number,p.direction,p.method,p.status,p.party_id,fp.display_name party_name,p.payment_date,p.amount,p.currency,case when p.bank_account_id is not null then 'bank' else 'cashbox' end account_kind,coalesce(p.bank_account_id,p.cashbox_id) account_id,coalesce(ba.account_name,cb.name) account_name,coalesce(ba.bank_name,'صندوق') bank_name,p.related_order_id,o.order_code,p.source_module,p.source_record_id,p.description,p.created_at,p.transfer_to_bank_account_id,dest.account_name transfer_to_account_name
from public.finance_payments p left join public.finance_parties fp on fp.id=p.party_id left join public.finance_bank_accounts ba on ba.id=p.bank_account_id left join public.finance_cashboxes cb on cb.id=p.cashbox_id left join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id left join public.orders o on o.id=p.related_order_id
union all
select gen_random_uuid(),('OB-BANK-'||right(replace(ba.id::text,'-',''),8)),'receipt'::public.finance_payment_direction,'opening_balance'::public.finance_payment_method,'confirmed'::public.finance_payment_status,null::uuid,null::text,date '2026-08-21',ba.opening_balance,ba.currency,'bank'::text,ba.id,ba.account_name,coalesce(ba.bank_name,'بانک'),null::uuid,null::text,'accounting'::text,null::uuid,'موجودی اول دوره حساب '||ba.account_name,now(),null::uuid,null::text
from public.finance_bank_accounts ba where ba.is_active is true and coalesce(ba.opening_balance,0)<>0
union all
select gen_random_uuid(),('OB-CASH-'||right(replace(cb.id::text,'-',''),8)),'receipt'::public.finance_payment_direction,'opening_balance'::public.finance_payment_method,'confirmed'::public.finance_payment_status,null::uuid,null::text,date '2026-08-21',cb.opening_balance,cb.currency,'cashbox'::text,cb.id,cb.name,'صندوق',null::uuid,null::text,'accounting'::text,null::uuid,'موجودی اول دوره صندوق '||cb.name,now(),null::uuid,null::text
from public.finance_cashboxes cb where cb.is_active is true and coalesce(cb.opening_balance,0)<>0;
grant select on public.v_finance_payment_ledger to authenticated;

create or replace view public.v_party_statement with (security_invoker=true) as
with rows as (
 select p.id party_id,date '2026-08-21' entry_date,'OPENING'::text ref_number,'opening_balance'::text entry_type,'مانده اول دوره'::text description,
 case when coalesce(p.opening_balance,0)>0 then p.opening_balance else 0 end debit_amount,
 case when coalesce(p.opening_balance,0)<0 then abs(p.opening_balance) else 0 end credit_amount,null::uuid related_order_id,null::uuid document_id,null::uuid payment_id,p.created_at
 from public.finance_parties p where coalesce(p.opening_balance,0)<>0
 union all
 select d.party_id,d.issue_date,d.doc_number,d.document_type::text,d.description,
 case when d.document_type in ('sales_invoice','debit_note','purchase_return') then d.total_amount else 0 end,
 case when d.document_type in ('purchase_invoice','expense_invoice','sales_return','credit_note') then d.total_amount else 0 end,d.related_order_id,d.id,null::uuid,d.created_at
 from public.finance_documents d where d.status not in ('draft','cancelled','void')
 union all
 select p.party_id,p.payment_date,p.payment_number,p.direction::text,p.description,
 case when p.direction='payment' then p.amount else 0 end,case when p.direction='receipt' then p.amount else 0 end,p.related_order_id,null::uuid,p.id,p.created_at
 from public.finance_payments p where p.status='confirmed'
)
select party_id,entry_date,ref_number,entry_type,description,debit_amount,credit_amount,related_order_id,document_id,payment_id,
sum(debit_amount-credit_amount) over(partition by party_id order by entry_date,created_at,ref_number rows unbounded preceding) running_balance
from rows;
grant select on public.v_party_statement to authenticated,service_role;

create or replace view public.v_party_balances with (security_invoker=true) as
select p.id party_id,p.display_name,p.party_type,p.phone,p.email,coalesce(sum(s.debit_amount-s.credit_amount),0) balance,coalesce(sum(s.debit_amount),0) total_debit,coalesce(sum(s.credit_amount),0) total_credit,p.customer_code
from public.finance_parties p left join public.v_party_statement s on s.party_id=p.id group by p.id;
grant select on public.v_party_balances to authenticated,service_role;
notify pgrst,'reload schema';
