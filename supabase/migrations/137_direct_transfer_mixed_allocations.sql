-- =====================================================================
-- 137_DIRECT_TRANSFER_MIXED_ALLOCATIONS
-- Generalises the former direct-expense offset into «حواله مستقیم»:
-- one source party + an explicit received amount + mixed expense/person rows.
-- It remains entirely non-cash. No bank/cashbox reference or treasury movement
-- is created. Existing migration-133 documents remain valid expense-only rows.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Extend the audited line model without replacing historical records.
-- ---------------------------------------------------------------------
alter table public.finance_direct_expense_offset_lines
  add column if not exists line_type text;

update public.finance_direct_expense_offset_lines
set line_type = 'expense'
where line_type is null;

alter table public.finance_direct_expense_offset_lines
  alter column line_type set default 'expense',
  alter column line_type set not null,
  alter column category_id drop not null,
  alter column expense_account_id drop not null;

alter table public.finance_direct_expense_offset_lines
  add column if not exists target_party_id uuid references public.finance_parties(id),
  add column if not exists target_payment_id uuid references public.finance_payments(id);

create unique index if not exists uq_direct_transfer_line_target_payment
  on public.finance_direct_expense_offset_lines(target_payment_id)
  where target_payment_id is not null;
create index if not exists idx_direct_transfer_lines_target_party
  on public.finance_direct_expense_offset_lines(target_party_id)
  where target_party_id is not null;

alter table public.finance_direct_expense_offset_lines
  drop constraint if exists chk_direct_transfer_line_shape;
alter table public.finance_direct_expense_offset_lines
  add constraint chk_direct_transfer_line_shape check (
    (
      line_type = 'expense'
      and category_id is not null
      and expense_account_id is not null
      and target_party_id is null
      and target_payment_id is null
    )
    or
    (
      line_type = 'party_payment'
      and category_id is null
      and expense_account_id is null
      and target_party_id is not null
      and target_payment_id is not null
    )
  );

comment on table public.finance_direct_expense_offsets is
  'Audited direct-transfer headers (legacy physical name retained for compatibility).';
comment on column public.finance_direct_expense_offsets.party_id is
  'Source party from whom the non-cash amount is received.';
comment on column public.finance_direct_expense_offsets.total_amount is
  'Explicit received amount; must exactly equal all transfer line amounts.';
comment on column public.finance_direct_expense_offset_lines.line_type is
  'expense = company expense; party_payment = non-cash payment to another party.';

