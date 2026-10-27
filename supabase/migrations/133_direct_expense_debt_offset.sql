-- =====================================================================
-- 133_DIRECT_EXPENSE_DEBT_OFFSET
-- تسویه غیرنقدی بدهی شخص با پرداخت مستقیم هزینه‌های شرکت
-- Depends on migration 132 for the committed payment-method enum value.
-- =====================================================================

begin;

create sequence if not exists public.finance_direct_expense_offset_seq;

create table if not exists public.finance_direct_expense_offsets (
  id uuid primary key default gen_random_uuid(),
  settlement_number text not null unique,
  status text not null default 'posted'
    check (status in ('posted', 'void')),
  party_id uuid not null references public.finance_parties(id),
  settlement_date date not null default current_date,
  total_amount numeric(18,2) not null check (total_amount > 0),
  description text,
  related_document_id uuid references public.finance_documents(id),
  related_order_id uuid references public.orders(id),
  payment_id uuid unique references public.finance_payments(id),
  journal_entry_id uuid unique references public.finance_journal_entries(id),
  idempotency_key text not null unique,
  linked_document_status_before text,
  linked_document_paid_amount_before numeric(18,2),
  replaces_settlement_id uuid references public.finance_direct_expense_offsets(id),
  replaced_by_settlement_id uuid references public.finance_direct_expense_offsets(id),
  revision_reason text,
  void_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (replaces_settlement_id is null or replaces_settlement_id <> id),
  check (replaced_by_settlement_id is null or replaced_by_settlement_id <> id)
);

create table if not exists public.finance_direct_expense_offset_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.finance_direct_expense_offsets(id),
  line_no integer not null check (line_no > 0),
  category_id uuid not null references public.finance_income_expense_categories(id),
  expense_account_id uuid not null references public.finance_accounts(id),
  amount numeric(18,2) not null check (amount > 0),
  description text,
  created_at timestamptz not null default now(),
  unique (settlement_id, line_no)
);

create index if not exists idx_direct_expense_offsets_party_date
  on public.finance_direct_expense_offsets(party_id, settlement_date desc);
create index if not exists idx_direct_expense_offsets_document
  on public.finance_direct_expense_offsets(related_document_id)
  where related_document_id is not null;
create index if not exists idx_direct_expense_offsets_order
  on public.finance_direct_expense_offsets(related_order_id)
  where related_order_id is not null;
create index if not exists idx_direct_expense_offsets_status
  on public.finance_direct_expense_offsets(status, settlement_date desc);
create index if not exists idx_direct_expense_offset_lines_parent
  on public.finance_direct_expense_offset_lines(settlement_id, line_no);
create index if not exists idx_direct_expense_offset_lines_category
  on public.finance_direct_expense_offset_lines(category_id);

-- A linked invoice cannot be voided, moved to another party/order, or reduced
-- below its paid amount while an active direct settlement depends on it.
create or replace function public.fn_protect_document_with_direct_expense_offset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.finance_direct_expense_offsets s
    where s.related_document_id = old.id
      and s.status = 'posted'
  ) then
    if new.status::text = 'void' and old.status::text <> 'void' then
      raise exception 'پیش از ابطال فاکتور، تسویه مستقیم هزینه مرتبط را ابطال کنید';
    end if;
    if new.party_id is distinct from old.party_id then
      raise exception 'تغییر شخص فاکتور دارای تسویه مستقیم هزینه مجاز نیست؛ ابتدا تسویه مرتبط را ابطال کنید';
    end if;
    if new.related_order_id is distinct from old.related_order_id then
      raise exception 'تغییر سفارش فاکتور دارای تسویه مستقیم هزینه مجاز نیست؛ ابتدا تسویه مرتبط را ابطال کنید';
    end if;
    if coalesce(new.total_amount, 0) < coalesce(new.paid_amount, 0) then
      raise exception 'مبلغ فاکتور نمی‌تواند از مبلغ تسویه‌شده کمتر شود';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_document_with_direct_expense_offset
  on public.finance_documents;
create trigger trg_protect_document_with_direct_expense_offset
before update of status, party_id, related_order_id, total_amount, paid_amount
on public.finance_documents
for each row execute function public.fn_protect_document_with_direct_expense_offset();

alter table public.finance_direct_expense_offsets enable row level security;
alter table public.finance_direct_expense_offset_lines enable row level security;

drop policy if exists direct_expense_offsets_select on public.finance_direct_expense_offsets;
create policy direct_expense_offsets_select
on public.finance_direct_expense_offsets
for select
to authenticated
using (public.has_role(array['admin','accountant']));

drop policy if exists direct_expense_offset_lines_select on public.finance_direct_expense_offset_lines;
create policy direct_expense_offset_lines_select
on public.finance_direct_expense_offset_lines
for select
to authenticated
using (public.has_role(array['admin','accountant']));

-- Direct writes are deliberately not granted. Every write must pass through the
-- atomic RPCs below so line totals, party credit and the journal cannot diverge.
revoke insert, update, delete, truncate
  on public.finance_direct_expense_offsets,
     public.finance_direct_expense_offset_lines
  from authenticated, anon;
grant select
  on public.finance_direct_expense_offsets,
     public.finance_direct_expense_offset_lines
  to authenticated;

create or replace function public.fn_prevent_direct_expense_offset_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'حذف فیزیکی سند تسویه مستقیم هزینه مجاز نیست؛ از ابطال امن استفاده کنید';
end;
$$;

drop trigger if exists trg_prevent_direct_expense_offset_delete
  on public.finance_direct_expense_offsets;
