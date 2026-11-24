-- 153: loan payment flow — connected, auditable, deletable.
-- (1) No-document installment allocations (payment_id IS NULL) become safely voidable.
-- (2) Loan installment view exposes the linked payment status (void badge support).
-- (3) Cashflow ledger carries the posted journal entry number/id of every payment,
--     so the voucher of each payment is visible and clickable with its lines.

create or replace function public.fn_finance_void_loan_installment_allocation(
  p_installment_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_loan uuid;
  v_restored numeric := 0;
begin
  if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی حذف پرداخت قسط ندارید'; end if;
  select * into v_row from public.finance_loan_installments where id = p_installment_id for update;
  if not found then raise exception 'قسط یافت نشد'; end if;
  if v_row.payment_id is not null then
    raise exception 'این قسط به سند پرداخت مشترک متصل است؛ از مسیر حذف سند پرداخت استفاده کنید';
  end if;
  if coalesce(v_row.paid_amount, 0) <= 0 then
    raise exception 'برای این قسط پرداختی ثبت نشده است';
  end if;
  v_restored := coalesce(v_row.paid_amount, 0);
  v_loan := v_row.loan_id;
  update public.finance_loan_installments
  set paid_amount = 0,
      paid_at = null,
      status = case when due_date < current_date then 'overdue' else 'pending' end,
      notes = concat_ws(E'\n', notes, 'حذف پرداخت بدون سند: ' || coalesce(p_reason, 'ابطال توسط کاربر')),
      updated_at = now()
  where id = p_installment_id;
  update public.finance_loans
  set status = 'active', updated_at = now()
  where id = v_loan and status = 'closed'
    and exists (select 1 from public.finance_loan_installments i where i.loan_id = v_loan and i.status not in ('paid','cancelled'));
  return jsonb_build_object('installment_id', p_installment_id, 'restored_amount', v_restored, 'loan_id', v_loan);
end;
$$;
grant execute on function public.fn_finance_void_loan_installment_allocation(uuid, text) to authenticated;

-- installment view: add linked payment status (void/cancelled badge support)
drop view if exists public.v_finance_loan_installments;
create view public.v_finance_loan_installments
with (security_invoker = true)
as
select
  i.id,
  i.loan_id,
  l.loan_number,
  l.title_fa as loan_title,
  l.lender_name,
  l.bank_name,
  i.installment_no,
  i.due_date,
  i.principal_amount,
  i.interest_amount,
  i.fee_amount,
  i.amount_due,
  i.paid_amount,
  i.paid_at,
  i.payment_id,
  p.payment_number,
  p.payment_date,
  p.description as payment_description,
  p.status as payment_status,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'cancelled' then 'cancelled'
    when i.due_date < current_date then 'overdue'
    else i.status
  end as status,
  i.notes,
  i.created_at,
  i.updated_at
from public.finance_loan_installments i
join public.finance_loans l on l.id = i.loan_id
left join public.finance_payments p on p.id = i.payment_id;

-- cashflow ledger: expose the posted journal entry of each payment (clickable voucher).
-- Built on top of the migration-136 contract (direct-expense offsets stay excluded,
-- bank/cashbox names kept, zero-effect history rows visible) with two appended
-- voucher columns delivered via a 1:1 lateral join (no row multiplication).
drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger with (security_invoker = true) as
select
  p.id,
  p.payment_number,
  p.payment_date,
  p.direction,
  p.method,
  p.status,
  p.party_id,
  fp.display_name as party_name,
  p.amount,
  p.currency,
  p.bank_account_id,
  ba.account_name as bank_account_name,
  p.cashbox_id,
  cb.name as cashbox_name,
  p.transfer_to_bank_account_id,
  dest.account_name as transfer_to_account_name,
  p.related_order_id,
  o.order_code,
  p.description,
  p.source_module,
  p.source_record_id,
  p.created_at,
  case when p.bank_account_id is not null then 'bank'
       when p.cashbox_id is not null then 'cashbox'
       else 'unassigned' end as account_kind,
  coalesce(p.bank_account_id, p.cashbox_id) as account_id,
  case when p.bank_account_id is not null then ba.account_name
       when p.cashbox_id is not null then cb.name
       else 'بدون حساب' end as account_name,
  case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end as receipt_amount,
  case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end as payment_amount,
  case when p.status <> 'confirmed' then 0
       when p.direction = 'receipt' then p.amount
       when p.direction = 'payment' then -p.amount
       else 0 end as signed_amount,
  sum(case when p.status <> 'confirmed' then 0
           when p.direction = 'receipt' then p.amount
           when p.direction = 'payment' then -p.amount
           else 0 end)
    over(partition by coalesce(p.bank_account_id, p.cashbox_id)
         order by p.payment_date, p.created_at, p.id rows unbounded preceding) as running_balance,
  case when p.bank_account_id is not null then coalesce(ba.bank_name, 'بانک')
       when p.cashbox_id is not null then 'صندوق'
       else 'بدون حساب' end as bank_name,
  je.journal_entry_id,
  je.journal_entry_number
from public.finance_payments p
left join public.finance_parties fp on fp.id = p.party_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
left join public.finance_bank_accounts dest on dest.id = p.transfer_to_bank_account_id
left join public.orders o on o.id = p.related_order_id
left join lateral (
  select e.id as journal_entry_id, e.entry_number as journal_entry_number
  from public.finance_journal_entries e
  where e.related_payment_id = p.id and e.status = 'posted'
  order by e.created_at desc
  limit 1
) je on true
where p.method <> 'direct_expense_offset';

grant select on public.v_finance_payment_ledger to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v_finance_payment_ledger'
      and column_name in ('bank_name','journal_entry_id','journal_entry_number')
  ) or (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'v_finance_payment_ledger'
          and column_name in ('bank_name','journal_entry_id','journal_entry_number')) <> 3
  then
    raise exception 'v_finance_payment_ledger voucher contract is missing';
  end if;
end;
$$;

notify pgrst, 'reload schema';