-- ---------------------------------------------------------------------
-- 2) Atomic create RPC. The browser never writes financial tables directly.
-- ---------------------------------------------------------------------
create or replace function public.fn_create_direct_transfer(
  p_source_party_id uuid,
  p_transfer_date date,
  p_received_amount numeric,
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
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text;
  v_source_payment_id uuid;
  v_target_payment_id uuid;
  v_journal_id uuid;
  v_receivable_account_id uuid;
  v_payable_account_id uuid;
  v_fallback_expense_account_id uuid;
  v_expense_account_id uuid;
  v_expense_account_type text;
  v_category_id uuid;
  v_category_type text;
  v_category_active boolean;
  v_target_party_id uuid;
  v_line jsonb;
  v_line_no integer;
  v_line_count integer;
  v_line_type text;
  v_line_amount numeric(18,2);
  v_line_total numeric(18,2) := 0;
  v_received_amount numeric(18,2);
  v_document_party_id uuid;
  v_document_order_id uuid;
  v_document_balance numeric(18,2);
  v_document_allocation_amount numeric(18,2);
  v_document_status text;
  v_document_paid numeric(18,2);
  v_resolved_order_id uuid := p_related_order_id;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت حواله مستقیم را ندارید';
  end if;

  if p_source_party_id is null then
    raise exception 'انتخاب شخص مبدأ الزامی است';
  end if;
  if p_transfer_date is null then
    raise exception 'تاریخ حواله الزامی است';
  end if;

  v_received_amount := round(coalesce(p_received_amount, 0), 2);
  if v_received_amount <= 0 then
    raise exception 'مبلغ دریافتی باید بزرگ‌تر از صفر باشد';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'کلید یکتای ثبت حواله الزامی است';
  end if;

  select *
  into v_existing
  from public.finance_direct_expense_offsets
  where idempotency_key = btrim(p_idempotency_key);

  if found then
    return jsonb_build_object(
      'transfer_id', v_existing.id,
      'transfer_number', v_existing.settlement_number,
      'settlement_id', v_existing.id,
      'settlement_number', v_existing.settlement_number,
      'payment_id', v_existing.payment_id,
      'journal_entry_id', v_existing.journal_entry_id,
      'received_amount', v_existing.total_amount,
      'total_amount', v_existing.total_amount,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  -- Lock the source party only for identity consistency. There is deliberately
  -- no balance ceiling: this transfer may take the source into credit balance.
  perform 1
  from public.finance_parties
  where id = p_source_party_id and coalesce(is_active, true)
  for update;
  if not found then
    raise exception 'شخص مبدأ معتبر یا فعال نیست';
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'ردیف‌های پرداخت باید به صورت آرایه ارسال شوند';
  end if;
  v_line_count := jsonb_array_length(p_lines);
  if v_line_count < 1 then
    raise exception 'حداقل یک ردیف پرداخت الزامی است';
  end if;
  if v_line_count > 100 then
    raise exception 'حداکثر ۱۰۰ ردیف پرداخت در هر حواله مجاز است';
  end if;

  for v_line, v_line_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    v_line_type := coalesce(nullif(btrim(v_line->>'line_type'), ''), 'expense');
    v_category_id := null;
    v_target_party_id := null;
    begin
      v_line_amount := round((v_line->>'amount')::numeric, 2);
      if v_line_type = 'expense' then
        v_category_id := nullif(v_line->>'category_id', '')::uuid;
      elsif v_line_type = 'party_payment' then
        v_target_party_id := nullif(v_line->>'target_party_id', '')::uuid;
      else
        raise exception 'invalid_line_type';
      end if;
    exception when others then
      raise exception 'اطلاعات ردیف پرداخت شماره % معتبر نیست', v_line_no;
    end;

    if v_line_amount is null or v_line_amount <= 0 then
      raise exception 'مبلغ ردیف پرداخت شماره % باید بزرگ‌تر از صفر باشد', v_line_no;
    end if;

    if v_line_type = 'expense' then
      if v_category_id is null then
        raise exception 'دسته هزینه ردیف شماره % الزامی است', v_line_no;
      end if;
      select c.category_type, c.is_active
      into v_category_type, v_category_active
      from public.finance_income_expense_categories c
      where c.id = v_category_id;
      if not found or v_category_type <> 'expense' or not coalesce(v_category_active, false) then
        raise exception 'دسته ردیف شماره % باید یک دسته هزینه فعال باشد', v_line_no;
      end if;
    else
      if v_target_party_id is null then
        raise exception 'شخص مقصد ردیف شماره % الزامی است', v_line_no;
      end if;
      if v_target_party_id = p_source_party_id then
        raise exception 'شخص مقصد ردیف شماره % باید با شخص مبدأ متفاوت باشد', v_line_no;
      end if;
      if not exists (
        select 1 from public.finance_parties
        where id = v_target_party_id and coalesce(is_active, true)
      ) then
        raise exception 'شخص مقصد ردیف شماره % معتبر یا فعال نیست', v_line_no;
      end if;
    end if;

    v_line_total := v_line_total + v_line_amount;
  end loop;

  v_line_total := round(v_line_total, 2);
  if v_line_total <> v_received_amount then
    raise exception 'مبلغ دریافتی (%) باید دقیقاً با جمع ردیف‌های پرداخت (%) برابر باشد', v_received_amount, v_line_total;
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
      raise exception 'فاکتور مرتبط برای این حواله معتبر نیست';
    end if;
    if v_document_party_id is distinct from p_source_party_id then
      raise exception 'فاکتور مرتبط متعلق به شخص مبدأ نیست';
    end if;
    if coalesce(v_document_balance, 0) <= 0 then
      raise exception 'فاکتور مرتبط مانده قابل تخصیص ندارد';
    end if;
    -- Linking a document never caps the source receipt. Only the remaining
    -- invoice balance is allocated; any excess becomes source-party credit.
    v_document_allocation_amount := least(v_received_amount, v_document_balance);
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
  v_payable_account_id := public.fn_finance_account_id('2000');
  v_fallback_expense_account_id := public.fn_finance_account_id('6000');
  if v_receivable_account_id is null
     or v_payable_account_id is null
     or v_fallback_expense_account_id is null then
    raise exception 'حساب‌های سیستمی 1100، 2000 یا 6000 پیکربندی نشده‌اند';
  end if;

  v_transfer_number := 'DT-'
    || to_char(p_transfer_date, 'YYYYMM') || '-'
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
    v_transfer_id,
    v_transfer_number,
    'posted',
    p_source_party_id,
    p_transfer_date,
    v_received_amount,
    v_description,
    p_related_document_id,
    v_resolved_order_id,
    btrim(p_idempotency_key),
    v_document_status,
    v_document_paid,
    auth.uid()
  );

  -- Source receipt: this affects only the source party statement. Both treasury
  -- references are NULL and reporting views exclude the internal method.
  insert into public.finance_payments (
    direction, method, status, party_id, amount, currency, payment_date,
    bank_account_id, cashbox_id, description, related_order_id,
    source_module, source_record_id, created_by
  ) values (
    'receipt', 'direct_expense_offset', 'confirmed', p_source_party_id,
    v_received_amount, 'IRR', p_transfer_date, null, null,
    coalesce(v_description, 'دریافت غیرنقدی حواله مستقیم'),
    v_resolved_order_id, 'accounting', v_transfer_id, auth.uid()
  ) returning id into v_source_payment_id;

  if p_related_document_id is not null then
    insert into public.finance_payment_allocations(payment_id, document_id, amount)
    values (v_source_payment_id, p_related_document_id, v_document_allocation_amount);
  end if;

  for v_line, v_line_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    v_line_type := coalesce(nullif(btrim(v_line->>'line_type'), ''), 'expense');
    v_line_amount := round((v_line->>'amount')::numeric, 2);
    v_category_id := null;
    v_target_party_id := null;
    v_target_payment_id := null;
    v_expense_account_id := null;

    if v_line_type = 'expense' then
      v_category_id := (v_line->>'category_id')::uuid;
      select coalesce(c.default_account_id, v_fallback_expense_account_id)
      into v_expense_account_id
      from public.finance_income_expense_categories c
      where c.id = v_category_id;

      select a.account_type::text
      into v_expense_account_type
      from public.finance_accounts a
      where a.id = v_expense_account_id and a.is_active;
      if v_expense_account_type not in ('expense','cost_of_goods_sold') then
        raise exception 'حساب پیش‌فرض دسته هزینه ردیف شماره % معتبر نیست', v_line_no;
      end if;
    else
      v_target_party_id := (v_line->>'target_party_id')::uuid;
      insert into public.finance_payments (
        direction, method, status, party_id, amount, currency, payment_date,
        bank_account_id, cashbox_id, description, related_order_id,
        source_module, source_record_id, created_by
      ) values (
        'payment', 'direct_expense_offset', 'confirmed', v_target_party_id,
        v_line_amount, 'IRR', p_transfer_date, null, null,
        coalesce(nullif(btrim(coalesce(v_line->>'description', '')), ''),
                 'پرداخت غیرنقدی به شخص در حواله مستقیم ' || v_transfer_number),
        v_resolved_order_id, 'accounting', v_transfer_id, auth.uid()
      ) returning id into v_target_payment_id;
    end if;

    insert into public.finance_direct_expense_offset_lines (
      settlement_id, line_no, line_type, category_id, expense_account_id,
      target_party_id, target_payment_id, amount, description
    ) values (
      v_transfer_id, v_line_no, v_line_type, v_category_id,
      v_expense_account_id, v_target_party_id, v_target_payment_id,
      v_line_amount, nullif(btrim(coalesce(v_line->>'description', '')), '')
    );
  end loop;

  insert into public.finance_journal_entries (
    entry_number, status, entry_date, description, source_module, source_id,
    related_document_id, related_payment_id, created_by, posted_by, posted_at
  ) values (
    null, 'posted', p_transfer_date,
    coalesce(v_description, 'حواله مستقیم') || ' - ' || v_transfer_number,
    'accounting', v_transfer_id, p_related_document_id, v_source_payment_id,
    auth.uid(), auth.uid(), now()
  ) returning id into v_journal_id;

  -- Expense rows debit their configured expense account.
  insert into public.finance_journal_lines (
    entry_id, account_id, party_id, debit_amount, credit_amount,
    description, related_order_id
  )
  select
    v_journal_id, l.expense_account_id, null, l.amount, 0,
    coalesce(l.description, c.name_fa, 'هزینه حواله مستقیم'),
    v_resolved_order_id
  from public.finance_direct_expense_offset_lines l
  join public.finance_income_expense_categories c on c.id = l.category_id
  where l.settlement_id = v_transfer_id
    and l.line_type = 'expense'
  order by l.line_no;

  -- Payments to another party debit payable, reducing that party's claim.
  insert into public.finance_journal_lines (
    entry_id, account_id, party_id, debit_amount, credit_amount,
    description, related_order_id
  )
  select
    v_journal_id, v_payable_account_id, l.target_party_id, l.amount, 0,
    coalesce(l.description, 'کاهش طلب شخص مقصد با حواله مستقیم'),
    v_resolved_order_id
  from public.finance_direct_expense_offset_lines l
  where l.settlement_id = v_transfer_id
    and l.line_type = 'party_payment'
  order by l.line_no;

  -- The single source receipt credits receivable for the full received amount.
  insert into public.finance_journal_lines (
    entry_id, account_id, party_id, debit_amount, credit_amount,
    description, related_order_id
  ) values (
    v_journal_id, v_receivable_account_id, p_source_party_id,
    0, v_received_amount,
    'کاهش بدهی شخص مبدأ بابت حواله مستقیم', v_resolved_order_id
  );

  if not public.fn_finance_assert_journal_balanced(v_journal_id) then
    raise exception 'سند حسابداری حواله مستقیم تراز نیست';
  end if;

  update public.finance_direct_expense_offsets
  set payment_id = v_source_payment_id,
      journal_entry_id = v_journal_id,
      updated_at = now()
  where id = v_transfer_id;

  perform set_config('app.direct_expense_internal', '0', true);

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'settlement_id', v_transfer_id,
    'settlement_number', v_transfer_number,
    'payment_id', v_source_payment_id,
    'journal_entry_id', v_journal_id,
    'received_amount', v_received_amount,
    'total_amount', v_received_amount,
    'status', 'posted',
    'idempotent', false
  );