create trigger trg_prevent_direct_expense_offset_delete
before delete on public.finance_direct_expense_offsets
for each row execute function public.fn_prevent_direct_expense_offset_delete();

drop trigger if exists trg_prevent_direct_expense_offset_line_delete
  on public.finance_direct_expense_offset_lines;
create trigger trg_prevent_direct_expense_offset_line_delete
before delete on public.finance_direct_expense_offset_lines
for each row execute function public.fn_prevent_direct_expense_offset_delete();

-- Underlying payment/allocation/journal rows are immutable outside the dedicated
-- RPCs. This prevents a generic payment edit from adding a bank account, changing
-- the amount, or voiding only one side of the audited document.
create or replace function public.fn_guard_direct_expense_financial_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_direct boolean := false;
  v_payment_id uuid;
  v_entry_id uuid;
begin
  if tg_table_name = 'finance_payments' then
    v_is_direct := coalesce(old.method::text = 'direct_expense_offset', false)
      or coalesce(new.method::text = 'direct_expense_offset', false);
  elsif tg_table_name = 'finance_payment_allocations' then
    v_payment_id := coalesce(new.payment_id, old.payment_id);
    select p.method::text = 'direct_expense_offset'
    into v_is_direct
    from public.finance_payments p
    where p.id = v_payment_id;
  elsif tg_table_name = 'finance_journal_entries' then
    v_payment_id := coalesce(new.related_payment_id, old.related_payment_id);
    select p.method::text = 'direct_expense_offset'
    into v_is_direct
    from public.finance_payments p
    where p.id = v_payment_id;
  elsif tg_table_name = 'finance_journal_lines' then
    v_entry_id := coalesce(new.entry_id, old.entry_id);
    select p.method::text = 'direct_expense_offset'
    into v_is_direct
    from public.finance_journal_entries je
    join public.finance_payments p on p.id = je.related_payment_id
    where je.id = v_entry_id;
  end if;

  if coalesce(v_is_direct, false)
     and coalesce(current_setting('app.direct_expense_internal', true), '') <> '1' then
    raise exception 'تغییر مستقیم اجزای مالی تسویه هزینه مجاز نیست؛ از RPC اختصاصی اصلاح یا ابطال استفاده کنید';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_direct_expense_payment on public.finance_payments;
create trigger trg_guard_direct_expense_payment
before insert or update or delete on public.finance_payments
for each row execute function public.fn_guard_direct_expense_financial_rows();

drop trigger if exists trg_guard_direct_expense_allocation on public.finance_payment_allocations;
create trigger trg_guard_direct_expense_allocation
before insert or update or delete on public.finance_payment_allocations
for each row execute function public.fn_guard_direct_expense_financial_rows();

drop trigger if exists trg_guard_direct_expense_journal_entry on public.finance_journal_entries;
create trigger trg_guard_direct_expense_journal_entry
before insert or update or delete on public.finance_journal_entries
for each row execute function public.fn_guard_direct_expense_financial_rows();

drop trigger if exists trg_guard_direct_expense_journal_line on public.finance_journal_lines;
create trigger trg_guard_direct_expense_journal_line
before insert or update or delete on public.finance_journal_lines
for each row execute function public.fn_guard_direct_expense_financial_rows();

-- A deferred database invariant makes a parent/line amount mismatch impossible,
-- even for privileged maintenance writes. It is checked at transaction commit,
-- after the atomic RPC has inserted all rows.
create or replace function public.fn_assert_direct_expense_offset_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_header_total numeric(18,2);
  v_line_total numeric(18,2);
begin
  if tg_table_name = 'finance_direct_expense_offsets' then
    v_settlement_id := coalesce(new.id, old.id);
  else
    v_settlement_id := coalesce(new.settlement_id, old.settlement_id);
  end if;

  select total_amount
  into v_header_total
  from public.finance_direct_expense_offsets
  where id = v_settlement_id;

  if not found then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0)
  into v_line_total
  from public.finance_direct_expense_offset_lines
  where settlement_id = v_settlement_id;

  if round(coalesce(v_header_total, 0), 2) <> round(coalesce(v_line_total, 0), 2) then
    raise exception 'مبلغ سند تسویه مستقیم (%) با جمع ردیف‌های هزینه (%) برابر نیست', v_header_total, v_line_total;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists ctr_direct_expense_offset_header_total
  on public.finance_direct_expense_offsets;
create constraint trigger ctr_direct_expense_offset_header_total
after insert or update of total_amount on public.finance_direct_expense_offsets
deferrable initially deferred
for each row execute function public.fn_assert_direct_expense_offset_total();

drop trigger if exists ctr_direct_expense_offset_line_total
  on public.finance_direct_expense_offset_lines;
create constraint trigger ctr_direct_expense_offset_line_total
after insert or update of amount or delete on public.finance_direct_expense_offset_lines
deferrable initially deferred
for each row execute function public.fn_assert_direct_expense_offset_total();

