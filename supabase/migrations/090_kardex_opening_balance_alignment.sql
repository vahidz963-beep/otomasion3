-- 090 align kardex with current stock snapshots.
-- A latest inventory snapshot is the opening balance; only movements after it
-- change the current balance. Older movements remain visible before the reset row.
create or replace view public.v_warehouse_kardex with (security_invoker=true) as
with latest_snapshot as (
 select distinct on (wsi.item_id) wsi.item_id,wsi.quantity snapshot_qty,s.id snapshot_id,s.imported_at snapshot_imported_at
 from public.warehouse_snapshot_items wsi join public.warehouse_snapshots s on s.id=wsi.snapshot_id
 where wsi.item_id is not null order by wsi.item_id,s.imported_at desc
), finance_line as (
 select distinct on (i.warehouse_item_id,d.id) i.warehouse_item_id,d.id finance_document_id,d.doc_number finance_doc_number,d.document_type,fp.display_name party_name,d.related_order_id,o.order_code,i.unit_price,i.line_total
 from public.finance_document_items i join public.finance_documents d on d.id=i.document_id left join public.finance_parties fp on fp.id=d.party_id left join public.orders o on o.id=d.related_order_id where i.warehouse_item_id is not null order by i.warehouse_item_id,d.id,i.line_no
), tx as (
 select wt.item_id,wi.item_code,wi.item_name_fa,wt.id tx_id,wt.transaction_type,case when wt.transaction_type='issue' then 'out' else 'in' end direction,wt.quantity,wt.document_id,wd.doc_number,wd.status document_status,wt.reference_type,wt.reference_id,wt.created_by,wt.note,wt.created_at,ls.snapshot_imported_at,fl.party_name,fl.related_order_id,fl.order_code,fl.unit_price,fl.line_total
 from public.warehouse_transactions wt join public.warehouse_items wi on wi.id=wt.item_id left join public.warehouse_documents wd on wd.id=wt.document_id left join latest_snapshot ls on ls.item_id=wt.item_id left join finance_line fl on fl.finance_document_id=wt.reference_id and fl.warehouse_item_id=wt.item_id
), historical as (
 select t.*,sum(case when t.transaction_type='issue' then -t.quantity when t.transaction_type in ('receipt','reversal','adjustment') then t.quantity else 0 end) over(partition by t.item_id order by t.created_at,t.tx_id rows between unbounded preceding and current row) running_balance from tx t where t.snapshot_imported_at is not null and t.created_at<=t.snapshot_imported_at
), after_snapshot as (
 select t.*,coalesce(ls.snapshot_qty,0)+sum(case when t.transaction_type='issue' then -t.quantity when t.transaction_type in ('receipt','reversal','adjustment') then t.quantity else 0 end) over(partition by t.item_id order by t.created_at,t.tx_id rows between unbounded preceding and current row) running_balance from tx t left join latest_snapshot ls on ls.item_id=t.item_id where t.snapshot_imported_at is null or t.created_at>t.snapshot_imported_at
), opening as (
 select ls.item_id,wi.item_code,wi.item_name_fa,ls.snapshot_id tx_id,'opening_balance' transaction_type,'in' direction,ls.snapshot_qty quantity,null::uuid document_id,'موجودی اول دوره'::text doc_number,null::text document_status,'snapshot'::text reference_type,ls.snapshot_id reference_id,null::uuid created_by,'موجودی اول دوره / Snapshot'::text note,ls.snapshot_imported_at created_at,ls.snapshot_imported_at snapshot_imported_at,null::text party_name,null::uuid related_order_id,null::text order_code,null::numeric unit_price,null::numeric line_total,ls.snapshot_qty running_balance from latest_snapshot ls join public.warehouse_items wi on wi.id=ls.item_id
)
select item_id,item_code,item_name_fa,tx_id,transaction_type,direction,quantity,document_id,doc_number,document_status,reference_type,reference_id,created_by,note,created_at,running_balance,party_name,related_order_id,order_code,unit_price,line_total from historical
union all select item_id,item_code,item_name_fa,tx_id,transaction_type,direction,quantity,document_id,doc_number,document_status,reference_type,reference_id,created_by,note,created_at,running_balance,party_name,related_order_id,order_code,unit_price,line_total from opening
union all select item_id,item_code,item_name_fa,tx_id,transaction_type,direction,quantity,document_id,doc_number,document_status,reference_type,reference_id,created_by,note,created_at,running_balance,party_name,related_order_id,order_code,unit_price,line_total from after_snapshot;
grant select on public.v_warehouse_kardex to authenticated;
notify pgrst,'reload schema';
