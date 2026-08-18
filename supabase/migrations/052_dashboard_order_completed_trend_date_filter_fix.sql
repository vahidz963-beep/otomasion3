-- =====================================================================
-- 052_DASHBOARD_ORDER_COMPLETED_TREND_DATE_FILTER_FIX
-- Fixes dashboard completed-order trend when dateTo is a date string.
--
-- Frontend currently filters v_order_tracking like:
--   updated_at >= dateFrom AND updated_at <= dateTo
-- If updated_at is a timestamptz such as 2026-08-18 14:30, filtering with
-- dateTo='2026-08-18' compares against 2026-08-18 00:00 and excludes the row.
--
-- This SQL keeps the real orders.updated_at unchanged, but makes
-- v_order_tracking.updated_at day-based (same timestamptz type at 00:00) so
-- completed orders are counted inside the selected day range without frontend
-- deploy.
-- =====================================================================

-- Keep the terminal detection fix from 051 too.
with ranked_steps as (
  select
    id,
    template_id,
    stage_order,
    row_number() over (partition by template_id order by stage_order desc, id desc) as rn
  from public.order_workflow_template_steps
  where is_active is not false
)
update public.order_workflow_template_steps s
set is_terminal = (r.rn = 1)
from ranked_steps r
where s.id = r.id
  and s.is_terminal is distinct from (r.rn = 1);

create or replace view public.v_order_tracking
with (security_invoker = true)
as
with order_stage_limits as (
  select
    order_id,
    max(stage_order) as max_stage_order
  from public.order_stage_instances
  group by order_id
)
select
  o.id,
  o.order_code,
  c.company_name as customer_name,
  c.tier as customer_tier,
  o.sales_path,
  o.current_stage,
  coalesce(osi.stage_name_fa, d.stage_name_fa, o.current_stage) as stage_name_fa,
  coalesce(osi.stage_name_en, d.stage_name_en, o.current_stage) as stage_name_en,
  coalesce(osi.stage_order::numeric, d.stage_order) as stage_order,
  (
    coalesce(tpl_step.is_terminal, d.is_terminal, false)
    or (
      osl.max_stage_order is not null
      and osi.stage_order is not null
      and osi.stage_order >= osl.max_stage_order
    )
    or (
      osi.id is not null
      and not exists (
        select 1
        from public.order_stage_instances next_stage
        where next_stage.order_id = o.id
          and next_stage.stage_order > osi.stage_order
      )
    )
  ) as is_terminal,
  o.priority,
  o.expected_delivery_date,
  o.is_cancelled,
  date_trunc('day', o.created_at) as created_at,
  date_trunc('day', o.updated_at) as updated_at,
  p.full_name as sales_officer_name
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_stage_instances osi on osi.order_id = o.id and osi.stage_key = o.current_stage
left join public.order_workflow_template_steps tpl_step on tpl_step.id = osi.template_step_id
left join public.order_status_definitions d on d.sales_path = o.sales_path and d.stage_key = o.current_stage
left join order_stage_limits osl on osl.order_id = o.id
left join public.profiles p on p.id = o.sales_officer_id;

grant select on public.v_order_tracking to authenticated;

notify pgrst, 'reload schema';
