-- Migration 148: پردازش‌گر رویدادهای پل انبار — «همان‌لحظه‌ای» شدن دو مسیر
-- مسیر ۱ (سایت → انبار): رویداد order_reserve/order_release که Edge Function «warehouse-bridge»
--   در warehouse_bridge_events ثبت می‌کند، همین‌جا به رزرو/آزادسازی واقعی انبار تبدیل می‌شود:
--   * سفارش‌های مرکز محاسبه (quote_id دارند) → کل BOM (هسته، بوبین، سیم، چسب) با همان منطق
--     نسخهٔ ۱۲۳ رزرو/آزاد می‌شود (idempotent با calculator_quote_id + idempotency_key=event_id).
--   * کالای عمومی سایت (quote_id ندارند) → رزرو در warehouse_bridge_reservations و
--     کسر از «قابل رزرو» از طریق به‌روزرسانی v_sales_stock_overview.
-- مسیر ۲ (انبار → سایت): رویداد خروجی stock_push_out هم در همین جدول ثبت می‌شود تا قابل ردیابی باشد
--   (ارسال واقعی به سایت توسط Edge Function انجام می‌شود).
-- اجرای دوره‌ای: pg_cron هر ۱ دقیقه رویدادهای ناتمام را دوباره تلاش می‌کند (در دسترس نبودن pg_cron بی‌خطر است).
-- امنیت: هر دو فن فقط برای service_role قابل اجرا هستند (grant) و جدول رزرو پل RLS کامل دارد.

begin;

-- ------------------------------------------------------------------
-- ۱) رزروهای عمومی پل (کالای عمومی سایت — بدون سفارش اتوماسیون)
-- ------------------------------------------------------------------
create table if not exists public.warehouse_bridge_reservations (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  wc_order text,
  warehouse_item_id uuid not null references public.warehouse_items(id),
  quantity numeric not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','released')),
  reserved_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists idx_bridge_res_item on public.warehouse_bridge_reservations(warehouse_item_id, status);
create index if not exists idx_bridge_res_order on public.warehouse_bridge_reservations(wc_order);
create unique index if not exists uq_bridge_res_event_item
  on public.warehouse_bridge_reservations(event_id, warehouse_item_id) where status = 'reserved';

alter table public.warehouse_bridge_reservations enable row level security;
revoke all on public.warehouse_bridge_reservations from anon, authenticated;
grant select on public.warehouse_bridge_reservations to authenticated; -- فقط خواندن برای نمای موجودی
grant select, insert, update on public.warehouse_bridge_reservations to service_role;

-- ------------------------------------------------------------------
-- ۲) به‌روزرسانی نمای موجودی فروش: رزروهای پل هم از قابل‌فروش کم شوند
--    (تعریف پایه از نسخهٔ ۰۳۵ + کسر رزروهای پل)
-- ------------------------------------------------------------------
create or replace view public.v_sales_stock_overview
with (security_invoker = true)
as
select
  s.item_id,
  s.item_code,
  s.item_name_fa,
  s.item_name_en,
  s.unit,
  s.category,
  s.current_qty,
  s.min_stock_threshold,
  coalesce(r.reserved_qty, 0) + coalesce(br.reserved_qty, 0) as reserved_qty,
  (s.current_qty - coalesce(r.reserved_qty, 0) - coalesce(br.reserved_qty, 0)) as available_for_sale_qty,
  ((s.current_qty - coalesce(r.reserved_qty, 0) - coalesce(br.reserved_qty, 0)) < s.min_stock_threshold) as is_low_stock,
  s.last_synced_at,
  s.item_group,
  s.location,
  s.reorder_point,
  s.unit_price_estimate,
  s.stock_value_estimate,
  s.last_movement_at,
  case
    when coalesce(s.category, s.item_group) = 'Finished' then 'تولید شده‌ها'
    when coalesce(s.category, s.item_group) is null then 'بدون گروه'
    else coalesce(s.category, s.item_group)
  end as item_group_label,
  (coalesce(s.category, s.item_group) = 'Finished') as is_produced_item
from public.v_warehouse_current_stock s
left join (
  select warehouse_item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
) r on r.warehouse_item_id = s.item_id
left join (
  select warehouse_item_id, sum(quantity) as reserved_qty
  from public.warehouse_bridge_reservations
  where status = 'reserved'
  group by warehouse_item_id
) br on br.warehouse_item_id = s.item_id;

grant select on public.v_sales_stock_overview to authenticated;

