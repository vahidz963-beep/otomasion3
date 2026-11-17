-- Migration 147: جدول رویدادهای پل انبار (ووکامرس ↔ اتوماسیون)
-- Edge Function «warehouse-bridge» رویدادهای امضاشدهٔ ووکامرس را اینجا idempotent ثبت می‌کند
-- (event_id یکتا — تکرار همان رویداد درج دوباره ندارد) و ماژول انبار وضعیت پردازش را به‌روز می‌کند.
-- امنیت: RLS کامل — فقط service_role دسترسی دارد (هرگز به مرورگر نمی‌رسد).

begin;

create table if not exists public.warehouse_bridge_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  event text not null check (event in ('order_reserve','order_release','stock_update')),
  wc_order text,
  quote_id text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  processed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_warehouse_bridge_events_status on public.warehouse_bridge_events(status, created_at desc);
create index if not exists idx_warehouse_bridge_events_wc_order on public.warehouse_bridge_events(wc_order);

alter table public.warehouse_bridge_events enable row level security;

-- فقط service_role (سمت سرور) — بدون هیچ سیاستی برای anon/authenticated
revoke all on public.warehouse_bridge_events from anon, authenticated;

grant select, insert, update on public.warehouse_bridge_events to service_role;

-- نمای آماری برای ماژول انبار (فقط سمت سرور)
create or replace view public.v_warehouse_bridge_pending as
  select event, count(*)::int as pending_count
  from public.warehouse_bridge_events
  where status = 'received'
  group by event;

commit;
