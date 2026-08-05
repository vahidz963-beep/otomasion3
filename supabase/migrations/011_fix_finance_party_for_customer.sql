-- =====================================================================
-- 011_FIX_FINANCE_PARTY_FOR_CUSTOMER
-- Fixes fn_finance_party_for_customer so it does not rely on ON CONFLICT
-- against a partial unique index.
-- Run this after migrations 001..010 if seed/demo data fails with:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- =====================================================================

create or replace function public.fn_finance_party_for_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_party_id uuid;
begin
  select * into v_customer
  from public.customers
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  select id into v_party_id
  from public.finance_parties
  where linked_customer_id = p_customer_id
  limit 1;

  if v_party_id is not null then
    update public.finance_parties
    set display_name = v_customer.company_name,
        phone = v_customer.contact_phone,
        email = v_customer.contact_email,
        address = v_customer.address,
        updated_at = now()
    where id = v_party_id;

    return v_party_id;
  end if;

  insert into public.finance_parties (
    party_type,
    display_name,
    linked_customer_id,
    phone,
    email,
    address,
    created_by
  ) values (
    'customer',
    v_customer.company_name,
    v_customer.id,
    v_customer.contact_phone,
    v_customer.contact_email,
    v_customer.address,
    auth.uid()
  )
  returning id into v_party_id;

  return v_party_id;
end;
$$;
