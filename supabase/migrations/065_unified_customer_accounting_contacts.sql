-- =====================================================================
-- 065_UNIFIED_CUSTOMER_ACCOUNTING_CONTACTS
-- One synchronized customer/contact list between Orders/CRM and Accounting.
-- Leads remain CRM-only until they become real customers.
-- =====================================================================

alter table public.finance_parties
  add column if not exists registration_number text,
  add column if not exists postal_code text;

create or replace function public.fn_sync_finance_customer_for_party(p_party_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.finance_parties%rowtype;
  v_customer_id uuid;
begin
  select * into v_party
  from public.finance_parties
  where id = p_party_id;

  if not found or v_party.party_type <> 'customer'::public.finance_party_type then
    return null;
  end if;

  v_customer_id := v_party.linked_customer_id;

  if v_customer_id is null then
    select c.id into v_customer_id
    from public.customers c
    where coalesce(c.is_active, true) = true
      and not exists (
        select 1 from public.finance_parties fp
        where fp.linked_customer_id = c.id
          and fp.id <> v_party.id
      )
      and (
        (nullif(v_party.phone, '') is not null and c.contact_phone = v_party.phone)
        or lower(trim(c.company_name)) = lower(trim(v_party.display_name))
      )
    order by case when nullif(v_party.phone, '') is not null and c.contact_phone = v_party.phone then 0 else 1 end, c.created_at desc
    limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (
      company_name,
      contact_phone,
      contact_email,
      address,
      crm_status,
      acquisition_source,
      is_active,
      created_by
    ) values (
      coalesce(nullif(trim(v_party.display_name), ''), 'مشتری بدون نام'),
      nullif(v_party.phone, ''),
      nullif(v_party.email, ''),
      nullif(v_party.address, ''),
      'active_customer'::public.crm_party_status,
      'همگام‌سازی از حسابداری',
      coalesce(v_party.is_active, true),
      coalesce(v_party.created_by, auth.uid())
    )
    returning id into v_customer_id;
  else
    update public.customers
    set company_name = coalesce(nullif(trim(v_party.display_name), ''), company_name),
        contact_phone = coalesce(nullif(v_party.phone, ''), contact_phone),
        contact_email = coalesce(nullif(v_party.email, ''), contact_email),
        address = coalesce(nullif(v_party.address, ''), address),
        crm_status = case when crm_status = 'lead'::public.crm_party_status then 'active_customer'::public.crm_party_status else crm_status end,
        is_active = coalesce(v_party.is_active, true),
        updated_at = now()
    where id = v_customer_id;
  end if;

  update public.finance_parties
  set linked_customer_id = v_customer_id,
      updated_at = now()
  where id = v_party.id
    and linked_customer_id is distinct from v_customer_id;

  return v_customer_id;
end;
$$;

create or replace function public.fn_sync_finance_party_for_customer(p_customer_id uuid)
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
    return null;
  end if;

  select id into v_party_id
  from public.finance_parties
  where linked_customer_id = p_customer_id
    and party_type = 'customer'::public.finance_party_type
  limit 1;

  if coalesce(v_customer.is_active, true) = false or v_customer.crm_status = 'inactive'::public.crm_party_status then
    if v_party_id is not null then
      update public.finance_parties
      set is_active = false,
          updated_at = now()
      where id = v_party_id;
    end if;
    return v_party_id;
  end if;

  -- Leads are intentionally CRM-only. They are synchronized to Accounting
  -- when their status becomes an actual customer status or an order is registered.
  if v_customer.crm_status = 'lead'::public.crm_party_status and v_party_id is null then
    return null;
  end if;

  if v_party_id is null then
    select fp.id into v_party_id
    from public.finance_parties fp
    where fp.party_type = 'customer'::public.finance_party_type
      and coalesce(fp.is_active, true) = true
      and fp.linked_customer_id is null
      and (
        (nullif(v_customer.contact_phone, '') is not null and fp.phone = v_customer.contact_phone)
        or lower(trim(fp.display_name)) = lower(trim(v_customer.company_name))
      )
    order by case when nullif(v_customer.contact_phone, '') is not null and fp.phone = v_customer.contact_phone then 0 else 1 end, fp.created_at desc
    limit 1;
  end if;

  if v_party_id is null then
    insert into public.finance_parties (
      party_type,
      display_name,
      linked_customer_id,
      phone,
      email,
      address,
      opening_balance,
      notes,
      created_by,
      is_active
    ) values (
      'customer'::public.finance_party_type,
      coalesce(nullif(trim(v_customer.company_name), ''), 'مشتری بدون نام'),
      v_customer.id,
      nullif(v_customer.contact_phone, ''),
      nullif(v_customer.contact_email, ''),
      nullif(v_customer.address, ''),
      0,
      null,
      coalesce(v_customer.created_by, auth.uid()),
      true
    ) returning id into v_party_id;
  else
    update public.finance_parties
    set party_type = 'customer'::public.finance_party_type,
        display_name = coalesce(nullif(trim(v_customer.company_name), ''), display_name),
        linked_customer_id = v_customer.id,
        phone = coalesce(nullif(v_customer.contact_phone, ''), phone),
        email = coalesce(nullif(v_customer.contact_email, ''), email),
        address = coalesce(nullif(v_customer.address, ''), address),
        is_active = true,
        updated_at = now()
    where id = v_party_id;
  end if;

  return v_party_id;
end;
$$;

create or replace function public.fn_trg_sync_customer_to_finance_party()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  perform public.fn_sync_finance_party_for_customer(new.id);
  return new;
end;
$$;

create or replace function public.fn_trg_sync_finance_party_to_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.party_type = 'customer'::public.finance_party_type then
    perform public.fn_sync_finance_customer_for_party(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_customer_to_finance_party on public.customers;
create trigger trg_sync_customer_to_finance_party
after insert or update of company_name, contact_phone, contact_email, address, crm_status, is_active
on public.customers
for each row execute function public.fn_trg_sync_customer_to_finance_party();

drop trigger if exists trg_sync_finance_party_to_customer on public.finance_parties;
create trigger trg_sync_finance_party_to_customer
after insert or update of party_type, display_name, phone, email, address, is_active
on public.finance_parties
for each row execute function public.fn_trg_sync_finance_party_to_customer();

-- Upsert from Orders/CRM side while keeping Accounting party in sync.
create or replace function public.fn_upsert_customer_accounting_contact(
  p_customer_id uuid default null,
  p_finance_party_id uuid default null,
  p_company_name text default null,
  p_contact_person_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_city text default null,
  p_address text default null,
  p_preferred_contact_channel text default null,
  p_acquisition_source text default null,
  p_crm_status text default 'active_customer',
  p_lead_score int default 50,
  p_next_follow_up_at timestamptz default null,
  p_economic_code text default null,
  p_registration_number text default null,
  p_national_id text default null,
  p_postal_code text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_id uuid;
  v_party_id uuid;
  v_status public.crm_party_status;
  v_channel public.crm_contact_channel;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales','sales_manager','accountant']) then
    raise exception 'دسترسی ثبت/ویرایش مشتری ندارید';
  end if;

  if nullif(trim(coalesce(p_company_name, '')), '') is null then
    raise exception 'نام مشتری الزامی است';
  end if;

  v_status := coalesce(nullif(p_crm_status, ''), 'active_customer')::public.crm_party_status;
  v_channel := nullif(p_preferred_contact_channel, '')::public.crm_contact_channel;

  if p_customer_id is null then
    insert into public.customers (
      company_name,
      contact_person_name,
      contact_phone,
      contact_email,
      city,
      address,
      preferred_contact_channel,
      acquisition_source,
      crm_status,
      lead_score,
      next_follow_up_at,
      assigned_sales_id,
      created_by,
      is_active
    ) values (
      trim(p_company_name),
      nullif(p_contact_person_name, ''),
      nullif(p_contact_phone, ''),
      nullif(p_contact_email, ''),
      nullif(p_city, ''),
      nullif(p_address, ''),
      v_channel,
      nullif(p_acquisition_source, ''),
      v_status,
      greatest(0, least(100, coalesce(p_lead_score, 50))),
      p_next_follow_up_at,
      v_actor,
      v_actor,
      true
    ) returning id into v_customer_id;
  else
    update public.customers
    set company_name = trim(p_company_name),
        contact_person_name = nullif(p_contact_person_name, ''),
        contact_phone = nullif(p_contact_phone, ''),
        contact_email = nullif(p_contact_email, ''),
        city = nullif(p_city, ''),
        address = nullif(p_address, ''),
        preferred_contact_channel = v_channel,
        acquisition_source = nullif(p_acquisition_source, ''),
        crm_status = v_status,
        lead_score = greatest(0, least(100, coalesce(p_lead_score, 50))),
        next_follow_up_at = p_next_follow_up_at,
        updated_at = now()
    where id = p_customer_id
    returning id into v_customer_id;
  end if;

  if v_customer_id is null then
    raise exception 'Customer not found';
  end if;

  if v_status <> 'lead'::public.crm_party_status then
    v_party_id := public.fn_sync_finance_party_for_customer(v_customer_id);

    if p_finance_party_id is not null and v_party_id is null then
      v_party_id := p_finance_party_id;
      update public.finance_parties
      set linked_customer_id = v_customer_id
      where id = v_party_id;
    end if;

    if v_party_id is not null then
      update public.finance_parties
      set economic_code = nullif(p_economic_code, ''),
          registration_number = nullif(p_registration_number, ''),
          national_id = nullif(p_national_id, ''),
          postal_code = nullif(p_postal_code, ''),
          notes = coalesce(nullif(p_notes, ''), notes),
          updated_at = now()
      where id = v_party_id;
    end if;
  end if;

  return v_customer_id;
end;
$$;

-- Keep the existing helper aligned with the new sync logic.
create or replace function public.fn_finance_party_for_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.fn_sync_finance_party_for_customer(p_customer_id);
end;
$$;

-- Unified list used by Orders/CRM. Leads are still visible in CRM; real customers
-- are linked to Accounting parties and carry official Accounting fields.
create or replace view public.v_customer_accounting_contacts
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.contact_person_name,
  c.contact_phone,
  c.contact_email,
  c.address,
  c.city,
  c.preferred_contact_channel,
  c.acquisition_source,
  c.crm_status,
  c.lead_score,
  c.assigned_sales_id,
  pr.full_name as assigned_sales_name,
  c.last_contacted_at,
  c.next_follow_up_at,
  c.is_active,
  fp.id as finance_party_id,
  fp.party_type as finance_party_type,
  fp.display_name as finance_display_name,
  fp.phone as finance_phone,
  fp.email as finance_email,
  fp.address as finance_address,
  fp.economic_code,
  fp.registration_number,
  fp.national_id,
  fp.postal_code,
  fp.opening_balance,
  fp.notes as finance_notes,
  count(distinct o.id) as total_orders,
  coalesce(sum(fd.total_amount) filter (where fd.document_type = 'sales_invoice' and fd.status <> 'void'), 0) as total_sales_amount,
  max(o.created_at) as last_order_at,
  count(distinct f.id) filter (where f.is_done = false and f.due_at <= now() + interval '3 days') as due_followups
from public.customers c
left join public.finance_parties fp on fp.linked_customer_id = c.id and fp.party_type = 'customer'::public.finance_party_type
left join public.profiles pr on pr.id = c.assigned_sales_id
left join public.orders o on o.customer_id = c.id
left join public.finance_documents fd on fd.related_order_id = o.id
left join public.crm_followups f on f.customer_id = c.id
where coalesce(c.is_active, true) = true
group by c.id, fp.id, pr.full_name;

-- Backfill current data.
do $$
declare
  r record;
begin
  for r in select id from public.customers where coalesce(is_active, true) = true and crm_status <> 'lead'::public.crm_party_status loop
    perform public.fn_sync_finance_party_for_customer(r.id);
  end loop;

  for r in select id from public.finance_parties where party_type = 'customer'::public.finance_party_type and coalesce(is_active, true) = true loop
    perform public.fn_sync_finance_customer_for_party(r.id);
  end loop;
end $$;

grant usage on schema public to authenticated, service_role;
grant select, insert, update on table public.customers to authenticated, service_role;
grant select, insert, update on table public.finance_parties to authenticated, service_role;
grant select on public.v_customer_accounting_contacts to authenticated, service_role;
grant execute on function public.fn_sync_finance_customer_for_party(uuid) to authenticated, service_role;
grant execute on function public.fn_sync_finance_party_for_customer(uuid) to authenticated, service_role;
grant execute on function public.fn_upsert_customer_accounting_contact(uuid, uuid, text, text, text, text, text, text, text, text, text, integer, timestamptz, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.fn_finance_party_for_customer(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
