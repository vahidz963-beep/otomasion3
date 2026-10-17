-- =====================================================================
-- 122_WAREHOUSE_MULTI_CURRENCY_PRICING
-- Central USD/CNY pricing for warehouse items.
-- - One base currency per item (USD or CNY)
-- - Separate base cost and sale prices
-- - Current IRR caches for compatibility with Warehouse/Orders/Finance/R&D
-- - Daily rate metadata/history and safe one-source fallback support
-- - Bulk USD <-> CNY conversion while preserving current IRR/Toman value
-- - Current material costs flow into BOM; produced price = BOM cost + profit
-- - Existing orders, proformas and invoices remain immutable snapshots
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Item pricing model. unit_price_estimate remains the current COST in IRR
-- for compatibility. unit_sale_price_estimate is the current SALE price in IRR.
-- ---------------------------------------------------------------------
alter table public.warehouse_items
  add column if not exists base_cost_price numeric,
  add column if not exists base_sale_price numeric,
  add column if not exists unit_sale_price_estimate numeric not null default 0,
  add column if not exists pricing_margin_pct numeric,
  add column if not exists pricing_updated_at timestamptz,
  add column if not exists pricing_updated_by uuid references public.profiles(id);

update public.warehouse_items
set price_currency = upper(coalesce(nullif(trim(price_currency), ''), 'IRR'));

update public.warehouse_items
set price_currency = 'IRR'
where price_currency not in ('IRR', 'USD', 'CNY');

update public.warehouse_items
set unit_sale_price_estimate = unit_price_estimate
where coalesce(unit_sale_price_estimate, 0) = 0
  and coalesce(unit_price_estimate, 0) <> 0;

-- Produced goods use their latest BOM cost plus the production profit margin.
-- Keep the existing 25% production default when no explicit margin exists.
update public.warehouse_items wi
set pricing_margin_pct = coalesce(
      wi.pricing_margin_pct,
      (select pms.default_margin_pct
       from public.price_margin_settings pms
       where pms.sales_path::text = 'production'
       limit 1),
      25
    ),
    unit_sale_price_estimate = round(
      (coalesce(wi.unit_price_estimate, 0) * (1 + coalesce(
        wi.pricing_margin_pct,
        (select pms.default_margin_pct
         from public.price_margin_settings pms
         where pms.sales_path::text = 'production'
         limit 1),
        25
      ) / 100.0)) / 10000
    ) * 10000
where wi.category = 'Finished';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_items_price_currency_check'
      and conrelid = 'public.warehouse_items'::regclass
  ) then
    alter table public.warehouse_items
      add constraint warehouse_items_price_currency_check
      check (price_currency in ('IRR', 'USD', 'CNY'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_items_base_cost_nonnegative_check'
      and conrelid = 'public.warehouse_items'::regclass
  ) then
    alter table public.warehouse_items
      add constraint warehouse_items_base_cost_nonnegative_check
      check (base_cost_price is null or base_cost_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_items_base_sale_nonnegative_check'
      and conrelid = 'public.warehouse_items'::regclass
  ) then
    alter table public.warehouse_items
      add constraint warehouse_items_base_sale_nonnegative_check
      check (base_sale_price is null or base_sale_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_items_pricing_margin_nonnegative_check'
      and conrelid = 'public.warehouse_items'::regclass
  ) then
    alter table public.warehouse_items
      add constraint warehouse_items_pricing_margin_nonnegative_check
      check (pricing_margin_pct is null or pricing_margin_pct >= 0);
  end if;
end $$;

create index if not exists idx_warehouse_items_price_currency
  on public.warehouse_items(price_currency, is_active);

-- Price fields must flow through audited security-definer functions. Ordinary
-- item metadata remains directly editable by Warehouse users.
create or replace function public.fn_guard_warehouse_currency_price_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.price_currency is distinct from old.price_currency
    or new.base_cost_price is distinct from old.base_cost_price
    or new.base_sale_price is distinct from old.base_sale_price
    or new.unit_price_estimate is distinct from old.unit_price_estimate
    or new.unit_sale_price_estimate is distinct from old.unit_sale_price_estimate
    or new.pricing_margin_pct is distinct from old.pricing_margin_pct
    or new.pricing_updated_at is distinct from old.pricing_updated_at
    or new.pricing_updated_by is distinct from old.pricing_updated_by
  ) then
    raise exception 'قیمت کالا فقط از مرکز قیمت‌گذاری ارزی قابل تغییر است';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_warehouse_currency_price_columns on public.warehouse_items;
create trigger trg_guard_warehouse_currency_price_columns
before update on public.warehouse_items
for each row execute function public.fn_guard_warehouse_currency_price_columns();

-- ---------------------------------------------------------------------
-- 2) Extend the existing singleton rate row. Toman columns are kept for the
-- current app API; Rial columns are authoritative for exact calculations.
-- ---------------------------------------------------------------------
alter table public.warehouse_exchange_rates
  add column if not exists usd_rial numeric,
  add column if not exists cny_rial numeric,
  add column if not exists usd_status text not null default 'manual',
  add column if not exists cny_status text not null default 'manual',
  add column if not exists usd_source_count integer not null default 0,
  add column if not exists cny_source_count integer not null default 0,
  add column if not exists usd_sources jsonb not null default '[]'::jsonb,
  add column if not exists cny_sources jsonb not null default '[]'::jsonb,
  add column if not exists usd_fetched_at timestamptz,
  add column if not exists cny_fetched_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_trigger text;

update public.warehouse_exchange_rates
set usd_rial = coalesce(usd_rial, usd_toman * 10),
    cny_rial = coalesce(cny_rial, cny_toman * 10),
    usd_fetched_at = coalesce(usd_fetched_at, updated_at),
    cny_fetched_at = coalesce(cny_fetched_at, updated_at),
    last_checked_at = coalesce(last_checked_at, updated_at)
where id = true;

alter table public.warehouse_exchange_rates
  alter column usd_rial set not null,
  alter column cny_rial set not null;

-- Rates must only change through the audited RPC (or the scheduled service-role
-- function). Direct writes would bypass history and item-price recalculation.
drop policy if exists warehouse_exchange_rates_write on public.warehouse_exchange_rates;
revoke insert, update, delete on public.warehouse_exchange_rates from authenticated;
grant select on public.warehouse_exchange_rates to authenticated;