create or replace function public.fn_create_direct_expense_offset(
  p_party_id uuid,
  p_settlement_date date,
  p_lines jsonb,
  p_description text default null,
  p_related_document_id uuid default null,
  p_related_order_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.finance_direct_expense_offsets%rowtype;
  v_settlement_id uuid := gen_random_uuid();
  v_settlement_number text;
  v_payment_id uuid;
  v_journal_id uuid;
  v_receivable_account_id uuid;
  v_fallback_expense_account_id uuid;
  v_expense_account_id uuid;
  v_expense_account_type text;
  v_category_id uuid;
  v_category_type text;
  v_category_active boolean;
  v_line jsonb;
  v_line_no integer;
  v_line_count integer;
  v_line_amount numeric(18,2);
  v_total numeric(18,2) := 0;
  v_party_balance numeric(18,2) := 0;
  v_document_party_id uuid;
  v_document_order_id uuid;
  v_document_balance numeric(18,2);
  v_document_status text;
  v_document_paid numeric(18,2);
  v_resolved_order_id uuid := p_related_order_id;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت تسویه مستقیم هزینه را ندارید';
  end if;

  if p_party_id is null then
    raise exception 'انتخاب شخص بدهکار الزامی است';
  end if;

  if p_settlement_date is null then
    raise exception 'تاریخ تسویه الزامی است';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'کلید یکتای ثبت سند الزامی است';
  end if;

  select *
  into v_existing
  from public.finance_direct_expense_offsets
  where idempotency_key = btrim(p_idempotency_key);

  if found then
    return jsonb_build_object(
      'settlement_id', v_existing.id,
      'settlement_number', v_existing.settlement_number,
      'payment_id', v_existing.payment_id,
      'journal_entry_id', v_existing.journal_entry_id,
      'total_amount', v_existing.total_amount,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  -- Serialise debt checks for the selected party.
  perform 1
  from public.finance_parties
  where id = p_party_id and coalesce(is_active, true)
  for update;
  if not found then
    raise exception 'شخص انتخاب‌شده معتبر یا فعال نیست';
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'ردیف‌های هزینه باید به صورت آرایه ارسال شوند';
  end if;

  v_line_count := jsonb_array_length(p_lines);
  if v_line_count < 1 then
    raise exception 'حداقل یک ردیف هزینه الزامی است';
  end if;
  if v_line_count > 100 then
    raise exception 'حداکثر ۱۰۰ ردیف هزینه در هر سند مجاز است';
  end if;

  -- Validate every line and derive the only authoritative total.
  for v_line, v_line_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    begin
      v_category_id := nullif(v_line->>'category_id', '')::uuid;
      v_line_amount := round((v_line->>'amount')::numeric, 2);
    exception when others then
      raise exception 'اطلاعات ردیف هزینه شماره % معتبر نیست', v_line_no;
    end;

    if v_category_id is null then
      raise exception 'دسته هزینه ردیف شماره % الزامی است', v_line_no;
    end if;
    if v_line_amount is null or v_line_amount <= 0 then
      raise exception 'مبلغ ردیف هزینه شماره % باید بزرگ‌تر از صفر باشد', v_line_no;
    end if;

    select c.category_type, c.is_active
    into v_category_type, v_category_active
    from public.finance_income_expense_categories c
    where c.id = v_category_id;

    if not found or v_category_type <> 'expense' or not coalesce(v_category_active, false) then
      raise exception 'دسته ردیف شماره % باید یک دسته هزینه فعال باشد', v_line_no;
    end if;

    v_total := v_total + v_line_amount;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 then
    raise exception 'جمع هزینه‌ها باید بزرگ‌تر از صفر باشد';
  end if;

  select coalesce(balance, 0)
  into v_party_balance
  from public.v_party_balances
  where party_id = p_party_id;
  v_party_balance := coalesce(v_party_balance, 0);

  if v_party_balance <= 0 then
    raise exception 'شخص انتخاب‌شده در حال حاضر مانده بدهکار ندارد';
  end if;
  if v_total > v_party_balance then
    raise exception 'جمع هزینه‌ها (%) از مانده بدهکار شخص (%) بیشتر است', v_total, v_party_balance;
  end if;

  if p_related_document_id is not null then
    select d.party_id,
           d.related_order_id,
           d.balance_amount,
           d.status::text,
           d.paid_amount
    into v_document_party_id,
         v_document_order_id,
         v_document_balance,
         v_document_status,
         v_document_paid
    from public.finance_documents d
    where d.id = p_related_document_id
      and d.document_type in ('sales_invoice','debit_note','purchase_return')
      and d.status not in ('draft','pending_approval','cancelled','void')
    for update;

    if not found then
      raise exception 'فاکتور مرتبط برای این نوع تسویه معتبر نیست';
    end if;
    if v_document_party_id is distinct from p_party_id then
      raise exception 'فاکتور مرتبط متعلق به شخص انتخاب‌شده نیست';
    end if;
    if coalesce(v_document_balance, 0) <= 0 or v_total > v_document_balance then
      raise exception 'جمع هزینه‌ها از مانده قابل تخصیص فاکتور بیشتر است';
    end if;

    if v_resolved_order_id is null then
      v_resolved_order_id := v_document_order_id;
    elsif v_document_order_id is not null and v_resolved_order_id <> v_document_order_id then
      raise exception 'سفارش انتخاب‌شده با فاکتور مرتبط یکسان نیست';
    end if;
  end if;

  if v_resolved_order_id is not null
     and not exists (select 1 from public.orders where id = v_resolved_order_id) then
    raise exception 'سفارش مرتبط معتبر نیست';
  end if;

  v_receivable_account_id := public.fn_finance_account_id('1100');
  v_fallback_expense_account_id := public.fn_finance_account_id('6000');
  if v_receivable_account_id is null or v_fallback_expense_account_id is null then
    raise exception 'حساب‌های سیستمی 1100 یا 6000 پیکربندی نشده‌اند';
  end if;

  v_settlement_number := 'DX-'
    || to_char(p_settlement_date, 'YYYYMM') || '-'
    || lpad(nextval('public.finance_direct_expense_offset_seq')::text, 6, '0');

  perform set_config('app.direct_expense_internal', '1', true);

  insert into public.finance_direct_expense_offsets (
    id,
    settlement_number,
    status,
    party_id,
    settlement_date,
    total_amount,
    description,
    related_document_id,
    related_order_id,
    idempotency_key,
    linked_document_status_before,
    linked_document_paid_amount_before,
    created_by
  ) values (
    v_settlement_id,
    v_settlement_number,
    'posted',
    p_party_id,
    p_settlement_date,
    v_total,
    v_description,
    p_related_document_id,
    v_resolved_order_id,
    btrim(p_idempotency_key),
    v_document_status,
    v_document_paid,
    auth.uid()
  );

  for v_line, v_line_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    v_category_id := (v_line->>'category_id')::uuid;
    v_line_amount := round((v_line->>'amount')::numeric, 2);

    select coalesce(c.default_account_id, v_fallback_expense_account_id)
    into v_expense_account_id
    from public.finance_income_expense_categories c
    where c.id = v_category_id;

    select a.account_type::text
    into v_expense_account_type
    from public.finance_accounts a
    where a.id = v_expense_account_id and a.is_active;

    if v_expense_account_type not in ('expense','cost_of_goods_sold') then
      raise exception 'حساب پیش‌فرض دسته هزینه ردیف شماره % یک حساب هزینه معتبر نیست', v_line_no;
    end if;

    insert into public.finance_direct_expense_offset_lines (
      settlement_id,
      line_no,
      category_id,
      expense_account_id,
      amount,
      description
    ) values (
      v_settlement_id,
      v_line_no,
      v_category_id,
      v_expense_account_id,
      v_line_amount,
      nullif(btrim(coalesce(v_line->>'description', '')), '')
    );
  end loop;

  -- This finance_payment is intentionally non-cash: both treasury references
  -- are NULL and the method is explicitly excluded from treasury views below.
  insert into public.finance_payments (
    direction,
    method,
    status,
    party_id,
    amount,
    currency,
    payment_date,
    bank_account_id,
    cashbox_id,
    description,
    related_order_id,
    source_module,
    source_record_id,
    created_by
  ) values (
    'receipt',
    'direct_expense_offset',
    'confirmed',
    p_party_id,
    v_total,
    'IRR',
    p_settlement_date,
    null,
    null,
    coalesce(v_description, 'تسویه غیرنقدی بدهی با پرداخت مستقیم هزینه'),
    v_resolved_order_id,
    'accounting',
    v_settlement_id,
    auth.uid()
  ) returning id into v_payment_id;

  if p_related_document_id is not null then
    insert into public.finance_payment_allocations(payment_id, document_id, amount)
    values (v_payment_id, p_related_document_id, v_total);
  end if;

  insert into public.finance_journal_entries (
    entry_number,
    status,
    entry_date,
    description,
    source_module,
    source_id,
    related_document_id,
    related_payment_id,
    created_by,
    posted_by,
    posted_at
  ) values (
    null,
    'posted',
    p_settlement_date,
    coalesce(v_description, 'تسویه غیرنقدی بدهی با پرداخت مستقیم هزینه')
      || ' - ' || v_settlement_number,
    'accounting',
    v_settlement_id,
    p_related_document_id,
    v_payment_id,
    auth.uid(),
    auth.uid(),
    now()
  ) returning id into v_journal_id;

  insert into public.finance_journal_lines (
    entry_id,
    account_id,
    party_id,
    debit_amount,
    credit_amount,
    description,
    related_order_id
  )
  select
    v_journal_id,
    l.expense_account_id,
    null,
    l.amount,
    0,
    coalesce(l.description, c.name_fa, 'هزینه پرداخت‌شده مستقیم توسط شخص'),
    v_resolved_order_id
  from public.finance_direct_expense_offset_lines l
  join public.finance_income_expense_categories c on c.id = l.category_id
  where l.settlement_id = v_settlement_id
  order by l.line_no;

  insert into public.finance_journal_lines (
    entry_id,
    account_id,
    party_id,
    debit_amount,
    credit_amount,
    description,
    related_order_id
  ) values (
    v_journal_id,
    v_receivable_account_id,
    p_party_id,
    0,
    v_total,
    'کاهش بدهی شخص بابت پرداخت مستقیم هزینه‌های شرکت',
    v_resolved_order_id
  );

  if not public.fn_finance_assert_journal_balanced(v_journal_id) then
    raise exception 'سند حسابداری تسویه مستقیم هزینه تراز نیست';
  end if;

  update public.finance_direct_expense_offsets
  set payment_id = v_payment_id,
      journal_entry_id = v_journal_id,
      updated_at = now()
  where id = v_settlement_id;

  perform set_config('app.direct_expense_internal', '0', true);

  return jsonb_build_object(
    'settlement_id', v_settlement_id,
    'settlement_number', v_settlement_number,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total,
    'status', 'posted',
    'idempotent', false
  );
exception
  when unique_violation then
    perform set_config('app.direct_expense_internal', '0', true);
    select *
    into v_existing
    from public.finance_direct_expense_offsets
    where idempotency_key = btrim(p_idempotency_key);

    if found then
      return jsonb_build_object(
        'settlement_id', v_existing.id,
        'settlement_number', v_existing.settlement_number,
        'payment_id', v_existing.payment_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'total_amount', v_existing.total_amount,
        'status', v_existing.status,
        'idempotent', true
      );
    end if;
    raise;
end;
$$;

create or replace function public.fn_void_direct_expense_offset(
  p_settlement_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement public.finance_direct_expense_offsets%rowtype;
  v_document_paid numeric(18,2);
  v_document_total numeric(18,2);
  v_restored_status public.finance_document_status;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ابطال تسویه مستقیم هزینه را ندارید';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'ثبت دلیل ابطال الزامی است';
  end if;

  select *
  into v_settlement
  from public.finance_direct_expense_offsets
  where id = p_settlement_id
  for update;

  if not found then
    raise exception 'سند تسویه مستقیم هزینه یافت نشد';
  end if;

  if v_settlement.status = 'void' then
    return jsonb_build_object(
      'settlement_id', v_settlement.id,
      'settlement_number', v_settlement.settlement_number,
      'status', 'void',
      'idempotent', true
    );
  end if;

  perform set_config('app.direct_expense_internal', '1', true);

  update public.finance_payments
  set status = 'void',
      description = concat_ws(E'\n', description, 'ابطال تسویه مستقیم هزینه: ' || btrim(p_reason)),
      updated_at = now()
  where id = v_settlement.payment_id
    and method = 'direct_expense_offset';

  update public.finance_journal_entries
  set status = 'void',
      description = concat_ws(E'\n', description, 'ابطال: ' || btrim(p_reason)),
      updated_at = now()
  where id = v_settlement.journal_entry_id;

  if v_settlement.related_document_id is not null then
    perform public.fn_finance_update_document_paid_amount(v_settlement.related_document_id);

    select paid_amount, total_amount
    into v_document_paid, v_document_total
    from public.finance_documents
    where id = v_settlement.related_document_id
    for update;

    if coalesce(v_document_paid, 0) <= 0 then
      begin
        if v_settlement.linked_document_status_before in ('approved','sent') then
          v_restored_status := v_settlement.linked_document_status_before::public.finance_document_status;
        else
          v_restored_status := 'approved'::public.finance_document_status;
        end if;
      exception when others then
        v_restored_status := 'approved'::public.finance_document_status;
      end;
    elsif v_document_paid >= v_document_total then
      v_restored_status := 'paid'::public.finance_document_status;
    else
      v_restored_status := 'partially_paid'::public.finance_document_status;
    end if;

    update public.finance_documents
    set status = v_restored_status,
        updated_at = now()
    where id = v_settlement.related_document_id
      and status not in ('draft','pending_approval','cancelled','void');
  end if;

  update public.finance_direct_expense_offsets
  set status = 'void',
      void_reason = btrim(p_reason),
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = v_settlement.id;

  perform set_config('app.direct_expense_internal', '0', true);

  return jsonb_build_object(
    'settlement_id', v_settlement.id,
    'settlement_number', v_settlement.settlement_number,
    'payment_id', v_settlement.payment_id,
    'journal_entry_id', v_settlement.journal_entry_id,
    'status', 'void',
    'idempotent', false
  );
end;
$$;

create or replace function public.fn_revise_direct_expense_offset(
  p_settlement_id uuid,
  p_party_id uuid,
  p_settlement_date date,
  p_lines jsonb,
  p_reason text,
  p_description text default null,
  p_related_document_id uuid default null,
  p_related_order_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.finance_direct_expense_offsets%rowtype;
  v_created jsonb;
  v_new_id uuid;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی اصلاح تسویه مستقیم هزینه را ندارید';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'ثبت دلیل اصلاح الزامی است';
  end if;

  select *
  into v_old
  from public.finance_direct_expense_offsets
  where id = p_settlement_id
  for update;

  if not found then
    raise exception 'سند مبنا برای اصلاح یافت نشد';
  end if;

  if v_old.status = 'void' and v_old.replaced_by_settlement_id is not null then
    select jsonb_build_object(
      'settlement_id', n.id,
      'settlement_number', n.settlement_number,
      'payment_id', n.payment_id,
      'journal_entry_id', n.journal_entry_id,
      'total_amount', n.total_amount,
      'status', n.status,
      'replaces_settlement_id', v_old.id,
      'idempotent', true
    )
    into v_created
    from public.finance_direct_expense_offsets n
    where n.id = v_old.replaced_by_settlement_id;
    return v_created;
  elsif v_old.status = 'void' then
    raise exception 'سند باطل‌شده‌ای که نسخه جایگزین ندارد قابل اصلاح نیست';
  end if;

  perform public.fn_void_direct_expense_offset(
    v_old.id,
    'اصلاح نسخه‌دار: ' || btrim(p_reason)
  );

  v_created := public.fn_create_direct_expense_offset(
    p_party_id,
    p_settlement_date,
    p_lines,
    p_description,
    p_related_document_id,
    p_related_order_id,
    p_idempotency_key
  );
  v_new_id := (v_created->>'settlement_id')::uuid;

  if v_new_id is null or v_new_id = v_old.id then
    raise exception 'نسخه جایگزین معتبر ساخته نشد';
  end if;

  update public.finance_direct_expense_offsets
  set replaces_settlement_id = v_old.id,
      revision_reason = btrim(p_reason),
      updated_at = now()
  where id = v_new_id;

  update public.finance_direct_expense_offsets
  set replaced_by_settlement_id = v_new_id,
      updated_at = now()
  where id = v_old.id;

  return v_created || jsonb_build_object(
    'replaces_settlement_id', v_old.id,
    'revision_reason', btrim(p_reason),
    'idempotent', false
  );
end;
$$;

revoke all on function public.fn_create_direct_expense_offset(uuid,date,jsonb,text,uuid,uuid,text) from public;
revoke all on function public.fn_void_direct_expense_offset(uuid,text) from public;
revoke all on function public.fn_revise_direct_expense_offset(uuid,uuid,date,jsonb,text,text,uuid,uuid,text) from public;
grant execute on function public.fn_create_direct_expense_offset(uuid,date,jsonb,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.fn_void_direct_expense_offset(uuid,text) to authenticated, service_role;
grant execute on function public.fn_revise_direct_expense_offset(uuid,uuid,date,jsonb,text,text,uuid,uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Cash-flow views: direct expense offsets are explicitly non-cash.
-- Earlier installations may still have the pre-116 column order, so this
-- standalone reporting view is safely recreated instead of replaced in place.
-- ---------------------------------------------------------------------
drop view if exists public.v_finance_payment_ledger;
create view public.v_finance_payment_ledger
with (security_invoker = true)
as
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
  case when p.direction='receipt' and p.status='confirmed' then p.amount else 0 end as receipt_amount,
  case when p.direction='payment' and p.status='confirmed' then p.amount else 0 end as payment_amount,
  case when p.status <> 'confirmed' then 0
       when p.direction='receipt' then p.amount
       when p.direction='payment' then -p.amount
       else 0 end as signed_amount,
  sum(case when p.status <> 'confirmed' then 0
           when p.direction='receipt' then p.amount
           when p.direction='payment' then -p.amount
           else 0 end)
    over(partition by coalesce(p.bank_account_id,p.cashbox_id)
         order by p.payment_date,p.created_at,p.id rows unbounded preceding) as running_balance
from public.finance_payments p
left join public.finance_parties fp on fp.id=p.party_id
left join public.finance_bank_accounts ba on ba.id=p.bank_account_id
left join public.finance_cashboxes cb on cb.id=p.cashbox_id
left join public.finance_bank_accounts dest on dest.id=p.transfer_to_bank_account_id
left join public.orders o on o.id=p.related_order_id
where p.method <> 'direct_expense_offset';

grant select on public.v_finance_payment_ledger to authenticated;

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
  ba.account_usage::text as account_usage,
  ba.opening_balance,
  coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_receipts,
  coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as total_payments,
  ba.opening_balance
    + coalesce(sum(case when p.direction = 'receipt' and p.status = 'confirmed' then p.amount else 0 end), 0)
    - coalesce(sum(case when p.direction = 'payment' and p.status = 'confirmed' then p.amount else 0 end), 0) as current_balance,
  max(p.payment_date) as last_movement_date,
  ba.card_number,
  ba.branch_name,
  ba.account_holder_name,
  ba.notes,
  ba.is_active
from public.finance_bank_accounts ba
left join public.finance_payments p
  on p.bank_account_id = ba.id
 and p.method <> 'direct_expense_offset'
where ba.is_active is true
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
  max(p.payment_date) as last_movement_date,
  null::text as card_number,
  null::text as branch_name,
  null::text as account_holder_name,
  null::text as notes,
  cb.is_active
from public.finance_cashboxes cb
left join public.finance_payments p
  on p.cashbox_id = cb.id
 and p.method <> 'direct_expense_offset'
where cb.is_active is true
group by cb.id;

grant select on public.v_finance_account_turnover to authenticated;

-- ---------------------------------------------------------------------
-- Expense report: hide the parent payment and expose each expense line once.
-- ---------------------------------------------------------------------
create or replace view public.v_finance_income_expense_ledger
with (security_invoker = true)
as
select
  p.id,
  p.payment_number,
  p.direction,
  case when p.direction = 'receipt' then 'income' else 'expense' end as flow_type,
  p.method,
  p.status,
  p.party_id,
  fp.display_name as party_name,
  p.payment_date,
  p.amount,
  p.currency,
  p.bank_account_id,
  ba.account_name as bank_account_name,
  ba.bank_name,
  p.cashbox_id,
  cb.name as cashbox_name,
  p.category_id,
  c.category_type,
  c.name_fa as category_name_fa,
  pc.name_fa as parent_category_name_fa,
  p.category_note,
  p.description,
  p.source_module,
  p.source_record_id,
  p.related_order_id,
  o.order_code,
  p.created_at,
  null::uuid as direct_settlement_id,
  null::text as direct_settlement_number,
  null::integer as direct_line_no,
  null::uuid as journal_entry_id,
  false as is_non_cash,
  null::text as void_reason,
  null::text as revision_reason,
  null::uuid as replaces_settlement_id,
  null::uuid as replaced_by_settlement_id,
  p.id as payment_id,
  p.created_by,
  cp.full_name as created_by_name
from public.finance_payments p
left join public.finance_parties fp on fp.id = p.party_id
left join public.finance_bank_accounts ba on ba.id = p.bank_account_id
left join public.finance_cashboxes cb on cb.id = p.cashbox_id
left join public.finance_income_expense_categories c on c.id = p.category_id
left join public.finance_income_expense_categories pc on pc.id = c.parent_id
left join public.orders o on o.id = p.related_order_id
left join public.profiles cp on cp.id = p.created_by
where p.status <> 'void'
  and p.method <> 'direct_expense_offset'
  and (p.category_id is not null or p.source_module = 'accounting')

union all

select
  l.id,
  s.settlement_number as payment_number,
  'payment'::public.finance_payment_direction as direction,
  'expense'::text as flow_type,
  'direct_expense_offset'::public.finance_payment_method as method,
  'confirmed'::public.finance_payment_status as status,
  s.party_id,
  fp.display_name as party_name,
  s.settlement_date as payment_date,
  l.amount,
  'IRR'::text as currency,
  null::uuid as bank_account_id,
  'بدون گردش بانک/صندوق'::text as bank_account_name,
  'غیرنقدی'::text as bank_name,
  null::uuid as cashbox_id,
  null::text as cashbox_name,
  l.category_id,
  c.category_type,
  c.name_fa as category_name_fa,
  pc.name_fa as parent_category_name_fa,
  l.description as category_note,
  concat_ws(' — ', nullif(s.description, ''), nullif(l.description, '')) as description,
  'direct_expense_offset'::text as source_module,
  s.id as source_record_id,
  s.related_order_id,
  o.order_code,
  s.created_at,
  s.id as direct_settlement_id,
  s.settlement_number as direct_settlement_number,
  l.line_no as direct_line_no,
  s.journal_entry_id,
  true as is_non_cash,
  s.void_reason,
  s.revision_reason,
  s.replaces_settlement_id,
  s.replaced_by_settlement_id,
  s.payment_id,
  s.created_by,
  cp.full_name as created_by_name
from public.finance_direct_expense_offset_lines l
join public.finance_direct_expense_offsets s on s.id = l.settlement_id
join public.finance_income_expense_categories c on c.id = l.category_id
left join public.finance_income_expense_categories pc on pc.id = c.parent_id
left join public.finance_parties fp on fp.id = s.party_id
left join public.orders o on o.id = s.related_order_id
left join public.profiles cp on cp.id = s.created_by
where s.status = 'posted';

grant select on public.v_finance_income_expense_ledger to authenticated;

create or replace view public.v_finance_direct_expense_offset_details
with (security_invoker = true)
as
select
  s.id as settlement_id,
  s.settlement_number,
  s.status,
  s.party_id,
  fp.display_name as party_name,
  s.settlement_date,
  s.total_amount,
  s.description as settlement_description,
  s.related_document_id,
  d.doc_number as related_document_number,
  s.related_order_id,
  o.order_code,
  s.payment_id,
  p.payment_number,
  s.journal_entry_id,
  je.entry_number as journal_entry_number,
  s.replaces_settlement_id,
  prior.settlement_number as replaces_settlement_number,
  s.replaced_by_settlement_id,
  newer.settlement_number as replaced_by_settlement_number,
  s.revision_reason,
  s.void_reason,
  s.voided_by,
  vp.full_name as voided_by_name,
  s.voided_at,
  s.created_by,
  cp.full_name as created_by_name,
  s.created_at,
  s.updated_at,
  l.id as line_id,
  l.line_no,
  l.category_id,
  c.name_fa as category_name_fa,
  c.parent_id as parent_category_id,
  pc.name_fa as parent_category_name_fa,
  l.expense_account_id,
  a.code as expense_account_code,
  a.name_fa as expense_account_name_fa,
  l.amount as line_amount,
  l.description as line_description,
  true as is_non_cash
from public.finance_direct_expense_offsets s
join public.finance_direct_expense_offset_lines l on l.settlement_id = s.id
join public.finance_income_expense_categories c on c.id = l.category_id
left join public.finance_income_expense_categories pc on pc.id = c.parent_id
join public.finance_accounts a on a.id = l.expense_account_id
join public.finance_parties fp on fp.id = s.party_id
left join public.finance_documents d on d.id = s.related_document_id
left join public.orders o on o.id = s.related_order_id
left join public.finance_payments p on p.id = s.payment_id
left join public.finance_journal_entries je on je.id = s.journal_entry_id
left join public.finance_direct_expense_offsets prior on prior.id = s.replaces_settlement_id
left join public.finance_direct_expense_offsets newer on newer.id = s.replaced_by_settlement_id
left join public.profiles cp on cp.id = s.created_by
left join public.profiles vp on vp.id = s.voided_by;

grant select on public.v_finance_direct_expense_offset_details to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard: non-cash settlements are expenses, never cash receipts.
-- ---------------------------------------------------------------------
create or replace view public.v_finance_dashboard
with (security_invoker = true)
as
with payment_month as (
  select
    coalesce(sum(amount) filter (
      where direction = 'receipt'
        and status = 'confirmed'
        and method <> 'direct_expense_offset'
        and payment_date >= date_trunc('month', current_date)::date
    ), 0) as month_receipts,
    coalesce(sum(amount) filter (
      where direction = 'payment'
        and status = 'confirmed'
        and method <> 'direct_expense_offset'
        and payment_date >= date_trunc('month', current_date)::date
    ), 0) as month_payments
  from public.finance_payments
), document_month as (
  select
    coalesce(sum(total_amount) filter (where document_type = 'sales_invoice' and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_sales,
    coalesce(sum(total_amount) filter (where document_type in ('purchase_invoice','expense_invoice') and issue_date >= date_trunc('month', current_date)::date and status not in ('draft','cancelled','void')), 0) as month_doc_costs,
    coalesce(sum(balance_amount) filter (where document_type in ('sales_invoice','debit_note') and status in ('approved','sent','partially_paid')), 0) as receivable_total,
    coalesce(sum(balance_amount) filter (where document_type in ('purchase_invoice','expense_invoice','credit_note') and status in ('approved','sent','partially_paid')), 0) as payable_total,
    coalesce(sum(balance_amount) filter (where due_date < current_date and status in ('approved','sent','partially_paid')), 0) as overdue_total
  from public.finance_documents
), direct_month as (
  select coalesce(sum(total_amount) filter (
    where status = 'posted'
      and settlement_date >= date_trunc('month', current_date)::date
  ), 0) as month_direct_costs
  from public.finance_direct_expense_offsets
)
select
  dm.receivable_total,
  dm.payable_total,
  dm.overdue_total,
  dm.month_sales,
  (dm.month_doc_costs + pm.month_payments + dx.month_direct_costs) as month_costs,
  (dm.month_sales + pm.month_receipts)
    - (dm.month_doc_costs + pm.month_payments + dx.month_direct_costs) as month_profit,
  (select count(*) from public.automation_referrals r where r.target_module = 'accounting' and r.status in ('open','in_progress')) as open_accounting_referrals,
  pm.month_receipts,
  pm.month_payments,
  dm.month_doc_costs,
  dx.month_direct_costs
from document_month dm
cross join payment_month pm
cross join direct_month dx;

grant select on public.v_finance_dashboard to authenticated;

-- ---------------------------------------------------------------------
-- Order profitability: a linked direct expense is counted once per line.
-- ---------------------------------------------------------------------
create or replace view public.v_order_unified_costs
with (security_invoker = true)
as
select
  oc.related_order_id as order_id,
  'manual_finance_cost'::text as source_type,
  oc.id as source_id,
  oc.cost_type,
  oc.amount,
  oc.notes,
  oc.created_at
from public.finance_order_costs oc
where oc.related_order_id is not null

union all

select
  d.related_order_id as order_id,
  'finance_document_cost'::text as source_type,
  d.id as source_id,
  case
    when d.document_type = 'purchase_invoice' then 'purchase'
    when d.document_type = 'expense_invoice' then 'other'
    else 'document'
  end as cost_type,
  greatest(coalesce(d.subtotal_amount, 0) - coalesce(d.discount_amount, 0), 0) as amount,
  concat_ws(' - ', d.doc_number, case when d.document_type = 'purchase_invoice' then 'فاکتور خرید' when d.document_type = 'expense_invoice' then 'سند هزینه' else d.document_type::text end, nullif(d.description, '')) as notes,
  d.created_at
from public.finance_documents d
where d.related_order_id is not null
  and d.document_type in ('purchase_invoice','expense_invoice')
  and d.status not in ('draft','cancelled','void')

union all

select
  coalesce(b.related_order_id, po.source_order_id) as order_id,
  'production_bom'::text as source_type,
  b.id as source_id,
  'production'::text as cost_type,
  coalesce(b.total_estimated_cost, 0) as amount,
  'هزینه نهایی فرمول تولید: ' || b.product_name_fa as notes,
  b.updated_at as created_at
from public.production_boms b
left join public.production_orders po on po.id = b.related_production_order_id
where coalesce(b.related_order_id, po.source_order_id) is not null
  and b.status <> 'archived'

union all

select
  rp.source_order_id as order_id,
  'rnd_cost'::text as source_type,
  ci.id as source_id,
  ci.cost_type,
  coalesce(ci.total_cost, 0) as amount,
  ci.title_fa || coalesce(' - ' || ci.note, '') as notes,
  ci.created_at
from public.rnd_cost_items ci
join public.rnd_projects rp on rp.id = ci.rnd_project_id
where rp.source_order_id is not null

union all

select
  s.related_order_id as order_id,
  'direct_expense_offset'::text as source_type,
  l.id as source_id,
  case
    when c.code = 'EXP-SHIPPING' then 'shipping'
    when c.code = 'EXP-SALARY' then 'labor'
    else 'other'
  end::text as cost_type,
  l.amount,
  concat_ws(' - ', s.settlement_number, c.name_fa, nullif(l.description, '')) as notes,
  s.created_at
from public.finance_direct_expense_offset_lines l
join public.finance_direct_expense_offsets s on s.id = l.settlement_id
join public.finance_income_expense_categories c on c.id = l.category_id
where s.related_order_id is not null
  and s.status = 'posted';

grant select on public.v_order_unified_costs to authenticated;

create or replace view public.v_order_profitability
with (security_invoker = true)
as
with revenue_summary as (
  select
    related_order_id as order_id,
    coalesce(sum(subtotal_amount - discount_amount) filter (where document_type = 'sales_invoice' and status not in ('draft','cancelled','void')), 0) as revenue_before_tax,
    coalesce(sum(tax_amount) filter (where status not in ('draft','cancelled','void')), 0) as tax_total
  from public.finance_documents
  where related_order_id is not null
  group by related_order_id
), cost_summary as (
  select
    order_id,
    coalesce(sum(amount), 0) as cost_before_tax
  from public.v_order_unified_costs
  group by order_id
)
select
  o.id as order_id,
  o.order_code,
  o.title_fa,
  o.sales_path,
  c.company_name,
  coalesce(rs.revenue_before_tax, 0) as revenue_before_tax,
  coalesce(cs.cost_before_tax, 0) as cost_before_tax,
  coalesce(rs.tax_total, 0) as tax_total,
  coalesce(rs.revenue_before_tax, 0) - coalesce(cs.cost_before_tax, 0) as gross_profit,
  case
    when coalesce(rs.revenue_before_tax, 0) > 0
    then round((coalesce(rs.revenue_before_tax, 0) - coalesce(cs.cost_before_tax, 0)) / nullif(coalesce(rs.revenue_before_tax, 0), 0) * 100, 2)
    else null
  end as gross_margin_pct
from public.orders o
join public.customers c on c.id = o.customer_id
left join revenue_summary rs on rs.order_id = o.id
left join cost_summary cs on cs.order_id = o.id;

grant select on public.v_order_profitability to authenticated;

comment on table public.finance_direct_expense_offsets is
  'سربرگ تسویه غیرنقدی بدهی شخص بابت هزینه‌هایی که مستقیماً برای شرکت پرداخت کرده است';
comment on table public.finance_direct_expense_offset_lines is
  'ردیف‌های هزینه سند تسویه مستقیم؛ جمع ردیف‌ها منبع قطعی مبلغ تسویه است';
comment on column public.finance_direct_expense_offsets.total_amount is
  'فقط توسط RPC و از جمع ردیف‌های هزینه محاسبه می‌شود';
comment on column public.finance_direct_expense_offsets.idempotency_key is
  'کلید یکتا برای جلوگیری از ثبت تکراری سند در خطای شبکه یا چندکلیکی';

commit;

notify pgrst, 'reload schema';
