-- 083 archive a shipment row independently from its operational status.
-- Cancelled remains a valid status; trash/archive hides the row from the list.

alter table public.warehouse_shipments
  add column if not exists archived_at timestamptz;

create index if not exists idx_warehouse_shipments_archived_at
  on public.warehouse_shipments(archived_at);

drop view if exists public.v_warehouse_shipment_overview;

create view public.v_warehouse_shipment_overview with (security_invoker=true) as
select distinct on (coalesce(s.related_order_id,s.id))
  s.id,s.shipment_number,s.source_type,s.warehouse_document_id,s.finance_document_id,s.related_order_id,
  s.customer_name,s.customer_city,s.shipment_date,s.item_summary,s.total_quantity,s.carton_count,s.total_value,
  s.carrier_name,s.tracking_code,s.receiver_name,s.status,s.notes,s.created_by,s.created_at,s.updated_at,
  wd.doc_number warehouse_doc_number,fd.doc_number finance_doc_number,o.order_code,fp.display_name party_name,c.customer_code
from public.warehouse_shipments s
left join public.warehouse_documents wd on wd.id=s.warehouse_document_id
left join public.finance_documents fd on fd.id=s.finance_document_id
left join public.orders o on o.id=s.related_order_id
left join public.finance_parties fp on fp.id=fd.party_id
left join public.customers c on c.id=o.customer_id
where s.archived_at is null
order by coalesce(s.related_order_id,s.id),(s.related_order_id is null),(s.warehouse_document_id is not null) desc,(s.finance_document_id is not null) desc,s.updated_at desc nulls last,s.created_at desc;

grant select on public.v_warehouse_shipment_overview to authenticated,service_role;
notify pgrst,'reload schema';
