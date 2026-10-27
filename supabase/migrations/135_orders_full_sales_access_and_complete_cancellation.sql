-- ============================================================================
-- 135_ORDERS_FULL_SALES_ACCESS_AND_COMPLETE_CANCELLATION
-- Admin-equivalent operational access INSIDE the Orders module for active Sales
-- and Sales Manager users. Accounting/Treasury mutation rights are unchanged.
-- ============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Explicit audit fields for complete order cancellation. No physical delete is
-- introduced and posted finance/warehouse history remains immutable.
alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

update public.orders
set cancelled_at = coalesce(cancelled_at, updated_at, created_at)
where is_cancelled and cancelled_at is null;

-- One reusable capability contract for the Orders module only.
create or replace function public.fn_has_full_orders_module_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (
      public.is_active_user()
      and public.has_role(array['admin','sales','sales_manager'])
    );
$$;

revoke execute on function public.fn_has_full_orders_module_access() from public, anon;
grant execute on function public.fn_has_full_orders_module_access()
  to authenticated, service_role;

-- Minimal, module-scoped audit trail. It intentionally stores no finance,
-- treasury or confidential cost payloads.
create table if not exists public.order_module_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_module_audit_events_order
  on public.order_module_audit_events(order_id, created_at desc);
create index if not exists idx_order_module_audit_events_customer
  on public.order_module_audit_events(customer_id, created_at desc);

alter table public.order_module_audit_events enable row level security;
revoke all on table public.order_module_audit_events from anon, authenticated;
grant select on table public.order_module_audit_events to authenticated;

drop policy if exists order_module_audit_select on public.order_module_audit_events;
create policy order_module_audit_select on public.order_module_audit_events
for select using (
  public.fn_has_full_orders_module_access()
  and (order_id is null or public.fn_user_can_access_order(order_id))
);

