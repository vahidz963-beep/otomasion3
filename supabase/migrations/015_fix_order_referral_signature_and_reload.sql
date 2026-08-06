-- =====================================================================
-- 015_FIX_ORDER_REFERRAL_SIGNATURE_AND_RELOAD
-- Fixes function signature mismatch seen from app/seed:
--   function public.fn_create_order_referral(uuid, unknown, text, unknown, unknown, integer, unknown) does not exist
-- Also notifies PostgREST to reload schema cache.
-- Run after 009/013.
-- =====================================================================

drop function if exists public.fn_create_order_referral(uuid, text, text, text, public.user_role, smallint, date);

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
    referral_number,
    source_module,
    target_module,
    target_role,
    referral_type,
    priority,
    status,
    title_fa,
    description_fa,
    related_order_id,
    created_by,
    due_date
  ) values (
    null,
    'orders',
    p_target_module,
    v_target_role,
    'request',
    greatest(1, least(coalesce(p_priority, 2), 3))::smallint,
    'open',
    p_title_fa,
    p_description_fa,
    p_order_id,
    auth.uid(),
    p_due_date
  ) returning id into v_referral_id;

  perform public.fn_log_order_event(
    p_order_id,
    'referral',
    'ارجاع سفارش ایجاد شد',
    p_title_fa,
    null,
    null,
    jsonb_build_object('referral_id', v_referral_id, 'target_module', p_target_module, 'target_role', v_target_role)
  );

  return v_referral_id;
end;
$$;

grant execute on function public.fn_create_order_referral(uuid, text, text, text, text, integer, date) to authenticated;

-- Force Supabase/PostgREST to refresh its function cache.
notify pgrst, 'reload schema';
