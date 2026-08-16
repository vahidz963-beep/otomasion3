-- =====================================================================
-- 039_FINANCE_BANK_CARDS_PRINT_TEMPLATES
-- Adds bank/card metadata for finance cashflow cards and appends it to
-- v_finance_account_turnover while preserving previous column order.
-- =====================================================================

alter table public.finance_bank_accounts
  add column if not exists branch_name text,
  add column if not exists account_holder_name text,
  add column if not exists notes text;

create or replace view public.v_finance_account_turnover
with (security_invoker = true)
as
select
  -- Keep previous 028 columns in exact order.
  'bank'::text as account_kind,
  ba.id as account_id,
  ba.account_name,
  ba.bank_name,
  ba.account_number,
  ba.iban,
  ba.currency,
  ba.account_usage::text as account_usage,
  ba.opening_balance,
  coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_receipts,
  coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_payments,
  ba.opening_balance
    + coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0)
    - coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as current_balance,
  max(p.payment_date) as last_movement_date,
  -- New columns appended safely.
  ba.card_number,
  ba.branch_name,
  ba.account_holder_name,
  ba.notes,
  ba.is_active
from public.finance_bank_accounts ba
left join public.finance_payments p on p.bank_account_id = ba.id
group by ba.id

union all

select
  'cashbox'::text as account_kind,
  cb.id as account_id,
  cb.name as account_name,
  'صندوق'::text as bank_name,
  null::text as account_number,
  null::text as iban,
  cb.currency,
  'cash'::text as account_usage,
  cb.opening_balance,
  coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_receipts,
  coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_payments,
  cb.opening_balance
    + coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0)
    - coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as current_balance,
  max(p.payment_date) as last_movement_date,
  null::text as card_number,
  null::text as branch_name,
  null::text as account_holder_name,
  null::text as notes,
  cb.is_active
from public.finance_cashboxes cb
left join public.finance_payments p on p.cashbox_id = cb.id
group by cb.id;

grant select on public.v_finance_account_turnover to authenticated;

grant select, insert, update on public.finance_bank_accounts to authenticated;

notify pgrst, 'reload schema';
