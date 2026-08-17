-- =====================================================================
-- 042_PRODUCTION_MULTI_BOM_MULTI_OUTPUT
-- Supports multiple BOM/formulas per production order/source order:
-- - Prepare material usage from all related BOMs
-- - Keep BOM identity on material usage lines for colored UI grouping
-- - Register multiple finished output items from one production order
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ensure produced item four digit code helper exists
-- ---------------------------------------------------------------------
create sequence if not exists public.production_item_code_seq;

create or replace function public.fn_next_warehouse_item_code_4digit()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  loop
    v_code := lpad(nextval('public.production_item_code_seq')::text, 4, '0');
    v_try := v_try + 1;

    if length(v_code) > 4 then
      raise exception 'ظرفیت کد چهاررقمی کالاهای تولیدی تکمیل شده است';
    end if;

    if not exists (select 1 from public.warehouse_items where item_code = v_code) then
      return v_code;
    end if;

    if v_try > 10000 then
      raise exception 'کد چهاررقمی خالی برای کالای تولیدی پیدا نشد';
    end if;
  end loop;
end;
$$;

grant execute on function public.fn_next_warehouse_item_code_4digit() to authenticated;

-- ---------------------------------------------------------------------
-- 2) Link prepared material rows to their BOM and BOM item
-- ---------------------------------------------------------------------
alter table public.production_material_usage
  add column if not exists bom_id uuid references public.production_boms(id) on delete set null,
  add column if not exists bom_item_id uuid references public.production_bom_items(id) on delete set null;

create index if not exists idx_production_material_usage_bom on public.production_material_usage(bom_id);
create index if not exists idx_production_material_usage_bom_item on public.production_material_usage(bom_item_id);

