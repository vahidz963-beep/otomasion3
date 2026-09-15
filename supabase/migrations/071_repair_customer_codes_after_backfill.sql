-- 071 REPAIR CUSTOMER CODES
-- Repairs accidental auto-generated numeric codes (294..835) by restoring
-- approved legacy codes from finance_parties.notes.
-- No customer/order/invoice/accounting/production/warehouse row is deleted.

begin;

-- Remove only generated codes 294+ from all rows except approved Engineer Jafari.
-- Old legacy codes are 1..293.
update public.customers c
set customer_code = null
where c.customer_code ~ '^[0-9]+$'
  and c.customer_code::bigint >= 294
  and regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') <> 'مهندس جعفری';

update public.finance_parties fp
set customer_code = null
where fp.customer_code ~ '^[0-9]+$'
  and fp.customer_code::bigint >= 294
  and not exists (
    select 1
    from public.customers c
    where c.id = fp.linked_customer_id
      and regexp_replace(trim(c.company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری'
  );

-- Restore legacy codes from the authoritative old-system note.
update public.finance_parties fp
set customer_code = substring(
  fp.notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)'
)
where fp.party_type::text = 'customer'
  and fp.notes ~ 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*[0-9]+'
  and substring(fp.notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)') not in ('76','213')
  and substring(fp.notes from 'کد در سیستم قبلی[[:space:]]*:[[:space:]]*([0-9]+)')::bigint between 1 and 293;

-- Mirror the restored code to the canonical customer row.
update public.customers c
set customer_code = fp.customer_code
from public.finance_parties fp
where fp.linked_customer_id = c.id
  and fp.party_type::text = 'customer'
  and fp.customer_code ~ '^[0-9]+$'
  and fp.customer_code::bigint between 1 and 293;

-- Approved new customer.
update public.customers
set customer_code = '294'
where regexp_replace(trim(company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری';

-- Keep approved new customer active; archive the remaining uncoded rows.
update public.customers
set is_active = false
where customer_code is null
  and regexp_replace(trim(company_name), '[[:space:]]+', ' ', 'g') <> 'مهندس جعفری';

-- Next automatic code is 295.
select setval(
  'public.customer_code_seq',
  greatest(294, coalesce((select max(customer_code::bigint)
    from public.customers where customer_code ~ '^[0-9]+$'), 294)),
  true
);

notify pgrst, 'reload schema';
commit;
