-- ============================================================================
-- 131_ORDER_STAGE_SAFE_EDITING
-- Atomic, revision-locked order editing with stage-aware limits. Draft business
-- dependencies are synchronized; posted finance history and physical shipment
-- documents are revised only through their existing audited/delta mechanisms.
-- ============================================================================

begin;

set local lock_timeout='10s';
set local statement_timeout='120s';

alter table public.orders
  add column if not exists edit_revision integer not null default 0,
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_edit_reason text;

create table if not exists public.order_revision_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  revision_no integer not null,
  reason text not null,
  order_snapshot jsonb not null,
  items_snapshot jsonb not null,
  dependency_snapshot jsonb not null default '{}'::jsonb,
  sync_result jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(order_id,revision_no)
);

create index if not exists idx_order_revision_snapshots_order
  on public.order_revision_snapshots(order_id,revision_no desc);

alter table public.order_revision_snapshots enable row level security;
drop policy if exists order_revision_snapshots_read on public.order_revision_snapshots;
create policy order_revision_snapshots_read
on public.order_revision_snapshots for select to authenticated
using (
  public.has_role(array['admin','sales','sales_manager','accountant','production','warehouse'])
  and exists (select 1 from public.orders o where o.id=order_id)
);

grant select on public.order_revision_snapshots to authenticated,service_role;
revoke insert,update,delete on public.order_revision_snapshots from authenticated;

-- Optional credit-control metadata used as a professional warning in order UI.
alter table public.customers
  add column if not exists credit_limit numeric not null default 0 check (credit_limit>=0),
  add column if not exists credit_hold boolean not null default false,
  add column if not exists credit_control_note text;

create or replace view public.v_customer_credit_control
with (security_invoker=true)
as
select
  c.id as customer_id,c.company_name,c.credit_limit,c.credit_hold,c.credit_control_note,
  coalesce(sum(d.balance_amount) filter(
    where d.document_type::text='sales_invoice'
      and d.status::text in ('approved','sent','partially_paid','paid')
      and d.balance_amount>0
  ),0) as outstanding_amount,
  case when c.credit_limit>0 then greatest(c.credit_limit-coalesce(sum(d.balance_amount) filter(
    where d.document_type::text='sales_invoice'
      and d.status::text in ('approved','sent','partially_paid','paid')
      and d.balance_amount>0
  ),0),0) else null end as available_credit,
  c.credit_hold or (c.credit_limit>0 and coalesce(sum(d.balance_amount) filter(
    where d.document_type::text='sales_invoice'
      and d.status::text in ('approved','sent','partially_paid','paid')
      and d.balance_amount>0
  ),0)>c.credit_limit) as requires_credit_review
from public.customers c
left join public.finance_parties fp on fp.linked_customer_id=c.id
left join public.finance_documents d on d.party_id=fp.id
group by c.id;

grant select on public.v_customer_credit_control to authenticated,service_role;

-- Generic one-shot key for order creation. Retried browser requests return the
-- first committed result instead of creating a duplicate order/proforma.
create table if not exists public.app_idempotency_keys(
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null,
  request_key text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation,request_key)
);
alter table public.app_idempotency_keys enable row level security;
revoke all on public.app_idempotency_keys from authenticated,anon;
grant all on public.app_idempotency_keys to service_role;

