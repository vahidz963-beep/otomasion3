-- =====================================================================
-- 043_WAREHOUSE_SHIPMENTS_READY_FROM_FINAL_FLOWS
-- Fixes dispatched list workflow:
-- - Only 3 statuses: ready, sent, cancelled
-- - Manual and automatic shipments stay in one list
-- - Final orders / production / R&D are inserted as ready-to-send
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Simplify statuses
-- ---------------------------------------------------------------------
alter table public.warehouse_shipments
  add column if not exists source_record_id uuid;

update public.warehouse_shipments
set status = case
  when status in ('sent','delivered') then 'sent'
  when status in ('cancelled','returned') then 'cancelled'
  else 'ready'
end;

alter table public.warehouse_shipments
  alter column status set default 'ready';

alter table public.warehouse_shipments
  drop constraint if exists warehouse_shipments_status_check;

alter table public.warehouse_shipments
  add constraint warehouse_shipments_status_check
  check (status in ('ready','sent','cancelled'));

create index if not exists idx_warehouse_shipments_source_record
  on public.warehouse_shipments(source_type, source_record_id);

-- ---------------------------------------------------------------------
-- 2) Helper: create/update one ready shipment row
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_upsert_ready_shipment(
  p_source_type text,
  p_source_record_id uuid,
  p_related_order_id uuid,
  p_customer_name text,
  p_customer_city text,
  p_item_summary text,
  p_total_quantity numeric default 0,
  p_total_value numeric default 0,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_related_order_id is not null then
    select id into v_id
    from public.warehouse_shipments
    where source_type = p_source_type
      and related_order_id = p_related_order_id
      and warehouse_document_id is null
    order by created_at desc
    limit 1;
  elsif p_source_record_id is not null then
    select id into v_id
    from public.warehouse_shipments
    where source_type = p_source_type
      and source_record_id = p_source_record_id
      and warehouse_document_id is null
    order by created_at desc
    limit 1;
  end if;

  if v_id is null then
    insert into public.warehouse_shipments (
      source_type, source_record_id, related_order_id, customer_name, customer_city,
      shipment_date, item_summary, total_quantity, total_value, status, notes, created_by
    ) values (
      p_source_type, p_source_record_id, p_related_order_id, p_customer_name, p_customer_city,
      current_date, p_item_summary, coalesce(p_total_quantity,0), coalesce(p_total_value,0),
      'ready', p_notes, auth.uid()
    ) returning id into v_id;
  else
    update public.warehouse_shipments
    set customer_name = coalesce(p_customer_name, customer_name),
        customer_city = coalesce(p_customer_city, customer_city),
        item_summary = coalesce(p_item_summary, item_summary),
        total_quantity = coalesce(p_total_quantity, total_quantity, 0),
        total_value = coalesce(p_total_value, total_value, 0),
        status = case when status = 'cancelled' then status else 'ready' end,
        notes = coalesce(p_notes, notes),
        updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.fn_warehouse_upsert_ready_shipment(text,uuid,uuid,text,text,text,numeric,numeric,text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Final sales/trading/order flow -> ready shipment
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_upsert_shipment_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_items text;
  v_qty numeric;
  v_value numeric;
  v_source_type text;
begin
  select
    t.id,
    t.order_code,
    t.customer_name,
    c.city as customer_city,
    t.sales_path,
    t.current_stage,
    t.stage_name_fa,
    t.is_terminal,
    t.is_cancelled
  into v_order
  from public.v_order_tracking t
  left join public.orders o on o.id = t.id
  left join public.customers c on c.id = o.customer_id
  where t.id = p_order_id;

  if not found or coalesce(v_order.is_cancelled, false) then
    return null;
  end if;

  if not coalesce(v_order.is_terminal, false)
     and v_order.current_stage not in ('closed','delivered','completed') then
    return null;
  end if;

  select
    string_agg(coalesce(oi.warehouse_item_code,'—') || ' · ' || oi.item_name_fa || ' × ' || oi.quantity::text, E'\n' order by oi.created_at, oi.id),
    coalesce(sum(oi.quantity), 0),
    coalesce(sum(oi.quantity * coalesce(oi.unit_price, 0)), 0)
  into v_items, v_qty, v_value
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_source_type := case
    when v_order.sales_path = 'production' then 'production'
    when v_order.sales_path = 'rnd' then 'rnd'
    when v_order.sales_path = 'trading' then 'trading'
    else 'other'
  end;

  return public.fn_warehouse_upsert_ready_shipment(
    v_source_type,
    p_order_id,
    p_order_id,
    v_order.customer_name,
    v_order.customer_city,
    coalesce(v_items, 'سفارش تکمیل‌شده ' || v_order.order_code),
    v_qty,
    v_value,
    'ثبت خودکار از مرحله نهایی سفارش: ' || coalesce(v_order.stage_name_fa, v_order.current_stage)
  );
end;
$$;

grant execute on function public.fn_warehouse_upsert_shipment_from_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Completed production -> ready shipment
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_upsert_shipment_from_production(p_production_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_items text;
  v_qty numeric;
  v_value numeric;
begin
  select * into v_po
  from public.production_orders
  where id = p_production_order_id;

  if not found then return null; end if;

  if v_po.status::text not in ('completed','delivered_to_warehouse')
     and coalesce(v_po.progress_percent,0) < 100
     and coalesce(v_po.quantity_produced,0) < coalesce(v_po.quantity_planned,0) then
    return null;
  end if;

  select
    string_agg(wi.item_code || ' · ' || wi.item_name_fa || ' × ' || po.quantity::text, E'\n' order by po.registered_at, po.id),
    coalesce(sum(po.quantity), 0),
    coalesce(sum(po.quantity * coalesce(wi.unit_price_estimate, 0)), 0)
  into v_items, v_qty, v_value
  from public.production_output po
  join public.warehouse_items wi on wi.id = po.warehouse_item_id
  where po.production_order_id = p_production_order_id;

  return public.fn_warehouse_upsert_ready_shipment(
    'production',
    p_production_order_id,
    v_po.source_order_id,
    v_po.customer_name_snapshot,
    null,
    coalesce(v_items, v_po.product_name_fa || ' × ' || coalesce(v_po.quantity_produced, v_po.quantity_planned, 0)::text),
    coalesce(nullif(v_qty,0), coalesce(v_po.quantity_produced, v_po.quantity_planned, 0)),
    coalesce(v_value, v_po.estimated_total_cost, 0),
    'ثبت خودکار از پایان تولید ' || v_po.code
  );
end;
$$;

grant execute on function public.fn_warehouse_upsert_shipment_from_production(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Completed R&D -> ready shipment / follow-up row
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_upsert_shipment_from_rnd(p_rnd_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rnd public.rnd_projects%rowtype;
begin
  select * into v_rnd
  from public.rnd_projects
  where id = p_rnd_project_id;

  if not found then return null; end if;

  if v_rnd.status::text not in ('approved','sent_to_production','archived')
     and coalesce(v_rnd.progress_percent,0) < 100 then
    return null;
  end if;

  return public.fn_warehouse_upsert_ready_shipment(
    'rnd',
    p_rnd_project_id,
    v_rnd.source_order_id,
    v_rnd.customer_name_snapshot,
    null,
    coalesce(v_rnd.title_fa, 'پروژه R&D تکمیل‌شده') || coalesce(' · ' || v_rnd.code, ''),
    1,
    coalesce(v_rnd.actual_total_cost, v_rnd.estimated_total_cost, 0),
    'ثبت خودکار از پایان R&D ' || coalesce(v_rnd.code, p_rnd_project_id::text)
  );
end;
$$;

grant execute on function public.fn_warehouse_upsert_shipment_from_rnd(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Trigger sync after final state changes
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_order_final_shipment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_warehouse_upsert_shipment_from_order(new.id);
  return new;
end;
$$;

drop trigger if exists trg_warehouse_order_final_shipment on public.orders;
create trigger trg_warehouse_order_final_shipment
after insert or update of current_stage, is_cancelled, updated_at on public.orders
for each row execute function public.fn_warehouse_order_final_shipment_trigger();

create or replace function public.fn_warehouse_production_final_shipment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_warehouse_upsert_shipment_from_production(new.id);
  return new;
end;
$$;

drop trigger if exists trg_warehouse_production_final_shipment on public.production_orders;
create trigger trg_warehouse_production_final_shipment
after insert or update of status, progress_percent, quantity_produced, updated_at on public.production_orders
for each row execute function public.fn_warehouse_production_final_shipment_trigger();

create or replace function public.fn_warehouse_rnd_final_shipment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_warehouse_upsert_shipment_from_rnd(new.id);
  return new;
end;
$$;

drop trigger if exists trg_warehouse_rnd_final_shipment on public.rnd_projects;
create trigger trg_warehouse_rnd_final_shipment
after insert or update of status, progress_percent, updated_at on public.rnd_projects
for each row execute function public.fn_warehouse_rnd_final_shipment_trigger();

-- ---------------------------------------------------------------------
-- 7) Existing final records backfill
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.orders loop
    perform public.fn_warehouse_upsert_shipment_from_order(r.id);
  end loop;

  for r in select id from public.production_orders loop
    perform public.fn_warehouse_upsert_shipment_from_production(r.id);
  end loop;

  for r in select id from public.rnd_projects loop
    perform public.fn_warehouse_upsert_shipment_from_rnd(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8) Override finance/warehouse document sync status to ready
-- ---------------------------------------------------------------------
create or replace function public.fn_warehouse_upsert_shipment_from_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
  v_shipment_id uuid;
  v_finance_doc uuid;
  v_order_id uuid;
  v_total_qty numeric;
  v_total_value numeric;
  v_summary text;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id;
  if not found then return null; end if;
  if v_doc.type::text <> 'out' or v_doc.status::text <> 'final' then return null; end if;

  select reference_id into v_finance_doc
  from public.warehouse_transactions
  where document_id = p_document_id and reference_type = 'finance_document'
  limit 1;

  select related_order_id into v_order_id from public.finance_documents where id = v_finance_doc;

  select
    coalesce(sum(wdl.quantity), 0),
    coalesce(sum(wdl.quantity * coalesce(fdi.unit_price, wi.unit_price_estimate, 0)), 0),
    string_agg(wi.item_code || ' · ' || wi.item_name_fa || ' × ' || wdl.quantity::text, E'\n' order by wi.item_code)
  into v_total_qty, v_total_value, v_summary
  from public.warehouse_document_lines wdl
  join public.warehouse_items wi on wi.id = wdl.item_id
  left join public.finance_document_items fdi on fdi.document_id = v_finance_doc and fdi.warehouse_item_id = wdl.item_id
  where wdl.document_id = p_document_id and wdl.removed_at is null;

  insert into public.warehouse_shipments (
    source_type, source_record_id, warehouse_document_id, finance_document_id, related_order_id,
    customer_name, customer_city, shipment_date, item_summary, total_quantity,
    total_value, status, notes, created_by
  ) values (
    case when v_finance_doc is not null then 'finance_invoice' else 'manual' end,
    coalesce(v_finance_doc, p_document_id), p_document_id, v_finance_doc, v_order_id,
    v_doc.customer_name, v_doc.customer_city, coalesce(v_doc.finalized_at::date, current_date),
    v_summary, v_total_qty, v_total_value, 'ready',
    'ثبت خودکار از سند خروج انبار ' || coalesce(v_doc.doc_number, p_document_id::text),
    coalesce(v_doc.created_by, auth.uid())
  )
  on conflict (warehouse_document_id) where warehouse_document_id is not null do update
  set finance_document_id = excluded.finance_document_id,
      related_order_id = excluded.related_order_id,
      customer_name = excluded.customer_name,
      customer_city = excluded.customer_city,
      shipment_date = excluded.shipment_date,
      item_summary = excluded.item_summary,
      total_quantity = excluded.total_quantity,
      total_value = excluded.total_value,
      status = case when public.warehouse_shipments.status = 'cancelled' then public.warehouse_shipments.status else 'ready' end,
      updated_at = now()
  returning id into v_shipment_id;

  return v_shipment_id;
end;
$$;

grant execute on function public.fn_warehouse_upsert_shipment_from_document(uuid) to authenticated;

notify pgrst, 'reload schema';
