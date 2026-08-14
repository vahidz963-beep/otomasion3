-- =====================================================================
-- 030_JALALI_DOCUMENT_NUMBERING
-- Makes new document/order/check/referral/warehouse/production/R&D numbers use Jalali year.
-- Example: RC-1405-00005 instead of RC-2026-00005
-- =====================================================================

create or replace function public.fn_jalali_year(p_date date default current_date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_date)::int > 3
      or (extract(month from p_date)::int = 3 and extract(day from p_date)::int >= 21)
    then (extract(year from p_date)::int - 621)::text
    else (extract(year from p_date)::int - 622)::text
  end;
$$;

create or replace function public.fn_next_document_number(p_rule_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.finance_numbering_rules%rowtype;
  v_period_key text;
  v_counter int;
  v_year text := public.fn_jalali_year(current_date);
begin
  select * into v_rule
  from public.finance_numbering_rules
  where rule_key = p_rule_key and is_active
  for update;

  if not found then
    raise exception 'Numbering rule not found: %', p_rule_key;
  end if;

  v_period_key := case v_rule.reset_scope
    when 'monthly' then v_year || to_char(now(), 'MM')
    when 'yearly' then v_year
    else 'global'
  end;

  insert into public.finance_numbering_counters (rule_key, period_key, counter, updated_at)
  values (p_rule_key, v_period_key, 1, now())
  on conflict (rule_key, period_key) do update
    set counter = public.finance_numbering_counters.counter + 1,
        updated_at = now()
  returning counter into v_counter;

  return v_rule.prefix
    || v_rule.separator
    || case when v_rule.include_year then v_year || v_rule.separator else '' end
    || lpad(v_counter::text, v_rule.padding, '0');
end;
$$;

-- Fallback/legacy generators using Jalali year.
create or replace function public.fn_generate_finance_document_number()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.doc_number is null or new.doc_number = '' then
    v_prefix := case new.document_type
      when 'sales_proforma' then 'PF'
      when 'sales_invoice' then 'SI'
      when 'purchase_invoice' then 'PI'
      when 'sales_return' then 'SR'
      when 'purchase_return' then 'PR'
      when 'expense_invoice' then 'EX'
      when 'credit_note' then 'CN'
      when 'debit_note' then 'DN'
      when 'opening_balance' then 'OB'
      else 'FD'
    end;
    new.doc_number := v_prefix || '-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.finance_document_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_finance_payment_number()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.payment_number is null or new.payment_number = '' then
    v_prefix := case when new.direction = 'receipt' then 'RC' else 'PY' end;
    new.payment_number := v_prefix || '-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.finance_payment_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_journal_entry_number()
returns trigger
language plpgsql
as $$
begin
  if new.entry_number is null or new.entry_number = '' then
    new.entry_number := 'JE-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.finance_journal_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_automation_referral_number()
returns trigger
language plpgsql
as $$
begin
  if new.referral_number is null or new.referral_number = '' then
    new.referral_number := 'REF-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.automation_referral_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fn_finalize_document(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
  v_doc_number text;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;
  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;
  if v_doc.status::text <> 'draft' then raise exception 'این سند قبلاً ثبت شده است'; end if;

  if v_doc.type::text = 'in' then
    v_doc_number := 'WH-IN-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
  else
    v_doc_number := 'WH-OUT-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.warehouse_out_doc_seq')::text, 4, '0');
  end if;

  update public.warehouse_documents
  set doc_number = v_doc_number,
      status = 'final'::public.warehouse_document_status,
      finalized_at = now()
  where id = p_document_id;

  return v_doc_number;
end;
$$;

create or replace function public.fn_generate_production_document_number()
returns trigger
language plpgsql
as $$
begin
  if new.doc_number is null or new.doc_number = '' then
    new.doc_number := 'PRD-DOC-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.production_document_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fn_generate_shared_file_number()
returns trigger
language plpgsql
as $$
begin
  if new.file_number is null or new.file_number = '' then
    new.file_number := 'SHF-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.shared_file_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

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
  v_item_id uuid;
  v_item_code text;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  perform public.fn_production_recalc_costs(p_bom_id);
  select * into v_bom from public.production_boms where id = p_bom_id for update;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  v_item_id := v_bom.warehouse_item_id;
  v_item_code := nullif(trim(coalesce(p_item_code, '')), '');

  if v_item_id is null then
    if v_item_code is null then
      v_item_code := 'PRD-' || public.fn_jalali_year(current_date) || '-' || lpad(nextval('public.production_item_code_seq')::text, 5, '0');
    end if;

    insert into public.warehouse_items (
      item_code, item_name_fa, item_name_en, category, unit, location,
      min_stock_threshold, unit_price_estimate, price_currency, is_active
    ) values (
      v_item_code, v_bom.product_name_fa, v_bom.product_name_en, 'Finished',
      coalesce(v_bom.unit, 'عدد'), 'تولید', 0, coalesce(v_bom.total_estimated_cost, 0), 'IRR', true
    ) returning id into v_item_id;

    update public.production_boms
    set warehouse_item_id = v_item_id,
        status = case when status = 'draft' then 'active' else status end,
        updated_at = now()
    where id = p_bom_id;
  else
    update public.warehouse_items
    set item_name_fa = v_bom.product_name_fa,
        item_name_en = v_bom.product_name_en,
        category = 'Finished',
        unit = coalesce(v_bom.unit, unit, 'عدد'),
        unit_price_estimate = coalesce(v_bom.total_estimated_cost, 0),
        price_currency = 'IRR',
        is_active = true,
        updated_at = now()
    where id = v_item_id;
  end if;
  return v_item_id;
end;
$$;

notify pgrst, 'reload schema';
