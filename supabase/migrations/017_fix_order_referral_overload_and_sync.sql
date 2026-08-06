-- =====================================================================
-- 017_FIX_ORDER_REFERRAL_OVERLOAD_AND_SYNC
-- Fixes remaining order referral signature mismatch and refreshes PostgREST.
-- Error fixed:
-- function public.fn_create_order_referral(uuid, text, text, unknown, user_role, integer, unknown) does not exist
-- =====================================================================

-- Canonical function: target_role as text, easy for PostgREST/browser calls.
create or replace function public.fn_create_order_referral(
  p_order_id uuid,
  p_target_module text,
  p_title_fa text,
  p_description_fa text default null,
  p_target_role text default null,
  p_priority integer default 2,
  p_due_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_id uuid;
  v_target_role public.user_role;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_active_user() then
    raise exception 'Not allowed to create order referral';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Order not found';
  end if;

  if p_target_role is not null and p_target_role <> '' then
    v_target_role := p_target_role::public.user_role;
  else
    v_target_role := case p_target_module
      when 'accounting' then 'accountant'::public.user_role
      when 'warehouse' then 'warehouse'::public.user_role
      when 'production' then 'production'::public.user_role
      when 'rnd' then 'rnd'::public.user_role
      when 'sales' then 'sales'::public.user_role
      when 'admin' then 'admin'::public.user_role
      else null
    end;
  end if;

  insert into public.automation_referrals (
    referral_number, source_module, target_module, target_role, referral_type,
    priority, status, title_fa, description_fa, related_order_id, created_by, due_date
  ) values (
    null, 'orders', p_target_module, v_target_role, 'request',
    greatest(1, least(coalesce(p_priority, 2), 3))::smallint,
    'open', p_title_fa, p_description_fa, p_order_id, auth.uid(), p_due_date
  ) returning id into v_referral_id;

  perform public.fn_log_order_event(
    p_order_id, 'referral', 'ارجاع سفارش ایجاد شد', p_title_fa,
    null, null,
    jsonb_build_object('referral_id', v_referral_id, 'target_module', p_target_module, 'target_role', v_target_role)
  );

  return v_referral_id;
end;
$$;

-- Overload for internal PL/pgSQL calls where p_target_role is already user_role.
create or replace function public.fn_create_order_referral(
  p_order_id uuid,
  p_target_module text,
  p_title_fa text,
  p_description_fa text,
  p_target_role public.user_role,
  p_priority integer,
  p_due_date date
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.fn_create_order_referral(
    p_order_id,
    p_target_module,
    p_title_fa,
    p_description_fa,
    p_target_role::text,
    p_priority,
    p_due_date
  );
$$;

grant execute on function public.fn_create_order_referral(uuid, text, text, text, text, integer, date) to authenticated;
grant execute on function public.fn_create_order_referral(uuid, text, text, text, public.user_role, integer, date) to authenticated;

-- Recreate app order function with explicit casts to avoid ambiguous function selection.
create or replace function public.fn_app_create_order(
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
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_customer_id uuid;
  v_order_id uuid;
  v_order_code text;
  v_doc_id uuid;
  v_item jsonb;
  v_sales_path public.order_sales_path;
  v_target_module text;
  v_target_role public.user_role;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','sales']) then
    raise exception 'Only sales/admin can create orders';
  end if;

  if v_actor is null then
    select id into v_actor from public.profiles where role = 'admin' and is_active limit 1;
  end if;

  v_customer_id := nullif(p_order->>'customer_id', '')::uuid;

  if v_customer_id is null then
    insert into public.customers (
      company_name, contact_person_name, contact_phone, contact_email, city, address,
      preferred_contact_channel, acquisition_source, crm_status, lead_score,
      assigned_sales_id, created_by
    ) values (
      coalesce(nullif(p_customer->>'company_name', ''), 'مشتری جدید'),
      nullif(p_customer->>'contact_person_name', ''),
      nullif(p_customer->>'contact_phone', ''),
      nullif(p_customer->>'contact_email', ''),
      nullif(p_customer->>'city', ''),
      nullif(p_customer->>'address', ''),
      nullif(p_customer->>'preferred_contact_channel', '')::public.crm_contact_channel,
      coalesce(nullif(p_customer->>'acquisition_source', ''), 'ثبت سفارش'),
      coalesce(nullif(p_customer->>'crm_status', '')::public.crm_party_status, 'lead'),
      coalesce(nullif(p_customer->>'lead_score', '')::int, 50),
      v_actor,
      v_actor
    ) returning id into v_customer_id;
  end if;

  v_sales_path := coalesce(nullif(p_order->>'sales_path', '')::public.order_sales_path, 'trading');

  insert into public.orders (
    order_code, customer_id, sales_path, workflow_template_id, current_stage,
    registered_at, title_fa, title_en, description_fa, priority,
    expected_delivery_date, sales_officer_id, created_by, contact_channel,
    customer_phone_snapshot, customer_city_snapshot
  ) values (
    null,
    v_customer_id,
    v_sales_path,
    nullif(p_order->>'workflow_template_id', '')::uuid,
    null,
    coalesce(nullif(p_order->>'registered_at', '')::date, current_date),
    coalesce(nullif(p_order->>'title_fa', ''), 'سفارش جدید'),
    nullif(p_order->>'title_en', ''),
    nullif(p_order->>'description_fa', ''),
    coalesce(nullif(p_order->>'priority', '')::smallint, 2),
    nullif(p_order->>'expected_delivery_date', '')::date,
    v_actor,
    v_actor,
    nullif(p_order->>'contact_channel', '')::public.crm_contact_channel,
    nullif(p_order->>'customer_phone_snapshot', ''),
    nullif(p_order->>'customer_city_snapshot', '')
  ) returning id, order_code into v_order_id, v_order_code;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.order_items (
      order_id, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price, notes
    ) values (
      v_order_id,
      coalesce(nullif(v_item->>'item_name_fa', ''), 'قلم سفارش'),
      nullif(v_item->>'item_name_en', ''),
      nullif(v_item->>'warehouse_item_code', ''),
      coalesce(nullif(v_item->>'quantity', '')::numeric, 1),
      coalesce(nullif(v_item->>'unit', ''), 'عدد'),
      coalesce(nullif(v_item->>'unit_price', '')::numeric, 0),
      nullif(v_item->>'notes', '')
    );
  end loop;

  if p_create_proforma then
    v_doc_id := public.fn_create_sales_proforma_from_order(v_order_id);
  end if;

  if p_ref_finance then
    perform public.fn_create_order_referral(v_order_id, 'accounting'::text, ('صدور/پیگیری فاکتور سفارش ' || v_order_code)::text, null::text, 'accountant'::public.user_role, 2::integer, null::date);
  end if;

  if p_ref_warehouse then
    perform public.fn_create_order_referral(v_order_id, 'warehouse'::text, ('بررسی موجودی سفارش ' || v_order_code)::text, null::text, 'warehouse'::public.user_role, 2::integer, null::date);
  end if;

  if p_ref_path then
    v_target_module := case v_sales_path when 'rnd' then 'rnd' when 'production' then 'production' else 'warehouse' end;
    v_target_role := case v_sales_path when 'rnd' then 'rnd'::public.user_role when 'production' then 'production'::public.user_role else 'warehouse'::public.user_role end;
    perform public.fn_create_order_referral(v_order_id, v_target_module::text, ('ارجاع مسیر سفارش ' || v_order_code)::text, null::text, v_target_role, 2::integer, null::date);
  end if;

  perform public.fn_log_crm_interaction(v_customer_id, ('ثبت سفارش ' || v_order_code)::text, null::text, 'note', null, v_order_id);

  return jsonb_build_object('id', v_order_id, 'order_code', v_order_code, 'proforma_id', v_doc_id);
end;
$$;

grant execute on function public.fn_app_create_order(jsonb, jsonb, jsonb, boolean, boolean, boolean, boolean) to authenticated;

select public.fn_backfill_order_stage_instances();
notify pgrst, 'reload schema';
