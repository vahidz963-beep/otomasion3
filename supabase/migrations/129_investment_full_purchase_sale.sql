-- ============================================================================
-- 129_INVESTMENT_FULL_PURCHASE_SALE
-- Full-sale-only investment ledger. Purchase/payment and sale/receipt are
-- posted atomically against the selected bank account or cashbox.
-- ============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.finance_investments
  drop constraint if exists finance_investments_asset_type_check;
alter table public.finance_investments
  add constraint finance_investments_asset_type_check
  check (asset_type in ('gold','silver','land','currency','equipment','stock','fund','other'));

alter table public.finance_investments
  add column if not exists acquisition_mode text not null default 'existing_asset'
    check (acquisition_mode in ('paid_purchase','existing_asset')),
  add column if not exists purchase_fee_amount numeric not null default 0 check (purchase_fee_amount >= 0),
  add column if not exists purchase_cash_amount numeric not null default 0 check (purchase_cash_amount >= 0),
  add column if not exists carrying_amount numeric not null default 0 check (carrying_amount >= 0),
  add column if not exists purchase_payment_id uuid references public.finance_payments(id) on delete set null,
  add column if not exists purchase_journal_entry_id uuid references public.finance_journal_entries(id) on delete set null,
  add column if not exists sale_date date,
  add column if not exists sale_gross_amount numeric,
  add column if not exists sale_fee_amount numeric not null default 0 check (sale_fee_amount >= 0),
  add column if not exists sale_cash_amount numeric,
  add column if not exists realized_profit_loss numeric,
  add column if not exists sale_payment_id uuid references public.finance_payments(id) on delete set null,
  add column if not exists sale_journal_entry_id uuid references public.finance_journal_entries(id) on delete set null,
  add column if not exists ledger_mode text not null default 'legacy' check (ledger_mode in ('legacy','full_sale'));

-- Existing registry rows are opening/existing assets. Their book value is kept,
-- but no historical bank/cash movement is invented.
update public.finance_investments
set acquisition_mode = 'existing_asset',
    purchase_cash_amount = 0,
    carrying_amount = greatest(coalesce(purchase_amount,0) + coalesce(purchase_fee_amount,0),0)
where ledger_mode = 'legacy';

insert into public.finance_accounts (code, name_fa, name_en, account_type, is_system)
values
  ('1400', 'سرمایه‌گذاری‌ها', 'Investments', 'asset', true),
  ('4210', 'سود فروش سرمایه‌گذاری', 'Realized investment gain', 'revenue', true),
  ('6400', 'زیان فروش سرمایه‌گذاری', 'Realized investment loss', 'expense', true)
on conflict (code) do update set
  name_fa = excluded.name_fa,
  name_en = excluded.name_en,
  account_type = excluded.account_type,
  is_system = true,
  is_active = true;

create table if not exists public.finance_investment_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text unique not null,
  investment_id uuid not null references public.finance_investments(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('purchase','sale')),
  acquisition_mode text not null default 'paid_purchase'
    check (acquisition_mode in ('paid_purchase','existing_asset','sale')),
  status text not null default 'confirmed' check (status in ('confirmed','legacy','void')),
  transaction_date date not null default current_date,
  quantity numeric not null check (quantity > 0),
  gross_amount numeric not null check (gross_amount >= 0),
  fee_amount numeric not null default 0 check (fee_amount >= 0),
  cash_amount numeric not null check (cash_amount >= 0),
  carrying_amount numeric not null default 0 check (carrying_amount >= 0),
  realized_profit_loss numeric,
  account_kind text check (account_kind in ('bank','cashbox')),
  account_id uuid,
  payment_id uuid references public.finance_payments(id) on delete set null,
  journal_entry_id uuid references public.finance_journal_entries(id) on delete set null,
  idempotency_key text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (investment_id, transaction_type),
  unique (idempotency_key)
);

create index if not exists idx_finance_investment_transactions_date
  on public.finance_investment_transactions(transaction_date desc, created_at desc);
create index if not exists idx_finance_investment_transactions_payment
  on public.finance_investment_transactions(payment_id)
  where payment_id is not null;

create sequence if not exists public.finance_investment_transaction_seq;

