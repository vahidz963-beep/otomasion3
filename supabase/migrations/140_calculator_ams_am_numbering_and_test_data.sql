begin;

-- Version 140.0.0 — AMS/AM document numbering for the calculator datasheet
-- plus optional customer-provided electrical test values.
-- [1] Every calculation gets an AMS number (AMS1, AMS2, …) used as the
--     datasheet Document ID. When its production order reaches the ordered
--     quantity and an admin approves the conversion, the document is
--     renumbered to an AM number (AM55, AM56, …) from its own sequence.
-- [2] Optional test data (inductance / turns ratio / Hi-Pot / DCR) entered by
--     the customer or staff is stored with the quote and printed on the
--     datasheet only when provided.

-- ------------------------------------------------------------------
-- 1) Columns and sequences
-- ------------------------------------------------------------------
create sequence if not exists calculator.ams_number_seq start 1;
create sequence if not exists calculator.am_number_seq start 1;

alter table calculator.quotes
  add column if not exists ams_code text;
alter table calculator.quotes
  add column if not exists am_code text;
alter table calculator.quotes
  add column if not exists test_data jsonb not null default '{}'::jsonb;

update calculator.quotes
set ams_code = 'AMS' || r.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from calculator.quotes
  where ams_code is null
) r
where calculator.quotes.id = r.id;

select setval('calculator.ams_number_seq', greatest((select count(*) from calculator.quotes where ams_code is not null), 1));

-- Unique document numbers from now on (defaults fire on plain inserts).
alter table calculator.quotes
  alter column ams_code set default 'AMS' || nextval('calculator.ams_number_seq');
alter table calculator.quotes
  add constraint quotes_ams_code_unique unique (ams_code);
alter table calculator.quotes
  add constraint quotes_am_code_unique unique (am_code);
create index if not exists quotes_am_code_idx on calculator.quotes(am_code) where am_code is not null;

-- ------------------------------------------------------------------
-- 2) Save quote: persist optional test data and return document codes
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_save_quote(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_id uuid; v_formula uuid; v_actor uuid; v_status text; v_line jsonb; v_req jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'ثبت Snapshot فقط توسط موتور امن سرور مجاز است'; end if;
  v_id:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  v_formula:=(p_payload->>'formula_version_id')::uuid; v_actor:=nullif(p_payload->>'actor_id','')::uuid;
  select status into v_status from calculator.quotes where id=v_id for update;
  if found and v_status in ('reserved','in_production','produced','cancelled') then raise exception 'سند قطعی قابل بازنویسی نیست'; end if;
  insert into calculator.quotes(id,calculator_type,source,status,order_type,quantity,customer_name,customer_phone,customer_email,project_title,formula_version_id,input_snapshot,engineering_snapshot,pricing_snapshot,public_result_snapshot,inventory_snapshot,site_order_id,test_data,expires_at,created_by,updated_by)
  values(v_id,(p_payload->>'calculator_type')::calculator.calculator_kind,coalesce(p_payload->>'source','internal'),'calculated',nullif(p_payload->>'order_type','')::calculator.order_kind,(p_payload->>'quantity')::int,nullif(p_payload->>'customer_name',''),nullif(p_payload->>'customer_phone',''),nullif(p_payload->>'customer_email',''),nullif(p_payload->>'project_title',''),v_formula,p_payload->'input_snapshot',p_payload->'engineering_snapshot',p_payload->'pricing_snapshot',p_payload->'public_result_snapshot',p_payload->'inventory_snapshot',nullif(p_payload->>'site_order_id',''),coalesce(p_payload->'test_data','{}'::jsonb),nullif(p_payload->>'expires_at','')::timestamptz,v_actor,v_actor)
  on conflict(id) do update set calculator_type=excluded.calculator_type,source=excluded.source,status='calculated',order_type=excluded.order_type,quantity=excluded.quantity,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,customer_email=excluded.customer_email,project_title=excluded.project_title,formula_version_id=excluded.formula_version_id,input_snapshot=excluded.input_snapshot,engineering_snapshot=excluded.engineering_snapshot,pricing_snapshot=excluded.pricing_snapshot,public_result_snapshot=excluded.public_result_snapshot,inventory_snapshot=excluded.inventory_snapshot,site_order_id=coalesce(excluded.site_order_id,calculator.quotes.site_order_id),test_data=coalesce(p_payload->'test_data',calculator.quotes.test_data),expires_at=excluded.expires_at,updated_by=v_actor;
  delete from calculator.quote_windings where quote_id=v_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'windings','[]'::jsonb)) loop
    insert into calculator.quote_windings(quote_id,line_no,name,start_pin,end_pin,turns,wire_id,strands,arrangement,layer_mode,requested_layers,calculated_layers,direction,length_m,weight_kg,window_share_percent)
    values(v_id,(v_line->>'line_no')::int,v_line->>'name',(v_line->>'start_pin')::int,(v_line->>'end_pin')::int,(v_line->>'turns')::int,(v_line->>'wire_id')::uuid,(v_line->>'strands')::int,v_line->>'arrangement',v_line->>'layer_mode',nullif(v_line->>'requested_layers','')::int,(v_line->>'calculated_layers')::int,v_line->>'direction',(v_line->>'length_m')::numeric,(v_line->>'weight_kg')::numeric,(v_line->>'window_share_percent')::numeric);
  end loop;
  delete from calculator.quote_requirements where quote_id=v_id;
  for v_req in select * from jsonb_array_elements(coalesce(p_payload->'requirements','[]'::jsonb)) loop
    insert into calculator.quote_requirements(quote_id,component_role,warehouse_item_id,quantity_per_unit,quantity_total,unit)
    values(v_id,v_req->>'component_role',(v_req->>'warehouse_item_id')::uuid,(v_req->>'quantity_per_unit')::numeric,(v_req->>'quantity_total')::numeric,v_req->>'unit');
  end loop;
  perform calculator.log_event('quote_calculated','quote',v_id::text,jsonb_build_object('formula_version_id',v_formula,'quantity',p_payload->>'quantity'),v_actor);
  return (select jsonb_build_object('id',q.id,'public_code',q.public_code,'ams_code',q.ams_code,'am_code',q.am_code,'status',q.status,'public_result',q.public_result_snapshot) from calculator.quotes q where q.id=v_id);
