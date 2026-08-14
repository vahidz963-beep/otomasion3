-- =====================================================================
-- 028_FINANCE_TREASURY_CHECKS_INVESTMENTS
-- Finance/accounting final workflow additions:
-- - Investments registry
-- - Treasury ledger view for bank/cash movements
-- - Check settlement RPC: clearing a check creates/links a payment and posts it
-- - Active document views for UI separation of proformas/invoices
-- =====================================================================

create table if not exists public.finance_investments (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null default 'other' check (asset_type in ('gold','silver','land','currency','equipment','stock','other')),
  title_fa text not null,
  acquisition_date date not null default current_date,
  quantity numeric not null default 1,
  unit text not null default 'عدد',
  purchase_amount numeric not null default 0,
  current_estimated_value numeric not null default 0,
  location text,
  notes text,
  status text not null default 'active' check (status in ('active','sold','archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_finance_investments_updated_at on public.finance_investments;
create trigger trg_finance_investments_updated_at
before update on public.finance_investments
for each row execute function public.set_updated_at();

create or replace view public.v_finance_account_turnover
with (security_invoker = true)
as
select
  'bank'::text as account_kind,
  ba.id as account_id,
  ba.account_name,
  ba.bank_name,
  ba.account_number,
  ba.iban,
  ba.currency,
  ba.account_usage,
  ba.opening_balance,
  coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_receipts,
  coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_payments,
  ba.opening_balance
    + coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0)
    - coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as current_balance,
  max(p.payment_date) as last_movement_date
from public.finance_bank_accounts ba
left join public.finance_payments p on p.bank_account_id = ba.id
group by ba.id

union all

select
  'cashbox'::text as account_kind,
  cb.id as account_id,
  cb.name as account_name,
  'صندوق'::text as bank_name,
  null::text as account_number,
  null::text as iban,
  cb.currency,
  'cash'::text as account_usage,
  cb.opening_balance,
  coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_receipts,
  coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_payments,
  cb.opening_balance
    + coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0)
    - coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as current_balance,
  max(p.payment_date) as last_movement_date
from public.finance_cashboxes cb
left join public.finance_payments p on p.cashbox_id = cb.id
group by cb.id;

create or replace view public.v_finance_payment_ledger
with (security_invoker = true)
as
select
  p.id,
  p.payment_number,
  p.direction,
  p.method,
  p.status,
  p.party_id,
  fp.display_name as party_name,
  p.payment_date,
  p.amount,
  p.currency,
  case when p.bank_account_id is not null then 'bank' else 'cashbox' end as account_kind,
  coalesce(p.bank_account_id, p.cashbox_id) as account_id,
  coalesce(ba.account_name, cb.name) as account_name,
  coalesce(ba.bank_name, 'صندوق') as bank_name,
  p.related_order_id,
  o.order_code,
  p.source_module,
  p.source_record_id,
  p.description,
  p.created_at
from public.finance_payments p
left join public.finance_parties fp on fp.id = p.party_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
left join public.orders o on o.id = p.related_order_id;

create or replace view public.v_finance_active_documents
with (security_invoker = true)
as
select *
from public.v_finance_document_summary
where status <> 'void';

create or replace function public.fn_finance_settle_check(
  p_check_id uuid,
  p_bank_account_id uuid,
  p_status text default 'cleared',
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check public.finance_checks%rowtype;
  v_payment_id uuid;
  v_direction public.finance_payment_direction;
begin
  if not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی مالی ندارید';
  end if;

  select * into v_check from public.finance_checks where id = p_check_id for update;
  if not found then raise exception 'چک یافت نشد'; end if;

  if p_status not in ('deposited','cleared','returned','cancelled') then
    raise exception 'وضعیت چک نامعتبر است';
  end if;

  update public.finance_checks
  set status = p_status,
      updated_at = now()
  where id = p_check_id;

  -- When a check clears, create and post the actual bank movement if not already linked.
  if p_status = 'cleared' and v_check.related_payment_id is null then
    v_direction := case when v_check.check_type = 'received' then 'receipt'::public.finance_payment_direction else 'payment'::public.finance_payment_direction end;

    insert into public.finance_payments (
      payment_number,
      direction,
      method,
      status,
      party_id,
      payment_date,
      amount,
      currency,
      bank_account_id,
      description,
      source_module,
      source_record_id,
      created_by
    ) values (
      null,
      v_direction,
      'check',
      'draft',
      v_check.party_id,
      current_date,
      v_check.amount,
      'IRR',
      p_bank_account_id,
      coalesce(p_note, '') || ' وصول/تسویه چک ' || coalesce(v_check.check_number, v_check.internal_check_code, ''),
      'accounting',
      p_check_id,
      auth.uid()
    ) returning id into v_payment_id;

    update public.finance_checks
    set related_payment_id = v_payment_id
    where id = p_check_id;

    perform public.fn_post_finance_payment(v_payment_id);
  else
    v_payment_id := v_check.related_payment_id;
  end if;

  return coalesce(v_payment_id, p_check_id);
end;
$$;

alter table public.finance_investments enable row level security;

drop policy if exists finance_investments_select on public.finance_investments;
create policy finance_investments_select on public.finance_investments
for select using (public.has_role(array['admin','accountant']));

drop policy if exists finance_investments_write on public.finance_investments;
create policy finance_investments_write on public.finance_investments
for all using (public.has_role(array['admin','accountant']))
with check (public.has_role(array['admin','accountant']));

grant select, insert, update, delete on public.finance_investments to authenticated;
grant select on public.v_finance_account_turnover to authenticated;
grant select on public.v_finance_payment_ledger to authenticated;
grant select on public.v_finance_active_documents to authenticated;
grant execute on function public.fn_finance_settle_check(uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
