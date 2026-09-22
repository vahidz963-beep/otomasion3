-- 086 expose transfer destination for running balance calculation.
-- The frontend calculates the balance after every receipt/payment without changing data.
drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger with (security_invoker=true) as
select p.id,p.payment_number,p.direction,p.method,p.status,p.party_id,fp.display_name party_name,p.payment_date,p.amount,p.currency,case when p.bank_account_id is not null then 'bank' else 'cashbox' end account_kind,coalesce(p.bank_account_id,p.cashbox_id) account_id,coalesce(ba.account_name,cb.name) account_name,coalesce(ba.bank_name,'صندوق') bank_name,p.related_order_id,o.order_code,p.source_module,p.source_record_id,p.description,p.created_at,p.transfer_to_bank_account_id,dest.account_name transfer_to_account_name
from public.finance_payments p left join public.finance_parties fp on fp.id=p.party_id left join public.finance_bank_accounts ba on ba.id=p.bank_account_id left join public.finance_cashboxes cb on cb.id=p.cashbox_id left join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id left join public.orders o on o.id=p.related_order_id;
grant select on public.v_finance_payment_ledger to authenticated;
notify pgrst,'reload schema';
