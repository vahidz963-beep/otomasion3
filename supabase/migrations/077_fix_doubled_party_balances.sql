-- 077 FIX DOUBLED PARTY BALANCES
-- Cause: 075 added opening_balance as an opening row in v_party_statement,
-- while 068 still added finance_parties.opening_balance a second time in
-- v_party_balances. This view-only fix removes the second addition.
-- No financial rows, invoices, payments, or balances are edited.

create or replace view public.v_party_balances
with (security_invoker = true)
as
select
  p.id as party_id,
  p.display_name,
  p.party_type,
  p.phone,
  p.email,
  coalesce(sum(s.debit_amount - s.credit_amount), 0) as balance,
  coalesce(sum(s.debit_amount), 0) as total_debit,
  coalesce(sum(s.credit_amount), 0) as total_credit,
  p.customer_code
from public.finance_parties p
left join public.v_party_statement s on s.party_id = p.id
group by p.id;

grant select on public.v_party_balances to authenticated, service_role;
notify pgrst, 'reload schema';
