-- =====================================================================
-- 134_WAREHOUSE_SALES_CATALOG_AND_ORDER_DOCUMENTS
-- Read-only, least-privilege surfaces for Warehouse valuation and Orders/Sales.
-- - Sales catalog exposes current SALE price and live stock, never cost fields.
-- - Orders can list/view/print only sales proformas and sales invoices attached
--   to orders the current user is already allowed to see.
-- - No accounting mutation, treasury, journal or cost-price access is granted.
-- =====================================================================

begin;

-- Multi-role sales managers must have the same narrow document visibility as
-- sales users. The sales branch is intentionally limited to order-linked sales
-- proformas/invoices; Admin/Accounting keep their existing complete access.
create or replace function public.fn_user_can_access_finance_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.finance_documents d
    where d.id = p_document_id
      and public.is_active_user()
      and (
        public.has_role(array['admin','accountant'])
        or (
          public.has_role(array['sales','sales_manager'])
          and d.document_type::text in ('sales_proforma','sales_invoice')
          and d.related_order_id is not null
          and public.fn_user_can_access_order(d.related_order_id)
        )
        or exists (
          select 1
          from public.automation_referrals r
          where r.related_document_id = d.id
            and r.status <> 'cancelled'
            and (
              r.assigned_to = auth.uid()
              or r.created_by = auth.uid()
              or r.target_role::text = any(public.current_role_names())
            )
        )
      )
  );
$$;

grant execute on function public.fn_user_can_access_finance_document(uuid) to authenticated;

-- Sales Manager can read party identity only when it belongs to a permitted
-- order-linked sales document; no global party or write access is added.
drop policy if exists finance_parties_read on public.finance_parties;
create policy finance_parties_read on public.finance_parties
for select to authenticated
using (
  public.has_role(array['admin','accountant','sales'])
  or (
    public.has_role(array['sales_manager'])
    and exists (
      select 1
      from public.finance_documents d
      where d.party_id = finance_parties.id
        and d.document_type::text in ('sales_proforma','sales_invoice')
        and d.related_order_id is not null
        and public.fn_user_can_access_order(d.related_order_id)
    )
  )
);

-- Finance item rows now include confidential cost snapshots. Sales users must
-- consume the explicit safe bundle below rather than selecting the physical row,
-- because PostgreSQL row policies cannot hide individual columns.
drop policy if exists finance_document_items_select on public.finance_document_items;
create policy finance_document_items_select on public.finance_document_items
for select to authenticated
using (
  public.has_role(array['admin','accountant'])
  or (
    not public.has_role(array['sales','sales_manager'])
    and public.fn_user_can_access_finance_document(document_id)
  )
);

-- A sales-safe live catalog. Cost/base-cost/BOM-cost/margin fields are omitted
-- by construction, so Orders never downloads confidential valuation details.
create or replace function public.fn_get_order_sales_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       not public.is_active_user()
       or not public.has_role(array['admin','sales','sales_manager','accountant','warehouse','production','rnd'])
     ) then
    raise exception 'دسترسی مشاهده کاتالوگ فروش انبار را ندارید';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', c.item_id,
      'item_code', c.item_code,
      'item_name_fa', c.item_name_fa,
      'item_name_en', c.item_name_en,
      'unit', c.unit,
      'category', c.category,
      'item_group', c.item_group,
      'item_group_label', c.item_group_label,
      'is_produced_item', c.is_produced_item,
      'current_qty', c.current_qty,
      'reserved_qty', c.reserved_qty,
      'available_for_sale_qty', c.available_for_sale_qty,
      'min_stock_threshold', c.min_stock_threshold,
      'is_low_stock', c.is_low_stock,
      'last_synced_at', c.last_synced_at,
      'effective_sale_price', c.effective_sale_price,
      'sale_price_rial', c.effective_sale_price,
      'sale_price_toman', round(coalesce(c.effective_sale_price, 0) / 10.0, 2),
      'price_currency', c.price_currency,
      'base_sale_price', c.base_sale_price,
      'unit_sale_price_estimate', c.unit_sale_price_estimate,
      'pricing_updated_at', c.pricing_updated_at,
      'usd_toman', c.usd_toman,
      'cny_toman', c.cny_toman,
      'rate_checked_at', er.last_checked_at,
      'price_status', case when coalesce(c.effective_sale_price, 0) > 0 then 'priced' else 'missing' end
    ) order by c.item_name_fa, c.item_code
  ), '[]'::jsonb)
  into v_rows
  from public.v_app_inventory_catalog c
  cross join public.warehouse_exchange_rates er
  where er.id = true;

  return v_rows;
