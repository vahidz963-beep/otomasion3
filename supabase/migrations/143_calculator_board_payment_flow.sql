-- Migration 143: WordPress payment flow for BOARD quotes.
-- 1) site_event: board quotes have no quote_requirements; skip inventory reservation,
--    promote directly to a production order and mark paid.
-- 2) promote: board quotes get a proper order item title (طراحی برد) instead of ترانس سفارشی.

create or replace function public.fn_calculator_process_site_event(p_event_key text,p_event_type text,p_site_order_id text,p_quote_id uuid,p_payload jsonb,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_event calculator.site_events%rowtype; v_result jsonb; v_order uuid; v_board boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'رویداد سایت فقط از API امن پذیرفته می‌شود'; end if;
  insert into calculator.site_events(provider,event_key,event_type,site_order_id,quote_id,payload,payload_hash)
  values('wordpress',p_event_key,p_event_type,p_site_order_id,p_quote_id,coalesce(p_payload,'{}'::jsonb),p_payload_hash)
  on conflict(provider,event_key) do nothing returning * into v_event;
  if not found then
    select * into v_event from calculator.site_events where provider='wordpress' and event_key=p_event_key;
    return coalesce(v_event.result,jsonb_build_object('event_id',v_event.id,'status',v_event.status,'idempotent',true));
  end if;
  select calculator_type='board' into v_board from calculator.quotes where id=p_quote_id;
  update calculator.quotes set site_order_id=coalesce(p_site_order_id,site_order_id),source='wordpress',status=case when p_event_type='payment_confirmed' then 'paid'::calculator.quote_status when p_event_type='order_approved' then 'approved'::calculator.quote_status else status end where id=p_quote_id;
  if p_event_type in ('payment_confirmed','order_approved') then
    v_order:=public.fn_calculator_promote_quote_to_order(p_quote_id,null);
    if v_board then
      v_result:=jsonb_build_object('quote_id',p_quote_id,'status','paid','order_id',v_order,'reservation','not_required');
    else
      v_result:=public.fn_calculator_reserve_quote(p_quote_id,p_event_key)||jsonb_build_object('order_id',v_order);
    end if;
  elsif p_event_type='order_cancelled' then
    v_result:=public.fn_calculator_release_quote(p_quote_id,coalesce(p_payload->>'reason','لغو از سایت'));
  else
    v_result:=jsonb_build_object('quote_id',p_quote_id,'status','ignored');
  end if;
  update calculator.site_events set status=case when p_event_type in ('payment_confirmed','order_approved','order_cancelled') then 'processed' else 'ignored' end,result=v_result,processed_at=now() where id=v_event.id;
  return v_result||jsonb_build_object('event_id',v_event.id,'idempotent',false);
exception when others then
  update calculator.site_events set status='failed',error_message=sqlerrm,processed_at=now() where id=v_event.id;
  raise;
end $$;

create or replace function public.fn_calculator_promote_quote_to_order(p_quote_id uuid,p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,calculator as $$
declare v_q calculator.quotes%rowtype; v_actor uuid; v_customer uuid; v_order uuid; v_code text;
begin
  if coalesce(auth.role(),'')<>'service_role' then perform public.fn_calculator_assert_role(array['admin','sales','sales_manager']); end if;
  select * into v_q from calculator.quotes where id=p_quote_id for update;
  if not found then raise exception 'محاسبه یافت نشد'; end if;
  if v_q.order_id is not null then return v_q.order_id; end if;
  v_actor:=coalesce(p_actor_id,auth.uid(),nullif((select value#>>'{}' from calculator.settings where key='order_owner_profile_id'),'')::uuid);
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and is_active) then return null; end if;
  select id into v_customer from public.customers where (v_q.customer_phone is not null and contact_phone=v_q.customer_phone) or (v_q.customer_email is not null and contact_email=v_q.customer_email) order by updated_at desc limit 1;
  if v_customer is null then insert into public.customers(company_name,contact_person_name,contact_phone,contact_email,created_by,notes) values(coalesce(nullif(v_q.customer_name,''),'مشتری سایت'),v_q.customer_name,v_q.customer_phone,v_q.customer_email,v_actor,'ایجاد خودکار از مرکز محاسبه') returning id into v_customer; end if;
  v_code:='WEB-'||regexp_replace(coalesce(v_q.site_order_id,v_q.public_code),'[^A-Za-z0-9_-]','','g');
  insert into public.orders(order_code,customer_id,sales_path,current_stage,title_fa,description_fa,created_by,sales_officer_id)
  values(v_code,v_customer,'production','draft',coalesce(v_q.project_title,'سفارش '||v_q.public_code),'ایجادشده از مرکز محاسبه؛ شناسه '||v_q.public_code,v_actor,v_actor)
  on conflict(order_code) do update set updated_at=now() returning id into v_order;
  if not exists(select 1 from public.order_items where order_id=v_order) then
    if v_q.calculator_type='board' then
      insert into public.order_items(order_id,item_name_fa,quantity,unit,unit_price,notes)
      values(v_order,'طراحی برد سفارشی ('||coalesce(v_q.input_snapshot->>'width_mm','')||'×'||coalesce(v_q.input_snapshot->>'height_mm','')||'mm · '||coalesce(v_q.input_snapshot->>'power_w','')||'W)',v_q.quantity,'عدد',coalesce((v_q.public_result_snapshot->>'unit_sale_rial')::numeric,0),'Snapshot محاسبه '||v_q.public_code);
    else
      insert into public.order_items(order_id,item_name_fa,quantity,unit,unit_price,notes)
      values(v_order,'ترانس سفارشی '||coalesce(v_q.input_snapshot->>'core_model',''),v_q.quantity,'عدد',coalesce((v_q.public_result_snapshot->>'unit_sale_rial')::numeric,0),'Snapshot محاسبه '||v_q.public_code);
    end if;
  end if;
  update calculator.quotes set order_id=v_order,updated_by=v_actor where id=p_quote_id;
  update public.order_inventory_reservations set order_id=v_order where calculator_quote_id=p_quote_id and order_id is null;
  perform calculator.log_event('quote_promoted_to_order','quote',p_quote_id::text,jsonb_build_object('order_id',v_order),v_actor);
  return v_order;
end $$;

revoke all on function public.fn_calculator_process_site_event(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_calculator_process_site_event(text,text,text,uuid,jsonb,text) to service_role;
revoke all on function public.fn_calculator_promote_quote_to_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_calculator_promote_quote_to_order(uuid,uuid) to service_role,authenticated;
