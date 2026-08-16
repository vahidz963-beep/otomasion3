-- =====================================================================
-- 041_FINANCE_WAREHOUSE_DASHBOARD_OFFICE_ENHANCEMENTS
-- - Finance invoice edit re-issues linked warehouse documents
-- - Sales returns create warehouse return-in documents
-- - Enrich accounting item kardex with customer/party/price/document data
-- - Add warehouse shipments / dispatched list
-- - Improve finance dashboard KPIs and receivable forecast for CEO dashboard
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Allow office module in referrals for leave/admin workflows
-- ---------------------------------------------------------------------
do $$
begin
  alter table public.automation_referrals drop constraint if exists automation_referrals_source_module_check;
  alter table public.automation_referrals drop constraint if exists automation_referrals_target_module_check;
  alter table public.automation_referrals
    add constraint automation_referrals_source_module_check
    check (source_module in ('orders','sales','rnd','production','warehouse','accounting','admin','office','manual'));
  alter table public.automation_referrals
    add constraint automation_referrals_target_module_check
    check (target_module in ('orders','sales','rnd','production','warehouse','accounting','admin','office','manual'));
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------
-- 1) Re-issue inventory document after editing an approved sales invoice
-- ---------------------------------------------------------------------
create or replace function public.fn_finance_reissue_inventory_for_document(
  p_document_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_old_wh_doc uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی همگام‌سازی اسناد فاکتور ندارید';
  end if;

  select * into v_doc
  from public.finance_documents
  where id = p_document_id
  for update;

  if not found then raise exception 'فاکتور یافت نشد'; end if;
  if v_doc.document_type <> 'sales_invoice' then return null; end if;
  if v_doc.status::text in ('void','cancelled') then raise exception 'فاکتور باطل/لغوشده قابل همگام‌سازی نیست'; end if;

  v_old_wh_doc := v_doc.warehouse_issue_document_id;
  if v_old_wh_doc is not null then
    update public.warehouse_documents
    set status = 'cancelled'::public.warehouse_document_status,
        cancelled_at = now(),
        note = concat_ws(E'\n', note, 'لغو و صدور مجدد به دلیل ویرایش فاکتور: ' || coalesce(p_reason, 'بدون شرح'))
    where id = v_old_wh_doc
      and status::text <> 'cancelled';
  end if;

  update public.finance_documents
  set warehouse_issue_document_id = null,
      updated_at = now()
  where id = p_document_id;

  return public.fn_finance_issue_inventory_for_document(p_document_id);
end;
$$;

grant execute on function public.fn_finance_reissue_inventory_for_document(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Sales return should put goods back into warehouse if invoice had items
-- ---------------------------------------------------------------------
create or replace function public.fn_create_sales_return_from_invoice(
  p_invoice_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.finance_documents%rowtype;
  v_return_id uuid;
  v_wh_doc_id uuid;
  v_doc_number text;
  v_line record;
  v_tx_id uuid;
  v_actor uuid;
  v_party_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can create sales returns';
  end if;

  select * into v_src
  from public.finance_documents
  where id = p_invoice_id
  for update;

  if not found then raise exception 'Invoice not found'; end if;
  if v_src.document_type <> 'sales_invoice' then raise exception 'Only sales invoice can be returned'; end if;
  if v_src.status::text in ('void','cancelled') then raise exception 'Cancelled/void invoice cannot be returned'; end if;

  insert into public.finance_documents (
    doc_number, document_type, status, party_id, related_order_id,
    related_quotation_id, related_rnd_project_id, related_production_order_id,
    source_module, source_record_id, issue_date, due_date, currency,
    exchange_rate, description, discount_amount, is_official, created_by
  ) values (
    null, 'sales_return', 'approved', v_src.party_id, v_src.related_order_id,
    v_src.related_quotation_id, v_src.related_rnd_project_id, v_src.related_production_order_id,
    'accounting', v_src.id, current_date, current_date, v_src.currency,
    v_src.exchange_rate, 'برگشت از فاکتور ' || v_src.doc_number || ': ' || coalesce(p_reason,''),
    v_src.discount_amount, v_src.is_official, auth.uid()
  ) returning id into v_return_id;

  insert into public.finance_document_items (
    document_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  )
  select
    v_return_id, line_no, item_type, description_fa, description_en,
    quantity, unit, unit_price, discount_amount, tax_rate,
    warehouse_item_id, order_item_id, expense_category_id, cost_center_id
  from public.finance_document_items
  where document_id = p_invoice_id
  order by line_no;

  perform public.fn_finance_recalculate_document_totals(v_return_id);

  v_actor := auth.uid();
  select display_name into v_party_name from public.finance_parties where id = v_src.party_id;

  if exists (select 1 from public.finance_document_items where document_id = v_return_id and warehouse_item_id is not null) then
    v_doc_number := 'WH-IN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');

    insert into public.warehouse_documents (doc_number, type, status, created_by, finalized_at, note, customer_name)
    values (
      v_doc_number,
      'in'::public.warehouse_document_type,
      'final'::public.warehouse_document_status,
      v_actor,
      now(),
      'برگشت کالا بابت فاکتور برگشتی ' || (select doc_number from public.finance_documents where id = v_return_id),
      v_party_name
    ) returning id into v_wh_doc_id;

    for v_line in
      select warehouse_item_id, sum(quantity) as quantity, min(description_fa) as description_fa
      from public.finance_document_items
      where document_id = v_return_id
        and warehouse_item_id is not null
      group by warehouse_item_id
    loop
      insert into public.warehouse_transactions (item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note)
      values (
        v_line.warehouse_item_id,
        'receipt'::public.warehouse_transaction_type,
        v_line.quantity,
        'finance_sales_return',
        v_return_id,
        v_wh_doc_id,
        v_actor,
        'برگشت کالا بابت فاکتور برگشتی - ' || coalesce(v_line.description_fa,'')
      ) returning id into v_tx_id;

      insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
      values (v_wh_doc_id, v_line.warehouse_item_id, v_line.quantity, 'sales_return', 'برگشت کالا بابت فاکتور برگشتی', v_tx_id);
    end loop;
  end if;

  perform public.fn_log_finance_document_event(
    p_invoice_id,
    'return_created',
    'فاکتور برگشتی ساخته شد: ' || coalesce(p_reason,''),
    v_src.status,
    v_src.status,
    jsonb_build_object('return_id', v_return_id, 'warehouse_document_id', v_wh_doc_id)
  );

  if v_src.related_order_id is not null then
    insert into public.order_events (order_id, event_type, title, description, created_by)
    values (v_src.related_order_id, 'finance', 'فاکتور برگشتی ثبت شد', 'اقلام برگشتی و سند برگشت انبار ثبت شد.', auth.uid());
  end if;

  return v_return_id;
end;
$$;

grant execute on function public.fn_create_sales_return_from_invoice(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Enriched warehouse kardex for accounting item card
-- Preserve existing columns, append enrichment columns at end.
-- ---------------------------------------------------------------------
create or replace view public.v_warehouse_kardex
with (security_invoker = true)
as
with finance_line as (
  select distinct on (i.warehouse_item_id, d.id)
    i.warehouse_item_id,
    d.id as finance_document_id,
    d.doc_number as finance_doc_number,
    d.document_type,
    d.party_id,
    fp.display_name as party_name,
    d.related_order_id,
    o.order_code,
    i.unit_price,
    i.line_total
  from public.finance_document_items i
  join public.finance_documents d on d.id = i.document_id
  left join public.finance_parties fp on fp.id = d.party_id
  left join public.orders o on o.id = d.related_order_id
  where i.warehouse_item_id is not null
  order by i.warehouse_item_id, d.id, i.line_no
), base as (
  select
    wt.item_id,
    wi.item_code,
    wi.item_name_fa,
    wt.id as tx_id,
    wt.transaction_type,
    case when wt.transaction_type = 'issue' then 'out' else 'in' end as direction,
    wt.quantity,
    wt.document_id,
    wd.doc_number,
    wd.status as document_status,
    wt.reference_type,
    wt.reference_id,
    wt.created_by,
    wt.note,
    wt.created_at,
    sum(case
      when wt.transaction_type = 'issue' then -wt.quantity
      when wt.transaction_type in ('receipt','reversal','adjustment') then wt.quantity
      else 0
    end) over (partition by wt.item_id order by wt.created_at, wt.id rows between unbounded preceding and current row) as running_balance,
    wd.customer_name,
    wd.customer_city,
    fl.party_name,
    fl.finance_document_id,
    fl.finance_doc_number,
    fl.document_type as finance_document_type,
    fl.related_order_id,
    fl.order_code,
    fl.unit_price,
    fl.line_total
  from public.warehouse_transactions wt
  join public.warehouse_items wi on wi.id = wt.item_id
  left join public.warehouse_documents wd on wd.id = wt.document_id
  left join finance_line fl on fl.finance_document_id = wt.reference_id and fl.warehouse_item_id = wt.item_id
  where wt.document_id is null or wd.status::text = 'final'
)
select * from base;

grant select on public.v_warehouse_kardex to authenticated;

-- ---------------------------------------------------------------------
-- 4) Finance dashboard KPIs - preserve old columns
-- ---------------------------------------------------------------------
create or replace view public.v_finance_dashboard
with (security_invoker = true)
as
with payment_month as (
  select
    coalesce(sum(amount) filter (where direction = 'receipt' and status = 'confirmed' and payment_date >= date_trunc('month', current_date)::date), 0) as month_receipts,
    coalesce(sum(amount) filter (where direction = 'payment' and status = 'confirmed' and payment_date >= date_trunc('month', current_date)::date), 0) as month_payments
  from public.finance_payments
), document_month as (
  select
    coalesce(sum(total_amount) filter (where document_type = 'sales_invoice' and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_sales,
    coalesce(sum(total_amount) filter (where document_type in ('purchase_invoice','expense_invoice') and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_doc_costs,
    coalesce(sum(balance_amount) filter (where document_type in ('sales_invoice','debit_note') and status in ('approved','sent','partially_paid')), 0) as receivable_total,
    coalesce(sum(balance_amount) filter (where document_type in ('purchase_invoice','expense_invoice','credit_note') and status in ('approved','sent','partially_paid')), 0) as payable_total,
    coalesce(sum(balance_amount) filter (where due_date < current_date and status in ('approved','sent','partially_paid')), 0) as overdue_total
  from public.finance_documents
)
select
  dm.receivable_total,
  dm.payable_total,
  dm.overdue_total,
  dm.month_sales,
  (dm.month_doc_costs + pm.month_payments) as month_costs,
  (dm.month_sales + pm.month_receipts) - (dm.month_doc_costs + pm.month_payments) as month_profit,
  (select count(*) from public.automation_referrals r where r.target_module = 'accounting' and r.status in ('open','in_progress')) as open_accounting_referrals,
  pm.month_receipts,
  pm.month_payments,
  dm.month_doc_costs
from document_month dm cross join payment_month pm;

grant select on public.v_finance_dashboard to authenticated;

-- ---------------------------------------------------------------------
-- 5) CEO receivable forecast table for the next 10 days
-- ---------------------------------------------------------------------
create or replace view public.v_finance_receivable_forecast
with (security_invoker = true)
as
select
  d.id as document_id,
  d.doc_number,
  d.related_order_id,
  o.order_code,
  fp.display_name as customer_name,
  d.due_date as expected_payment_date,
  d.balance_amount as expected_amount,
  d.total_amount,
  d.paid_amount,
  o.expected_delivery_date,
  coalesce(olo.current_stage_name_fa, '') as current_stage_name_fa,
  coalesce(olo.progress_percent, 0) as progress_percent,
  coalesce(olo.sales_path, o.sales_path) as sales_path,
  case
    when d.due_date <= current_date + 3 then 'very_near'
    when d.due_date <= current_date + 10 then 'near'
    else 'future'
  end as forecast_status
from public.finance_documents d
left join public.finance_parties fp on fp.id = d.party_id
left join public.orders o on o.id = d.related_order_id
left join public.v_order_lifecycle_overview olo on olo.id = d.related_order_id
where d.document_type in ('sales_invoice','sales_proforma')
  and d.status not in ('draft','cancelled','void','paid')
  and coalesce(d.balance_amount, 0) > 0
  and coalesce(d.due_date, o.expected_delivery_date, current_date) between current_date and current_date + 10
order by expected_payment_date asc, expected_amount desc;

grant select on public.v_finance_receivable_forecast to authenticated;

-- ---------------------------------------------------------------------
-- 6) Warehouse dispatched / shipment list
-- ---------------------------------------------------------------------
create table if not exists public.warehouse_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_number text unique,
  source_type text not null default 'manual' check (source_type in ('manual','finance_invoice','sales_return','production','rnd','trading','other')),
  warehouse_document_id uuid references public.warehouse_documents(id) on delete set null,
  finance_document_id uuid references public.finance_documents(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  customer_name text,
  customer_city text,
  shipment_date date not null default current_date,
  item_summary text,
  total_quantity numeric not null default 0,
  carton_count numeric not null default 0,
  total_value numeric not null default 0,
  carrier_name text,
  tracking_code text,
  receiver_name text,
  status text not null default 'pending_warehouse' check (status in ('pending_warehouse','ready','sent','delivered','returned','cancelled')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.warehouse_shipment_seq;

create unique index if not exists uq_warehouse_shipments_document
  on public.warehouse_shipments(warehouse_document_id)
  where warehouse_document_id is not null;

create or replace function public.fn_generate_warehouse_shipment_number()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_number is null or new.shipment_number = '' then
    new.shipment_number := 'SHP-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_shipment_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_warehouse_shipment_number on public.warehouse_shipments;
create trigger trg_generate_warehouse_shipment_number
before insert on public.warehouse_shipments
for each row execute function public.fn_generate_warehouse_shipment_number();

drop trigger if exists trg_warehouse_shipments_updated_at on public.warehouse_shipments;
create trigger trg_warehouse_shipments_updated_at
before update on public.warehouse_shipments
for each row execute function public.set_updated_at();

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
    source_type, warehouse_document_id, finance_document_id, related_order_id,
    customer_name, customer_city, shipment_date, item_summary, total_quantity,
    total_value, status, notes, created_by
  ) values (
    case when v_finance_doc is not null then 'finance_invoice' else 'manual' end,
    p_document_id, v_finance_doc, v_order_id,
    v_doc.customer_name, v_doc.customer_city, coalesce(v_doc.finalized_at::date, current_date),
    v_summary, v_total_qty, v_total_value, 'pending_warehouse',
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
      updated_at = now()
  returning id into v_shipment_id;

  return v_shipment_id;
end;
$$;

grant execute on function public.fn_warehouse_upsert_shipment_from_document(uuid) to authenticated;

create or replace function public.fn_warehouse_shipment_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type::text = 'out' and new.status::text = 'final' then
    perform public.fn_warehouse_upsert_shipment_from_document(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_warehouse_shipment_sync on public.warehouse_documents;
create trigger trg_warehouse_shipment_sync
after insert or update of status on public.warehouse_documents
for each row execute function public.fn_warehouse_shipment_sync_trigger();

create or replace view public.v_warehouse_shipment_overview
with (security_invoker = true)
as
select
  s.*,
  wd.doc_number as warehouse_doc_number,
  fd.doc_number as finance_doc_number,
  o.order_code,
  fp.display_name as party_name
from public.warehouse_shipments s
left join public.warehouse_documents wd on wd.id = s.warehouse_document_id
left join public.finance_documents fd on fd.id = s.finance_document_id
left join public.finance_parties fp on fp.id = fd.party_id
left join public.orders o on o.id = s.related_order_id;

grant select, insert, update on public.warehouse_shipments to authenticated;
grant select on public.v_warehouse_shipment_overview to authenticated;

notify pgrst, 'reload schema';
