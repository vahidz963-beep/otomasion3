-- =====================================================================
-- 050_FINANCE_EDIT_APPROVED_INVOICE_RESYNC
-- Allows safe correction of approved/posted finance documents from the UI.
-- After editing a confirmed invoice/document, old posted journal entries are
-- voided and a fresh journal entry is posted from the corrected document.
-- Warehouse issue documents for sales invoices are already re-issued by
-- fn_finance_reissue_inventory_for_document from migration 041.
-- =====================================================================

create or replace function public.fn_finance_repost_document_after_edit(
  p_document_id uuid,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_entry_id uuid;
  v_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی اصلاح سند حسابداری فاکتور ندارید';
  end if;

  select * into v_doc
  from public.finance_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'فاکتور/سند مالی یافت نشد';
  end if;

  if v_doc.document_type = 'sales_proforma' then
    return null;
  end if;

  if v_doc.status::text in ('draft','pending_approval','cancelled','void') then
    return null;
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'اصلاح فاکتور تأییدشده');

  -- Keep history but remove old posted entry from accounting effect.
  update public.finance_journal_entries
  set status = 'void'::public.finance_journal_status,
      description = concat_ws(E'\n', description, 'ابطال و جایگزینی خودکار به دلیل اصلاح فاکتور: ' || v_reason),
      updated_at = now()
  where related_document_id = p_document_id
    and status = 'posted'::public.finance_journal_status;

  -- Repost from current, recalculated document totals/items.
  v_entry_id := public.fn_post_finance_document(p_document_id);

  perform public.fn_log_finance_document_event(
    p_document_id,
    'note',
    'سند حسابداری فاکتور بعد از اصلاح، باطل و مجدداً ثبت شد: ' || v_reason,
    v_doc.status,
    v_doc.status,
    jsonb_build_object('replacement_journal_entry_id', v_entry_id, 'reason', v_reason)
  );

  return v_entry_id;
end;
$$;

grant execute on function public.fn_finance_repost_document_after_edit(uuid,text) to authenticated;

notify pgrst, 'reload schema';
