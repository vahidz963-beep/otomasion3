-- =====================================================================
-- 003_WAREHOUSE
-- Snapshot + Transaction inventory model for central warehouse.
-- Depends on: 001_core_auth_profiles.sql, 002_orders_core.sql (notifications)
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'warehouse_transaction_type') then
    create type public.warehouse_transaction_type as enum ('issue','receipt','reversal','adjustment');
  end if;
end $$;

create table if not exists public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null,
  item_name_fa text not null,
  item_name_en text,
  unit text not null,
  category text,
  min_stock_threshold numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_warehouse_items_code on public.warehouse_items(item_code);
create index if not exists idx_warehouse_items_active on public.warehouse_items(is_active);

drop trigger if exists trg_warehouse_items_updated_at on public.warehouse_items;
create trigger trg_warehouse_items_updated_at
before update on public.warehouse_items
for each row execute function public.set_updated_at();

create table if not exists public.warehouse_snapshots (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  row_count int,
  notes text
);

create index if not exists idx_warehouse_snapshots_imported_at on public.warehouse_snapshots(imported_at desc);

create table if not exists public.warehouse_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.warehouse_snapshots(id) on delete cascade,
  item_code text not null,
  item_id uuid references public.warehouse_items(id),
  quantity numeric not null,
  unit text,
  matched boolean not null default false
);

create index if not exists idx_warehouse_snapshot_items_snapshot on public.warehouse_snapshot_items(snapshot_id);
create index if not exists idx_warehouse_snapshot_items_unmatched on public.warehouse_snapshot_items(matched) where matched = false;

create or replace function public.fn_match_snapshot_item()
returns trigger
language plpgsql
as $$
begin
  select id into new.item_id from public.warehouse_items where item_code = new.item_code;
  new.matched := (new.item_id is not null);
  return new;
end;
$$;

drop trigger if exists trg_match_snapshot_item on public.warehouse_snapshot_items;
create trigger trg_match_snapshot_item
before insert or update of item_code on public.warehouse_snapshot_items
for each row execute function public.fn_match_snapshot_item();

create table if not exists public.warehouse_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_items(id),
  transaction_type public.warehouse_transaction_type not null,
  quantity numeric not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  created_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_warehouse_transactions_item on public.warehouse_transactions(item_id);
create index if not exists idx_warehouse_transactions_reference on public.warehouse_transactions(reference_type, reference_id);
create index if not exists idx_warehouse_transactions_created_at on public.warehouse_transactions(created_at desc);

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
)
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
  (ls.snapshot_imported_at is null) as never_synced
from public.warehouse_items wi
left join latest_snapshot ls on ls.item_id = wi.id
left join tx_since_snapshot tx on tx.item_id = wi.id
where wi.is_active;

-- Compatibility view for sales/order UI.
create or replace view public.v_warehouse_stock_readonly
with (security_invoker = true)
as
select
  item_code,
  item_name_fa,
  item_name_en,
  current_qty as available_qty,
  unit,
  last_synced_at as updated_at
from public.v_warehouse_current_stock;

-- ---------------------------------------------------------------------
-- Controlled inventory mutation helpers.
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_add_transaction(
  p_item_id uuid,
  p_transaction_type public.warehouse_transaction_type,
  p_quantity numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','warehouse','production']) then
    raise exception 'Not allowed to write warehouse transactions';
  end if;

  insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, created_by, note)
  values (p_item_id, p_transaction_type, p_quantity, p_reference_type, p_reference_id, coalesce(p_created_by, auth.uid()), p_note)
  returning id into v_tx_id;

  return v_tx_id;
end;
$$;

create or replace function public.fn_warehouse_issue(
  p_item_id uuid,
  p_quantity numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid default null,
  p_note text default null
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.fn_warehouse_add_transaction(p_item_id, 'issue'::public.warehouse_transaction_type, p_quantity, p_reference_type, p_reference_id, p_created_by, p_note);
$$;

create or replace function public.fn_warehouse_reverse_issue(
  p_item_id uuid,
  p_quantity numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid default null,
  p_note text default null
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.fn_warehouse_add_transaction(p_item_id, 'reversal'::public.warehouse_transaction_type, p_quantity, p_reference_type, p_reference_id, p_created_by, p_note);
$$;

create or replace function public.fn_warehouse_receipt(
  p_item_id uuid,
  p_quantity numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid default null,
  p_note text default null
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.fn_warehouse_add_transaction(p_item_id, 'receipt'::public.warehouse_transaction_type, p_quantity, p_reference_type, p_reference_id, p_created_by, p_note);
$$;

create or replace function public.fn_notify_low_stock_after_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock public.v_warehouse_current_stock%rowtype;
begin
  select * into v_stock from public.v_warehouse_current_stock where item_id = new.item_id;

  if coalesce(v_stock.is_low_stock, false) then
    insert into public.notifications (recipient_role, title_fa, title_en, body_fa)
    values (
      'warehouse',
      'کمبود موجودی: ' || v_stock.item_name_fa || ' (' || v_stock.current_qty || ' ' || v_stock.unit || ')',
      'Low stock: ' || coalesce(v_stock.item_name_en, v_stock.item_name_fa),
      'موجودی محاسبه‌شده زیر آستانه‌ی ' || v_stock.min_stock_threshold || ' رسیده است.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_low_stock on public.warehouse_transactions;
create trigger trg_notify_low_stock
after insert on public.warehouse_transactions
for each row execute function public.fn_notify_low_stock_after_tx();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.warehouse_items enable row level security;
alter table public.warehouse_snapshots enable row level security;
alter table public.warehouse_snapshot_items enable row level security;
alter table public.warehouse_transactions enable row level security;

drop policy if exists warehouse_items_read on public.warehouse_items;
create policy warehouse_items_read on public.warehouse_items
for select using (public.is_active_user());

drop policy if exists warehouse_items_write on public.warehouse_items;
create policy warehouse_items_write on public.warehouse_items
for all using (public.has_role(array['admin','warehouse']))
with check (public.has_role(array['admin','warehouse']));

drop policy if exists warehouse_snapshots_read on public.warehouse_snapshots;
create policy warehouse_snapshots_read on public.warehouse_snapshots
for select using (public.is_active_user());

drop policy if exists warehouse_snapshots_write on public.warehouse_snapshots;
create policy warehouse_snapshots_write on public.warehouse_snapshots
for all using (public.has_role(array['admin','warehouse']))
with check (public.has_role(array['admin','warehouse']));

drop policy if exists warehouse_snapshot_items_read on public.warehouse_snapshot_items;
create policy warehouse_snapshot_items_read on public.warehouse_snapshot_items
for select using (public.is_active_user());

drop policy if exists warehouse_snapshot_items_write on public.warehouse_snapshot_items;
create policy warehouse_snapshot_items_write on public.warehouse_snapshot_items
for all using (public.has_role(array['admin','warehouse']))
with check (public.has_role(array['admin','warehouse']));

drop policy if exists warehouse_transactions_read on public.warehouse_transactions;
create policy warehouse_transactions_read on public.warehouse_transactions
for select using (public.is_active_user());

drop policy if exists warehouse_transactions_insert on public.warehouse_transactions;
create policy warehouse_transactions_insert on public.warehouse_transactions
for insert with check (public.has_role(array['admin','warehouse']));
