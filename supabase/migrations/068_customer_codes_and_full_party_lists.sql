-- =====================================================================
-- 068_CUSTOMER_CODES_AND_FULL_PARTY_LISTS
-- One immutable, human-readable customer code shared by CRM, Orders,
-- Accounting, Invoices, Production, R&D and Warehouse references.
-- Also removes the practical 200/1000-row ceiling from the data model by
-- making the code available for paginated client loaders.
-- =====================================================================

create sequence if not exists public.customer_code_seq as bigint start with 294 increment by 1;

alter table public.customers
  add column if not exists customer_code text;

alter table public.finance_parties
  add column if not exists customer_code text;

-- Continue an existing CUS-###### series when possible.
do $$
declare
  v_last bigint;
begin
  select max((substring(customer_code from '^([0-9]+)$'))::bigint)
    into v_last
  from public.customers
  where customer_code ~ '^[0-9]+$';
  if v_last is null then v_last := 0; end if;
  perform setval('public.customer_code_seq', v_last, v_last > 0);
end $$;

-- Do not backfill existing customers here. Legacy mapping is applied separately
-- and only after an explicit matching report is approved.

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

-- Give existing customer parties the canonical customer code.
update public.finance_parties fp
set customer_code = c.customer_code
from public.customers c
where fp.linked_customer_id = c.id
  and fp.party_type = 'customer'::public.finance_party_type
  and fp.customer_code is distinct from c.customer_code;

-- Unlinked existing parties are intentionally not backfilled here.
-- They require explicit review before receiving a customer code.

create or replace function public.fn_assign_finance_party_customer_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.party_type = 'customer'::public.finance_party_type then
    if new.linked_customer_id is not null then
      select c.customer_code into new.customer_code
      from public.customers c
      where c.id = new.linked_customer_id;
    end if;
    if nullif(trim(new.customer_code), '') is null then
      new.customer_code := nextval('public.customer_code_seq')::text;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_finance_party_customer_code on public.finance_parties;
create trigger trg_assign_finance_party_customer_code
before insert or update of party_type, linked_customer_id, customer_code on public.finance_parties
for each row execute function public.fn_assign_finance_party_customer_code();

create unique index if not exists uq_customers_customer_code
  on public.customers(customer_code);
create unique index if not exists uq_finance_customer_party_code
  on public.finance_parties(customer_code)
  where party_type = 'customer'::public.finance_party_type and customer_code is not null;
create index if not exists idx_finance_parties_customer_code
  on public.finance_parties(customer_code);

-- Add the code at the end of existing views so CREATE OR REPLACE remains safe.
create or replace view public.v_party_balances
with (security_invoker = true)
as
select
  p.id as party_id,
  p.display_name,
  p.party_type,
  p.phone,
  p.email,
  coalesce(p.opening_balance, 0) + coalesce(sum(s.debit_amount - s.credit_amount), 0) as balance,
  coalesce(sum(s.debit_amount), 0) as total_debit,
  coalesce(sum(s.credit_amount), 0) as total_credit,
  p.customer_code
from public.finance_parties p
left join public.v_party_statement s on s.party_id = p.id
group by p.id;

grant select on public.v_party_balances to authenticated, service_role;

create or replace view public.v_finance_document_summary
with (security_invoker = true)
as
select
  d.id,
  d.doc_number,
  d.document_type,
  d.status,
  d.issue_date,
  d.due_date,
  d.party_id,
  p.display_name as party_name,
  p.party_type,
  d.related_order_id,
  o.order_code,
  d.source_module,
  d.subtotal_amount,
  d.discount_amount,
  d.tax_amount,
  d.total_amount,
  d.paid_amount,
  d.balance_amount,
  case when d.due_date < current_date and d.balance_amount > 0 and d.status in ('approved','sent','partially_paid') then true else false end as is_overdue,
  d.converted_from_document_id,
  p.customer_code
from public.finance_documents d
left join public.finance_parties p on p.id = d.party_id
left join public.orders o on o.id = d.related_order_id;

grant select on public.v_finance_document_summary to authenticated, service_role;

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
  count(distinct f.id) filter (where f.is_done = false and f.due_at <= now() + interval '3 days') as due_followups,
  c.customer_code
from public.customers c
left join public.finance_parties fp on fp.linked_customer_id = c.id and fp.party_type = 'customer'::public.finance_party_type
left join public.profiles pr on pr.id = c.assigned_sales_id
left join public.orders o on o.customer_id = c.id
left join public.finance_documents fd on fd.related_order_id = o.id
left join public.crm_followups f on f.customer_id = c.id
where coalesce(c.is_active, true) = true
group by c.id, fp.id, pr.full_name;

grant select on public.v_customer_accounting_contacts to authenticated, service_role;

create or replace view public.v_customer_accounting_contacts_fast
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
  fp.economic_code,
  fp.registration_number,
  fp.national_id,
  fp.postal_code,
  fp.opening_balance,
  fp.notes as finance_notes,
  0::bigint as total_orders,
  0::numeric as total_sales_amount,
  null::timestamptz as last_order_at,
  0::bigint as due_followups,
  c.customer_code
from public.customers c
left join public.finance_parties fp on fp.linked_customer_id = c.id and fp.party_type = 'customer'::public.finance_party_type
left join public.profiles pr on pr.id = c.assigned_sales_id
where coalesce(c.is_active, true) = true;

grant select on public.v_customer_accounting_contacts_fast to authenticated, service_role;

notify pgrst, 'reload schema';