exception
  when unique_violation then
    perform set_config('app.direct_expense_internal', '0', true);
    select * into v_existing
    from public.finance_direct_expense_offsets
    where idempotency_key = btrim(p_idempotency_key);
    if found then
      return jsonb_build_object(
        'transfer_id', v_existing.id,
        'transfer_number', v_existing.settlement_number,
        'settlement_id', v_existing.id,
        'settlement_number', v_existing.settlement_number,
        'payment_id', v_existing.payment_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'received_amount', v_existing.total_amount,
        'total_amount', v_existing.total_amount,
        'status', v_existing.status,
        'idempotent', true
      );
    end if;
    raise;
  when others then
    perform set_config('app.direct_expense_internal', '0', true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Complete safe void: every active effect becomes inactive, audit stays.
-- ---------------------------------------------------------------------
create or replace function public.fn_void_direct_transfer(
  p_transfer_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.finance_direct_expense_offsets%rowtype;
  v_document_paid numeric(18,2);
  v_document_total numeric(18,2);
  v_restored_status public.finance_document_status;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ابطال حواله مستقیم را ندارید';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'ثبت دلیل ابطال الزامی است';
  end if;

  select * into v_transfer
  from public.finance_direct_expense_offsets
  where id = p_transfer_id
  for update;
  if not found then
    raise exception 'حواله مستقیم یافت نشد';
  end if;
  if v_transfer.status = 'void' then
    return jsonb_build_object(
      'transfer_id', v_transfer.id,
      'transfer_number', v_transfer.settlement_number,
      'settlement_id', v_transfer.id,
      'settlement_number', v_transfer.settlement_number,
      'status', 'void',
      'idempotent', true
    );
  end if;

  perform set_config('app.direct_expense_internal', '1', true);

  update public.finance_payments
  set status = 'void',
      description = concat_ws(E'\n', description, 'ابطال حواله مستقیم: ' || btrim(p_reason)),
      updated_at = now()
  where method = 'direct_expense_offset'
    and (id = v_transfer.payment_id or source_record_id = v_transfer.id);

  update public.finance_journal_entries
  set status = 'void',
      description = concat_ws(E'\n', description, 'ابطال حواله مستقیم: ' || btrim(p_reason)),
      updated_at = now()
  where id = v_transfer.journal_entry_id;

  if v_transfer.related_document_id is not null then
    perform public.fn_finance_update_document_paid_amount(v_transfer.related_document_id);

    select paid_amount, total_amount
    into v_document_paid, v_document_total
    from public.finance_documents
    where id = v_transfer.related_document_id
    for update;

    if coalesce(v_document_paid, 0) <= 0 then
      begin
        if v_transfer.linked_document_status_before in ('approved','sent') then
          v_restored_status := v_transfer.linked_document_status_before::public.finance_document_status;
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
    where id = v_transfer.related_document_id
      and status not in ('draft','pending_approval','cancelled','void');
  end if;

  update public.finance_direct_expense_offsets
  set status = 'void',
      void_reason = btrim(p_reason),
      voided_by = auth.uid(),
      voided_at = now(),
      updated_at = now()
  where id = v_transfer.id;

  perform set_config('app.direct_expense_internal', '0', true);

  return jsonb_build_object(
    'transfer_id', v_transfer.id,
    'transfer_number', v_transfer.settlement_number,
    'settlement_id', v_transfer.id,
    'settlement_number', v_transfer.settlement_number,
    'payment_id', v_transfer.payment_id,
    'journal_entry_id', v_transfer.journal_entry_id,
    'status', 'void',
    'idempotent', false
  );
exception when others then
  perform set_config('app.direct_expense_internal', '0', true);
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Versioned correction: old version is voided, replacement is linked.
-- ---------------------------------------------------------------------
create or replace function public.fn_revise_direct_transfer(
  p_transfer_id uuid,
  p_source_party_id uuid,
  p_transfer_date date,
  p_received_amount numeric,
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
    raise exception 'دسترسی اصلاح حواله مستقیم را ندارید';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'ثبت دلیل اصلاح الزامی است';
  end if;

  select * into v_old
  from public.finance_direct_expense_offsets
  where id = p_transfer_id
  for update;
  if not found then
    raise exception 'نسخه مبنای حواله مستقیم یافت نشد';
  end if;

  if v_old.status = 'void' and v_old.replaced_by_settlement_id is not null then
    select jsonb_build_object(
      'transfer_id', n.id,
      'transfer_number', n.settlement_number,
      'settlement_id', n.id,
      'settlement_number', n.settlement_number,
      'payment_id', n.payment_id,
      'journal_entry_id', n.journal_entry_id,
      'received_amount', n.total_amount,
      'total_amount', n.total_amount,
      'status', n.status,
      'replaces_settlement_id', v_old.id,
      'idempotent', true
    ) into v_created
    from public.finance_direct_expense_offsets n
    where n.id = v_old.replaced_by_settlement_id;
    return v_created;
  elsif v_old.status = 'void' then
    raise exception 'حواله باطل‌شده بدون نسخه جایگزین قابل اصلاح نیست';
  end if;

  perform public.fn_void_direct_transfer(
    v_old.id,
    'اصلاح نسخه‌دار: ' || btrim(p_reason)
  );

  v_created := public.fn_create_direct_transfer(
    p_source_party_id,
    p_transfer_date,
    p_received_amount,
    p_lines,
    p_description,
    p_related_document_id,
    p_related_order_id,
    p_idempotency_key
  );
  v_new_id := (v_created->>'transfer_id')::uuid;
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

-- Legacy RPC names remain as thin compatibility wrappers. They now use the
-- unrestricted source balance and the new audited implementation.
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
  v_total numeric(18,2);
begin
  select round(coalesce(sum(round((value->>'amount')::numeric, 2)), 0), 2)
  into v_total
  from jsonb_array_elements(p_lines);
  return public.fn_create_direct_transfer(
    p_party_id, p_settlement_date, v_total, p_lines, p_description,
    p_related_document_id, p_related_order_id, p_idempotency_key
  );
end;
$$;

create or replace function public.fn_void_direct_expense_offset(
  p_settlement_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.fn_void_direct_transfer(p_settlement_id, p_reason);
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
  v_total numeric(18,2);
begin
  select round(coalesce(sum(round((value->>'amount')::numeric, 2)), 0), 2)
  into v_total
  from jsonb_array_elements(p_lines);
  return public.fn_revise_direct_transfer(
    p_settlement_id, p_party_id, p_settlement_date, v_total, p_lines,
    p_reason, p_description, p_related_document_id, p_related_order_id,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.fn_create_direct_transfer(uuid,date,numeric,jsonb,text,uuid,uuid,text) from public;
revoke all on function public.fn_void_direct_transfer(uuid,text) from public;
revoke all on function public.fn_revise_direct_transfer(uuid,uuid,date,numeric,jsonb,text,text,uuid,uuid,text) from public;
grant execute on function public.fn_create_direct_transfer(uuid,date,numeric,jsonb,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.fn_void_direct_transfer(uuid,text) to authenticated, service_role;
grant execute on function public.fn_revise_direct_transfer(uuid,uuid,date,numeric,jsonb,text,text,uuid,uuid,text) to authenticated, service_role;

revoke all on function public.fn_create_direct_expense_offset(uuid,date,jsonb,text,uuid,uuid,text) from public;
revoke all on function public.fn_void_direct_expense_offset(uuid,text) from public;
revoke all on function public.fn_revise_direct_expense_offset(uuid,uuid,date,jsonb,text,text,uuid,uuid,text) from public;
grant execute on function public.fn_create_direct_expense_offset(uuid,date,jsonb,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.fn_void_direct_expense_offset(uuid,text) to authenticated, service_role;
grant execute on function public.fn_revise_direct_expense_offset(uuid,uuid,date,jsonb,text,text,uuid,uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) Detail and summary views. Physical legacy names remain API-compatible.
-- ---------------------------------------------------------------------
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
  true as is_non_cash,
  l.line_type,
  l.target_party_id,
  tp.display_name as target_party_name,
  l.target_payment_id,
  tpay.payment_number as target_payment_number,
  s.total_amount as received_amount
from public.finance_direct_expense_offsets s
join public.finance_direct_expense_offset_lines l on l.settlement_id = s.id
left join public.finance_income_expense_categories c on c.id = l.category_id
left join public.finance_income_expense_categories pc on pc.id = c.parent_id
left join public.finance_accounts a on a.id = l.expense_account_id
join public.finance_parties fp on fp.id = s.party_id
left join public.finance_parties tp on tp.id = l.target_party_id
left join public.finance_documents d on d.id = s.related_document_id
left join public.orders o on o.id = s.related_order_id
left join public.finance_payments p on p.id = s.payment_id
left join public.finance_payments tpay on tpay.id = l.target_payment_id
left join public.finance_journal_entries je on je.id = s.journal_entry_id
left join public.finance_direct_expense_offsets prior on prior.id = s.replaces_settlement_id
left join public.finance_direct_expense_offsets newer on newer.id = s.replaced_by_settlement_id
left join public.profiles cp on cp.id = s.created_by
left join public.profiles vp on vp.id = s.voided_by;

grant select on public.v_finance_direct_expense_offset_details to authenticated;

create or replace view public.v_finance_direct_transfer_summary
with (security_invoker = true)
as
select
  s.id as transfer_id,
  s.settlement_number as transfer_number,
  s.status,
  s.party_id as source_party_id,
  fp.display_name as source_party_name,
  s.settlement_date as transfer_date,
  s.total_amount as received_amount,
  coalesce(sum(l.amount), 0) as allocated_amount,
  coalesce(sum(l.amount) filter (where l.line_type = 'expense'), 0) as expense_amount,
  coalesce(sum(l.amount) filter (where l.line_type = 'party_payment'), 0) as party_payment_amount,
  count(*) filter (where l.line_type = 'expense') as expense_line_count,
  count(*) filter (where l.line_type = 'party_payment') as party_payment_line_count,
  s.description,
  s.related_document_id,
  d.doc_number as related_document_number,
  s.related_order_id,
  o.order_code,
  s.payment_id as source_payment_id,
  s.journal_entry_id,
  s.replaces_settlement_id,
  s.replaced_by_settlement_id,
  s.revision_reason,
  s.void_reason,
  s.voided_by,
  s.voided_at,
  s.created_by,
  s.created_at,
  s.updated_at
from public.finance_direct_expense_offsets s
join public.finance_direct_expense_offset_lines l on l.settlement_id = s.id
join public.finance_parties fp on fp.id = s.party_id
left join public.finance_documents d on d.id = s.related_document_id
left join public.orders o on o.id = s.related_order_id
group by s.id, fp.display_name, d.doc_number, o.order_code;

grant select on public.v_finance_direct_transfer_summary to authenticated;

-- ---------------------------------------------------------------------
-- 6) Expense reporting includes only actual expense rows, never party rows.
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
where s.status = 'posted'
  and l.line_type = 'expense';

grant select on public.v_finance_income_expense_ledger to authenticated;

-- Dashboard cost is actual expense only. Person-to-person allocation is not cost.
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
  select coalesce(sum(l.amount) filter (
    where s.status = 'posted'
      and l.line_type = 'expense'
      and s.settlement_date >= date_trunc('month', current_date)::date
  ), 0) as month_direct_costs
  from public.finance_direct_expense_offsets s
  join public.finance_direct_expense_offset_lines l on l.settlement_id = s.id
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

-- Only expense rows contribute to order profitability.
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
  and s.status = 'posted'
  and l.line_type = 'expense';

grant select on public.v_order_unified_costs to authenticated;

-- Physical deletion remains forbidden; the wording now reflects the public name.
create or replace function public.fn_prevent_direct_expense_offset_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'حذف فیزیکی حواله مستقیم مجاز نیست؛ از ابطال امن استفاده کنید';
end;
$$;

notify pgrst, 'reload schema';
commit;
