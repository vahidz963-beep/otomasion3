-- =====================================================================
-- 029_FINANCE_DOCUMENT_SUMMARY_CONVERTED_FROM
-- Adds converted_from_document_id to finance summary for UI separation of proformas/invoices.
-- IMPORTANT: In PostgreSQL CREATE OR REPLACE VIEW cannot insert a column in the
-- middle of an existing view. Therefore original column order is preserved and
-- converted_from_document_id is appended at the end.
-- =====================================================================

create or replace view public.v_finance_document_summary
with (security_invoker = true)
as
select
  d.id,
  d.doc_number,
  d.document_type,
  d.status,
  d.issue_date,
  d.due_date,
  d.party_id,
  p.display_name as party_name,
  p.party_type,
  d.related_order_id,
  o.order_code,
  d.source_module,
  d.subtotal_amount,
  d.discount_amount,
  d.tax_amount,
  d.total_amount,
  d.paid_amount,
  d.balance_amount,
  case
    when d.due_date < current_date
      and d.balance_amount > 0
      and d.status in ('approved','sent','partially_paid')
    then true
    else false
  end as is_overdue,
  d.converted_from_document_id
from public.finance_documents d
left join public.finance_parties p on p.id = d.party_id
left join public.orders o on o.id = d.related_order_id;

grant select on public.v_finance_document_summary to authenticated;

notify pgrst, 'reload schema';
