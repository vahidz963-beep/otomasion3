-- =====================================================================
-- 023_WAREHOUSE_FINAL_DOCUMENT_DELETE_RESTORE_META
-- Final warehouse fixes:
-- - customer/city/note metadata on draft/final documents
-- - cancel/delete final documents with reversing stock movements
-- - delete draft safely without FK errors
-- - restore inactive warehouse items
-- =====================================================================

alter table public.warehouse_documents
  add column if not exists customer_name text,
  add column if not exists customer_city text,
  add column if not exists updated_at timestamptz not null default now();

create or replace view public.v_warehouse_documents_summary
with (security_invoker = true)
as
select
  wd.id,
  wd.doc_number,
  wd.type,
  wd.status,
  wd.created_by,
  p.full_name as created_by_name,
  wd.created_at,
  wd.finalized_at,
  count(wdl.id) filter (where wdl.removed_at is null) as line_count,
  coalesce(sum(wdl.quantity) filter (where wdl.removed_at is null), 0) as total_quantity,
  wd.note,
  wd.customer_name,
  wd.customer_city,
  wd.cancelled_at
from public.warehouse_documents wd
left join public.warehouse_document_lines wdl on wdl.document_id = wd.id
left join public.profiles p on p.id = wd.created_by
group by wd.id, p.full_name;

create or replace function public.fn_update_warehouse_document_meta(
  p_document_id uuid,
  p_customer_name text default null,
  p_customer_city text default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;
  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  update public.warehouse_documents
  set customer_name = nullif(trim(coalesce(p_customer_name, '')), ''),
      customer_city = nullif(trim(coalesce(p_customer_city, '')), ''),
      note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_document_id;

  return p_document_id;
end;
$$;

create or replace function public.fn_cancel_draft_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;
  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;
  if v_doc.status::text <> 'draft' then raise exception 'فقط سند موقت قابل لغو است'; end if;

  update public.warehouse_document_lines set tx_id = null where document_id = p_document_id;
  delete from public.warehouse_document_lines where document_id = p_document_id;
  delete from public.warehouse_transactions where document_id = p_document_id;
  delete from public.warehouse_documents where id = p_document_id;
end;
$$;

create or replace function public.fn_remove_document_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.warehouse_document_lines%rowtype;
  v_doc public.warehouse_documents%rowtype;
  v_tx_type public.warehouse_transaction_type;
  v_tx_id uuid;
begin
  select * into v_line from public.warehouse_document_lines where id = p_line_id for update;
  if not found then raise exception 'ردیف سند یافت نشد'; end if;

  select * into v_doc from public.warehouse_documents where id = v_line.document_id;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  if v_doc.status::text = 'draft' then
    v_tx_id := v_line.tx_id;
    update public.warehouse_document_lines set tx_id = null where id = p_line_id;
    delete from public.warehouse_document_lines where id = p_line_id;
    if v_tx_id is not null then
      delete from public.warehouse_transactions where id = v_tx_id;
    end if;
  else
    -- For final docs, use correcting transaction instead of destructive delete.
    v_tx_type := case when v_doc.type::text = 'out' then 'receipt'::public.warehouse_transaction_type else 'issue'::public.warehouse_transaction_type end;
    insert into public.warehouse_transactions (item_id, transaction_type, quantity, document_id, created_by, note)
    values (v_line.item_id, v_tx_type, v_line.quantity, v_doc.id, auth.uid(), 'count_correction: حذف ردیف سند نهایی');
    update public.warehouse_document_lines set removed_at = now() where id = p_line_id;
  end if;
end;
$$;

create or replace function public.fn_cancel_warehouse_document(
  p_document_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.warehouse_documents%rowtype;
  v_line record;
  v_tx_type public.warehouse_transaction_type;
begin
  select * into v_doc from public.warehouse_documents where id = p_document_id for update;
  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  if v_doc.status::text = 'draft' then
    perform public.fn_cancel_draft_document(p_document_id);
    return p_document_id;
  end if;

  if v_doc.status::text = 'cancelled' then
    return p_document_id;
  end if;

  if v_doc.status::text <> 'final' then
    raise exception 'فقط سند نهایی یا موقت قابل حذف/لغو است';
  end if;

  for v_line in
    select * from public.warehouse_document_lines
    where document_id = p_document_id and removed_at is null
  loop
    v_tx_type := case when v_doc.type::text = 'out' then 'receipt'::public.warehouse_transaction_type else 'issue'::public.warehouse_transaction_type end;
    insert into public.warehouse_transactions (item_id, transaction_type, quantity, document_id, created_by, note)
    values (
      v_line.item_id,
      v_tx_type,
      v_line.quantity,
      p_document_id,
      auth.uid(),
      'cancel_document: برگشت اثر سند ' || coalesce(v_doc.doc_number, p_document_id::text) || coalesce(' - ' || p_reason, '')
    );
  end loop;

  update public.warehouse_documents
  set status = 'cancelled'::public.warehouse_document_status,
      cancelled_at = now(),
      note = concat_ws(E'\n', note, 'حذف/لغو سند: ' || coalesce(p_reason, 'بدون شرح')),
      updated_at = now()
  where id = p_document_id;

  return p_document_id;
end;
$$;

create or replace function public.fn_reactivate_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['admin','warehouse']) then raise exception 'دسترسی ندارید'; end if;
  update public.warehouse_items set is_active = true where id = p_item_id;
end;
$$;

grant execute on function public.fn_update_warehouse_document_meta(uuid,text,text,text) to authenticated;
grant execute on function public.fn_cancel_draft_document(uuid) to authenticated;
grant execute on function public.fn_remove_document_line(uuid) to authenticated;
grant execute on function public.fn_cancel_warehouse_document(uuid,text) to authenticated;
grant execute on function public.fn_reactivate_item(uuid) to authenticated;

notify pgrst, 'reload schema';