end;
$$;

grant execute on function public.fn_get_order_sales_catalog() to authenticated;

-- Safe list for the dedicated Orders/Sales tab. Only order-linked sales docs are
-- returned and every non-accounting user is constrained by order visibility.
create or replace function public.fn_get_accessible_order_sales_documents(
  p_limit integer default 1000
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 3000);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       not public.is_active_user()
       or not public.has_role(array['admin','accountant','sales','sales_manager'])
     ) then
    raise exception 'دسترسی مشاهده فاکتورهای فروش را ندارید';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.issue_date desc, q.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      d.id,
      d.doc_number,
      d.document_type::text as document_type,
      d.status::text as status,
      d.issue_date,
      d.due_date,
      d.related_order_id,
      o.order_code,
      coalesce(p.display_name, c.company_name, '—') as customer_name,
      coalesce(p.customer_code, c.customer_code) as customer_code,
      d.subtotal_amount,
      d.discount_amount,
      d.tax_amount,
      d.total_amount,
      d.paid_amount,
      d.balance_amount,
      d.is_official,
      d.description,
      d.print_note,
      d.created_at,
      d.updated_at
    from public.finance_documents d
    join public.orders o on o.id = d.related_order_id
    left join public.finance_parties p on p.id = d.party_id
    left join public.customers c on c.id = o.customer_id
    where d.document_type::text in ('sales_proforma','sales_invoice')
      and (
        coalesce(auth.role(), '') = 'service_role'
        or public.has_role(array['admin','accountant'])
        or (
          public.has_role(array['sales','sales_manager'])
          and public.fn_user_can_access_order(d.related_order_id)
        )
      )
    order by d.issue_date desc, d.created_at desc
    limit v_limit
  ) q;

  return v_rows;
end;
$$;

grant execute on function public.fn_get_accessible_order_sales_documents(integer) to authenticated;

-- Same safe projection, scoped to one visible order for its detail panel.
create or replace function public.fn_get_order_sales_documents(
  p_order_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       not public.is_active_user()
       or not public.has_role(array['admin','accountant','sales','sales_manager'])
       or not public.fn_user_can_access_order(p_order_id)
     ) then
    raise exception 'این سفارش در دسترس شما نیست';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.issue_date desc, q.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      d.id,
      d.doc_number,
      d.document_type::text as document_type,
      d.status::text as status,
      d.issue_date,
      d.due_date,
      d.related_order_id,
      o.order_code,
      coalesce(p.display_name, c.company_name, '—') as customer_name,
      coalesce(p.customer_code, c.customer_code) as customer_code,
      d.subtotal_amount,
      d.discount_amount,
      d.tax_amount,
      d.total_amount,
      d.paid_amount,
      d.balance_amount,
      d.is_official,
      d.description,
      d.print_note,
      d.created_at,
      d.updated_at
    from public.finance_documents d
    join public.orders o on o.id = d.related_order_id
    left join public.finance_parties p on p.id = d.party_id
    left join public.customers c on c.id = o.customer_id
    where d.related_order_id = p_order_id
      and d.document_type::text in ('sales_proforma','sales_invoice')
    order by d.issue_date desc, d.created_at desc
  ) q;

  return v_rows;
end;
$$;

grant execute on function public.fn_get_order_sales_documents(uuid) to authenticated;