-- ---------------------------------------------------------------------
-- 3) Immutable audit history for rate fetches and item price changes.
-- ---------------------------------------------------------------------
create table if not exists public.warehouse_exchange_rate_history (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency in ('USD', 'CNY')),
  previous_rial numeric,
  candidate_rial numeric,
  applied_rial numeric,
  source_count integer not null default 0,
  decision_status text not null,
  accepted boolean not null default false,
  source_details jsonb not null default '{}'::jsonb,
  trigger_source text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_warehouse_rate_history_currency_created
  on public.warehouse_exchange_rate_history(currency, created_at desc);

create table if not exists public.warehouse_item_currency_price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_items(id),
  action text not null,
  old_currency text,
  new_currency text,
  old_base_cost numeric,
  new_base_cost numeric,
  old_base_sale numeric,
  new_base_sale numeric,
  old_cost_rial numeric,
  new_cost_rial numeric,
  old_sale_rial numeric,
  new_sale_rial numeric,
  usd_rial numeric,
  cny_rial numeric,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.warehouse_item_currency_price_history
  add column if not exists old_cost_rial numeric,
  add column if not exists new_cost_rial numeric,
  add column if not exists old_sale_rial numeric,
  add column if not exists new_sale_rial numeric;

create index if not exists idx_warehouse_item_price_history_item_created
  on public.warehouse_item_currency_price_history(item_id, created_at desc);

alter table public.warehouse_exchange_rate_history enable row level security;
alter table public.warehouse_item_currency_price_history enable row level security;

drop policy if exists warehouse_rate_history_select on public.warehouse_exchange_rate_history;
create policy warehouse_rate_history_select on public.warehouse_exchange_rate_history
for select to authenticated using (public.has_role(array['admin','warehouse']));

drop policy if exists warehouse_item_price_history_select on public.warehouse_item_currency_price_history;
create policy warehouse_item_price_history_select on public.warehouse_item_currency_price_history
for select to authenticated using (public.has_role(array['admin','warehouse']));

revoke insert, update, delete on public.warehouse_exchange_rate_history from authenticated;
revoke insert, update, delete on public.warehouse_item_currency_price_history from authenticated;
grant select on public.warehouse_exchange_rate_history to authenticated;
grant select on public.warehouse_item_currency_price_history to authenticated;

