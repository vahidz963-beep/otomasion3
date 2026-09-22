-- 085 discount percent/amount for orders and invoice creation.
alter table public.order_items add column if not exists discount_percent numeric not null default 0 check (discount_percent between 0 and 100);
alter table public.order_items add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);

create or replace function public.fn_create_sales_proforma_from_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype;v_party_id uuid;v_doc_id uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' and not public.has_role(array['admin','accountant','sales']) then raise exception 'Not allowed to create proforma from order';end if;
 select * into v_order from public.orders where id=p_order_id;if not found then raise exception 'Order not found';end if;
 select id into v_doc_id from public.finance_documents where related_order_id=p_order_id and document_type='sales_proforma' and status<>'void' order by created_at desc limit 1;if v_doc_id is not null then return v_doc_id;end if;
 v_party_id:=public.fn_finance_party_for_customer(v_order.customer_id);
 insert into public.finance_documents(doc_number,document_type,status,party_id,related_order_id,source_module,source_record_id,issue_date,due_date,description,created_by) values(null,'sales_proforma','draft',v_party_id,v_order.id,'orders',v_order.id,current_date,coalesce(v_order.expected_delivery_date,current_date+7),'پیش‌فاکتور برای سفارش '||v_order.order_code,auth.uid()) returning id into v_doc_id;
 insert into public.finance_document_items(document_id,line_no,item_type,description_fa,description_en,quantity,unit,unit_price,discount_amount,tax_rate,warehouse_item_id,order_item_id)
 select v_doc_id,row_number() over(order by oi.created_at,oi.id),'goods',oi.item_name_fa,oi.item_name_en,oi.quantity,oi.unit,oi.unit_price,least(greatest(coalesce(oi.discount_amount,0),0),oi.quantity*oi.unit_price),0,wi.id,oi.id from public.order_items oi left join public.warehouse_items wi on wi.item_code=oi.warehouse_item_code where oi.order_id=p_order_id;
 perform public.fn_finance_recalculate_document_totals(v_doc_id);perform public.fn_log_order_event(p_order_id,'finance','پیش‌فاکتور از سفارش ساخته شد؛ تخفیف‌های ردیف‌ها منتقل شد',null,null,null,jsonb_build_object('finance_document_id',v_doc_id));return v_doc_id;
end; $$;
grant execute on function public.fn_create_sales_proforma_from_order(uuid) to authenticated;
notify pgrst,'reload schema';
