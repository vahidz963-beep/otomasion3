-- 070 CUSTOMER CODE FINALIZATION
-- Safe/idempotent finalization after legacy matching.
-- Does not delete or recreate customers, finance parties, orders, invoices,
-- accounting statements, production records, or warehouse records.

alter table public.customers add column if not exists customer_code text;
alter table public.finance_parties add column if not exists customer_code text;
create sequence if not exists public.customer_code_seq as bigint start with 294 increment by 1;

-- Preserve any legacy numeric codes already present in accounting notes.
update public.finance_parties
set customer_code = substring(notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)')
where party_type::text = 'customer'
  and notes ~ 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*[0-9]+'
  and substring(notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)') not in ('76','213')
  and customer_code is distinct from substring(notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)');

update public.customers c
set customer_code = fp.customer_code
from public.finance_parties fp
where fp.linked_customer_id = c.id
  and fp.party_type::text = 'customer'
  and fp.customer_code is not null
  and c.customer_code is distinct from fp.customer_code;

-- Approved new customer code.
update public.customers
set customer_code = '294'
where regexp_replace(trim(company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری'
  and customer_code is null;

update public.finance_parties fp
set customer_code = '294'
from public.customers c
where fp.linked_customer_id = c.id
  and regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری'
  and fp.customer_code is null;

-- Keep ambiguous legacy codes out of automatic assignment.
comment on column public.customers.customer_code is 'Permanent customer code. Legacy codes are preserved as numeric text; 76 and 213 remain unresolved.';
comment on column public.finance_parties.customer_code is 'Customer code mirrored from customers or legacy mapping.';

select setval('public.customer_code_seq', greatest(294, coalesce((select max(customer_code::bigint) from public.customers where customer_code ~ '^[0-9]+$'),294)), true);

create or replace function public.fn_assign_customer_code()
returns trigger language plpgsql as $$
begin
  if nullif(trim(new.customer_code), '') is null then
    new.customer_code := nextval('public.customer_code_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_customer_code on public.customers;
create trigger trg_assign_customer_code before insert on public.customers
for each row execute function public.fn_assign_customer_code();

create unique index if not exists uq_customers_customer_code on public.customers(customer_code) where customer_code is not null;
create unique index if not exists uq_finance_customer_party_code on public.finance_parties(customer_code)
where party_type::text = 'customer' and customer_code is not null;
create index if not exists idx_finance_parties_customer_code on public.finance_parties(customer_code);

notify pgrst, 'reload schema';