-- ------------------------------------------------------------------
-- ۳) نوع رویداد خروجی (انبار → سایت) برای ردیابی
-- ------------------------------------------------------------------
alter table public.warehouse_bridge_events
  drop constraint if exists warehouse_bridge_events_event_check;
alter table public.warehouse_bridge_events
  add constraint warehouse_bridge_events_event_check
  check (event in ('order_reserve','order_release','stock_update','stock_push_out'));

-- ------------------------------------------------------------------
-- ۴) پردازش‌گر یک رویداد
-- ------------------------------------------------------------------
create or replace function public.fn_warehouse_bridge_process_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, calculator
as $$
declare
  v_event public.warehouse_bridge_events%rowtype;
  v_quote calculator.quotes%rowtype;
  v_req record;
  v_item record;
  v_available numeric;
  v_count int;
  v_note text;
begin
  select * into v_event from public.warehouse_bridge_events where event_id = p_event_id for update;
  if not found then raise exception 'رویداد پل یافت نشد'; end if;
  if v_event.status <> 'received' then
    return jsonb_build_object('event_id', p_event_id, 'status', v_event.status, 'idempotent', true);
  end if;

  begin
    if v_event.event = 'order_reserve' then
      if v_event.quote_id is not null then
        -- ---------- رزرو کامل BOM سفارش محاسبه (منطق نسخهٔ ۱۲۳) ----------
        select * into v_quote from calculator.quotes where id = (v_event.quote_id)::uuid for update;
        if not found then raise exception 'محاسبهٔ % یافت نشد', v_event.quote_id; end if;
        if v_quote.status in ('reserved','in_production','produced') then
          v_note := 'قبلاً رزرو بود — idempotent';
        elsif v_quote.status in ('cancelled','expired') or (v_quote.expires_at is not null and v_quote.expires_at < now()) then
          raise exception 'محاسبهٔ % لغوشده/منقضی است و قابل رزرو نیست', v_event.quote_id;
        else
          if not exists(select 1 from calculator.quote_requirements where quote_id = v_quote.id) then
            raise exception 'اقلام مصرفی محاسبهٔ % ثبت نشده‌اند', v_event.quote_id;
          end if;
          for v_req in
            select qr.*, coalesce(s.available_for_sale_qty, 0) as available
            from calculator.quote_requirements qr
            left join public.v_sales_stock_overview s on s.item_id = qr.warehouse_item_id
            where qr.quote_id = v_quote.id
            order by qr.warehouse_item_id
          loop
            if v_req.available < v_req.quantity_total then
              raise exception 'موجودی قابل رزرو کافی نیست (قلم %)؛ نیاز: %، قابل رزرو: %',
                v_req.warehouse_item_id, v_req.quantity_total, v_req.available;
            end if;
            insert into public.order_inventory_reservations
              (order_id, warehouse_item_id, quantity, status, reserved_by, notes, calculator_quote_id, idempotency_key)
            values
              (v_quote.order_id, v_req.warehouse_item_id, v_req.quantity_total, 'reserved', null,
               'رزرو فروش سایت — پل انبار ' || v_event.event_id::text,
               v_quote.id, v_event.event_id::text)
            on conflict (calculator_quote_id, warehouse_item_id) where calculator_quote_id is not null and status = 'reserved'
            do nothing;
          end loop;
          update calculator.quotes set status = 'reserved', reserved_at = coalesce(reserved_at, now()), updated_by = null
            where id = v_quote.id;
          perform calculator.log_event('inventory_reserved', 'quote', v_quote.id::text,
            jsonb_build_object('source', 'warehouse_bridge', 'event_id', v_event.event_id, 'wc_order', v_event.wc_order));
          v_note := 'رزرو BOM انجام شد';
        end if;
      else
        -- ---------- رزرو کالای عمومی سایت ----------
        for v_item in
          select
            (x->>'item_code') as item_code,
            greatest(1, coalesce((x->>'qty')::numeric, 0)) as qty
          from jsonb_array_elements(v_event.items) x
        loop
          select wi.id into v_item.warehouse_item_id
          from public.warehouse_items wi where wi.item_code = v_item.item_code and wi.is_active;
          if v_item.warehouse_item_id is null then
            raise exception 'کالای % در انبار یافت نشد؛ نگاشت محصول را در پل بررسی کنید', v_item.item_code;
          end if;
          select coalesce(available_for_sale_qty, 0) into v_available
          from public.v_sales_stock_overview where item_id = v_item.warehouse_item_id;
          if v_available < v_item.qty then
            raise exception 'موجودی قابل رزرو % کافی نیست؛ نیاز: %، قابل رزرو: %', v_item.item_code, v_item.qty, v_available;
          end if;
          insert into public.warehouse_bridge_reservations (event_id, wc_order, warehouse_item_id, quantity)
          values (v_event.event_id, v_event.wc_order, v_item.warehouse_item_id, v_item.qty)
          on conflict (event_id, warehouse_item_id) where status = 'reserved' do nothing;
        end loop;
        v_note := 'رزرو عمومی انجام شد';
      end if;

    elsif v_event.event = 'order_release' then
      if v_event.quote_id is not null then
        -- ---------- آزادسازی سفارش محاسبه (منطق نسخهٔ ۱۲۳) ----------
        update public.order_inventory_reservations
          set status = 'released', released_at = now(),
              notes = concat_ws(' — ', notes, 'آزادسازی فروش سایت — پل انبار ' || v_event.event_id::text)
          where calculator_quote_id = (v_event.quote_id)::uuid and status = 'reserved';
        get diagnostics v_count = row_count;
        update calculator.quotes
          set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
              cancellation_reason = coalesce('لغو سفارش سایت ' || coalesce(v_event.wc_order, ''), cancellation_reason),
              updated_by = null
          where id = (v_event.quote_id)::uuid and status <> 'produced';
        perform calculator.log_event('inventory_released', 'quote', v_event.quote_id,
          jsonb_build_object('source', 'warehouse_bridge', 'event_id', v_event.event_id, 'released_count', v_count));
        v_note := 'آزادسازی BOM انجام شد';
      else
        -- ---------- آزادسازی رزرو عمومی بر اساس شماره سفارش سایت ----------
        update public.warehouse_bridge_reservations
          set status = 'released', released_at = now()
          where wc_order = v_event.wc_order and status = 'reserved';
        get diagnostics v_count = row_count;
        v_note := 'آزادسازی عمومی انجام شد (' || v_count || ' ردیف)';
      end if;

    elsif v_event.event in ('stock_update', 'stock_push_out') then
      v_note := 'رویداد خروجی/اطلاعاتی — بدون اثر انبار';
    else
      raise exception 'نوع رویداد پردازش‌ناپذیر: %', v_event.event;
    end if;

    update public.warehouse_bridge_events
      set status = 'processed', processed_at = now(), note = v_note
      where event_id = p_event_id;
    return jsonb_build_object('event_id', p_event_id, 'status', 'processed', 'note', v_note);

  exception when others then
    update public.warehouse_bridge_events
      set status = 'failed', processed_at = now(), note = left(SQLERRM, 400)
      where event_id = p_event_id;
    return jsonb_build_object('event_id', p_event_id, 'status', 'failed', 'error', left(SQLERRM, 400));
  end;
