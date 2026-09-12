-- 070 CUSTOMER CODE FINALIZATION - SAFE / IDEMPOTENT
-- No DELETE. No recreation of customers, accounting documents, orders,
-- production or warehouse records.

begin;

alter table public.customers add column if not exists customer_code text;
alter table public.finance_parties add column if not exists customer_code text;
create sequence if not exists public.customer_code_seq as bigint start with 294 increment by 1;

-- Copy approved legacy codes from finance notes, excluding ambiguous 76 and 213.
-- Do not overwrite an existing code and do not create a duplicate code.
update public.finance_parties fp
set customer_code = m.legacy_code
from (
  select
    fp2.id,
    substring(fp2.notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)') as legacy_code
  from public.finance_parties fp2
  where fp2.party_type::text = 'customer'
    and fp2.notes ~ 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*[0-9]+'
) m
where fp.id = m.id
  and m.legacy_code not in ('76','213')
  and m.legacy_code::bigint between 1 and 293
  and fp.customer_code is null
  and not exists (
    select 1 from public.finance_parties other_fp
    where other_fp.customer_code = m.legacy_code
      and other_fp.id <> fp.id
  );

-- Mirror finance party codes onto the canonical customer row.
update public.customers c
set customer_code = fp.customer_code
from public.finance_parties fp
where fp.linked_customer_id = c.id
  and fp.party_type::text = 'customer'
  and fp.customer_code is not null
  and c.customer_code is null
  and not exists (
    select 1 from public.customers other_c
    where other_c.customer_code = fp.customer_code
      and other_c.id <> c.id
  );

-- Approved new code. If 294 is already occupied, skip safely instead of failing.
update public.customers c
set customer_code = '294'
where regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری'
  and c.customer_code is null
  and not exists (
    select 1 from public.customers other_c
    where other_c.customer_code = '294'
      and other_c.id <> c.id
  );

-- Mirror 294 to an existing linked finance party only when it is safe.
update public.finance_parties fp
set customer_code = '294'
from public.customers c
where fp.linked_customer_id = c.id
  and regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری'
  and fp.customer_code is null
  and not exists (
    select 1 from public.finance_parties other_fp
    where other_fp.customer_code = '294'
      and other_fp.id <> fp.id
  );

-- Approved behavior: keep only Engineer Jafari active among the no-code rows.
-- Records are archived logically, never physically deleted.
update public.customers c
set is_active = false
where c.customer_code is null
  and c.is_active = true
  and regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') <> 'مهندس جعفری';

-- Next automatically generated code is 295 or greater.
select setval(
  'public.customer_code_seq',
  greatest(
    294,
    coalesce((
      select max(customer_code::bigint)
      from public.customers
      where customer_code ~ '^[0-9]+$'
    ), 294)
  ),
  true
);

create or replace function public.fn_assign_customer_code()
returns trigger
language plpgsql
as $$
begin
  if nullif(trim(new.customer_code), '') is null then
    new.customer_code := nextval('public.customer_code_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_customer_code on public.customers;
create trigger trg_assign_customer_code
before insert on public.customers
for each row execute function public.fn_assign_customer_code();

create index if not exists idx_customers_customer_code
  on public.customers(customer_code);
create index if not exists idx_finance_parties_customer_code
  on public.finance_parties(customer_code);

notify pgrst, 'reload schema';
commit;
