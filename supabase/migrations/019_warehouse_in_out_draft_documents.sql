-- =====================================================================
-- 019_WAREHOUSE_IN_OUT_DRAFT_DOCUMENTS
-- Adds draft documents for both IN and OUT movements.
-- After this migration, quick in/out/stocktake movements go into a user draft
-- document first and are finalized later from the UI.
-- =====================================================================

create unique index if not exists uq_one_open_in_draft_per_user
  on public.warehouse_documents(created_by)
  where status = 'draft' and type = 'in';

create or replace function public.fn_get_or_create_open_draft(p_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'کاربر غیرفعال است';
  end if;

  if p_type not in ('in','out') then
    raise exception 'نوع سند باید in یا out باشد';
  end if;

  select id into v_id
  from public.warehouse_documents
  where type::text = p_type
    and status::text = 'draft'
    and created_by = auth.uid()
  limit 1;

  if v_id is null then
    insert into public.warehouse_documents (type, status, created_by)
    values (p_type::public.warehouse_document_type, 'draft'::public.warehouse_document_status, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.fn_get_or_create_open_out_draft()
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.fn_get_or_create_open_draft('out');
$$;

create or replace function public.fn_record_stock_movement(
  p_item_id uuid,
  p_direction text,
  p_quantity numeric,
  p_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_tx_id uuid;
  v_tx_type public.warehouse_transaction_type;
begin
  if not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی انبار ندارید';
  end if;

  if p_direction not in ('in','out') then
    raise exception 'جهت باید in یا out باشد';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'مقدار باید بزرگ‌تر از صفر باشد';
  end if;

  -- Both IN and OUT now use draft documents first.
  v_doc_id := public.fn_get_or_create_open_draft(p_direction);
  v_tx_type := public.fn_warehouse_tx_type_from_direction(p_direction, true);

  insert into public.warehouse_transactions (
    item_id, transaction_type, quantity, reference_type, reference_id, document_id, created_by, note
  ) values (
    p_item_id,
    v_tx_type,
    p_quantity,
    null,
    null,
    v_doc_id,
    auth.uid(),
    coalesce(p_reason, p_direction) || coalesce(' - ' || p_note, '')
  ) returning id into v_tx_id;

  insert into public.warehouse_document_lines (document_id, item_id, quantity, reason, note, tx_id)
  values (
    v_doc_id,
    p_item_id,
    p_quantity,
    coalesce(p_reason, case when p_direction='in' then 'manual_in' else 'manual_out' end),
    p_note,
    v_tx_id
  );

  return jsonb_build_object(
    'document_id', v_doc_id,
    'doc_number', (select doc_number from public.warehouse_documents where id = v_doc_id),
    'type', (select type from public.warehouse_documents where id = v_doc_id),
    'status', (select status from public.warehouse_documents where id = v_doc_id)
  );
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
    v_doc_number := 'WH-IN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
  else
    v_doc_number := 'WH-OUT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.warehouse_out_doc_seq')::text, 4, '0');
  end if;

  update public.warehouse_documents
  set doc_number = v_doc_number,
      status = 'final'::public.warehouse_document_status,
      finalized_at = now()
  where id = p_document_id;

  return v_doc_number;
end;
$$;

grant execute on function public.fn_get_or_create_open_draft(text) to authenticated;
grant execute on function public.fn_get_or_create_open_out_draft() to authenticated;
grant execute on function public.fn_record_stock_movement(uuid,text,numeric,text,text) to authenticated;
grant execute on function public.fn_finalize_document(uuid) to authenticated;

notify pgrst, 'reload schema';