end $$;

-- ------------------------------------------------------------------
-- 3) List quotes: expose document codes
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_list_quotes(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,calculator as $$
begin
  perform public.fn_calculator_assert_role(array['admin','sales','sales_manager','production','warehouse']);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select q.id,q.public_code,q.ams_code,q.am_code,q.calculator_type::text,q.source,q.status::text,q.order_type::text,q.quantity,q.customer_name,q.customer_phone,q.project_title,q.site_order_id,q.order_id,q.production_order_id,q.public_result_snapshot,q.inventory_snapshot,q.created_at,q.reserved_at,q.consumed_at from calculator.quotes q order by q.created_at desc limit least(greatest(p_limit,1),300)) x),'[]'::jsonb);
end $$;

-- ------------------------------------------------------------------
-- 4) Admin conversion: AMS -> AM once the order reached its quantity
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_convert_quote_to_am(p_quote_id uuid)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_q calculator.quotes%rowtype; v_code text;
begin
  if not public.is_admin() then raise exception 'تبدیل شماره سند به AM فقط با تأیید مدیر مجاز است'; end if;
  select * into v_q from calculator.quotes where id=p_quote_id for update;
  if not found then raise exception 'محاسبه یافت نشد'; end if;
  if v_q.am_code is not null then return jsonb_build_object('quote_id',v_q.id,'ams_code',v_q.ams_code,'am_code',v_q.am_code,'idempotent',true); end if;
  if v_q.order_id is null or v_q.status not in ('reserved','in_production','produced') then
    raise exception 'تبدیل به شماره AM پس از اتصال سفارش و رسیدن آن به تعداد (رزرو/در تولید/تکمیل) مجاز است';
  end if;
  v_code:='AM'||nextval('calculator.am_number_seq');
  update calculator.quotes set am_code=v_code,updated_by=auth.uid() where id=p_quote_id;
  perform calculator.log_event('quote_renumbered_to_am','quote',p_quote_id::text,jsonb_build_object('ams_code',v_q.ams_code,'am_code',v_code));
  return jsonb_build_object('quote_id',p_quote_id,'ams_code',v_q.ams_code,'am_code',v_code,'idempotent',false);
end $$;

revoke all on function public.fn_calculator_save_quote(jsonb) from public,anon;
grant execute on function public.fn_calculator_save_quote(jsonb) to service_role;
revoke all on function public.fn_calculator_list_quotes(integer) from public,anon;
grant execute on function public.fn_calculator_list_quotes(integer) to authenticated;
revoke all on function public.fn_calculator_convert_quote_to_am(uuid) from public,anon;
grant execute on function public.fn_calculator_convert_quote_to_am(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