-- Prepare material usage from ALL active related BOMs unless p_bom_id is provided.
create or replace function public.fn_production_prepare_material_usage_from_bom(
  p_production_order_id uuid,
  p_bom_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_count int := 0;
  v_bom_count int := 0;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی ثبت مواد مصرفی تولید ندارید';
  end if;

  select * into v_po from public.production_orders where id = p_production_order_id;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  select count(*) into v_bom_count
  from public.production_boms b
  where b.status <> 'archived'
    and (
      (p_bom_id is not null and b.id = p_bom_id)
      or (p_bom_id is null and (b.related_production_order_id = p_production_order_id or (b.related_order_id is not null and b.related_order_id = v_po.source_order_id)))
    );

  if coalesce(v_bom_count, 0) = 0 then
    raise exception 'فرمول تولید مرتبط یافت نشد';
  end if;

  -- Refresh latest formula list: cancel only not-issued/not-final lines.
  update public.production_material_usage pmu
  set status = 'cancelled'
  where pmu.production_order_id = p_production_order_id
    and pmu.status <> 'cancelled'
    and pmu.quantity_issued is null
    and not exists (
      select 1 from public.warehouse_documents wd
      where wd.id = pmu.warehouse_document_id and wd.status::text = 'final'
    );

  insert into public.production_material_usage (
    production_order_id, warehouse_item_id, quantity_requested, quantity_issued,
    status, requested_by, created_at, bom_id, bom_item_id
  )
  select
    p_production_order_id,
    bi.warehouse_item_id,
    bi.quantity * coalesce(v_po.quantity_planned, 1),
    null,
    'pending',
    auth.uid(),
    now(),
    b.id,
    bi.id
  from public.production_boms b
  join public.production_bom_items bi on bi.bom_id = b.id
  where b.status <> 'archived'
    and (
      (p_bom_id is not null and b.id = p_bom_id)
      or (p_bom_id is null and (b.related_production_order_id = p_production_order_id or (b.related_order_id is not null and b.related_order_id = v_po.source_order_id)))
    )
    and bi.cost_type = 'material'
    and bi.warehouse_item_id is not null
  order by b.product_name_fa, bi.created_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.fn_production_prepare_material_usage_from_bom(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Enriched material usage overview with BOM grouping/color metadata
-- Keep existing view columns first; append new columns at end.
-- ---------------------------------------------------------------------
create or replace view public.v_production_material_usage_overview
with (security_invoker = true)
as
select
  pmu.id,
  pmu.production_order_id,
  po.code as production_code,
  po.source_order_id,
  po.source_order_code,
  po.product_name_fa,
  pmu.stage_id,
  pmu.warehouse_item_id,
  wi.item_code,
  wi.item_name_fa,
  wi.unit,
  wi.category,
  cat.item_group_label,
  pmu.quantity_requested,
  pmu.quantity_issued,
  pmu.status,
  pmu.requested_by,
  pmu.issued_by,
  pmu.created_at,
  pmu.issued_at,
  cat.current_qty,
  cat.available_for_sale_qty,
  cat.unit_price_estimate,
  (pmu.quantity_requested * coalesce(cat.unit_price_estimate, 0)) as estimated_cost,
  pmu.warehouse_document_id,
  wd.doc_number as warehouse_document_number,
  wd.status as warehouse_document_status,
  pmu.warehouse_document_line_id,
  pmu.bom_id,
  pmu.bom_item_id,
  b.product_name_fa as bom_product_name_fa,
  b.version_no as bom_version_no,
  dense_rank() over (partition by pmu.production_order_id order by coalesce(b.product_name_fa, ''), pmu.bom_id) as bom_color_index
from public.production_material_usage pmu
join public.production_orders po on po.id = pmu.production_order_id
join public.warehouse_items wi on wi.id = pmu.warehouse_item_id
left join public.v_app_inventory_catalog cat on cat.item_id = pmu.warehouse_item_id
left join public.warehouse_documents wd on wd.id = pmu.warehouse_document_id
left join public.production_boms b on b.id = pmu.bom_id
where pmu.status <> 'cancelled';

grant select on public.v_production_material_usage_overview to authenticated;

-- ---------------------------------------------------------------------
-- 4) Multiple finished outputs for one production order
-- ---------------------------------------------------------------------
alter table public.production_output
  add column if not exists warehouse_document_id uuid references public.warehouse_documents(id);

-- Prevent old trigger from double-applying direct inventory transactions.
drop trigger if exists trg_register_production_output on public.production_output;

create or replace function public.fn_create_finished_item_for_production_name(
  p_production_order_id uuid,
  p_product_name_fa text,
  p_unit text default 'عدد',
  p_unit_price_estimate numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_po public.production_orders%rowtype;
begin
  select * into v_po from public.production_orders where id = p_production_order_id;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  insert into public.warehouse_items (
    item_code, item_name_fa, item_name_en, category, unit, location,
    min_stock_threshold, unit_price_estimate, price_currency, is_active
  ) values (
    public.fn_next_warehouse_item_code_4digit(),
    coalesce(nullif(trim(p_product_name_fa), ''), v_po.product_name_fa),
    null,
    'Finished',
    coalesce(nullif(trim(p_unit), ''), v_po.unit, 'عدد'),
    'تولید',
    0,
    coalesce(p_unit_price_estimate, v_po.estimated_total_cost, 0),
    'IRR',
    true
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

grant execute on function public.fn_create_finished_item_for_production_name(uuid,text,text,numeric) to authenticated;

create or replace function public.fn_production_register_outputs(
  p_production_order_id uuid,
  p_outputs jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_total int;
  v_done int;
  v_row jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_existing public.production_output%rowtype;
  v_output_id uuid;
  v_delta numeric;
  v_doc_in uuid;
  v_doc_out uuid;
  v_doc_number text;
  v_tx_id uuid;
  v_result jsonb := '[]'::jsonb;
  v_total_produced numeric;
  v_product_name text;
  v_unit text;
  v_unit_price numeric;
begin
  if not public.has_role(array['admin','production','warehouse']) then
    raise exception 'دسترسی ثبت خروجی تولید ندارید';
  end if;

  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) = 0 then
    raise exception 'برای ثبت خروجی، حداقل یک محصول وارد کنید';
  end if;

  select * into v_po from public.production_orders where id = p_production_order_id for update;
  if not found then raise exception 'سفارش تولید یافت نشد'; end if;

  select count(*), count(*) filter (where status::text = 'completed')
  into v_total, v_done
  from public.production_order_stages
  where production_order_id = p_production_order_id;

  if coalesce(v_total,0) > 0 and coalesce(v_done,0) < coalesce(v_total,0) then
    raise exception 'ثبت خروجی فقط پس از تکمیل همه مراحل تولید مجاز است';
  end if;

  for v_row in select * from jsonb_array_elements(p_outputs)
  loop
    v_qty := nullif(v_row->>'quantity','')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'تعداد خروجی تولید باید بزرگ‌تر از صفر باشد';
    end if;

    v_item_id := nullif(v_row->>'warehouse_item_id','')::uuid;
    v_product_name := nullif(trim(coalesce(v_row->>'product_name_fa', '')), '');
    v_unit := nullif(trim(coalesce(v_row->>'unit', '')), '');
    v_unit_price := coalesce(nullif(v_row->>'unit_price_estimate','')::numeric, 0);

    if v_item_id is null then
      v_item_id := public.fn_create_finished_item_for_production_name(
        p_production_order_id,
        coalesce(v_product_name, v_po.product_name_fa),
        coalesce(v_unit, v_po.unit, 'عدد'),
        v_unit_price
      );
    end if;

    select * into v_existing
    from public.production_output
    where production_order_id = p_production_order_id
      and warehouse_item_id = v_item_id
    order by registered_at desc
    limit 1
    for update;

    if found then
      v_output_id := v_existing.id;
      v_delta := v_qty - coalesce(v_existing.quantity, 0);
      update public.production_output
      set quantity = v_qty,
          registered_by = auth.uid(),
          registered_at = now()
      where id = v_output_id;
    else
      insert into public.production_output (production_order_id, warehouse_item_id, quantity, registered_by)
      values (p_production_order_id, v_item_id, v_qty, auth.uid())
      returning id into v_output_id;
      v_delta := v_qty;
    end if;

    if v_delta <> 0 then
      if v_delta > 0 then
        if v_doc_in is null then
          v_doc_number := 'WH-IN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
          insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note)
          values (v_doc_number, 'in'::public.warehouse_document_type, 'final'::public.warehouse_document_status, auth.uid(), now(), 'ورود چندمحصولی خروجی تولید ' || v_po.code)
          returning id into v_doc_in;
        end if;

        insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
        values (v_item_id, 'receipt'::public.warehouse_transaction_type, abs(v_delta), 'production_output', v_output_id, v_doc_in, auth.uid(), 'خروجی تولید ' || v_po.code)
        returning id into v_tx_id;

        insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
        values (v_doc_in, v_item_id, abs(v_delta), 'production_output', 'خروجی تولید ' || v_po.code, v_tx_id);

        update public.production_output set warehouse_document_id = v_doc_in where id = v_output_id;
      else
        if v_doc_out is null then
          v_doc_number := 'WH-OUT-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_out_doc_seq')::text, 4, '0');
          insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note)
          values (v_doc_number, 'out'::public.warehouse_document_type, 'final'::public.warehouse_document_status, auth.uid(), now(), 'اصلاح کاهشی خروجی تولید ' || v_po.code)
          returning id into v_doc_out;
        end if;

        insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
        values (v_item_id, 'issue'::public.warehouse_transaction_type, abs(v_delta), 'production_output_adjustment', v_output_id, v_doc_out, auth.uid(), 'اصلاح کاهشی خروجی تولید ' || v_po.code)
        returning id into v_tx_id;

        insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
        values (v_doc_out, v_item_id, abs(v_delta), 'production_output', 'اصلاح کاهشی خروجی تولید ' || v_po.code, v_tx_id);
      end if;
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'output_id', v_output_id,
      'warehouse_item_id', v_item_id,
      'quantity_registered', v_qty,
      'delta', v_delta,
      'item_code', (select item_code from public.warehouse_items where id = v_item_id),
      'item_name_fa', (select item_name_fa from public.warehouse_items where id = v_item_id)
    ));
  end loop;

  select coalesce(sum(quantity), 0)
  into v_total_produced
  from public.production_output
  where production_order_id = p_production_order_id;

  update public.production_orders
  set quantity_produced = v_total_produced,
      output_warehouse_item_id = coalesce(output_warehouse_item_id, (select warehouse_item_id from public.production_output where production_order_id = p_production_order_id order by registered_at desc limit 1)),
      status = 'delivered_to_warehouse'::public.production_order_status,
      actual_end = coalesce(actual_end, current_date),
      updated_at = now()
  where id = p_production_order_id;

  insert into public.production_documents (production_order_id, document_type, title_fa, description_fa, status, created_by)
  values (
    p_production_order_id,
    'output',
    'ثبت خروجی چندمحصولی تولید در انبار',
    'تعداد ردیف خروجی: ' || jsonb_array_length(p_outputs) || '، مجموع تولید: ' || coalesce(v_total_produced,0),
    'registered',
    auth.uid()
  );

  if v_po.source_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (
      v_po.source_order_id,
      'production',
      'خروجی چندمحصولی تولید در انبار ثبت شد',
      'کد تولید ' || v_po.code || '، تعداد ردیف خروجی: ' || jsonb_array_length(p_outputs) || '، مجموع تولید: ' || coalesce(v_total_produced,0),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'production_order_id', p_production_order_id,
    'total_produced', v_total_produced,
    'outputs', v_result,
    'warehouse_in_document_id', v_doc_in,
    'warehouse_out_document_id', v_doc_out
  );
end;
$$;

grant execute on function public.fn_production_register_outputs(uuid,jsonb) to authenticated;

create or replace function public.fn_production_register_output(
  p_production_order_id uuid,
  p_quantity numeric,
  p_warehouse_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.fn_production_register_outputs(
    p_production_order_id,
    jsonb_build_array(jsonb_build_object(
      'warehouse_item_id', p_warehouse_item_id,
      'quantity', p_quantity
    ))
  );
end;
$$;

grant execute on function public.fn_production_register_output(uuid,numeric,uuid) to authenticated;

notify pgrst, 'reload schema';
