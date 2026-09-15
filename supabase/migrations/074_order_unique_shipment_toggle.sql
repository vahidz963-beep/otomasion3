-- 074 ORDER SHIPMENT TOGGLE / IDEMPOTENT SHIPMENT LIST
-- Structural change only. No existing data is read, deleted, or rewritten here.
-- The RPC is idempotent: repeated clicks for one order update the same logical shipment.

create index if not exists idx_warehouse_shipments_related_order_active
  on public.warehouse_shipments(related_order_id, status, updated_at desc);

create or replace function public.fn_toggle_order_shipment(
  p_order_id uuid,
  p_enabled boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
  v_shipment_id uuid;
begin
  if not public.has_role(array['admin','sales','warehouse','accountant']) then
    raise exception 'دسترسی ثبت ارسال سفارش ندارید';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 7401));

  if not p_enabled then
    update public.warehouse_shipments
    set status = 'cancelled',
        notes = concat_ws(E'\n', notes, 'لغو از جزئیات سفارش'),
        updated_at = now()
    where related_order_id = p_order_id
      and status <> 'cancelled';
    return null;
  end if;

  select d.id, d.doc_number
  into v_invoice
  from public.finance_documents d
  join public.orders o on o.id = d.related_order_id
  where d.related_order_id = p_order_id
    and d.document_type = 'sales_invoice'
    and d.status in ('approved','sent','partially_paid','paid')
  order by d.updated_at desc
  limit 1;

  if v_invoice.id is null then
    raise exception 'ابتدا فاکتور نهایی تأییدشده سفارش را ثبت کنید';
  end if;

  -- Existing invoice finalization creates/updates the warehouse OUT document.
  -- This call makes the shipment list idempotent for the same order.
  perform public.fn_warehouse_upsert_shipment_from_document(v_invoice.id);

  select id into v_shipment_id
  from public.warehouse_shipments
  where related_order_id = p_order_id
    and status <> 'cancelled'
  order by updated_at desc, created_at desc
  limit 1;

  if v_shipment_id is null then
    v_shipment_id := public.fn_warehouse_upsert_shipment_from_order(p_order_id);
  end if;

  return v_shipment_id;
end;
$$;

grant execute on function public.fn_toggle_order_shipment(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