end $$;

-- ------------------------------------------------------------------
-- ۵) پردازش دسته‌ای (برای sweep دوره‌ای و اجرای دستی)
-- ------------------------------------------------------------------
create or replace function public.fn_warehouse_bridge_process_pending(p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, calculator
as $$
declare
  r record;
  v_processed int := 0;
  v_failed int := 0;
  v_res jsonb;
begin
  for r in
    select event_id from public.warehouse_bridge_events
    where status = 'received'
    order by created_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    v_res := public.fn_warehouse_bridge_process_event(r.event_id);
    if v_res->>'status' = 'processed' then v_processed := v_processed + 1;
    elsif v_res->>'status' = 'failed' then v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('processed', v_processed, 'failed', v_failed);
end $$;

revoke all on function public.fn_warehouse_bridge_process_event(uuid) from public, anon, authenticated;
revoke all on function public.fn_warehouse_bridge_process_pending(int) from public, anon, authenticated;
grant execute on function public.fn_warehouse_bridge_process_event(uuid) to service_role;
grant execute on function public.fn_warehouse_bridge_process_pending(int) to service_role;

-- ------------------------------------------------------------------
-- ۶) sweep خودکار هر ۱ دقیقه (در دسترس نبودن pg_cron بی‌خطر رد می‌شود)
-- ------------------------------------------------------------------
do $mig$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron در دسترس نیست؛ sweep دستی/edge کافی است';
end $mig$;

do $mig$
begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    if not exists(select 1 from cron.job where jobname = 'aryaman-bridge-sweep') then
      perform cron.schedule('aryaman-bridge-sweep', '1 minute',
        $$select public.fn_warehouse_bridge_process_pending(50);$$);
    end if;
  end if;
exception when others then
  raise notice 'زمان‌بندی pg_cron ثبت نشد: %', SQLERRM;
end $mig$;

commit;