create or replace function public.fn_log_order_module_audit(
  p_action text,
  p_order_id uuid default null,
  p_customer_id uuid default null,
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.order_module_audit_events(actor_id, order_id, customer_id, action, details)
  values (auth.uid(), p_order_id, p_customer_id, p_action, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_log_order_module_audit(text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.fn_log_order_module_audit(text,uuid,uuid,jsonb) to service_role;

-- Sales and Sales Manager now see every order in the Orders module, matching the
-- Admin module scope. Cross-module R&D/Production/Warehouse/Accounting rules are
-- preserved exactly as before.
create or replace function public.fn_user_can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and public.is_active_user()
      and (
        public.is_admin()
        or public.has_role(array['sales','sales_manager'])
        or (public.has_role(array['rnd']) and o.sales_path = 'rnd')
        or (public.has_role(array['production']) and o.sales_path = 'production')
        or (
          public.has_role(array['warehouse'])
          and (
            o.current_stage in ('warehouse_receipt','final_output','delivered')
            or o.sales_path in ('trading','production')
          )
        )
        or public.has_role(array['accountant'])
      )
  );
$$;

grant execute on function public.fn_user_can_access_order(uuid)
  to authenticated, service_role;

-- Direct order/item policies follow the same full Orders-module scope. Physical
-- delete remains unavailable; cancellation is the audited RPC below.
drop policy if exists orders_update_authorized on public.orders;
create policy orders_update_authorized on public.orders
for update to authenticated
using (
  public.is_admin()
  or (public.has_role(array['sales','sales_manager']) and public.is_active_user())
  or (public.has_role(array['rnd']) and public.is_active_user() and sales_path = 'rnd')
  or (public.has_role(array['production']) and public.is_active_user() and sales_path = 'production')
  or (
    public.has_role(array['warehouse'])
    and public.is_active_user()
    and current_stage in ('warehouse_receipt','final_output','delivered')
  )
)
with check (
  public.is_admin()
  or (public.has_role(array['sales','sales_manager']) and public.is_active_user())
  or (public.has_role(array['rnd','production','warehouse']) and public.is_active_user())
);

drop policy if exists order_items_write_sales_admin on public.order_items;
create policy order_items_write_sales_admin on public.order_items
for all to authenticated
using (
  public.fn_user_can_access_order(order_id)
  and public.has_role(array['admin','sales','sales_manager'])
)
with check (
  public.fn_user_can_access_order(order_id)
  and public.has_role(array['admin','sales','sales_manager'])
);

-- The following wrappers expose the exact existing audited operations to Admin,
-- Sales and Sales Manager. They delegate only one operation at a time and do not
-- grant generic service-role, accounting, payment, void or treasury access.
create or replace function public.fn_orders_full_create_order(
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
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result jsonb;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی کامل ماژول سفارش‌ها را ندارید';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_app_create_order_idempotent(
    p_request_key, p_customer, p_order, p_items,
    p_create_proforma, p_ref_finance, p_ref_warehouse, p_ref_path
  );
  perform public.fn_log_order_module_audit(
    'order.created',
    (v_result->>'id')::uuid,
    (select customer_id from public.orders where id = (v_result->>'id')::uuid),
    jsonb_build_object('request_key', p_request_key, 'idempotent', coalesce((v_result->>'idempotent')::boolean, false))
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_create_order(text,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.fn_orders_full_create_order(text,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean)
  to authenticated, service_role;

create or replace function public.fn_orders_full_update_stage_safe(
  p_order_id uuid,
  p_order jsonb,
  p_items jsonb,
  p_reason text,
  p_expected_revision integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result jsonb;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی کامل ویرایش سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_update_order_stage_safe(
    p_order_id, p_order, p_items, p_reason, p_expected_revision
  );
  perform public.fn_log_order_module_audit(
    'order.stage_safe_updated', p_order_id,
    (select customer_id from public.orders where id = p_order_id),
    jsonb_build_object('reason', p_reason, 'revision_no', v_result->'revision_no')
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_update_stage_safe(uuid,jsonb,jsonb,text,integer) from public, anon;
grant execute on function public.fn_orders_full_update_stage_safe(uuid,jsonb,jsonb,text,integer)
  to authenticated, service_role;

create or replace function public.fn_orders_full_set_stage(
  p_order_id uuid,
  p_stage_key text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_active_user()
       and public.has_role(array['admin','sales','sales_manager','production','rnd','warehouse','accountant'])
     ) then
    raise exception 'دسترسی تغییر مرحله سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.fn_set_order_stage(p_order_id, p_stage_key, p_note);
  perform public.fn_log_order_module_audit(
    'order.stage_changed', p_order_id,
    (select customer_id from public.orders where id = p_order_id),
    jsonb_build_object('stage_key', p_stage_key, 'note', p_note)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_set_stage(uuid,text,text) from public, anon;
grant execute on function public.fn_orders_full_set_stage(uuid,text,text)
  to authenticated, service_role;

create or replace function public.fn_orders_full_reserve_inventory(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result integer;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی رزرو موجودی سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  v_result := public.fn_reserve_order_inventory(p_order_id);
  perform public.fn_log_order_module_audit(
    'order.inventory_reserved', p_order_id,
    (select customer_id from public.orders where id = p_order_id),
    jsonb_build_object('synced_items', v_result)
  );
  return v_result;
end;
$$;

revoke execute on function public.fn_orders_full_reserve_inventory(uuid) from public, anon;
grant execute on function public.fn_orders_full_reserve_inventory(uuid)
  to authenticated, service_role;

create or replace function public.fn_orders_full_release_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_active_user()
       and public.has_role(array['admin','warehouse','sales','sales_manager'])
     ) then
    raise exception 'دسترسی آزادسازی رزرو سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.fn_release_order_inventory(p_order_id);
  perform public.fn_log_order_module_audit(
    'order.inventory_released', p_order_id,
    (select customer_id from public.orders where id = p_order_id), '{}'
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_release_inventory(uuid) from public, anon;
grant execute on function public.fn_orders_full_release_inventory(uuid)
  to authenticated, service_role;

create or replace function public.fn_orders_full_create_proforma(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_active_user()
       and public.has_role(array['admin','accountant','sales','sales_manager'])
     ) then
    raise exception 'دسترسی صدور پیش‌فاکتور سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_create_sales_proforma_from_order(p_order_id);
  perform public.fn_log_order_module_audit(
    'order.proforma_created', p_order_id,
    (select customer_id from public.orders where id = p_order_id),
    jsonb_build_object('document_id', v_result)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_create_proforma(uuid) from public, anon;
grant execute on function public.fn_orders_full_create_proforma(uuid)
  to authenticated, service_role;

create or replace function public.fn_orders_full_dispatch_shipment(
  p_order_id uuid,
  p_lines jsonb,
  p_shipment_date date default null,
  p_carton_count numeric default 0,
  p_carrier_name text default null,
  p_tracking_code text default null,
  p_receiver_name text default null,
  p_notes text default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_active_user()
       and public.has_role(array['admin','warehouse','sales','sales_manager'])
     ) then
    raise exception 'دسترسی ثبت ارسال سفارش را ندارید';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'سفارش یافت نشد';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_dispatch_order_shipment(
    p_order_id, p_lines, p_shipment_date, p_carton_count,
    p_carrier_name, p_tracking_code, p_receiver_name, p_notes,
    p_idempotency_key
  );
  perform public.fn_log_order_module_audit(
    'order.shipment_dispatched', p_order_id,
    (select customer_id from public.orders where id = p_order_id),
    jsonb_build_object('shipment_id', v_result, 'idempotency_key', p_idempotency_key)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_dispatch_shipment(uuid,jsonb,date,numeric,text,text,text,text,text) from public, anon;
grant execute on function public.fn_orders_full_dispatch_shipment(uuid,jsonb,date,numeric,text,text,text,text,text)
  to authenticated, service_role;

create or replace function public.fn_orders_full_update_customer_credit(
  p_customer_id uuid,
  p_credit_limit numeric,
  p_credit_hold boolean,
  p_credit_control_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_limit numeric := greatest(coalesce(p_credit_limit, 0), 0);
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی کنترل اعتبار مشتری را ندارید';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;
  if not found then raise exception 'مشتری یافت نشد'; end if;

  update public.customers
  set credit_limit = v_limit,
      credit_hold = coalesce(p_credit_hold, false),
      credit_control_note = nullif(trim(coalesce(p_credit_control_note, '')), ''),
      updated_at = now()
  where id = p_customer_id;

  perform public.fn_log_order_module_audit(
    'customer.credit_updated', null, p_customer_id,
    jsonb_build_object(
      'old_credit_limit', coalesce(v_customer.credit_limit, 0),
      'new_credit_limit', v_limit,
      'old_credit_hold', coalesce(v_customer.credit_hold, false),
      'new_credit_hold', coalesce(p_credit_hold, false)
    )
  );

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'credit_limit', v_limit,
    'credit_hold', coalesce(p_credit_hold, false),
    'credit_control_note', nullif(trim(coalesce(p_credit_control_note, '')), '')
  );
end;
$$;

revoke execute on function public.fn_orders_full_update_customer_credit(uuid,numeric,boolean,text) from public, anon;
grant execute on function public.fn_orders_full_update_customer_credit(uuid,numeric,boolean,text)
  to authenticated, service_role;

create or replace function public.fn_orders_full_log_crm_interaction(
  p_customer_id uuid,
  p_title text,
  p_description text default null,
  p_activity_type public.crm_activity_type default 'note',
  p_contact_channel public.crm_contact_channel default null,
  p_related_order_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result uuid;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی ثبت تعامل سفارش/CRM را ندارید';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_log_crm_interaction(
    p_customer_id, p_title, p_description, p_activity_type,
    p_contact_channel, p_related_order_id
  );
  perform public.fn_log_order_module_audit(
    'order.crm_interaction_logged', p_related_order_id, p_customer_id,
    jsonb_build_object('interaction_id', v_result, 'activity_type', p_activity_type)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_log_crm_interaction(uuid,text,text,public.crm_activity_type,public.crm_contact_channel,uuid) from public, anon;
grant execute on function public.fn_orders_full_log_crm_interaction(uuid,text,text,public.crm_activity_type,public.crm_contact_channel,uuid)
  to authenticated, service_role;

create or replace function public.fn_orders_full_create_crm_followup(
  p_customer_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_description text default null,
  p_activity_type public.crm_activity_type default 'follow_up',
  p_contact_channel public.crm_contact_channel default null,
  p_related_order_id uuid default null,
  p_assigned_to uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_result uuid;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی ثبت پیگیری سفارش/CRM را ندارید';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_create_crm_followup(
    p_customer_id, p_title, p_due_at, p_description, p_activity_type,
    p_contact_channel, p_related_order_id, p_assigned_to
  );
  perform public.fn_log_order_module_audit(
    'order.crm_followup_created', p_related_order_id, p_customer_id,
    jsonb_build_object('followup_id', v_result, 'due_at', p_due_at)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_create_crm_followup(uuid,text,timestamptz,text,public.crm_activity_type,public.crm_contact_channel,uuid,uuid) from public, anon;
grant execute on function public.fn_orders_full_create_crm_followup(uuid,text,timestamptz,text,public.crm_activity_type,public.crm_contact_channel,uuid,uuid)
  to authenticated, service_role;

create or replace function public.fn_orders_full_complete_crm_followup(
  p_followup_id uuid,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_followup public.crm_followups%rowtype;
  v_result uuid;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی بستن پیگیری سفارش/CRM را ندارید';
  end if;
  select * into v_followup from public.crm_followups where id = p_followup_id;
  if not found then raise exception 'پیگیری یافت نشد'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fn_complete_crm_followup(p_followup_id, p_note);
  perform public.fn_log_order_module_audit(
    'order.crm_followup_completed', v_followup.related_order_id, v_followup.customer_id,
    jsonb_build_object('followup_id', v_result)
  );
  perform set_config('request.jwt.claim.role', v_original_role, true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.role', v_original_role, true);
  raise;
end;
$$;

revoke execute on function public.fn_orders_full_complete_crm_followup(uuid,text) from public, anon;
grant execute on function public.fn_orders_full_complete_crm_followup(uuid,text)
  to authenticated, service_role;

-- Complete Orders-side cancellation. Reserved stock and unfinished order stages,
-- referrals/follow-ups/opportunities are closed atomically. Posted invoices,
-- payments, production history and physical shipments are intentionally retained
-- and never voided/reversed from the Orders permission boundary.
create or replace function public.fn_orders_cancel_order_complete(
  p_order_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_reserved_count integer := 0;
  v_skipped_stages integer := 0;
  v_cancelled_referrals integer := 0;
  v_closed_followups integer := 0;
  v_lost_opportunities integer := 0;
  v_active_shipments integer := 0;
  v_finance_documents integer := 0;
  v_production_records integer := 0;
  v_rnd_records integer := 0;
begin
  if not public.fn_has_full_orders_module_access() then
    raise exception 'دسترسی لغو کامل سفارش را ندارید';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'ثبت دلیل روشن برای لغو کامل سفارش الزامی است';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'سفارش یافت نشد'; end if;
  if v_order.is_cancelled then
    return jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'cancelled', true,
      'idempotent', true,
      'reason', v_order.cancelled_reason
    );
  end if;

  select count(*) into v_reserved_count
  from public.order_inventory_reservations
  where order_id = p_order_id and status = 'reserved';

  select count(*) into v_active_shipments
  from public.warehouse_shipments
  where related_order_id = p_order_id
    and status in ('sent','delivered')
    and cancelled_at is null;

  select count(*) into v_finance_documents
  from public.finance_documents
  where related_order_id = p_order_id
    and status::text not in ('void','cancelled');

  select count(*) into v_production_records
  from public.production_orders
  where source_order_id = p_order_id and status::text <> 'cancelled';

  select count(*) into v_rnd_records
  from public.rnd_projects
  where source_order_id = p_order_id and status::text not in ('cancelled','completed');

  update public.order_stage_instances
  set status = 'skipped',
      completed_at = coalesce(completed_at, now()),
      notes = concat_ws(E'\n', notes, 'توقف مرحله به دلیل لغو کامل سفارش: ' || v_reason)
  where order_id = p_order_id
    and status in ('pending','current','blocked');
  get diagnostics v_skipped_stages = row_count;

  update public.automation_referrals
  set status = 'cancelled',
      response_fa = concat_ws(E'\n', response_fa, 'لغو خودکار به دلیل لغو سفارش: ' || v_reason),
      updated_at = now()
  where related_order_id = p_order_id
    and status in ('open','in_progress');
  get diagnostics v_cancelled_referrals = row_count;

  update public.crm_followups
  set is_done = true,
      done_at = coalesce(done_at, now())
  where related_order_id = p_order_id and not is_done;
  get diagnostics v_closed_followups = row_count;

  update public.crm_opportunities
  set stage = 'lost',
      lost_reason = concat_ws(E'؛ ', lost_reason, 'لغو سفارش: ' || v_reason),
      updated_at = now()
  where related_order_id = p_order_id and stage not in ('won','lost');
  get diagnostics v_lost_opportunities = row_count;

  update public.orders
  set is_cancelled = true,
      cancelled_reason = v_reason,
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      updated_at = now()
  where id = p_order_id;
  -- Existing triggers release active reservations and calculator quote holds.

  perform public.fn_log_order_event(
    p_order_id,
    'closed',
    'سفارش به‌طور کامل لغو شد',
    v_reason,
    v_order.current_stage,
    v_order.current_stage,
    jsonb_build_object(
      'cancelled_by', auth.uid(),
      'released_reservations', v_reserved_count,
      'skipped_stages', v_skipped_stages,
      'cancelled_referrals', v_cancelled_referrals,
      'closed_followups', v_closed_followups,
      'lost_opportunities', v_lost_opportunities,
      'retained_active_shipments', v_active_shipments,
      'retained_finance_documents', v_finance_documents,
      'retained_production_records', v_production_records,
      'retained_rnd_records', v_rnd_records
    )
  );
  perform public.fn_log_order_module_audit(
    'order.cancelled_complete', p_order_id, v_order.customer_id,
    jsonb_build_object(
      'reason', v_reason,
      'released_reservations', v_reserved_count,
      'skipped_stages', v_skipped_stages,
      'cancelled_referrals', v_cancelled_referrals,
      'closed_followups', v_closed_followups,
      'lost_opportunities', v_lost_opportunities,
      'retained_active_shipments', v_active_shipments,
      'retained_finance_documents', v_finance_documents,
      'retained_production_records', v_production_records,
      'retained_rnd_records', v_rnd_records
    )
  );

  return jsonb_build_object(
    'id', p_order_id,
    'order_code', v_order.order_code,
    'cancelled', true,
    'idempotent', false,
    'reason', v_reason,
    'released_reservations', v_reserved_count,
    'skipped_stages', v_skipped_stages,
    'cancelled_referrals', v_cancelled_referrals,
    'closed_followups', v_closed_followups,
    'lost_opportunities', v_lost_opportunities,
    'retained_active_shipments', v_active_shipments,
    'retained_finance_documents', v_finance_documents,
    'retained_production_records', v_production_records,
    'retained_rnd_records', v_rnd_records
  );
end;
$$;

revoke execute on function public.fn_orders_cancel_order_complete(uuid,text) from public, anon;
grant execute on function public.fn_orders_cancel_order_complete(uuid,text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
