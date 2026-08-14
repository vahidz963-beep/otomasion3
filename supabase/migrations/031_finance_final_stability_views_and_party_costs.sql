-- =====================================================================
-- 031_FINANCE_FINAL_STABILITY_VIEWS_AND_PARTY_COSTS
-- Final finance stabilization helpers:
-- - create finance party and optional customer in one RPC
-- - last sale price by warehouse item for accounting item kardex
-- - grants for order costs and supporting views
-- =====================================================================

create or replace function public.fn_finance_create_party_and_customer(
  p_display_name text,
  p_party_type text default 'customer',
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_opening_balance numeric default 0,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_customer_id uuid;
  v_party_type public.finance_party_type;
begin
  if not public.has_role(array['admin','accountant','sales','sales_manager']) then
    raise exception 'دسترسی ثبت شخص ندارید';
  end if;

  if nullif(trim(coalesce(p_display_name, '')), '') is null then
    raise exception 'نام شخص الزامی است';
  end if;

  v_party_type := coalesce(nullif(p_party_type,''), 'customer')::public.finance_party_type;

  if v_party_type = 'customer' then
    select id into v_customer_id
    from public.customers
    where company_name = trim(p_display_name)
    limit 1;

    if v_customer_id is null then
      insert into public.customers (
        company_name,
        contact_phone,
        contact_email,
        address,
        created_by,
        is_active
      ) values (
        trim(p_display_name),
        p_phone,
        p_email,
        p_address,
        auth.uid(),
        true
      ) returning id into v_customer_id;
    end if;
  end if;

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
    v_party_type,
    trim(p_display_name),
    v_customer_id,
    p_phone,
    p_email,
    p_address,
    coalesce(p_opening_balance, 0),
    p_notes,
    auth.uid(),
    true
  )
  on conflict (linked_customer_id) where linked_customer_id is not null do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      email = excluded.email,
      address = excluded.address,
      notes = excluded.notes,
      updated_at = now()
  returning id into v_party_id;

  if v_party_id is null then
    insert into public.finance_parties (
      party_type, display_name, phone, email, address, opening_balance, notes, created_by, is_active
    ) values (
      v_party_type, trim(p_display_name), p_phone, p_email, p_address, coalesce(p_opening_balance,0), p_notes, auth.uid(), true
    ) returning id into v_party_id;
  end if;

  return v_party_id;
end;
$$;

create or replace view public.v_finance_item_last_sale
with (security_invoker = true)
as
select distinct on (i.warehouse_item_id)
  i.warehouse_item_id,
  d.id as document_id,
  d.doc_number,
  d.issue_date,
  i.unit_price as last_sale_unit_price,
  i.quantity as last_sale_quantity,
  i.description_fa
from public.finance_document_items i
join public.finance_documents d on d.id = i.document_id
where i.warehouse_item_id is not null
  and d.document_type = 'sales_invoice'
  and d.status <> 'void'
order by i.warehouse_item_id, d.issue_date desc, d.created_at desc;

grant execute on function public.fn_finance_create_party_and_customer(text,text,text,text,text,numeric,text) to authenticated;
grant select on public.v_finance_item_last_sale to authenticated;
grant select, insert, update, delete on public.finance_order_costs to authenticated;

notify pgrst, 'reload schema';
