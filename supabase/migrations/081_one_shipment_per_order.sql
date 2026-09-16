-- 081 ONE SHIPMENT PER ORDER
-- Order, invoice and warehouse all converge on one shipment row.
-- Existing financial/warehouse documents are not deleted or rebuilt.

create or replace function public.fn_warehouse_upsert_ready_shipment(
  p_source_type text, p_source_record_id uuid, p_related_order_id uuid,
  p_customer_name text, p_customer_city text, p_item_summary text,
  p_total_quantity numeric default 0, p_total_value numeric default 0, p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_related_order_id is not null then
    select id into v_id from public.warehouse_shipments
    where related_order_id=p_related_order_id and status <> 'cancelled'
    order by (warehouse_document_id is not null) desc, updated_at desc nulls last, created_at desc limit 1;
  end if;
  if v_id is null and p_source_record_id is not null then
    select id into v_id from public.warehouse_shipments
    where source_type=p_source_type and source_record_id=p_source_record_id and status <> 'cancelled'
    order by updated_at desc nulls last, created_at desc limit 1;
  end if;
  if v_id is null then
    insert into public.warehouse_shipments(source_type,source_record_id,related_order_id,customer_name,customer_city,shipment_date,item_summary,total_quantity,total_value,status,notes,created_by)
    values(p_source_type,p_source_record_id,p_related_order_id,p_customer_name,p_customer_city,current_date,p_item_summary,coalesce(p_total_quantity,0),coalesce(p_total_value,0),'ready',p_notes,auth.uid()) returning id into v_id;
  else
    update public.warehouse_shipments set source_type=coalesce(source_type,p_source_type),source_record_id=coalesce(source_record_id,p_source_record_id),related_order_id=coalesce(related_order_id,p_related_order_id),customer_name=coalesce(p_customer_name,customer_name),customer_city=coalesce(p_customer_city,customer_city),item_summary=coalesce(p_item_summary,item_summary),total_quantity=coalesce(p_total_quantity,total_quantity,0),total_value=coalesce(p_total_value,total_value,0),status=case when status='cancelled' then status else 'ready' end,notes=coalesce(p_notes,notes),updated_at=now() where id=v_id;
  end if;
  return v_id;
end; $$;

grant execute on function public.fn_warehouse_upsert_ready_shipment(text,uuid,uuid,text,text,text,numeric,numeric,text) to authenticated;

create or replace function public.fn_warehouse_upsert_shipment_from_document(p_document_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_doc public.warehouse_documents%rowtype; v_shipment_id uuid; v_finance_doc uuid; v_order_id uuid; v_total_qty numeric; v_total_value numeric; v_summary text;
begin
  select * into v_doc from public.warehouse_documents where id=p_document_id;
  if not found or v_doc.type::text<>'out' or v_doc.status::text<>'final' then return null; end if;
  select reference_id into v_finance_doc from public.warehouse_transactions where document_id=p_document_id and reference_type='finance_document' limit 1;
  select related_order_id into v_order_id from public.finance_documents where id=v_finance_doc;
  select coalesce(sum(wdl.quantity),0),coalesce(sum(wdl.quantity*coalesce(fdi.unit_price,wi.unit_price_estimate,0)),0),string_agg(wi.item_code||' · '||wi.item_name_fa||' × '||wdl.quantity::text,E'\n' order by wi.item_code)
  into v_total_qty,v_total_value,v_summary from public.warehouse_document_lines wdl join public.warehouse_items wi on wi.id=wdl.item_id left join public.finance_document_items fdi on fdi.document_id=v_finance_doc and fdi.warehouse_item_id=wdl.item_id where wdl.document_id=p_document_id and wdl.removed_at is null;
  if v_order_id is not null then
    select id into v_shipment_id from public.warehouse_shipments where related_order_id=v_order_id and status<>'cancelled' order by (warehouse_document_id is not null) desc,updated_at desc nulls last,created_at desc limit 1;
  end if;
  if v_shipment_id is not null then
    update public.warehouse_shipments set source_type=case when v_finance_doc is not null then 'finance_invoice' else source_type end,source_record_id=coalesce(v_finance_doc,p_document_id),warehouse_document_id=p_document_id,finance_document_id=v_finance_doc,customer_name=coalesce(v_doc.customer_name,customer_name),customer_city=coalesce(v_doc.customer_city,customer_city),shipment_date=coalesce(v_doc.finalized_at::date,current_date),item_summary=v_summary,total_quantity=v_total_qty,total_value=v_total_value,status=case when status='cancelled' then status else 'ready' end,notes='همگام‌سازی از سند خروج انبار '||coalesce(v_doc.doc_number,p_document_id::text),updated_at=now() where id=v_shipment_id;
    return v_shipment_id;
  end if;
  insert into public.warehouse_shipments(source_type,source_record_id,warehouse_document_id,finance_document_id,related_order_id,customer_name,customer_city,shipment_date,item_summary,total_quantity,total_value,status,notes,created_by)
  values(case when v_finance_doc is not null then 'finance_invoice' else 'manual' end,coalesce(v_finance_doc,p_document_id),p_document_id,v_finance_doc,v_order_id,v_doc.customer_name,v_doc.customer_city,coalesce(v_doc.finalized_at::date,current_date),v_summary,v_total_qty,v_total_value,'ready','ثبت خودکار از سند خروج انبار '||coalesce(v_doc.doc_number,p_document_id::text),coalesce(v_doc.created_by,auth.uid())) returning id into v_shipment_id;
  return v_shipment_id;
end; $$;

grant execute on function public.fn_warehouse_upsert_shipment_from_document(uuid) to authenticated;

create or replace view public.v_warehouse_shipment_overview with (security_invoker=true) as
select distinct on (coalesce(s.related_order_id,s.id)) s.id,s.shipment_number,s.source_type,s.warehouse_document_id,s.finance_document_id,s.related_order_id,s.customer_name,s.customer_city,s.shipment_date,s.item_summary,s.total_quantity,s.carton_count,s.total_value,s.carrier_name,s.tracking_code,s.receiver_name,s.status,s.notes,s.created_by,s.created_at,s.updated_at,wd.doc_number warehouse_doc_number,fd.doc_number finance_doc_number,o.order_code,fp.display_name party_name,c.customer_code
from public.warehouse_shipments s left join public.warehouse_documents wd on wd.id=s.warehouse_document_id left join public.finance_documents fd on fd.id=s.finance_document_id left join public.orders o on o.id=s.related_order_id left join public.finance_parties fp on fp.id=fd.party_id left join public.customers c on c.id=o.customer_id
order by coalesce(s.related_order_id,s.id),(s.related_order_id is null),(s.warehouse_document_id is not null) desc,s.updated_at desc nulls last,s.created_at desc;

grant select on public.v_warehouse_shipment_overview to authenticated,service_role;
notify pgrst,'reload schema';