create or replace function public.fn_generate_finance_investment_transaction_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.transaction_number is null or trim(new.transaction_number) = '' then
    new.transaction_number := case when new.transaction_type = 'sale' then 'INV-S-' else 'INV-B-' end
      || to_char(new.transaction_date, 'YYYY') || '-'
      || lpad(nextval('public.finance_investment_transaction_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_investment_transaction_number on public.finance_investment_transactions;
create trigger trg_finance_investment_transaction_number
before insert on public.finance_investment_transactions
for each row execute function public.fn_generate_finance_investment_transaction_number();

-- Preserve old registry records without inventing historical bank movements.
insert into public.finance_investment_transactions (
  investment_id, transaction_number, transaction_type, acquisition_mode, status, transaction_date,
  quantity, gross_amount, fee_amount, cash_amount, carrying_amount, notes, created_by, created_at
)
select
  i.id,
  'INV-LEGACY-' || right(replace(i.id::text,'-',''),12),
  'purchase', 'existing_asset', 'legacy', i.acquisition_date,
  greatest(i.quantity,0.000001), greatest(i.purchase_amount,0),
  greatest(i.purchase_fee_amount,0), 0,
  greatest(i.carrying_amount,0),
  'انتقال غیرمخرب رکورد قدیمی؛ عمداً هیچ گردش بانکی تاریخی ساخته نشد.',
  i.created_by, i.created_at
from public.finance_investments i
where not exists (
  select 1 from public.finance_investment_transactions t
  where t.investment_id = i.id and t.transaction_type = 'purchase'
)
on conflict do nothing;

create or replace function public.fn_investment_assert_account(
  p_account_kind text,
  p_account_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_kind not in ('bank','cashbox') or p_account_id is null then
    raise exception 'حساب بانک/صندوق معامله باید انتخاب شود';
  end if;
  if p_account_kind = 'bank' and not exists (
    select 1 from public.finance_bank_accounts where id = p_account_id and is_active
  ) then
    raise exception 'حساب بانکی انتخاب‌شده فعال یا معتبر نیست';
  end if;
  if p_account_kind = 'cashbox' and not exists (
    select 1 from public.finance_cashboxes where id = p_account_id and is_active
  ) then
    raise exception 'صندوق انتخاب‌شده فعال یا معتبر نیست';
  end if;
end;
$$;

create or replace function public.fn_purchase_finance_investment(
  p_asset_type text,
  p_title_fa text,
  p_acquisition_date date,
  p_quantity numeric,
  p_unit text,
  p_purchase_amount numeric,
  p_fee_amount numeric,
  p_current_estimated_value numeric,
  p_account_kind text,
  p_account_id uuid,
  p_location text default null,
  p_notes text default null,
  p_idempotency_key text default null,
  p_acquisition_mode text default 'paid_purchase'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_investment_id uuid := gen_random_uuid();
  v_tx_id uuid := gen_random_uuid();
  v_payment_id uuid;
  v_journal_id uuid := gen_random_uuid();
  v_cash numeric;
  v_carrying numeric;
  v_mode text := coalesce(nullif(trim(p_acquisition_mode),''),'paid_purchase');
  v_method public.finance_payment_method;
  v_cash_account uuid;
  v_existing record;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت خرید سرمایه‌گذاری را ندارید';
  end if;
  if nullif(trim(coalesce(p_title_fa,'')),'') is null then raise exception 'عنوان سرمایه‌گذاری الزامی است'; end if;
  if p_asset_type not in ('gold','silver','land','currency','equipment','stock','fund','other') then raise exception 'نوع دارایی نامعتبر است'; end if;
  if v_mode not in ('paid_purchase','existing_asset') then raise exception 'روش ثبت دارایی نامعتبر است'; end if;
  if coalesce(p_quantity,0) <= 0 then raise exception 'مقدار دارایی باید بیشتر از صفر باشد'; end if;
  if v_mode='paid_purchase' and coalesce(p_purchase_amount,0) <= 0 then raise exception 'مبلغ خرید باید بیشتر از صفر باشد'; end if;
  if coalesce(p_purchase_amount,0) < 0 then raise exception 'ارزش مبنای دارایی نمی‌تواند منفی باشد'; end if;
  if coalesce(p_fee_amount,0) < 0 then raise exception 'هزینه معامله نمی‌تواند منفی باشد'; end if;
  if v_mode='paid_purchase' then
    perform public.fn_investment_assert_account(p_account_kind,p_account_id);
  end if;

  if nullif(trim(coalesce(p_idempotency_key,'')),'') is not null then
    select i.id as investment_id, t.id as transaction_id, t.payment_id
    into v_existing
    from public.finance_investment_transactions t
    join public.finance_investments i on i.id = t.investment_id
    where t.idempotency_key = trim(p_idempotency_key);
    if found then
      return jsonb_build_object('investment_id',v_existing.investment_id,'transaction_id',v_existing.transaction_id,'payment_id',v_existing.payment_id,'idempotent',true);
    end if;
  end if;

  v_carrying := round(coalesce(p_purchase_amount,0)+coalesce(p_fee_amount,0),2);
  v_cash := case when v_mode='paid_purchase' then v_carrying else 0 end;

  insert into public.finance_investments (
    id, asset_type, title_fa, acquisition_date, quantity, unit, acquisition_mode,
    purchase_amount, purchase_fee_amount, purchase_cash_amount, carrying_amount,
    current_estimated_value, location, notes, status, ledger_mode, created_by
  ) values (
    v_investment_id, p_asset_type, trim(p_title_fa), coalesce(p_acquisition_date,current_date),
    p_quantity, coalesce(nullif(trim(p_unit),''),'عدد'), v_mode,
    round(coalesce(p_purchase_amount,0),2), round(coalesce(p_fee_amount,0),2), v_cash, v_carrying,
    greatest(coalesce(p_current_estimated_value,p_purchase_amount,0),0),
    nullif(trim(coalesce(p_location,'')),''), nullif(trim(coalesce(p_notes,'')),''),
    'active', 'full_sale', v_actor
  );

  if v_mode='paid_purchase' then
    v_payment_id := gen_random_uuid();
    v_method := case when p_account_kind='cashbox' then 'cash'::public.finance_payment_method else 'bank_transfer'::public.finance_payment_method end;
    v_cash_account := public.fn_finance_account_id(case when p_account_kind='cashbox' then '1000' else '1010' end);

    insert into public.finance_payments (
      id, payment_number, direction, method, status, payment_date, amount, currency,
      bank_account_id, cashbox_id, source_module, source_record_id, description, created_by
    ) values (
      v_payment_id, null, 'payment', v_method, 'confirmed', coalesce(p_acquisition_date,current_date),
      v_cash, 'IRR', case when p_account_kind='bank' then p_account_id end,
      case when p_account_kind='cashbox' then p_account_id end,
      'accounting', v_tx_id, 'خرید کامل سرمایه‌گذاری: ' || trim(p_title_fa), v_actor
    );

    insert into public.finance_journal_entries (
      id, entry_number, status, entry_date, description, source_module, source_id,
      related_payment_id, created_by, posted_by, posted_at
    ) values (
      v_journal_id, null, 'posted', coalesce(p_acquisition_date,current_date),
      'خرید سرمایه‌گذاری ' || trim(p_title_fa), 'accounting', v_tx_id,
      v_payment_id, v_actor, v_actor, now()
    );
    insert into public.finance_journal_lines (entry_id,account_id,debit_amount,description)
    values (v_journal_id,public.fn_finance_account_id('1400'),v_carrying,'بهای خرید و مخارج قابل انتساب سرمایه‌گذاری');
    insert into public.finance_journal_lines (entry_id,account_id,credit_amount,description)
    values (v_journal_id,v_cash_account,v_cash,'خروج وجه خرید سرمایه‌گذاری');
  else
    -- Existing/opening asset: register its book value without creating any
    -- finance_payment row and without touching bank/cash turnover.
    insert into public.finance_journal_entries (
      id, entry_number, status, entry_date, description, source_module, source_id,
      related_payment_id, created_by, posted_by, posted_at
    ) values (
      v_journal_id, null, 'posted', coalesce(p_acquisition_date,current_date),
      'ثبت دارایی از قبل موجود: ' || trim(p_title_fa), 'accounting', v_tx_id,
      null, v_actor, v_actor, now()
    );
    if v_carrying>0 then
      insert into public.finance_journal_lines (entry_id,account_id,debit_amount,description)
      values (v_journal_id,public.fn_finance_account_id('1400'),v_carrying,'ارزش مبنای دارایی از قبل موجود');
      insert into public.finance_journal_lines (entry_id,account_id,credit_amount,description)
      values (v_journal_id,public.fn_finance_account_id('3000'),v_carrying,'تعدیل افتتاحیه دارایی موجود؛ بدون گردش نقدی');
    else
      -- A zero-value registry record needs no accounting effect.
      delete from public.finance_journal_entries where id=v_journal_id;
      v_journal_id := null;
    end if;
  end if;

  if v_journal_id is not null and not public.fn_finance_assert_journal_balanced(v_journal_id) then
    raise exception 'سند حسابداری ثبت سرمایه‌گذاری تراز نیست';
  end if;

  insert into public.finance_investment_transactions (
    id, transaction_number, investment_id, transaction_type, acquisition_mode, status,
    transaction_date, quantity, gross_amount, fee_amount, cash_amount,
    carrying_amount, account_kind, account_id, payment_id, journal_entry_id,
    idempotency_key, notes, created_by
  ) values (
    v_tx_id, null, v_investment_id, 'purchase', v_mode, 'confirmed',
    coalesce(p_acquisition_date,current_date), p_quantity, round(coalesce(p_purchase_amount,0),2),
    round(coalesce(p_fee_amount,0),2), v_cash, v_carrying,
    case when v_mode='paid_purchase' then p_account_kind end,
    case when v_mode='paid_purchase' then p_account_id end,
    v_payment_id, v_journal_id,
    nullif(trim(coalesce(p_idempotency_key,'')),''), nullif(trim(coalesce(p_notes,'')),''), v_actor
  );

  update public.finance_investments
  set purchase_payment_id=v_payment_id, purchase_journal_entry_id=v_journal_id
  where id=v_investment_id;

  return jsonb_build_object(
    'investment_id',v_investment_id,'transaction_id',v_tx_id,
    'payment_id',v_payment_id,'journal_entry_id',v_journal_id,
    'acquisition_mode',v_mode,'cash_amount',v_cash,'carrying_amount',v_carrying,
    'idempotent',false
  );
end;
$$;

create or replace function public.fn_sell_finance_investment_full(
  p_investment_id uuid,
  p_sale_date date,
  p_gross_amount numeric,
  p_fee_amount numeric,
  p_account_kind text,
  p_account_id uuid,
  p_notes text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.finance_investments%rowtype;
  v_tx_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_journal_id uuid := gen_random_uuid();
  v_opening_journal_id uuid;
  v_cash numeric;
  v_carrying numeric;
  v_profit numeric;
  v_method public.finance_payment_method;
  v_cash_account uuid;
  v_existing record;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ثبت فروش سرمایه‌گذاری را ندارید';
  end if;
  perform public.fn_investment_assert_account(p_account_kind,p_account_id);
  if coalesce(p_gross_amount,0) <= 0 then raise exception 'مبلغ فروش باید بیشتر از صفر باشد'; end if;
  if coalesce(p_fee_amount,0) < 0 or coalesce(p_fee_amount,0) >= p_gross_amount then raise exception 'هزینه فروش نامعتبر است'; end if;

  if nullif(trim(coalesce(p_idempotency_key,'')),'') is not null then
    select t.investment_id,t.id as transaction_id,t.payment_id into v_existing
    from public.finance_investment_transactions t
    where t.idempotency_key=trim(p_idempotency_key);
    if found then
      return jsonb_build_object('investment_id',v_existing.investment_id,'transaction_id',v_existing.transaction_id,'payment_id',v_existing.payment_id,'idempotent',true);
    end if;
  end if;

  select * into v_inv from public.finance_investments where id=p_investment_id for update;
  if not found then raise exception 'سرمایه‌گذاری یافت نشد'; end if;
  if v_inv.status <> 'active' then raise exception 'فقط دارایی فعال و فروش‌نرفته قابل فروش است'; end if;
  if exists (select 1 from public.finance_investment_transactions where investment_id=p_investment_id and transaction_type='sale' and status<>'void') then
    raise exception 'فروش این دارایی قبلاً ثبت شده است';
  end if;

  v_cash := round(p_gross_amount-coalesce(p_fee_amount,0),2);
  v_carrying := round(greatest(coalesce(v_inv.carrying_amount,v_inv.purchase_amount,0),0),2);
  v_profit := round(v_cash-v_carrying,2);
  v_method := case when p_account_kind='cashbox' then 'cash'::public.finance_payment_method else 'bank_transfer'::public.finance_payment_method end;
  v_cash_account := public.fn_finance_account_id(case when p_account_kind='cashbox' then '1000' else '1010' end);

  -- A legacy registry asset had no historical accounting journal. Recognize its
  -- opening book value immediately before disposal (still without cash impact)
  -- so the sale never credits an unrecognized investment asset balance.
  if v_carrying>0 and v_inv.purchase_journal_entry_id is null then
    v_opening_journal_id:=gen_random_uuid();
    insert into public.finance_journal_entries(
      id,entry_number,status,entry_date,description,source_module,source_id,
      created_by,posted_by,posted_at
    ) values(
      v_opening_journal_id,null,'posted',coalesce(v_inv.acquisition_date,p_sale_date,current_date),
      'شناسایی ارزش افتتاحیه دارایی موجود پیش از فروش: '||v_inv.title_fa,
      'accounting',v_inv.id,v_actor,v_actor,now()
    );
    insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description)
    values(v_opening_journal_id,public.fn_finance_account_id('1400'),v_carrying,'ارزش مبنای دارایی موجود');
    insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description)
    values(v_opening_journal_id,public.fn_finance_account_id('3000'),v_carrying,'تعدیل افتتاحیه بدون گردش نقدی');
    update public.finance_investments set purchase_journal_entry_id=v_opening_journal_id where id=p_investment_id;
    update public.finance_investment_transactions
    set journal_entry_id=v_opening_journal_id
    where investment_id=p_investment_id and transaction_type='purchase' and journal_entry_id is null;
  end if;

  insert into public.finance_payments (
    id,payment_number,direction,method,status,payment_date,amount,currency,
    bank_account_id,cashbox_id,source_module,source_record_id,description,created_by
  ) values (
    v_payment_id,null,'receipt',v_method,'confirmed',coalesce(p_sale_date,current_date),v_cash,'IRR',
    case when p_account_kind='bank' then p_account_id end,
    case when p_account_kind='cashbox' then p_account_id end,
    'accounting',v_tx_id,'فروش کامل سرمایه‌گذاری: '||v_inv.title_fa,v_actor
  );

  insert into public.finance_journal_entries (
    id,entry_number,status,entry_date,description,source_module,source_id,
    related_payment_id,created_by,posted_by,posted_at
  ) values (
    v_journal_id,null,'posted',coalesce(p_sale_date,current_date),
    'فروش کامل سرمایه‌گذاری '||v_inv.title_fa,'accounting',v_tx_id,
    v_payment_id,v_actor,v_actor,now()
  );
  insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description)
  values(v_journal_id,v_cash_account,v_cash,'ورود خالص وجه فروش سرمایه‌گذاری');
  insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description)
  values(v_journal_id,public.fn_finance_account_id('1400'),v_carrying,'خروج ارزش دفتری سرمایه‌گذاری');
  if v_profit > 0 then
    insert into public.finance_journal_lines(entry_id,account_id,credit_amount,description)
    values(v_journal_id,public.fn_finance_account_id('4210'),v_profit,'سود تحقق‌یافته فروش سرمایه‌گذاری');
  elsif v_profit < 0 then
    insert into public.finance_journal_lines(entry_id,account_id,debit_amount,description)
    values(v_journal_id,public.fn_finance_account_id('6400'),abs(v_profit),'زیان تحقق‌یافته فروش سرمایه‌گذاری');
  end if;
  if not public.fn_finance_assert_journal_balanced(v_journal_id) then
    raise exception 'سند حسابداری فروش سرمایه‌گذاری تراز نیست';
  end if;

  insert into public.finance_investment_transactions (
    id,transaction_number,investment_id,transaction_type,acquisition_mode,status,transaction_date,
    quantity,gross_amount,fee_amount,cash_amount,carrying_amount,realized_profit_loss,
    account_kind,account_id,payment_id,journal_entry_id,idempotency_key,notes,created_by
  ) values (
    v_tx_id,null,p_investment_id,'sale','sale','confirmed',coalesce(p_sale_date,current_date),
    v_inv.quantity,round(p_gross_amount,2),round(coalesce(p_fee_amount,0),2),v_cash,v_carrying,v_profit,
    p_account_kind,p_account_id,v_payment_id,v_journal_id,
    nullif(trim(coalesce(p_idempotency_key,'')),''),nullif(trim(coalesce(p_notes,'')),''),v_actor
  );

  update public.finance_investments
  set status='sold',sale_date=coalesce(p_sale_date,current_date),sale_gross_amount=round(p_gross_amount,2),
      sale_fee_amount=round(coalesce(p_fee_amount,0),2),sale_cash_amount=v_cash,
      realized_profit_loss=v_profit,sale_payment_id=v_payment_id,sale_journal_entry_id=v_journal_id,
      current_estimated_value=v_cash,updated_at=now()
  where id=p_investment_id;

  return jsonb_build_object('investment_id',p_investment_id,'transaction_id',v_tx_id,'payment_id',v_payment_id,'journal_entry_id',v_journal_id,'cash_amount',v_cash,'realized_profit_loss',v_profit,'idempotent',false);
end;
$$;

create or replace function public.fn_update_finance_investment_metadata(
  p_investment_id uuid,
  p_title_fa text,
  p_current_estimated_value numeric,
  p_location text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی ویرایش سرمایه‌گذاری را ندارید';
  end if;
  if nullif(trim(coalesce(p_title_fa,'')),'') is null then raise exception 'عنوان الزامی است'; end if;
  update public.finance_investments
  set title_fa=trim(p_title_fa),current_estimated_value=greatest(coalesce(p_current_estimated_value,0),0),
      location=nullif(trim(coalesce(p_location,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
  where id=p_investment_id;
  if not found then raise exception 'سرمایه‌گذاری یافت نشد'; end if;
  return p_investment_id;
end;
$$;

create or replace function public.fn_archive_finance_investment(p_investment_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_mode text; v_status text;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی آرشیو سرمایه‌گذاری را ندارید';
  end if;
  select ledger_mode,status into v_mode,v_status from public.finance_investments where id=p_investment_id for update;
  if not found then raise exception 'سرمایه‌گذاری یافت نشد'; end if;
  if v_mode='full_sale' and v_status='active' then
    raise exception 'دارایی خریداری‌شده فعال را ابتدا با عملیات «فروش کامل» تسویه کنید؛ آرشیو نباید گردش مالی را پنهان کند';
  end if;
  update public.finance_investments set status='archived',updated_at=now() where id=p_investment_id;
  return p_investment_id;
end;
$$;

create or replace view public.v_finance_investment_portfolio
with (security_invoker=true)
as
select
  i.*,
  pt.transaction_number as purchase_transaction_number,
  pt.account_kind as purchase_account_kind,
  pt.account_id as purchase_account_id,
  coalesce(pba.account_name,pcb.name) as purchase_account_name,
  st.transaction_number as sale_transaction_number,
  st.account_kind as sale_account_kind,
  st.account_id as sale_account_id,
  coalesce(sba.account_name,scb.name) as sale_account_name
from public.finance_investments i
left join public.finance_investment_transactions pt on pt.investment_id=i.id and pt.transaction_type='purchase'
left join public.finance_investment_transactions st on st.investment_id=i.id and st.transaction_type='sale' and st.status<>'void'
left join public.finance_bank_accounts pba on pt.account_kind='bank' and pba.id=pt.account_id
left join public.finance_cashboxes pcb on pt.account_kind='cashbox' and pcb.id=pt.account_id
left join public.finance_bank_accounts sba on st.account_kind='bank' and sba.id=st.account_id
left join public.finance_cashboxes scb on st.account_kind='cashbox' and scb.id=st.account_id;

alter table public.finance_investment_transactions enable row level security;
drop policy if exists finance_investment_transactions_read on public.finance_investment_transactions;
create policy finance_investment_transactions_read on public.finance_investment_transactions
for select to authenticated using (public.has_role(array['admin','accountant']));

revoke insert,update,delete on public.finance_investments from authenticated;
revoke insert,update,delete on public.finance_investment_transactions from authenticated;
grant select on public.finance_investment_transactions,public.v_finance_investment_portfolio to authenticated,service_role;
grant execute on function public.fn_purchase_finance_investment(text,text,date,numeric,text,numeric,numeric,numeric,text,uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.fn_sell_finance_investment_full(uuid,date,numeric,numeric,text,uuid,text,text) to authenticated,service_role;
grant execute on function public.fn_update_finance_investment_metadata(uuid,text,numeric,text,text) to authenticated,service_role;
grant execute on function public.fn_archive_finance_investment(uuid) to authenticated,service_role;

commit;

notify pgrst, 'reload schema';
