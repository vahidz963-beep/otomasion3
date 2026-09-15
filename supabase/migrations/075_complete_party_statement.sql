-- 075 COMPLETE PARTY STATEMENT
-- Adds opening balance and keeps every qualifying invoice and confirmed
-- receipt/payment in one chronological ledger. Structural/view change only.

create or replace view public.v_party_statement
with (security_invoker = true)
as
with rows as (
  select
    p.id as party_id,
    coalesce(p.created_at::date, current_date) as entry_date,
    'OPENING'::text as ref_number,
    'opening_balance'::text as entry_type,
    'مانده اول دوره'::text as description,
    case when coalesce(p.opening_balance, 0) > 0 then p.opening_balance else 0 end as debit_amount,
    case when coalesce(p.opening_balance, 0) < 0 then abs(p.opening_balance) else 0 end as credit_amount,
    null::uuid as related_order_id,
    null::uuid as document_id,
    null::uuid as payment_id,
    p.created_at
  from public.finance_parties p

  union all

  select
    d.party_id,
    d.issue_date as entry_date,
    d.doc_number as ref_number,
    d.document_type::text as entry_type,
    d.description,
    case
      when d.document_type in ('sales_invoice','debit_note','purchase_return') then d.total_amount
      else 0
    end as debit_amount,
    case
      when d.document_type in ('purchase_invoice','expense_invoice','sales_return','credit_note') then d.total_amount
      else 0
    end as credit_amount,
    d.related_order_id,
    d.id as document_id,
    null::uuid as payment_id,
    d.created_at
  from public.finance_documents d
  where d.status not in ('draft','cancelled','void')

  union all

  select
    p.party_id,
    p.payment_date as entry_date,
    p.payment_number as ref_number,
    p.direction::text as entry_type,
    p.description,
    case when p.direction = 'payment' then p.amount else 0 end as debit_amount,
    case when p.direction = 'receipt' then p.amount else 0 end as credit_amount,
    p.related_order_id,
    null::uuid as document_id,
    p.id as payment_id,
    p.created_at
  from public.finance_payments p
  where p.status = 'confirmed'
)
select
  party_id,
  entry_date,
  ref_number,
  entry_type,
  description,
  debit_amount,
  credit_amount,
  related_order_id,
  document_id,
  payment_id,
  sum(debit_amount - credit_amount) over (
    partition by party_id
    order by entry_date, created_at, ref_number
    rows unbounded preceding
  ) as running_balance
from rows;

grant select on public.v_party_statement to authenticated, service_role;
notify pgrst, 'reload schema';
