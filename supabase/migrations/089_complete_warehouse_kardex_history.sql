-- 089 complete kardex history.
-- Include final, cancelled and reversal events. Inventory balance remains the
-- signed sum of every warehouse transaction, so cancellations/reversals are visible.
create or replace view public.v_warehouse_kardex with (security_invoker=true) as
with finance_line as (
 select distinct on (i.warehouse_item_id,d.id) i.warehouse_item_id,d.id finance_document_id,d.doc_number finance_doc_number,d.document_type,d.party_id,fp.display_name party_name,d.related_order_id,o.order_code,i.unit_price,i.line_total
 from public.finance_document_items i join public.finance_documents d on d.id=i.document_id left join public.finance_parties fp on fp.id=d.party_id left join public.orders o on o.id=d.related_order_id
 where i.warehouse_item_id is not null order by i.warehouse_item_id,d.id,i.line_no
), base as (
 select wt.item_id,wi.item_code,wi.item_name_fa,wt.id tx_id,wt.transaction_type,case when wt.transaction_type='issue' then 'out' else 'in' end direction,wt.quantity,wt.document_id,wd.doc_number,wd.status document_status,wt.reference_type,wt.reference_id,wt.created_by,wt.note,wt.created_at,
 sum(case when wt.transaction_type='issue' then -wt.quantity when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity else 0 end) over(partition by wt.item_id order by wt.created_at,wt.id rows between unbounded preceding and current row) running_balance,
 wd.customer_name,wd.customer_city,fl.party_name,fl.finance_document_id,fl.finance_doc_number,fl.document_type finance_document_type,fl.related_order_id,fl.order_code,fl.unit_price,fl.line_total
 from public.warehouse_transactions wt join public.warehouse_items wi on wi.id=wt.item_id left join public.warehouse_documents wd on wd.id=wt.document_id left join finance_line fl on fl.finance_document_id=wt.reference_id and fl.warehouse_item_id=wt.item_id
)
select * from base;
grant select on public.v_warehouse_kardex to authenticated;
notify pgrst,'reload schema';
