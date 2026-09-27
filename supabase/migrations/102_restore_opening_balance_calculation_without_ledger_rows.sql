-- 102 restore opening balances as calculation-only values.
-- No synthetic opening document/ledger row is displayed for banks, cashboxes or parties.
-- Bank/cash balances still include their opening_balance in v_finance_account_turnover.
-- Party balances include finance_parties.opening_balance in v_party_balances.

drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger with (security_invoker=true) as
select p.id,p.payment_number,p.direction,p.method,p.status,p.party_id,fp.display_name party_name,p.payment_date,p.amount,p.currency,case when p.bank_account_id is not null then 'bank' else 'cashbox' end account_kind,coalesce(p.bank_account_id,p.cashbox_id) account_id,coalesce(ba.account_name,cb.name) account_name,coalesce(ba.bank_name,'صندوق') bank_name,p.related_order_id,o.order_code,p.source_module,p.source_record_id,p.description,p.created_at,p.transfer_to_bank_account_id,dest.account_name transfer_to_account_name
from public.finance_payments p left join public.finance_parties fp on fp.id=p.party_id left join public.finance_bank_accounts ba on ba.id=p.bank_account_id left join public.finance_cashboxes cb on cb.id=p.cashbox_id left join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id left join public.orders o on o.id=p.related_order_id;
grant select on public.v_finance_payment_ledger to authenticated;

create or replace view public.v_party_statement with (security_invoker=true) as
with rows as (
 select d.party_id,d.issue_date entry_date,d.doc_number ref_number,d.document_type::text entry_type,d.description,
 case when d.document_type in ('sales_invoice','debit_note','purchase_return') then d.total_amount else 0 end debit_amount,
 case when d.document_type in ('purchase_invoice','expense_invoice','sales_return','credit_note') then d.total_amount else 0 end credit_amount,d.related_order_id,d.id document_id,null::uuid payment_id,d.created_at
 from public.finance_documents d where d.status not in ('draft','cancelled','void')
 union all
 select p.party_id,p.payment_date,p.payment_number,p.direction::text,p.description,
 case when p.direction='payment' then p.amount else 0 end,case when p.direction='receipt' then p.amount else 0 end,p.related_order_id,null::uuid,p.id,p.created_at
 from public.finance_payments p where p.status='confirmed'
)
select r.party_id,r.entry_date,r.ref_number,r.entry_type,r.description,r.debit_amount,r.credit_amount,r.related_order_id,r.document_id,r.payment_id,
coalesce(fp.opening_balance,0)+sum(r.debit_amount-r.credit_amount) over(partition by r.party_id order by r.entry_date,r.created_at,r.ref_number rows unbounded preceding) running_balance
from rows r join public.finance_parties fp on fp.id=r.party_id;
grant select on public.v_party_statement to authenticated,service_role;

create or replace view public.v_party_balances with (security_invoker=true) as
select p.id party_id,p.display_name,p.party_type,p.phone,p.email,
coalesce(p.opening_balance,0)+coalesce(sum(s.debit_amount-s.credit_amount),0) balance,
coalesce(case when p.opening_balance>0 then p.opening_balance else 0 end,0)+coalesce(sum(s.debit_amount),0) total_debit,
coalesce(case when p.opening_balance<0 then abs(p.opening_balance) else 0 end,0)+coalesce(sum(s.credit_amount),0) total_credit,p.customer_code
from public.finance_parties p left join public.v_party_statement s on s.party_id=p.id group by p.id;
grant select on public.v_party_balances to authenticated,service_role;
notify pgrst,'reload schema';