-- One thousand Toman = ten thousand Rial. This is the single rounding rule used
-- by Warehouse, Orders, Finance and all shared catalog views.
create or replace function public.fn_round_warehouse_price_rial(p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_amount is null then null
    else round(p_amount / 10000) * 10000
  end
$$;

grant execute on function public.fn_round_warehouse_price_rial(numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Immutable currency/rate snapshots on order and finance lines.
-- unit_price remains the actual agreed line price; the extra fields preserve
-- the catalog/base price and rate that were visible when the line was created.
-- ---------------------------------------------------------------------
alter table public.order_items
  add column if not exists price_currency_snapshot text,
  add column if not exists base_cost_price_snapshot numeric,
  add column if not exists base_sale_price_snapshot numeric,
  add column if not exists exchange_rate_rial_snapshot numeric,
  add column if not exists catalog_cost_rial_snapshot numeric,
  add column if not exists catalog_sale_rial_snapshot numeric,
  add column if not exists price_snapshot_at timestamptz;

alter table public.finance_document_items
  add column if not exists price_currency_snapshot text,
  add column if not exists base_cost_price_snapshot numeric,
  add column if not exists base_sale_price_snapshot numeric,
  add column if not exists exchange_rate_rial_snapshot numeric,
  add column if not exists catalog_cost_rial_snapshot numeric,
  add column if not exists catalog_sale_rial_snapshot numeric,
  add column if not exists price_snapshot_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_price_currency_snapshot_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_price_currency_snapshot_check
      check (price_currency_snapshot is null or price_currency_snapshot in ('IRR','USD','CNY'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'finance_items_price_currency_snapshot_check'
      and conrelid = 'public.finance_document_items'::regclass
  ) then
    alter table public.finance_document_items
      add constraint finance_items_price_currency_snapshot_check
      check (price_currency_snapshot is null or price_currency_snapshot in ('IRR','USD','CNY'));
  end if;
end $$;

create or replace function public.fn_snapshot_order_item_currency_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.warehouse_items%rowtype;
  v_rates public.warehouse_exchange_rates%rowtype;
begin
  if new.price_snapshot_at is not null then return new; end if;

  if nullif(trim(coalesce(new.warehouse_item_code, '')), '') is not null then
    select * into v_item
    from public.warehouse_items
    where item_code = trim(new.warehouse_item_code)
    limit 1;
  end if;

  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true;

  if v_item.id is not null then
    new.price_currency_snapshot := coalesce(v_item.price_currency, 'IRR');
    new.base_cost_price_snapshot := v_item.base_cost_price;
    new.base_sale_price_snapshot := v_item.base_sale_price;
    new.exchange_rate_rial_snapshot := case v_item.price_currency
      when 'USD' then v_rates.usd_rial
      when 'CNY' then v_rates.cny_rial
      else 1
    end;
    new.catalog_cost_rial_snapshot := v_item.unit_price_estimate;
    new.catalog_sale_rial_snapshot := case
      when v_item.price_currency in ('USD','CNY') then v_item.unit_sale_price_estimate
      else new.unit_price
    end;
  else
    new.price_currency_snapshot := 'IRR';
    new.exchange_rate_rial_snapshot := 1;
    new.catalog_sale_rial_snapshot := new.unit_price;
  end if;

  new.price_snapshot_at := now();
  return new;
end;
$$;

drop trigger if exists trg_snapshot_order_item_currency_price on public.order_items;
create trigger trg_snapshot_order_item_currency_price
before insert on public.order_items
for each row execute function public.fn_snapshot_order_item_currency_price();

create or replace function public.fn_snapshot_finance_item_currency_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item public.order_items%rowtype;
  v_source_item public.finance_document_items%rowtype;
  v_item public.warehouse_items%rowtype;
  v_rates public.warehouse_exchange_rates%rowtype;
  v_source_document_id uuid;
begin
  if new.price_snapshot_at is not null then return new; end if;

  -- Documents created from an order retain the order-time price/rate snapshot.
  if new.order_item_id is not null then
    select * into v_order_item
    from public.order_items
    where id = new.order_item_id;

    if v_order_item.price_snapshot_at is not null then
      new.price_currency_snapshot := v_order_item.price_currency_snapshot;
      new.base_cost_price_snapshot := v_order_item.base_cost_price_snapshot;
      new.base_sale_price_snapshot := v_order_item.base_sale_price_snapshot;
      new.exchange_rate_rial_snapshot := v_order_item.exchange_rate_rial_snapshot;
      new.catalog_cost_rial_snapshot := v_order_item.catalog_cost_rial_snapshot;
      new.catalog_sale_rial_snapshot := v_order_item.catalog_sale_rial_snapshot;
      new.price_snapshot_at := v_order_item.price_snapshot_at;
      return new;
    end if;
  end if;

  -- A converted invoice retains the source proforma snapshot, even when it was
  -- a manually created proforma with no order item.
  select converted_from_document_id into v_source_document_id
  from public.finance_documents
  where id = new.document_id;

  if v_source_document_id is not null then
    select * into v_source_item
    from public.finance_document_items
    where document_id = v_source_document_id
      and line_no = new.line_no
    limit 1;

    if v_source_item.price_snapshot_at is not null then
      new.price_currency_snapshot := v_source_item.price_currency_snapshot;
      new.base_cost_price_snapshot := v_source_item.base_cost_price_snapshot;
      new.base_sale_price_snapshot := v_source_item.base_sale_price_snapshot;
      new.exchange_rate_rial_snapshot := v_source_item.exchange_rate_rial_snapshot;
      new.catalog_cost_rial_snapshot := v_source_item.catalog_cost_rial_snapshot;
      new.catalog_sale_rial_snapshot := v_source_item.catalog_sale_rial_snapshot;
      new.price_snapshot_at := v_source_item.price_snapshot_at;
      return new;
    end if;
  end if;

  if new.warehouse_item_id is not null then
    select * into v_item
    from public.warehouse_items
    where id = new.warehouse_item_id;
  end if;

  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true;

  if v_item.id is not null then
    new.price_currency_snapshot := coalesce(v_item.price_currency, 'IRR');
    new.base_cost_price_snapshot := v_item.base_cost_price;
    new.base_sale_price_snapshot := v_item.base_sale_price;
    new.exchange_rate_rial_snapshot := case v_item.price_currency
      when 'USD' then v_rates.usd_rial
      when 'CNY' then v_rates.cny_rial
      else 1
    end;
    new.catalog_cost_rial_snapshot := v_item.unit_price_estimate;
    new.catalog_sale_rial_snapshot := case
      when v_item.price_currency in ('USD','CNY') then v_item.unit_sale_price_estimate
      else new.unit_price
    end;
  else
    new.price_currency_snapshot := 'IRR';
    new.exchange_rate_rial_snapshot := 1;
    new.catalog_sale_rial_snapshot := new.unit_price;
  end if;

  new.price_snapshot_at := now();
  return new;
end;
$$;

drop trigger if exists trg_snapshot_finance_item_currency_price on public.finance_document_items;
create trigger trg_snapshot_finance_item_currency_price
before insert on public.finance_document_items
for each row execute function public.fn_snapshot_finance_item_currency_price();

-- ---------------------------------------------------------------------
-- 5) Push current warehouse COST into linked material rows of active/draft
-- BOMs, recalculate BOM totals, then price produced goods as BOM + profit.
-- Historical R&D/production/order cost rows are intentionally not rewritten.
-- ---------------------------------------------------------------------
create or replace function public.fn_refresh_production_bom_currency_costs(
  p_changed_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rates public.warehouse_exchange_rates%rowtype;
  v_default_margin numeric := 25;
  v_bom_line_count integer := 0;
  v_bom_count integer := 0;
  v_product_count integer := 0;
begin
  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true;

  select coalesce(
    (select pms.default_margin_pct
     from public.price_margin_settings pms
     where pms.sales_path::text = 'production'
     limit 1),
    25
  ) into v_default_margin;

  update public.production_bom_items pbi
  set unit_cost = wi.unit_price_estimate
  from public.warehouse_items wi
  where pbi.warehouse_item_id = wi.id
    and pbi.cost_type = 'material'
    and (p_changed_item_id is null or wi.id = p_changed_item_id)
    and pbi.unit_cost is distinct from wi.unit_price_estimate;

  get diagnostics v_bom_line_count = row_count;

  with totals as (
    select
      b.id as bom_id,
      coalesce(sum(i.total_cost) filter (where i.cost_type = 'material'), 0) as material_cost,
      coalesce(sum(i.total_cost) filter (where i.cost_type in ('labor','service')), 0) as labor_cost,
      coalesce(sum(i.total_cost) filter (where i.cost_type = 'overhead'), 0) as overhead_cost
    from public.production_boms b
    left join public.production_bom_items i on i.bom_id = b.id
    where b.status <> 'archived'
    group by b.id
  )
  update public.production_boms b
  set total_material_cost = t.material_cost,
      total_labor_cost = t.labor_cost,
      total_overhead_cost = t.overhead_cost,
      total_estimated_cost = t.material_cost + t.labor_cost + t.overhead_cost,
      updated_at = now()
  from totals t
  where b.id = t.bom_id
    and (
      b.total_material_cost is distinct from t.material_cost
      or b.total_labor_cost is distinct from t.labor_cost
      or b.total_overhead_cost is distinct from t.overhead_cost
      or b.total_estimated_cost is distinct from (t.material_cost + t.labor_cost + t.overhead_cost)
    );

  get diagnostics v_bom_count = row_count;

  -- Record only products whose calculated values actually change.
  with latest_bom as (
    select distinct on (b.warehouse_item_id)
      b.warehouse_item_id,
      b.total_estimated_cost
    from public.production_boms b
    where b.warehouse_item_id is not null
      and b.status <> 'archived'
    order by b.warehouse_item_id, (b.status = 'active') desc, b.updated_at desc, b.id desc
  ), priced as (
    select
      wi.*,
      public.fn_round_warehouse_price_rial(lb.total_estimated_cost) as next_cost_rial,
      coalesce(wi.pricing_margin_pct, v_default_margin, 25) as next_margin,
      case when wi.price_currency = 'USD' then v_rates.usd_rial
           when wi.price_currency = 'CNY' then v_rates.cny_rial
           else 1 end as item_rate
    from latest_bom lb
    join public.warehouse_items wi on wi.id = lb.warehouse_item_id
    where wi.category = 'Finished'
  ), calculated as (
    select
      p.*,
      public.fn_round_warehouse_price_rial(p.next_cost_rial * (1 + p.next_margin / 100.0)) as next_sale_rial,
      case when p.price_currency in ('USD','CNY') and coalesce(p.item_rate, 0) > 0
        then round(p.next_cost_rial / p.item_rate, 6)
        else null end as next_base_cost
    from priced p
  ), final_prices as (
    select
      c.*,
      case when c.price_currency in ('USD','CNY') and coalesce(c.item_rate, 0) > 0
        then round(c.next_sale_rial / c.item_rate, 6)
        else null end as next_base_sale
    from calculated c
  )
  insert into public.warehouse_item_currency_price_history (
    item_id, action, old_currency, new_currency,
    old_base_cost, new_base_cost, old_base_sale, new_base_sale,
    old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
    usd_rial, cny_rial, changed_by
  )
  select
    fp.id, 'bom_auto_reprice', fp.price_currency, fp.price_currency,
    fp.base_cost_price, fp.next_base_cost,
    fp.base_sale_price, fp.next_base_sale,
    fp.unit_price_estimate, fp.next_cost_rial,
    fp.unit_sale_price_estimate, fp.next_sale_rial,
    v_rates.usd_rial, v_rates.cny_rial, auth.uid()
  from final_prices fp
  where fp.unit_price_estimate is distinct from fp.next_cost_rial
     or fp.unit_sale_price_estimate is distinct from fp.next_sale_rial
     or fp.base_cost_price is distinct from fp.next_base_cost
     or fp.base_sale_price is distinct from fp.next_base_sale
     or fp.pricing_margin_pct is distinct from fp.next_margin;

  with latest_bom as (
    select distinct on (b.warehouse_item_id)
      b.warehouse_item_id,
      b.total_estimated_cost
    from public.production_boms b
    where b.warehouse_item_id is not null
      and b.status <> 'archived'
    order by b.warehouse_item_id, (b.status = 'active') desc, b.updated_at desc, b.id desc
  ), priced as (
    select
      wi.id,
      wi.price_currency,
      wi.unit_price_estimate,
      wi.unit_sale_price_estimate,
      wi.base_cost_price,
      wi.base_sale_price,
      wi.pricing_margin_pct,
      public.fn_round_warehouse_price_rial(lb.total_estimated_cost) as next_cost_rial,
      coalesce(wi.pricing_margin_pct, v_default_margin, 25) as next_margin,
      case when wi.price_currency = 'USD' then v_rates.usd_rial
           when wi.price_currency = 'CNY' then v_rates.cny_rial
           else 1 end as item_rate
    from latest_bom lb
    join public.warehouse_items wi on wi.id = lb.warehouse_item_id
    where wi.category = 'Finished'
  ), calculated as (
    select
      p.*,
      public.fn_round_warehouse_price_rial(p.next_cost_rial * (1 + p.next_margin / 100.0)) as next_sale_rial,
      case when p.price_currency in ('USD','CNY') and coalesce(p.item_rate, 0) > 0
        then round(p.next_cost_rial / p.item_rate, 6)
        else null end as next_base_cost
    from priced p
  ), final_prices as (
    select
      c.*,
      case when c.price_currency in ('USD','CNY') and coalesce(c.item_rate, 0) > 0
        then round(c.next_sale_rial / c.item_rate, 6)
        else null end as next_base_sale
    from calculated c
  )
  update public.warehouse_items wi
  set price_currency = case when wi.price_currency in ('USD','CNY') then wi.price_currency else 'IRR' end,
      base_cost_price = fp.next_base_cost,
      base_sale_price = fp.next_base_sale,
      unit_price_estimate = fp.next_cost_rial,
      unit_sale_price_estimate = fp.next_sale_rial,
      pricing_margin_pct = fp.next_margin,
      pricing_updated_at = now(),
      updated_at = now()
  from final_prices fp
  where wi.id = fp.id
    and (
      wi.unit_price_estimate is distinct from fp.next_cost_rial
      or wi.unit_sale_price_estimate is distinct from fp.next_sale_rial
      or wi.base_cost_price is distinct from fp.next_base_cost
      or wi.base_sale_price is distinct from fp.next_base_sale
      or wi.pricing_margin_pct is distinct from fp.next_margin
    );

  get diagnostics v_product_count = row_count;

  return jsonb_build_object(
    'bom_lines_updated', v_bom_line_count,
    'boms_recalculated', v_bom_count,
    'products_repriced', v_product_count
  );
end;
$$;

revoke all on function public.fn_refresh_production_bom_currency_costs(uuid) from public;

-- ---------------------------------------------------------------------
-- 6) Set/edit one item immediately. No approval queue is used.
-- ---------------------------------------------------------------------
create or replace function public.fn_set_warehouse_item_currency_price(
  p_item_id uuid,
  p_currency text,
  p_base_cost numeric,
  p_base_sale numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.warehouse_items%rowtype;
  v_rates public.warehouse_exchange_rates%rowtype;
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_rate numeric;
  v_cost_rial numeric;
  v_sale_rial numeric;
  v_effective_base_cost numeric;
  v_effective_base_sale numeric;
  v_margin_pct numeric;
  v_bom_cost_rial numeric;
  v_is_produced boolean := false;
begin
  if not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی تغییر قیمت ارزی کالا ندارید';
  end if;

  if v_currency not in ('USD', 'CNY') then
    raise exception 'ارز مبنا باید دلار یا یوان باشد';
  end if;

  if p_base_cost is null or p_base_sale is null or p_base_cost < 0 or p_base_sale < 0 then
    raise exception 'قیمت خرید و فروش باید عدد معتبر و نامنفی باشد';
  end if;

  select * into v_item
  from public.warehouse_items
  where id = p_item_id
  for update;

  if not found then raise exception 'کالا یافت نشد'; end if;

  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true
  for update;

  if not found then raise exception 'نرخ ارز انبار تعریف نشده است'; end if;

  v_rate := case when v_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end;
  if coalesce(v_rate, 0) <= 0 then raise exception 'نرخ ارز انتخاب‌شده معتبر نیست'; end if;

  v_is_produced := coalesce(v_item.category, '') = 'Finished';

  if v_is_produced then
    -- For produced goods the cost is authoritative from the latest usable BOM;
    -- users edit the profit percentage (represented by the submitted cost/sale
    -- ratio), not the manufacturing cost itself.
    select b.total_estimated_cost
    into v_bom_cost_rial
    from public.production_boms b
    where b.warehouse_item_id = p_item_id
      and b.status <> 'archived'
    order by (b.status = 'active') desc, b.updated_at desc, b.id desc
    limit 1;

    if not found or coalesce(v_bom_cost_rial, 0) <= 0 then
      raise exception 'برای قیمت‌گذاری محصول تولیدی ابتدا BOM معتبر و دارای هزینه ثبت کنید';
    end if;
    if coalesce(p_base_cost, 0) <= 0 or p_base_sale < p_base_cost then
      raise exception 'قیمت فروش محصول تولیدی باید برابر یا بیشتر از بهای BOM باشد';
    end if;

    v_margin_pct := round((p_base_sale / p_base_cost - 1) * 100, 6);
    v_cost_rial := public.fn_round_warehouse_price_rial(v_bom_cost_rial);
    v_sale_rial := public.fn_round_warehouse_price_rial(v_cost_rial * (1 + v_margin_pct / 100.0));
    v_effective_base_cost := round(v_cost_rial / v_rate, 6);
    v_effective_base_sale := round(v_sale_rial / v_rate, 6);
  else
    v_effective_base_cost := p_base_cost;
    v_effective_base_sale := p_base_sale;
    -- This column is authoritative only for BOM-priced produced goods. The
    -- regular-item margin remains derivable from its two base prices.
    v_margin_pct := null;
    v_cost_rial := public.fn_round_warehouse_price_rial(v_effective_base_cost * v_rate);
    v_sale_rial := public.fn_round_warehouse_price_rial(v_effective_base_sale * v_rate);
  end if;

  insert into public.warehouse_item_currency_price_history (
    item_id, action, old_currency, new_currency,
    old_base_cost, new_base_cost, old_base_sale, new_base_sale,
    old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
    usd_rial, cny_rial, changed_by
  ) values (
    p_item_id, case when v_is_produced then 'bom_profit_edit' else 'manual_edit' end,
    v_item.price_currency, v_currency,
    v_item.base_cost_price, v_effective_base_cost,
    v_item.base_sale_price, v_effective_base_sale,
    v_item.unit_price_estimate, v_cost_rial,
    v_item.unit_sale_price_estimate, v_sale_rial,
    v_rates.usd_rial, v_rates.cny_rial, auth.uid()
  );

  update public.warehouse_items
  set price_currency = v_currency,
      base_cost_price = v_effective_base_cost,
      base_sale_price = v_effective_base_sale,
      unit_price_estimate = v_cost_rial,
      unit_sale_price_estimate = v_sale_rial,
      pricing_margin_pct = v_margin_pct,
      pricing_updated_at = now(),
      pricing_updated_by = auth.uid(),
      updated_at = now()
  where id = p_item_id;

  perform public.fn_refresh_production_bom_currency_costs(p_item_id);

  return jsonb_build_object(
    'item_id', p_item_id,
    'price_currency', v_currency,
    'base_cost_price', v_effective_base_cost,
    'base_sale_price', v_effective_base_sale,
    'cost_rial', v_cost_rial,
    'sale_rial', v_sale_rial,
    'margin_pct', v_margin_pct,
    'pricing_source', case when v_is_produced then 'bom_plus_profit' else 'manual' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Convert every FX-priced item to USD or CNY while preserving its current
-- Rial/Toman value. IRR legacy items with no base FX price are left untouched.
-- ---------------------------------------------------------------------
create or replace function public.fn_convert_all_warehouse_item_currency(
  p_target_currency text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := upper(trim(coalesce(p_target_currency, '')));
  v_rates public.warehouse_exchange_rates%rowtype;
  v_target_rate numeric;
  v_count integer := 0;
  v_skipped integer := 0;
begin
  if not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی تغییر گروهی ارز مبنای کالاها ندارید';
  end if;

  if v_target not in ('USD', 'CNY') then
    raise exception 'ارز مقصد باید دلار یا یوان باشد';
  end if;

  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true
  for update;

  v_target_rate := case when v_target = 'USD' then v_rates.usd_rial else v_rates.cny_rial end;
  if coalesce(v_target_rate, 0) <= 0 then raise exception 'نرخ ارز مقصد معتبر نیست'; end if;

  insert into public.warehouse_item_currency_price_history (
    item_id, action, old_currency, new_currency,
    old_base_cost, new_base_cost, old_base_sale, new_base_sale,
    old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
    usd_rial, cny_rial, changed_by
  )
  select
    wi.id,
    'bulk_currency_conversion',
    wi.price_currency,
    v_target,
    wi.base_cost_price,
    round(wi.base_cost_price * (case when wi.price_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end) / v_target_rate, 6),
    wi.base_sale_price,
    round(wi.base_sale_price * (case when wi.price_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end) / v_target_rate, 6),
    wi.unit_price_estimate,
    wi.unit_price_estimate,
    wi.unit_sale_price_estimate,
    wi.unit_sale_price_estimate,
    v_rates.usd_rial,
    v_rates.cny_rial,
    auth.uid()
  from public.warehouse_items wi
  where wi.price_currency in ('USD', 'CNY')
    and wi.price_currency <> v_target
    and wi.base_cost_price is not null
    and wi.base_sale_price is not null;

  update public.warehouse_items wi
  set price_currency = v_target,
      base_cost_price = round(wi.base_cost_price * (case when wi.price_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end) / v_target_rate, 6),
      base_sale_price = round(wi.base_sale_price * (case when wi.price_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end) / v_target_rate, 6),
      -- Preserve the already-rounded Rial/Toman caches byte-for-byte. Only the
      -- canonical base currency/amount changes in this atomic conversion.
      unit_price_estimate = wi.unit_price_estimate,
      unit_sale_price_estimate = wi.unit_sale_price_estimate,
      pricing_updated_at = now(),
      pricing_updated_by = auth.uid(),
      updated_at = now()
  where wi.price_currency in ('USD', 'CNY')
    and wi.price_currency <> v_target
    and wi.base_cost_price is not null
    and wi.base_sale_price is not null;

  get diagnostics v_count = row_count;

  select count(*) into v_skipped
  from public.warehouse_items
  where is_active
    and (price_currency = 'IRR' or base_cost_price is null or base_sale_price is null);

  return jsonb_build_object(
    'target_currency', v_target,
    'converted_count', v_count,
    'skipped_count', v_skipped,
    'usd_rial', v_rates.usd_rial,
    'cny_rial', v_rates.cny_rial
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Apply one or both fetched rates atomically. A non-null candidate is
-- accepted even when it came from only one valid source, as requested.
-- ---------------------------------------------------------------------
create or replace function public.fn_apply_warehouse_exchange_rates(
  p_usd_rial numeric default null,
  p_cny_rial numeric default null,
  p_usd_meta jsonb default '{}'::jsonb,
  p_cny_meta jsonb default '{}'::jsonb,
  p_trigger_source text default 'scheduled'
) returns public.warehouse_exchange_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.warehouse_exchange_rates%rowtype;
  v_row public.warehouse_exchange_rates%rowtype;
  v_usd_ok boolean := coalesce(p_usd_rial, 0) > 0;
  v_cny_ok boolean := coalesce(p_cny_rial, 0) > 0;
  v_usd_count integer := coalesce(nullif(p_usd_meta->>'valid_count', '')::integer, 0);
  v_cny_count integer := coalesce(nullif(p_cny_meta->>'valid_count', '')::integer, 0);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی اعمال نرخ ارز انبار ندارید';
  end if;

  select * into v_old
  from public.warehouse_exchange_rates
  where id = true
  for update;

  if not found then raise exception 'ردیف تنظیمات نرخ ارز یافت نشد'; end if;

  if v_usd_ok and (p_usd_rial < 500000 or p_usd_rial > 20000000) then
    raise exception 'نرخ دلار خارج از محدوده منطقی است';
  end if;
  if v_cny_ok and (p_cny_rial < 50000 or p_cny_rial > 5000000) then
    raise exception 'نرخ یوان خارج از محدوده منطقی است';
  end if;

  insert into public.warehouse_exchange_rate_history (
    currency, previous_rial, candidate_rial, applied_rial, source_count,
    decision_status, accepted, source_details, trigger_source, created_by
  ) values
  (
    'USD', v_old.usd_rial, p_usd_rial,
    case when v_usd_ok then p_usd_rial else v_old.usd_rial end,
    v_usd_count, coalesce(p_usd_meta->>'status', case when v_usd_ok then 'updated' else 'no_data' end),
    v_usd_ok, coalesce(p_usd_meta, '{}'::jsonb), p_trigger_source, auth.uid()
  ),
  (
    'CNY', v_old.cny_rial, p_cny_rial,
    case when v_cny_ok then p_cny_rial else v_old.cny_rial end,
    v_cny_count, coalesce(p_cny_meta->>'status', case when v_cny_ok then 'updated' else 'no_data' end),
    v_cny_ok, coalesce(p_cny_meta, '{}'::jsonb), p_trigger_source, auth.uid()
  );

  update public.warehouse_exchange_rates
  set usd_rial = case when v_usd_ok then p_usd_rial else usd_rial end,
      usd_toman = case when v_usd_ok then p_usd_rial / 10 else usd_toman end,
      cny_rial = case when v_cny_ok then p_cny_rial else cny_rial end,
      cny_toman = case when v_cny_ok then p_cny_rial / 10 else cny_toman end,
      usd_status = coalesce(p_usd_meta->>'status', case when v_usd_ok then 'updated' else 'no_data' end),
      cny_status = coalesce(p_cny_meta->>'status', case when v_cny_ok then 'updated' else 'no_data' end),
      usd_source_count = v_usd_count,
      cny_source_count = v_cny_count,
      usd_sources = coalesce(p_usd_meta->'results', '[]'::jsonb),
      cny_sources = coalesce(p_cny_meta->'results', '[]'::jsonb),
      usd_fetched_at = case when v_usd_ok then now() else usd_fetched_at end,
      cny_fetched_at = case when v_cny_ok then now() else cny_fetched_at end,
      last_checked_at = now(),
      last_trigger = p_trigger_source,
      updated_at = case when v_usd_ok or v_cny_ok then now() else updated_at end,
      updated_by = coalesce(auth.uid(), updated_by)
  where id = true
  returning * into v_row;

  -- Refresh the IRR caches consumed by Warehouse, Sales, Finance, Production and R&D.
  update public.warehouse_items wi
  set unit_price_estimate = public.fn_round_warehouse_price_rial(
        wi.base_cost_price * case when wi.price_currency = 'USD' then v_row.usd_rial else v_row.cny_rial end
      ),
      unit_sale_price_estimate = public.fn_round_warehouse_price_rial(
        wi.base_sale_price * case when wi.price_currency = 'USD' then v_row.usd_rial else v_row.cny_rial end
      ),
      pricing_updated_at = now(),
      updated_at = now()
  where wi.price_currency in ('USD', 'CNY')
    and wi.base_cost_price is not null
    and wi.base_sale_price is not null;

  perform public.fn_refresh_production_bom_currency_costs(null);

  return v_row;
end;
$$;

-- Keep the old manual RPC signature compatible, but make it Warehouse-aware.
create or replace function public.fn_set_warehouse_exchange_rates(
  p_usd_toman numeric,
  p_cny_toman numeric
) returns public.warehouse_exchange_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.warehouse_exchange_rates;
begin
  if not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی تغییر نرخ ارز ندارید';
  end if;
  if coalesce(p_usd_toman, 0) <= 0 or coalesce(p_cny_toman, 0) <= 0 then
    raise exception 'نرخ ارز باید بزرگ‌تر از صفر باشد';
  end if;

  select * into v_row
  from public.fn_apply_warehouse_exchange_rates(
    p_usd_toman * 10,
    p_cny_toman * 10,
    jsonb_build_object('status','manual','valid_count',1,'results','[]'::jsonb),
    jsonb_build_object('status','manual','valid_count',1,'results','[]'::jsonb),
    'manual'
  );

  return v_row;
end;
$$;

create or replace function public.fn_get_warehouse_exchange_rates()
returns public.warehouse_exchange_rates
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.warehouse_exchange_rates where id = true
$$;

-- ---------------------------------------------------------------------
-- 9) Produced goods: authoritative cost = latest BOM cost; sale price = BOM
-- cost + the stored production profit percentage. Publishing a changed BOM
-- preserves an existing USD/CNY base currency and recalculates its base values.
-- ---------------------------------------------------------------------
create or replace function public.fn_production_publish_bom_to_warehouse(
  p_bom_id uuid,
  p_item_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom public.production_boms%rowtype;
  v_item public.warehouse_items%rowtype;
  v_rates public.warehouse_exchange_rates%rowtype;
  v_item_id uuid;
  v_item_code text;
  v_source_order_id uuid;
  v_margin_pct numeric;
  v_cost_rial numeric;
  v_sale_rial numeric;
  v_rate numeric;
  v_base_cost numeric;
  v_base_sale numeric;
  v_currency text := 'IRR';
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  perform public.fn_production_recalc_costs(p_bom_id);
  select * into v_bom
  from public.production_boms
  where id = p_bom_id
  for update;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  if v_bom.related_production_order_id is not null and v_bom.related_order_id is null then
    select source_order_id into v_source_order_id
    from public.production_orders
    where id = v_bom.related_production_order_id;

    update public.production_boms
    set related_order_id = v_source_order_id,
        updated_at = now()
    where id = p_bom_id;
    v_bom.related_order_id := v_source_order_id;
  end if;

  if v_bom.status = 'draft' then
    update public.production_boms
    set status = 'active', updated_at = now()
    where id = p_bom_id;
    v_bom.status := 'active';
  end if;

  select coalesce(
    (select pms.default_margin_pct
     from public.price_margin_settings pms
     where pms.sales_path::text = 'production'
     limit 1),
    25
  ) into v_margin_pct;

  select * into v_rates
  from public.warehouse_exchange_rates
  where id = true;

  v_cost_rial := public.fn_round_warehouse_price_rial(coalesce(v_bom.total_estimated_cost, 0));
  v_item_id := v_bom.warehouse_item_id;
  v_item_code := nullif(trim(coalesce(p_item_code, '')), '');

  if v_item_id is null then
    if v_item_code is null then
      v_item_code := public.fn_next_warehouse_item_code_4digit();
    end if;

    v_sale_rial := public.fn_round_warehouse_price_rial(v_cost_rial * (1 + v_margin_pct / 100.0));

    insert into public.warehouse_items (
      item_code, item_name_fa, item_name_en, category, unit, location,
      min_stock_threshold, unit_price_estimate, unit_sale_price_estimate,
      price_currency, pricing_margin_pct, pricing_updated_at,
      pricing_updated_by, is_active
    ) values (
      v_item_code,
      v_bom.product_name_fa,
      v_bom.product_name_en,
      'Finished',
      coalesce(v_bom.unit, 'عدد'),
      'تولید',
      0,
      v_cost_rial,
      v_sale_rial,
      'IRR',
      v_margin_pct,
      now(),
      auth.uid(),
      true
    ) returning id into v_item_id;

    update public.production_boms
    set warehouse_item_id = v_item_id,
        status = case when status = 'draft' then 'active' else status end,
        updated_at = now()
    where id = p_bom_id;

    insert into public.warehouse_item_currency_price_history (
      item_id, action, old_currency, new_currency,
      old_base_cost, new_base_cost, old_base_sale, new_base_sale,
      old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
      usd_rial, cny_rial, changed_by
    ) values (
      v_item_id, 'bom_publish', null, 'IRR',
      null, null, null, null,
      null, v_cost_rial, null, v_sale_rial,
      v_rates.usd_rial, v_rates.cny_rial, auth.uid()
    );
  else
    select * into v_item
    from public.warehouse_items
    where id = v_item_id
    for update;
    if not found then raise exception 'کالای متصل به فرمول تولید یافت نشد'; end if;

    v_margin_pct := coalesce(v_item.pricing_margin_pct, v_margin_pct, 25);
    v_sale_rial := public.fn_round_warehouse_price_rial(v_cost_rial * (1 + v_margin_pct / 100.0));
    v_currency := case when v_item.price_currency in ('USD','CNY') then v_item.price_currency else 'IRR' end;

    if v_currency in ('USD','CNY') then
      v_rate := case when v_currency = 'USD' then v_rates.usd_rial else v_rates.cny_rial end;
      if coalesce(v_rate, 0) <= 0 then raise exception 'نرخ ارز محصول تولیدی معتبر نیست'; end if;
      v_base_cost := round(v_cost_rial / v_rate, 6);
      v_base_sale := round(v_sale_rial / v_rate, 6);
    else
      v_base_cost := null;
      v_base_sale := null;
    end if;

    insert into public.warehouse_item_currency_price_history (
      item_id, action, old_currency, new_currency,
      old_base_cost, new_base_cost, old_base_sale, new_base_sale,
      old_cost_rial, new_cost_rial, old_sale_rial, new_sale_rial,
      usd_rial, cny_rial, changed_by
    ) values (
      v_item_id, 'bom_publish', v_item.price_currency, v_currency,
      v_item.base_cost_price, v_base_cost, v_item.base_sale_price, v_base_sale,
      v_item.unit_price_estimate, v_cost_rial,
      v_item.unit_sale_price_estimate, v_sale_rial,
      v_rates.usd_rial, v_rates.cny_rial, auth.uid()
    );

    update public.warehouse_items
    set item_name_fa = v_bom.product_name_fa,
        item_name_en = v_bom.product_name_en,
        category = 'Finished',
        unit = coalesce(v_bom.unit, unit, 'عدد'),
        price_currency = v_currency,
        base_cost_price = v_base_cost,
        base_sale_price = v_base_sale,
        unit_price_estimate = v_cost_rial,
        unit_sale_price_estimate = v_sale_rial,
        pricing_margin_pct = v_margin_pct,
        pricing_updated_at = now(),
        pricing_updated_by = auth.uid(),
        is_active = true,
        updated_at = now()
    where id = v_item_id;
  end if;

  perform public.fn_refresh_production_bom_currency_costs(v_item_id);
  return v_item_id;
end;
$$;

grant execute on function public.fn_production_publish_bom_to_warehouse(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 10) Clean shared price view for Warehouse UI.
-- ---------------------------------------------------------------------
create or replace view public.v_warehouse_currency_prices
with (security_invoker = true)
as
select
  wi.id as item_id,
  wi.item_code,
  wi.item_name_fa,
  wi.category as item_group,
  wi.unit,
  wi.is_active,
  (wi.category = 'Finished') as is_produced_item,
  wi.pricing_margin_pct,
  bom.bom_cost_rial,
  case when wi.category = 'Finished' then 'bom_plus_profit' else 'manual' end as pricing_mode,
  wi.price_currency,
  wi.base_cost_price,
  wi.base_sale_price,
  wi.unit_price_estimate as current_cost_rial,
  wi.unit_sale_price_estimate as current_sale_rial,
  case
    when wi.price_currency = 'USD' then wi.base_cost_price
    when wi.price_currency = 'CNY' then wi.base_cost_price * er.cny_rial / er.usd_rial
    else wi.unit_price_estimate / er.usd_rial
  end as cost_usd,
  case
    when wi.price_currency = 'CNY' then wi.base_cost_price
    when wi.price_currency = 'USD' then wi.base_cost_price * er.usd_rial / er.cny_rial
    else wi.unit_price_estimate / er.cny_rial
  end as cost_cny,
  case
    when wi.price_currency = 'USD' then wi.base_sale_price
    when wi.price_currency = 'CNY' then wi.base_sale_price * er.cny_rial / er.usd_rial
    else wi.unit_sale_price_estimate / er.usd_rial
  end as sale_usd,
  case
    when wi.price_currency = 'CNY' then wi.base_sale_price
    when wi.price_currency = 'USD' then wi.base_sale_price * er.usd_rial / er.cny_rial
    else wi.unit_sale_price_estimate / er.cny_rial
  end as sale_cny,
  case
    when wi.category = 'Finished' and wi.pricing_margin_pct is not null
      then round(wi.pricing_margin_pct, 2)
    when coalesce(wi.base_cost_price, 0) > 0
      then round((coalesce(wi.base_sale_price, 0) / wi.base_cost_price - 1) * 100, 2)
    else 0
  end as margin_pct,
  wi.pricing_updated_at,
  wi.pricing_updated_by,
  er.usd_rial,
  er.cny_rial,
  er.usd_toman,
  er.cny_toman,
  (wi.price_currency in ('USD','CNY') and wi.base_cost_price is not null and wi.base_sale_price is not null) as has_currency_price
from public.warehouse_items wi
cross join public.warehouse_exchange_rates er
left join lateral (
  select b.total_estimated_cost as bom_cost_rial
  from public.production_boms b
  where b.warehouse_item_id = wi.id
    and b.status <> 'archived'
  order by (b.status = 'active') desc, b.updated_at desc, b.id desc
  limit 1
) bom on true
where er.id = true;

grant select on public.v_warehouse_currency_prices to authenticated;

-- ---------------------------------------------------------------------
-- 11) Shared application catalog. Existing columns stay in their exact order;
-- new FX columns are appended. FX-priced items use the current converted SALE
-- price, not a historical last-sale price. This makes all NEW documents current
-- while existing order/invoice line prices remain frozen snapshots.
-- ---------------------------------------------------------------------
create or replace view public.v_app_inventory_catalog
with (security_invoker = true)
as
select
  s.item_id,
  s.item_code,
  s.item_name_fa,
  s.item_name_en,
  s.unit,
  s.category,
  s.item_group,
  case
    when coalesce(s.category, s.item_group) = 'Finished' then 'تولید شده‌ها'
    when coalesce(s.category, s.item_group) is null then 'بدون گروه'
    else coalesce(s.category, s.item_group)
  end as item_group_label,
  (coalesce(s.category, s.item_group) = 'Finished') as is_produced_item,
  s.location,
  s.current_qty,
  coalesce(s.reserved_qty, 0) as reserved_qty,
  coalesce(s.available_for_sale_qty, s.current_qty - coalesce(s.reserved_qty, 0)) as available_for_sale_qty,
  s.min_stock_threshold,
  s.reorder_point,
  s.is_low_stock,
  s.last_synced_at,
  s.unit_price_estimate,
  s.stock_value_estimate,
  ls.last_sale_unit_price,
  case
    when wi.price_currency in ('USD','CNY')
      and wi.base_sale_price is not null
      then wi.unit_sale_price_estimate
    when wi.category = 'Finished'
      and coalesce(wi.unit_sale_price_estimate, 0) > 0
      then wi.unit_sale_price_estimate
    else coalesce(ls.last_sale_unit_price, s.unit_price_estimate, 0)
  end as effective_sale_price,
  ls.doc_number as last_sale_doc_number,
  ls.issue_date as last_sale_date,
  wi.price_currency,
  wi.base_cost_price,
  wi.base_sale_price,
  wi.unit_sale_price_estimate,
  wi.pricing_margin_pct,
  case when wi.category = 'Finished' then 'bom_plus_profit' else 'manual' end as pricing_mode,
  wi.pricing_updated_at,
  er.usd_rial,
  er.cny_rial,
  er.usd_toman,
  er.cny_toman
from public.v_sales_stock_overview s
join public.warehouse_items wi on wi.id = s.item_id
cross join public.warehouse_exchange_rates er
left join public.v_finance_item_last_sale ls on ls.warehouse_item_id = s.item_id
where er.id = true;

grant select on public.v_app_inventory_catalog to authenticated;

-- ---------------------------------------------------------------------
-- 12) Grants. Direct table price edits remain protected by existing Warehouse
-- RLS; the RPCs provide validation, audit history and atomic recalculation.
-- ---------------------------------------------------------------------
grant execute on function public.fn_set_warehouse_item_currency_price(uuid,text,numeric,numeric) to authenticated;
grant execute on function public.fn_convert_all_warehouse_item_currency(text) to authenticated;
grant execute on function public.fn_apply_warehouse_exchange_rates(numeric,numeric,jsonb,jsonb,text) to authenticated;
grant execute on function public.fn_set_warehouse_exchange_rates(numeric,numeric) to authenticated;
grant execute on function public.fn_get_warehouse_exchange_rates() to authenticated;

notify pgrst, 'reload schema';

commit;