-- Printable bundle for Orders/Sales. Explicit JSON keys prevent accidental
-- exposure of cost snapshots, payment accounts, journal lines or audit internals.
create or replace function public.fn_get_order_sales_document_bundle(
  p_document_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_party jsonb := null;
  v_order jsonb := null;
  v_items jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       not public.is_active_user()
       or not public.has_role(array['admin','accountant','sales','sales_manager'])
     ) then
    raise exception 'دسترسی مشاهده این سند فروش را ندارید';
  end if;

  select * into v_doc
  from public.finance_documents d
  where d.id = p_document_id
    and d.document_type::text in ('sales_proforma','sales_invoice')
    and d.related_order_id is not null;

  if v_doc.id is null then
    raise exception 'فاکتور یا پیش‌فاکتور سفارش پیدا نشد';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant'])
     and not (
       public.has_role(array['sales','sales_manager'])
       and public.fn_user_can_access_order(v_doc.related_order_id)
     ) then
    raise exception 'این سند به سفارش‌های قابل مشاهده شما تعلق ندارد';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'party_type', p.party_type,
    'customer_code', p.customer_code,
    'phone', p.phone,
    'email', p.email,
    'address', p.address,
    'national_id', p.national_id,
    'economic_code', p.economic_code,
    'registration_number', p.registration_number,
    'postal_code', p.postal_code
  ) into v_party
  from public.finance_parties p
  where p.id = v_doc.party_id;

  select jsonb_build_object(
    'id', o.id,
    'order_code', o.order_code,
    'customer_name', coalesce(c.company_name, v_party->>'display_name', '—'),
    'contact_phone', coalesce(o.customer_phone_snapshot, c.contact_phone, v_party->>'phone'),
    'customer_city', coalesce(o.customer_city_snapshot, c.city),
    'title_fa', o.title_fa
  ) into v_order
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.id = v_doc.related_order_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'document_id', i.document_id,
      'line_no', i.line_no,
      'item_type', i.item_type,
      'description_fa', i.description_fa,
      'description_en', i.description_en,
      'quantity', i.quantity,
      'unit', i.unit,
      'unit_price', i.unit_price,
      'discount_amount', i.discount_amount,
      'tax_rate', i.tax_rate,
      'tax_amount', i.tax_amount,
      'line_total', i.line_total,
      'warehouse_item_id', i.warehouse_item_id,
      'order_item_id', i.order_item_id
    ) order by i.line_no
  ), '[]'::jsonb)
  into v_items
  from public.finance_document_items i
  where i.document_id = v_doc.id;

  return jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id,
      'doc_number', v_doc.doc_number,
      'document_type', v_doc.document_type,
      'status', v_doc.status,
      'party_id', v_doc.party_id,
      'related_order_id', v_doc.related_order_id,
      'issue_date', v_doc.issue_date,
      'due_date', v_doc.due_date,
      'currency', v_doc.currency,
      'exchange_rate', v_doc.exchange_rate,
      'description', v_doc.description,
      'subtotal_amount', v_doc.subtotal_amount,
      'discount_amount', v_doc.discount_amount,
      'tax_amount', v_doc.tax_amount,
      'total_amount', v_doc.total_amount,
      'paid_amount', v_doc.paid_amount,
      'balance_amount', v_doc.balance_amount,
      'is_official', v_doc.is_official,
      'print_note', v_doc.print_note,
      'created_at', v_doc.created_at,
      'updated_at', v_doc.updated_at
    ),
    'items', v_items,
    'party', v_party,
    'order', v_order,
    'allocations', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'events', '[]'::jsonb,
    'referrals', '[]'::jsonb,
    'ioDocuments', '[]'::jsonb,
    'access', jsonb_build_object(
      'mode', 'sales_read_only',
      'can_edit', false,
      'can_post', false,
      'can_void', false,
      'can_pay', false,
      'can_print_company', true,
      'can_print_official', true
    )
  );
end;
$$;

grant execute on function public.fn_get_order_sales_document_bundle(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
