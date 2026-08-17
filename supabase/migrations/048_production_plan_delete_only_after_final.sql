-- =====================================================================
-- 048_PRODUCTION_PLAN_DELETE_ONLY_AFTER_FINAL
-- Safety rule for production planning:
-- A production order can be removed from the planning timeline/list only after
-- the final stage is completed (green/completed in UI).
-- =====================================================================

create or replace function public.fn_production_plan_can_be_removed(p_production_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.production_orders po
    where po.id = p_production_order_id
      and (
        po.status::text in ('completed', 'delivered_to_warehouse')
        or coalesce(po.progress_percent, 0) >= 100
        or (
          exists (
            select 1
            from public.production_order_stages s
            where s.production_order_id = po.id
          )
          and not exists (
            select 1
            from public.production_order_stages s
            where s.production_order_id = po.id
              and s.status::text <> 'completed'
          )
        )
      )
  );
$$;

create or replace function public.fn_production_delete_plan(p_production_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  if not exists (select 1 from public.production_orders where id = p_production_order_id) then
    raise exception 'سفارش تولید یافت نشد';
  end if;

  if not public.fn_production_plan_can_be_removed(p_production_order_id) then
    raise exception 'حذف از برنامه‌ریزی فقط بعد از تکمیل مرحله پایانی تولید مجاز است';
  end if;

  delete from public.production_plans
  where production_order_id = p_production_order_id;

  update public.production_orders
  set planned_start = null,
      planned_end = null,
      work_days = null,
      labor_people = null,
      total_man_hours = null,
      updated_at = now()
  where id = p_production_order_id;

  return p_production_order_id;
end;
$$;

grant execute on function public.fn_production_plan_can_be_removed(uuid) to authenticated;
grant execute on function public.fn_production_delete_plan(uuid) to authenticated;

notify pgrst, 'reload schema';
