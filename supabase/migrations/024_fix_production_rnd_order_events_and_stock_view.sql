-- =====================================================================
-- 024_FIX_PRODUCTION_RND_ORDER_EVENTS_AND_STOCK_VIEW
-- Fixes online errors:
-- 1) column "created_by" of relation "order_events" does not exist
-- 2) column v_warehouse_current_stock.available_for_sale_qty does not exist
-- =====================================================================

-- Some new Production/R&D RPCs write created_by. Existing order_events used actor_id.
-- Keep both for backward compatibility.
alter table public.order_events
  add column if not exists created_by uuid references public.profiles(id);

update public.order_events
set created_by = actor_id
where created_by is null and actor_id is not null;

-- Rebuild warehouse current stock view and append reserved/available columns at the end.
-- Existing column order is preserved so dependent views remain valid.
create or replace view public.v_warehouse_current_stock
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (wsi.item_id)
    wsi.item_id,
    wsi.quantity as snapshot_qty,
    s.id as snapshot_id,
    s.imported_at as snapshot_imported_at
  from public.warehouse_snapshot_items wsi
  join public.warehouse_snapshots s on s.id = wsi.snapshot_id
  where wsi.item_id is not null
  order by wsi.item_id, s.imported_at desc
), tx_since_snapshot as (
  select
    wt.item_id,
    sum(case
      when wt.transaction_type = 'issue' then -wt.quantity
      when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity
      else 0
    end) as net_qty
  from public.warehouse_transactions wt
  left join latest_snapshot ls on ls.item_id = wt.item_id
  where ls.snapshot_imported_at is null or wt.created_at > ls.snapshot_imported_at
  group by wt.item_id
), tx_totals as (
  select
    wt.item_id,
    sum(case when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity else 0 end) as total_in,
    sum(case when wt.transaction_type = 'issue' then wt.quantity else 0 end) as total_out,
    max(wt.created_at) as last_movement_at
  from public.warehouse_transactions wt
  group by wt.item_id
), reservations as (
  select warehouse_item_id as item_id, sum(quantity) as reserved_qty
  from public.order_inventory_reservations
  where status = 'reserved'
  group by warehouse_item_id
), stock_base as (
  select
    wi.id as item_id,
    wi.item_code,
    wi.item_name_fa,
    wi.item_name_en,
    wi.unit,
    wi.category,
    wi.min_stock_threshold,
    ls.snapshot_qty,
    ls.snapshot_imported_at as last_synced_at,
    coalesce(tx.net_qty, 0) as net_transactions_since_sync,
    (coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) as current_qty,
    ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) < wi.min_stock_threshold) as is_low_stock,
    (ls.snapshot_imported_at is null) as never_synced,
    wi.category as item_group,
    wi.location,
    wi.min_stock_threshold as reorder_point,
    wi.unit_price_estimate,
    wi.price_currency,
    coalesce(tt.total_in, 0) as total_in,
    coalesce(tt.total_out, 0) as total_out,
    tt.last_movement_at,
    ((coalesce(ls.snapshot_qty, 0) + coalesce(tx.net_qty, 0)) * wi.unit_price_estimate) as stock_value_estimate,
    coalesce(r.reserved_qty, 0) as reserved_qty
  from public.warehouse_items wi
  left join latest_snapshot ls on ls.item_id = wi.id
  left join tx_since_snapshot tx on tx.item_id = wi.id
  left join tx_totals tt on tt.item_id = wi.id
  left join reservations r on r.item_id = wi.id
  where wi.is_active
)
select
  item_id,
  item_code,
  item_name_fa,
  item_name_en,
  unit,
  category,
  min_stock_threshold,
  snapshot_qty,
  last_synced_at,
  net_transactions_since_sync,
  current_qty,
  is_low_stock,
  never_synced,
  item_group,
  location,
  reorder_point,
  unit_price_estimate,
  price_currency,
  total_in,
  total_out,
  last_movement_at,
  stock_value_estimate,
  reserved_qty,
  (current_qty - reserved_qty) as available_for_sale_qty
from stock_base;

grant select on public.v_warehouse_current_stock to authenticated;
grant select on public.v_sales_stock_overview to authenticated;

notify pgrst, 'reload schema';
