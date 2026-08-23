-- =====================================================================
-- 064_ACCOUNTING_BALANCE_SHEET_REPORT
-- Adds a secure helper RPC for professional balance sheet reporting.
-- The frontend computes final grouping from posted journal lines returned here.
-- =====================================================================

create or replace function public.fn_finance_balance_sheet_lines(p_as_of_date date)
returns table (
  entry_id uuid,
  entry_number text,
  entry_date date,
  account_id uuid,
  account_code text,
  account_name_fa text,
  account_name_en text,
  account_type text,
  debit_amount numeric,
  credit_amount numeric,
  line_description text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can read balance sheet report';
  end if;

  return query
  select
    je.id as entry_id,
    je.entry_number,
    je.entry_date,
    fa.id as account_id,
    fa.code as account_code,
    fa.name_fa as account_name_fa,
    fa.name_en as account_name_en,
    fa.account_type::text as account_type,
    coalesce(jl.debit_amount, 0) as debit_amount,
    coalesce(jl.credit_amount, 0) as credit_amount,
    jl.description as line_description
  from public.finance_journal_lines jl
  join public.finance_journal_entries je on je.id = jl.entry_id
  join public.finance_accounts fa on fa.id = jl.account_id
  where je.status = 'posted'
    and je.entry_date <= coalesce(p_as_of_date, current_date)
  order by fa.code, je.entry_date, je.entry_number;
end;
$$;

grant usage on schema public to authenticated, service_role;
grant execute on function public.fn_finance_balance_sheet_lines(date) to authenticated, service_role;

notify pgrst, 'reload schema';