create or replace function public.fn_app_create_order_idempotent(
  p_request_key text,
  p_customer jsonb,
  p_order jsonb,
  p_items jsonb default '[]'::jsonb,
  p_create_proforma boolean default false,
  p_ref_finance boolean default false,
  p_ref_warehouse boolean default false,
  p_ref_path boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid:=auth.uid();
  v_key text:=nullif(trim(coalesce(p_request_key,'')),'');
  v_result jsonb;
begin
  if v_actor is null then select id into v_actor from public.profiles where role='admin' and is_active order by created_at limit 1; end if;
  if v_actor is null then raise exception 'کاربر ثبت‌کننده سفارش مشخص نیست'; end if;
  if v_key is null or length(v_key)>160 then raise exception 'کلید جلوگیری از ثبت تکراری معتبر نیست'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-create:'||v_actor::text||':'||v_key,131));
  select result into v_result from public.app_idempotency_keys
  where actor_id=v_actor and operation='create_order' and request_key=v_key;
  if found then return v_result||jsonb_build_object('idempotent',true); end if;

  v_result:=public.fn_app_create_order(
    p_customer,p_order,p_items,p_create_proforma,p_ref_finance,p_ref_warehouse,p_ref_path
  );
  insert into public.app_idempotency_keys(actor_id,operation,request_key,result)
  values(v_actor,'create_order',v_key,v_result);
  return v_result||jsonb_build_object('idempotent',false);
end;
$$;

grant execute on function public.fn_app_create_order_idempotent(text,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean) to authenticated,service_role;

create or replace function public.fn_update_order_stage_safe(
  p_order_id uuid,
  p_order jsonb,
  p_items jsonb,
  p_reason text,
  p_expected_revision integer default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.orders%rowtype;
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_actor uuid:=auth.uid();
  v_old_items jsonb;
  v_dependencies jsonb;
  v_revision integer;
  v_removed_ids uuid[]:='{}'::uuid[];
  v_item jsonb;
  v_item_id uuid;
  v_existing public.order_items%rowtype;
  v_sent numeric;
  v_new_qty numeric;
  v_new_code text;
  v_new_unit text;
  v_new_count integer;
  v_existing_count integer;
  v_shipment_count integer;
  v_production_count integer;
  v_production_started boolean;
  v_production_id uuid;
  v_produced numeric;
  v_finance_confirmed boolean;
  v_can_repost_finance boolean;
  v_doc record;
  v_fin_items jsonb;
  v_doc_sync jsonb;
  v_finance_sync jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_reservations integer:=0;
  v_current_item_count integer;
  v_single_quantity numeric;
  v_has_quantity_change boolean:=false;
  v_customer_id uuid;
  v_sales_path text;
  v_expected_date date;
  v_title text;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','sales','sales_manager','accountant']) then
    raise exception 'دسترسی ویرایش سفارش را ندارید';
  end if;
  if v_reason is null then raise exception 'ثبت دلیل ویرایش سفارش الزامی است'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'سفارش باید حداقل یک قلم معتبر داشته باشد';
  end if;

  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'سفارش یافت نشد'; end if;
  if v_old.is_cancelled then raise exception 'سفارش لغوشده قابل ویرایش نیست'; end if;
  if p_expected_revision is not null and p_expected_revision<>v_old.edit_revision then
    raise exception 'این سفارش هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه را به‌روزرسانی کنید';
  end if;

  select count(*),coalesce(jsonb_agg(to_jsonb(oi) order by oi.line_no),'[]'::jsonb)
  into v_existing_count,v_old_items
  from public.order_items oi where oi.order_id=p_order_id;

  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(*) from (
       select distinct nullif(e->>'id','') as id_key,
         coalesce(nullif(e->>'id',''),'new-'||ordinality::text) as unique_key
       from jsonb_array_elements(p_items) with ordinality rows(e,ordinality)
     ) q) then
    raise exception 'یک ردیف سفارش بیش از یک بار ارسال شده است';
  end if;

  select coalesce(array_agg(oi.id),'{}'::uuid[]) into v_removed_ids
  from public.order_items oi
  where oi.order_id=p_order_id
    and not exists (
      select 1 from jsonb_array_elements(p_items) e
      where nullif(e->>'id','')::uuid=oi.id
    );

  select count(*) into v_new_count
  from jsonb_array_elements(p_items) e where nullif(e->>'id','') is null;

  select count(*) into v_shipment_count
  from public.warehouse_shipments s
  where s.related_order_id=p_order_id and s.status in ('sent','delivered') and s.cancelled_at is null;

  select count(*),
         bool_or(status::text not in ('draft','planned','cancelled') or coalesce(quantity_produced,0)>0),
         (array_agg(id order by created_at,id))[1],max(coalesce(quantity_produced,0))
  into v_production_count,v_production_started,v_production_id,v_produced
  from public.production_orders
  where source_order_id=p_order_id and status::text<>'cancelled';
  v_production_started:=coalesce(v_production_started,false);
  v_produced:=coalesce(v_produced,0);

  select exists(
    select 1 from public.finance_documents d
    where d.related_order_id=p_order_id and d.document_type::text='sales_invoice'
      and d.status::text in ('approved','sent','partially_paid','paid')
  ) into v_finance_confirmed;
  v_can_repost_finance:=coalesce(auth.role(),'')='service_role' or public.has_role(array['admin','accountant']);

  v_customer_id:=case when p_order?'customer_id' then nullif(p_order->>'customer_id','')::uuid else v_old.customer_id end;
  v_sales_path:=case when p_order?'sales_path' then nullif(p_order->>'sales_path','') else v_old.sales_path::text end;
  if v_customer_id is distinct from v_old.customer_id and (
    v_shipment_count>0 or v_production_count>0 or exists(select 1 from public.finance_documents where related_order_id=p_order_id and status::text<>'void')
  ) then raise exception 'پس از ایجاد سند مالی/تولیدی/ارسال، تغییر مشتری سفارش مجاز نیست'; end if;
  if v_sales_path is distinct from v_old.sales_path::text and (
    v_shipment_count>0 or v_production_count>0 or exists(select 1 from public.rnd_projects where source_order_id=p_order_id)
  ) then raise exception 'پس از ایجاد وابستگی اجرایی، مسیر سفارش قابل تغییر نیست'; end if;
  if v_sales_path not in ('trading','rnd','production') then raise exception 'مسیر سفارش نامعتبر است'; end if;

  if v_production_started and (cardinality(v_removed_ids)>0 or v_new_count>0) then
    raise exception 'پس از شروع تولید، افزودن یا حذف ردیف سفارش مجاز نیست؛ فقط مقادیر با رعایت مقدار تولید/ارسال‌شده قابل اصلاح‌اند';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(trim(coalesce(v_item->>'item_name_fa','')),'') is null then raise exception 'شرح همه اقلام سفارش الزامی است'; end if;
    v_new_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_new_qty<=0 then raise exception 'مقدار همه اقلام باید بیشتر از صفر باشد'; end if;
    if coalesce(nullif(v_item->>'unit_price','')::numeric,0)<0 then raise exception 'قیمت قلم سفارش نمی‌تواند منفی باشد'; end if;
    if coalesce(nullif(v_item->>'discount_percent','')::numeric,0) not between 0 and 100 then raise exception 'درصد تخفیف نامعتبر است'; end if;

    v_item_id:=nullif(v_item->>'id','')::uuid;
    if v_item_id is not null then
      select * into v_existing from public.order_items where id=v_item_id and order_id=p_order_id for update;
      if not found then raise exception 'یکی از اقلام متعلق به این سفارش نیست یا حذف شده است'; end if;
      select coalesce(sum(sl.quantity),0) into v_sent
      from public.warehouse_shipment_lines sl
      join public.warehouse_shipments s on s.id=sl.shipment_id
      where sl.order_item_id=v_item_id and s.status in ('sent','delivered') and s.cancelled_at is null;
      if v_new_qty<v_sent then
        raise exception 'مقدار قلم «%» نمی‌تواند از مقدار ارسال‌شده (%) کمتر باشد',v_existing.item_name_fa,v_sent;
      end if;
      v_new_code:=nullif(trim(coalesce(v_item->>'warehouse_item_code','')),'');
      v_new_unit:=coalesce(nullif(trim(v_item->>'unit'),''),'عدد');
      if (v_sent>0 or v_production_started) and (
        v_new_code is distinct from v_existing.warehouse_item_code or v_new_unit is distinct from v_existing.unit
      ) then raise exception 'پس از تولید/ارسال، اتصال انبار و واحد قلم «%» قابل تغییر نیست',v_existing.item_name_fa; end if;
      if v_new_qty is distinct from v_existing.quantity then v_has_quantity_change:=true; end if;
    end if;
  end loop;

  if cardinality(v_removed_ids)>0 then
    for v_item_id in select unnest(v_removed_ids)
    loop
      select coalesce(sum(sl.quantity),0) into v_sent
      from public.warehouse_shipment_lines sl
      join public.warehouse_shipments s on s.id=sl.shipment_id
      where sl.order_item_id=v_item_id and s.status in ('sent','delivered') and s.cancelled_at is null;
      if v_sent>0 then raise exception 'قلم دارای ارسال فیزیکی را نمی‌توان از سفارش حذف کرد'; end if;
    end loop;
  end if;

  if v_production_started and v_has_quantity_change then
    if v_production_count<>1 or v_existing_count<>1 or jsonb_array_length(p_items)<>1 then
      raise exception 'این سفارش چندقلمی/چندبرنامه‌ای پس از شروع تولید است؛ تغییر مقدار نیازمند اصلاح برنامه تولید توسط مدیر تولید است';
    end if;
    v_new_qty:=coalesce(nullif((p_items->0)->>'quantity','')::numeric,0);
    if v_new_qty<v_produced then raise exception 'مقدار سفارش نمی‌تواند از مقدار تولیدشده (%) کمتر باشد',v_produced; end if;
  end if;

  if v_finance_confirmed and not v_can_repost_finance then
    raise exception 'سفارش دارای فاکتور تأییدشده است؛ ویرایش مرحله‌ای آن باید توسط مدیر یا حسابدار انجام شود تا سند مالی اتمیک بازثبت شود';
  end if;

  v_revision:=v_old.edit_revision+1;
  select jsonb_build_object(
    'shipment_count',v_shipment_count,'production_count',v_production_count,
    'production_started',v_production_started,'maximum_produced_quantity',v_produced,
    'has_confirmed_invoice',v_finance_confirmed,
    'finance_documents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'doc_number',doc_number,'type',document_type,'status',status)),'[]'::jsonb) from public.finance_documents where related_order_id=p_order_id and status::text<>'void'),
    'reservations',(select count(*) from public.order_inventory_reservations where order_id=p_order_id and status='reserved')
  ) into v_dependencies;

  insert into public.order_revision_snapshots(
    order_id,revision_no,reason,order_snapshot,items_snapshot,dependency_snapshot,created_by
  ) values(p_order_id,v_revision,v_reason,to_jsonb(v_old),v_old_items,v_dependencies,v_actor);

  update public.orders
  set customer_id=v_customer_id,
      sales_path=v_sales_path::public.order_sales_path,
      registered_at=case when p_order?'registered_at' then coalesce(nullif(p_order->>'registered_at','')::date,registered_at) else registered_at end,
      expected_delivery_date=case when p_order?'expected_delivery_date' then nullif(p_order->>'expected_delivery_date','')::date else expected_delivery_date end,
      title_fa=case when p_order?'title_fa' then coalesce(nullif(trim(p_order->>'title_fa'),''),title_fa) else title_fa end,
      title_en=case when p_order?'title_en' then nullif(trim(p_order->>'title_en'),'') else title_en end,
      description_fa=case when p_order?'description_fa' then nullif(trim(p_order->>'description_fa'),'') else description_fa end,
      description_en=case when p_order?'description_en' then nullif(trim(p_order->>'description_en'),'') else description_en end,
      priority=case when p_order?'priority' then greatest(1,least(3,coalesce(nullif(p_order->>'priority','')::integer,priority))) else priority end,
      contact_channel=case when p_order?'contact_channel' then nullif(p_order->>'contact_channel','')::public.crm_contact_channel else contact_channel end,
      customer_phone_snapshot=case when p_order?'customer_phone_snapshot' then nullif(trim(p_order->>'customer_phone_snapshot'),'') else customer_phone_snapshot end,
      customer_city_snapshot=case when p_order?'customer_city_snapshot' then nullif(trim(p_order->>'customer_city_snapshot'),'') else customer_city_snapshot end,
      edit_revision=v_revision,last_edited_at=now(),last_edited_by=v_actor,last_edit_reason=v_reason,updated_at=now()
  where id=p_order_id;

  -- Move current line numbers out of the way so arbitrary reordering remains
  -- compatible with the unique(order_id,line_no) constraint.
  update public.order_items set line_no=line_no+100000 where order_id=p_order_id;

  for v_item in select value||jsonb_build_object('_line_no',ordinality) from jsonb_array_elements(p_items) with ordinality rows(value,ordinality)
  loop
    v_item_id:=nullif(v_item->>'id','')::uuid;
    if v_item_id is null then
      insert into public.order_items(
        order_id,line_no,item_name_fa,item_name_en,warehouse_item_code,quantity,unit,
        unit_price,discount_percent,discount_amount,notes
      ) values(
        p_order_id,(v_item->>'_line_no')::integer,trim(v_item->>'item_name_fa'),nullif(trim(v_item->>'item_name_en'),''),
        nullif(trim(v_item->>'warehouse_item_code'),''),nullif(v_item->>'quantity','')::numeric,
        coalesce(nullif(trim(v_item->>'unit'),''),'عدد'),coalesce(nullif(v_item->>'unit_price','')::numeric,0),
        greatest(0,least(100,coalesce(nullif(v_item->>'discount_percent','')::numeric,0))),
        greatest(0,coalesce(nullif(v_item->>'discount_amount','')::numeric,0)),nullif(trim(v_item->>'notes'),'')
      );
    else
      update public.order_items
      set line_no=(v_item->>'_line_no')::integer,item_name_fa=trim(v_item->>'item_name_fa'),
          item_name_en=nullif(trim(v_item->>'item_name_en'),''),warehouse_item_code=nullif(trim(v_item->>'warehouse_item_code'),''),
          quantity=nullif(v_item->>'quantity','')::numeric,unit=coalesce(nullif(trim(v_item->>'unit'),''),'عدد'),
          unit_price=coalesce(nullif(v_item->>'unit_price','')::numeric,0),
          discount_percent=greatest(0,least(100,coalesce(nullif(v_item->>'discount_percent','')::numeric,0))),
          discount_amount=greatest(0,coalesce(nullif(v_item->>'discount_amount','')::numeric,0)),
          notes=nullif(trim(v_item->>'notes'),'')
      where id=v_item_id and order_id=p_order_id;
    end if;
  end loop;

  -- Synchronize every active order-derived sales document from the edited order.
  for v_doc in
    select d.* from public.finance_documents d
    where d.related_order_id=p_order_id
      and d.document_type::text in ('sales_proforma','sales_invoice')
      and d.status::text not in ('void','cancelled')
    order by d.created_at,d.id
    for update
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_type','goods','description_fa',oi.item_name_fa,'description_en',oi.item_name_en,
      'quantity',oi.quantity,'unit',oi.unit,'unit_price',oi.unit_price,
      'discount_amount',oi.discount_amount,'tax_rate',coalesce(oldfi.tax_rate,0),
      'warehouse_item_id',wi.id,'order_item_id',oi.id,
      'price_currency_snapshot',oldfi.price_currency_snapshot,
      'base_cost_price_snapshot',oldfi.base_cost_price_snapshot,
      'base_sale_price_snapshot',oldfi.base_sale_price_snapshot,
      'exchange_rate_rial_snapshot',oldfi.exchange_rate_rial_snapshot,
      'catalog_cost_rial_snapshot',oldfi.catalog_cost_rial_snapshot,
      'catalog_sale_rial_snapshot',oldfi.catalog_sale_rial_snapshot,
      'price_snapshot_at',oldfi.price_snapshot_at
    ) order by oi.line_no),'[]'::jsonb)
    into v_fin_items
    from public.order_items oi
    left join public.warehouse_items wi on wi.item_code=oi.warehouse_item_code
    left join lateral(
      select fi.* from public.finance_document_items fi
      where fi.document_id=v_doc.id and fi.order_item_id=oi.id
      order by fi.line_no limit 1
    ) oldfi on true
    where oi.order_id=p_order_id and not (oi.id=any(v_removed_ids));

    if v_doc.document_type::text='sales_invoice' and v_doc.status::text in ('approved','sent','partially_paid','paid') then
      v_doc_sync:=public.fn_update_confirmed_finance_document(
        v_doc.id,
        jsonb_build_object('party_id',v_doc.party_id,'related_order_id',p_order_id,'issue_date',v_doc.issue_date,
          'due_date',v_doc.due_date,'is_official',v_doc.is_official,'description',v_doc.description,
          'print_note',v_doc.print_note,'discount_amount',v_doc.discount_amount),
        v_fin_items,'ویرایش مرحله‌ای سفارش '||v_old.order_code||': '||v_reason
      );
    else
      -- Proformas and unposted invoices have no immutable journal/physical effect.
      delete from public.finance_document_items where document_id=v_doc.id;
      insert into public.finance_document_items(
        document_id,line_no,item_type,description_fa,description_en,quantity,unit,unit_price,
        discount_amount,tax_rate,warehouse_item_id,order_item_id,
        price_currency_snapshot,base_cost_price_snapshot,base_sale_price_snapshot,
        exchange_rate_rial_snapshot,catalog_cost_rial_snapshot,catalog_sale_rial_snapshot,price_snapshot_at
      )
      select v_doc.id,ordinality,'goods',trim(e->>'description_fa'),nullif(e->>'description_en',''),
        (e->>'quantity')::numeric,coalesce(nullif(e->>'unit',''),'عدد'),coalesce(nullif(e->>'unit_price','')::numeric,0),
        coalesce(nullif(e->>'discount_amount','')::numeric,0),coalesce(nullif(e->>'tax_rate','')::numeric,0),
        nullif(e->>'warehouse_item_id','')::uuid,nullif(e->>'order_item_id','')::uuid,
        nullif(e->>'price_currency_snapshot',''),nullif(e->>'base_cost_price_snapshot','')::numeric,
        nullif(e->>'base_sale_price_snapshot','')::numeric,nullif(e->>'exchange_rate_rial_snapshot','')::numeric,
        nullif(e->>'catalog_cost_rial_snapshot','')::numeric,nullif(e->>'catalog_sale_rial_snapshot','')::numeric,
        nullif(e->>'price_snapshot_at','')::timestamptz
      from jsonb_array_elements(v_fin_items) with ordinality rows(e,ordinality);
      perform public.fn_finance_recalculate_document_totals(v_doc.id);
      perform public.fn_log_finance_document_event(v_doc.id,'note',
        'اقلام سند با نسخه '||v_revision::text||' سفارش همگام شد: '||v_reason,
        v_doc.status,v_doc.status,jsonb_build_object('order_revision',v_revision));
      v_doc_sync:=jsonb_build_object('id',v_doc.id,'mode','draft_or_proforma_sync');
    end if;
    v_finance_sync:=v_finance_sync||jsonb_build_array(v_doc_sync);
  end loop;

  -- Preserve reservation history before removing an unexecuted line.
  if cardinality(v_removed_ids)>0 then
    update public.order_inventory_reservations
    set status='released',released_at=coalesce(released_at,now()),
        notes=concat_ws(E'\n',notes,'آزادسازی به دلیل حذف امن قلم در نسخه '||v_revision::text),
        order_item_id=null
    where order_item_id=any(v_removed_ids);
    delete from public.order_items where order_id=p_order_id and id=any(v_removed_ids);
  end if;

  select count(*),max(quantity) into v_current_item_count,v_single_quantity
  from public.order_items where order_id=p_order_id;
  v_expected_date:=case when p_order?'expected_delivery_date' then nullif(p_order->>'expected_delivery_date','')::date else v_old.expected_delivery_date end;
  v_title:=case when p_order?'title_fa' then coalesce(nullif(trim(p_order->>'title_fa'),''),v_old.title_fa) else v_old.title_fa end;

  if v_production_count=1 and v_current_item_count=1 then
    if v_single_quantity<v_produced then raise exception 'مقدار جدید از مقدار تولیدشده کمتر است'; end if;
    update public.production_orders
    set quantity_planned=v_single_quantity,planned_end=coalesce(v_expected_date,planned_end),
        notes=concat_ws(E'\n',notes,'همگام‌سازی با نسخه '||v_revision::text||' سفارش: '||v_reason),updated_at=now()
    where id=v_production_id and status::text<>'cancelled';
  elsif v_production_count>0 and (v_has_quantity_change or cardinality(v_removed_ids)>0 or v_new_count>0) then
    v_warnings:=v_warnings||jsonb_build_array('برنامه تولید چندقلمی به‌صورت مخرب تغییر نکرد؛ برای بازبینی به تولید اعلان شد.');
    perform public.fn_log_order_event(p_order_id,'production','بازبینی برنامه تولید پس از ویرایش سفارش',v_reason);
  end if;

  update public.rnd_projects
  set title_fa=v_title,planned_end=coalesce(v_expected_date,planned_end),
      technical_notes=concat_ws(E'\n',technical_notes,'همگام‌سازی نسخه '||v_revision::text||' سفارش: '||v_reason),updated_at=now()
  where source_order_id=p_order_id and status::text not in ('rejected','archived','sent_to_production');

  if v_finance_confirmed or exists(select 1 from public.order_inventory_reservations where order_id=p_order_id and status='reserved') then
    v_reservations:=public.fn_sync_order_inventory_reservations(p_order_id,false);
  end if;

  perform public.fn_log_order_event(
    p_order_id,'note','نسخه '||v_revision::text||' سفارش ثبت شد',
    v_reason||' — اسناد فیزیکی قبلی بدون بازنویسی حفظ شدند.'
  );

  update public.order_revision_snapshots
  set sync_result=jsonb_build_object(
    'finance_documents',v_finance_sync,'reservations_synced',v_reservations,
    'production_count',v_production_count,'warnings',v_warnings
  )
  where order_id=p_order_id and revision_no=v_revision;

  return jsonb_build_object(
    'order_id',p_order_id,'revision_no',v_revision,'finance_documents',v_finance_sync,
    'reservations_synced',v_reservations,'warnings',v_warnings
  );
end;
$$;

grant execute on function public.fn_update_order_stage_safe(uuid,jsonb,jsonb,text,integer) to authenticated,service_role;

commit;

notify pgrst,'reload schema';
