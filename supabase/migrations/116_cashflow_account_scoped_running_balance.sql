-- 116: account-scoped, confirmed-only running balances.
-- A movement on one bank/cash account must never change another account's balance.
drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger with (security_invoker=true) as
with rows as (
  select p.id,p.payment_number,p.direction,p.method,p.status,p.party_id,fp.display_name party_name,p.payment_date,p.amount,p.currency,
    case when p.bank_account_id is not null then 'bank' else 'cashbox' end account_kind,
    coalesce(p.bank_account_id,p.cashbox_id) account_id,coalesce(ba.account_name,cb.name) account_name,
    coalesce(ba.bank_name,'صندوق') bank_name,p.related_order_id,o.order_code,p.source_module,p.source_record_id,p.description,p.created_at,
    p.transfer_to_bank_account_id,dest.account_name transfer_to_account_name
  from public.finance_payments p
  left join public.finance_parties fp on fp.id=p.party_id
  left join public.finance_bank_accounts ba on ba.id=p.bank_account_id
  left join public.finance_cashboxes cb on cb.id=p.cashbox_id
  left join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id
  left join public.orders o on o.id=p.related_order_id
  where p.status='confirmed'
  union all
  select gen_random_uuid(),('TR-DEST-'||right(replace(p.id::text,'-',''),8)),'receipt'::public.finance_payment_direction,
    'bank_transfer'::public.finance_payment_method,'confirmed'::public.finance_payment_status,null::uuid,null::text,p.payment_date,p.amount,p.currency,
    'bank'::text,dest.id,dest.account_name,coalesce(dest.bank_name,'بانک'),null::uuid,null::text,'accounting'::text,p.id,
    'واریز انتقال بین بانکی از '||coalesce(src.account_name,'حساب مبدأ'),p.created_at,null::uuid,null::text
  from public.finance_payments p
  join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id
  left join public.finance_bank_accounts src on src.id=p.bank_account_id
  where p.method='account_transfer' and p.status='confirmed'
  union all
  select gen_random_uuid(),('OB-BANK-'||right(replace(ba.id::text,'-',''),8)),'receipt'::public.finance_payment_direction,
    'opening_balance'::public.finance_payment_method,'confirmed'::public.finance_payment_status,null::uuid,null::text,date '2026-08-21',ba.opening_balance,ba.currency,
    'bank'::text,ba.id,ba.account_name,coalesce(ba.bank_name,'بانک'),null::uuid,null::text,'accounting'::text,null::uuid,
    'موجودی اول دوره حساب '||ba.account_name,now(),null::uuid,null::text
  from public.finance_bank_accounts ba where ba.is_active is true and coalesce(ba.opening_balance,0)<>0
  union all
  select gen_random_uuid(),('OB-CASH-'||right(replace(cb.id::text,'-',''),8)),'receipt'::public.finance_payment_direction,
    'opening_balance'::public.finance_payment_method,'confirmed'::public.finance_payment_status,null::uuid,null::text,date '2026-08-21',cb.opening_balance,cb.currency,
    'cashbox'::text,cb.id,cb.name,'صندوق',null::uuid,null::text,'accounting'::text,null::uuid,
    'موجودی اول دوره صندوق '||cb.name,now(),null::uuid,null::text
  from public.finance_cashboxes cb where cb.is_active is true and coalesce(cb.opening_balance,0)<>0
)
select rows.*,
  sum(case when rows.direction='receipt' then rows.amount else -rows.amount end)
    over (partition by rows.account_id order by rows.payment_date,rows.created_at,rows.payment_number,rows.id rows between unbounded preceding and current row)
  + coalesce(case when rows.method='opening_balance' then 0 else 0 end,0) as running_balance
from rows;
grant select on public.v_finance_payment_ledger to authenticated;
notify pgrst,'reload schema';
