-- =====================================================================
-- 136_FINANCE_PAYMENT_LEDGER_BANK_NAME_CONTRACT
-- Restore the dashboard/API contract removed by migration 133.
-- The column is deliberately appended so CREATE OR REPLACE remains compatible
-- with installations that already have the migration-133 column order.
-- =====================================================================

begin;

create or replace view public.v_finance_payment_ledger
with (security_invoker = true)
as
select
  p.id,
  p.payment_number,
  p.payment_date,
  p.direction,
  p.method,
  p.status,
  p.party_id,
  fp.display_name as party_name,
  p.amount,
  p.currency,
  p.bank_account_id,
  ba.account_name as bank_account_name,
  p.cashbox_id,
  cb.name as cashbox_name,
  p.transfer_to_bank_account_id,
  dest.account_name as transfer_to_account_name,
  p.related_order_id,
  o.order_code,
  p.description,
  p.source_module,
  p.source_record_id,
  p.created_at,
  case when p.bank_account_id is not null then 'bank'
       when p.cashbox_id is not null then 'cashbox'
       else 'unassigned' end as account_kind,
  coalesce(p.bank_account_id, p.cashbox_id) as account_id,
  case when p.bank_account_id is not null then ba.account_name
       when p.cashbox_id is not null then cb.name
       else 'بدون حساب' end as account_name,
  case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end as receipt_amount,
  case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end as payment_amount,
  case when p.status <> 'confirmed' then 0
       when p.direction = 'receipt' then p.amount
       when p.direction = 'payment' then -p.amount
       else 0 end as signed_amount,
  sum(case when p.status <> 'confirmed' then 0
           when p.direction = 'receipt' then p.amount
           when p.direction = 'payment' then -p.amount
           else 0 end)
    over(partition by coalesce(p.bank_account_id, p.cashbox_id)
         order by p.payment_date, p.created_at, p.id rows unbounded preceding) as running_balance,
  case when p.bank_account_id is not null then coalesce(ba.bank_name, 'بانک')
       when p.cashbox_id is not null then 'صندوق'
       else 'بدون حساب' end as bank_name
from public.finance_payments p
left join public.finance_parties fp on fp.id = p.party_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
left join public.finance_bank_accounts dest on dest.id = p.transfer_to_bank_account_id
left join public.orders o on o.id = p.related_order_id
where p.method <> 'direct_expense_offset';

grant select on public.v_finance_payment_ledger to authenticated;

-- Fail the migration itself if a future edit accidentally removes the contract.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_finance_payment_ledger'
      and column_name = 'bank_name'
  ) then
    raise exception 'v_finance_payment_ledger.bank_name contract is missing';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
