-- 120: Warehouse opening balances as auditable adjustment documents.
-- - One protected final document is created for every inventory import/snapshot.
-- - Existing snapshots are backfilled without creating stock transactions, so
--   current quantities do not change or double.
-- - New count corrections are stored as final adjustment documents.
-- - Kardex rows expose document_kind flags so the UI can hide adjustments in
--   the general view and show them in the selected item's own kardex.

begin;

alter table public.warehouse_documents
  add column if not exists document_kind text not null default 'movement',
  add column if not exists source_snapshot_id uuid references public.warehouse_snapshots(id) on delete cascade;

alter table public.warehouse_document_lines
  add column if not exists source_snapshot_item_id uuid references public.warehouse_snapshot_items(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouse_documents_kind_check'
      and conrelid = 'public.warehouse_documents'::regclass
  ) then
    alter table public.warehouse_documents
      add constraint warehouse_documents_kind_check
      check (document_kind in ('movement', 'adjustment', 'opening_balance'));
  end if;
end $$;

create unique index if not exists uq_warehouse_document_snapshot
  on public.warehouse_documents(source_snapshot_id)
  where source_snapshot_id is not null;

create unique index if not exists uq_warehouse_document_line_snapshot_item
  on public.warehouse_document_lines(source_snapshot_item_id);

create sequence if not exists public.warehouse_adjustment_doc_seq;

create or replace function public.fn_ensure_warehouse_opening_document(p_snapshot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.warehouse_snapshots%rowtype;
  v_actor uuid;
  v_document_id uuid;
  v_document_number text;
begin
  if auth.uid() is not null and not public.has_role(array['admin','warehouse']) then
    raise exception 'دسترسی ثبت سند اصلاحی انبار را ندارید';
  end if;

  select * into v_snapshot
  from public.warehouse_snapshots
  where id = p_snapshot_id;

  if not found then
    raise exception 'ورود اطلاعات انبار یافت نشد';
  end if;

  v_actor := coalesce(
    v_snapshot.imported_by,
    auth.uid(),
    (select id from public.profiles order by id limit 1)
  );

  if v_actor is null then
    raise exception 'برای ثبت سند موجودی اول دوره، کاربر ثبت‌کننده یافت نشد';
  end if;

  v_document_number := 'WH-OPEN-'
    || to_char(v_snapshot.imported_at at time zone 'Asia/Tehran', 'YYYYMMDD')
    || '-'
    || upper(substr(replace(v_snapshot.id::text, '-', ''), 1, 12));

  insert into public.warehouse_documents (
    doc_number,
    type,
    status,
    created_by,
    created_at,
    finalized_at,
    note,
    document_kind,
    source_snapshot_id
  ) values (
    v_document_number,
    'in'::public.warehouse_document_type,
    'final'::public.warehouse_document_status,
    v_actor,
    v_snapshot.imported_at,
    v_snapshot.imported_at,
    concat_ws(
      ' · ',
      'سند اصلاحی موجودی اول دوره',
      nullif(v_snapshot.file_name, ''),
      nullif(v_snapshot.notes, '')
    ),
    'opening_balance',
    v_snapshot.id
  )
  on conflict (source_snapshot_id) where source_snapshot_id is not null
  do update set
    document_kind = 'opening_balance',
    status = 'final'::public.warehouse_document_status,
    note = excluded.note,
    finalized_at = excluded.finalized_at
  returning id into v_document_id;

  return v_document_id;
end;
$$;

create or replace function public.fn_materialize_warehouse_opening_document(p_snapshot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
begin
  v_document_id := public.fn_ensure_warehouse_opening_document(p_snapshot_id);

  insert into public.warehouse_document_lines (
    document_id,
    item_id,
    quantity,
    reason,
    note,
    tx_id,
    source_snapshot_item_id
  )
  select
    v_document_id,
    wsi.item_id,
    wsi.quantity,
    'opening_balance',
    'موجودی اول دوره ثبت‌شده از ورود اطلاعات انبار',
    null,
    wsi.id
  from public.warehouse_snapshot_items wsi
  where wsi.snapshot_id = p_snapshot_id
    and wsi.item_id is not null
    and wsi.quantity > 0
  on conflict (source_snapshot_item_id)
  do update set
    document_id = excluded.document_id,
    item_id = excluded.item_id,
    quantity = excluded.quantity,
    reason = excluded.reason,
    note = excluded.note,
    removed_at = null;

  delete from public.warehouse_document_lines wdl
  where wdl.document_id = v_document_id
    and wdl.source_snapshot_item_id is not null
    and not exists (
      select 1
      from public.warehouse_snapshot_items wsi
      where wsi.id = wdl.source_snapshot_item_id
        and wsi.snapshot_id = p_snapshot_id
        and wsi.item_id is not null
        and wsi.quantity > 0
    );

  return v_document_id;
end;
$$;

create or replace function public.trg_warehouse_snapshot_opening_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_ensure_warehouse_opening_document(new.id);
  return new;
end;
$$;

create or replace function public.trg_warehouse_snapshot_item_opening_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
begin
  v_document_id := public.fn_ensure_warehouse_opening_document(new.snapshot_id);

  if new.item_id is null or new.quantity <= 0 then
    delete from public.warehouse_document_lines
    where source_snapshot_item_id = new.id;
    return new;
  end if;

  insert into public.warehouse_document_lines (
    document_id,
    item_id,
    quantity,
    reason,
    note,
    tx_id,
    source_snapshot_item_id
  ) values (
    v_document_id,
    new.item_id,
    new.quantity,
    'opening_balance',
    'موجودی اول دوره ثبت‌شده از ورود اطلاعات انبار',
    null,
    new.id
  )
  on conflict (source_snapshot_item_id)
  do update set
    document_id = excluded.document_id,
    item_id = excluded.item_id,
    quantity = excluded.quantity,
    reason = excluded.reason,
    note = excluded.note,
    removed_at = null;

  return new;
end;
$$;

drop trigger if exists trg_warehouse_snapshot_opening_document on public.warehouse_snapshots;
create trigger trg_warehouse_snapshot_opening_document
after insert or update of file_name, notes on public.warehouse_snapshots
for each row execute function public.trg_warehouse_snapshot_opening_document();

drop trigger if exists trg_warehouse_snapshot_item_opening_line on public.warehouse_snapshot_items;
create trigger trg_warehouse_snapshot_item_opening_line
after insert or update of snapshot_id, item_id, quantity, matched on public.warehouse_snapshot_items
for each row execute function public.trg_warehouse_snapshot_item_opening_line();

-- Backfill every existing import. This only creates document headers/lines and
-- deliberately creates no warehouse_transaction, so inventory stays unchanged.
do $$
declare
  v_snapshot record;
begin
  for v_snapshot in
    select id from public.warehouse_snapshots order by imported_at, id
  loop
    perform public.fn_materialize_warehouse_opening_document(v_snapshot.id);
  end loop;
end $$;

-- Count corrections and manually entered opening quantities become their own
-- final adjustment documents. Normal IN/OUT movements keep using draft docs.
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
  v_doc_number text;
  v_is_adjustment boolean;
  v_document_kind text;
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

  v_is_adjustment := coalesce(p_reason, '') in ('count_correction', 'opening_balance');
  v_document_kind := case when p_reason = 'opening_balance' then 'opening_balance' else 'adjustment' end;

  if v_is_adjustment then
    v_doc_number := case when p_reason = 'opening_balance' then 'WH-OPEN-' else 'WH-ADJ-' end
      || to_char(now() at time zone 'Asia/Tehran', 'YYYY')
      || '-'
      || lpad(nextval('public.warehouse_adjustment_doc_seq')::text, 5, '0');

    insert into public.warehouse_documents (
      doc_number,
      type,
      status,
      created_by,
      finalized_at,
      note,
      document_kind
    ) values (
      v_doc_number,
      p_direction::public.warehouse_document_type,
      'final'::public.warehouse_document_status,
      auth.uid(),
      now(),
      case
        when p_reason = 'opening_balance' then concat_ws(' · ', 'سند اصلاحی موجودی اول دوره', nullif(p_note, ''))
        else concat_ws(' · ', 'سند اصلاح موجودی', nullif(p_note, ''))
      end,
      v_document_kind
    ) returning id into v_doc_id;
  else
    v_doc_id := public.fn_get_or_create_open_draft(p_direction);
    v_document_kind := 'movement';
  end if;

  v_tx_type := public.fn_warehouse_tx_type_from_direction(p_direction, true);

  insert into public.warehouse_transactions (
    item_id,
    transaction_type,
    quantity,
    reference_type,
    reference_id,
    document_id,
    created_by,
    note
  ) values (
    p_item_id,
    v_tx_type,
    p_quantity,
    case when v_is_adjustment then v_document_kind else null end,
    case when v_is_adjustment then v_doc_id else null end,
    v_doc_id,
    auth.uid(),
    coalesce(p_reason, p_direction) || coalesce(' - ' || p_note, '')
  ) returning id into v_tx_id;

  insert into public.warehouse_document_lines (
    document_id,
    item_id,
    quantity,
    reason,
    note,
    tx_id
  ) values (
    v_doc_id,
    p_item_id,
    p_quantity,
    coalesce(p_reason, case when p_direction = 'in' then 'manual_in' else 'manual_out' end),
    p_note,
    v_tx_id
  );

  return jsonb_build_object(
    'document_id', v_doc_id,
    'doc_number', (select doc_number from public.warehouse_documents where id = v_doc_id),
    'type', (select type from public.warehouse_documents where id = v_doc_id),
    'status', (select status from public.warehouse_documents where id = v_doc_id),
    'document_kind', v_document_kind
  );
end;
$$;

-- Snapshot-backed opening documents are audit records and must never generate
-- a reversing stock transaction when someone tries to delete them.
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
  select * into v_doc
  from public.warehouse_documents
  where id = p_document_id
  for update;

  if not found then raise exception 'سند یافت نشد'; end if;
  if v_doc.created_by <> auth.uid() and not public.is_admin() then raise exception 'دسترسی ندارید'; end if;

  if v_doc.document_kind = 'opening_balance' then
    raise exception 'سند موجودی اول دوره سیستمی و محافظت‌شده است؛ اصلاح موجودی را با سند اصلاحی جدید انجام دهید';
  end if;

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
    select *
    from public.warehouse_document_lines
    where document_id = p_document_id
      and removed_at is null
  loop
    v_tx_type := case
      when v_doc.type::text = 'out' then 'receipt'::public.warehouse_transaction_type
      else 'issue'::public.warehouse_transaction_type
    end;

    insert into public.warehouse_transactions (
      item_id,
      transaction_type,
      quantity,
      document_id,
      created_by,
      note
    ) values (
      v_line.item_id,
      v_tx_type,
      v_line.quantity,
      p_document_id,
      auth.uid(),
      'cancel_document: برگشت اثر سند '
        || coalesce(v_doc.doc_number, p_document_id::text)
        || coalesce(' - ' || p_reason, '')
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
  wd.cancelled_at,
  wd.document_kind,
  wd.source_snapshot_id
from public.warehouse_documents wd
left join public.warehouse_document_lines wdl on wdl.document_id = wd.id
left join public.profiles p on p.id = wd.created_by
group by wd.id, p.full_name;

drop view if exists public.v_warehouse_kardex;
create view public.v_warehouse_kardex
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (wsi.item_id)
    wsi.item_id,
    wsi.quantity as snapshot_qty,
    s.id as snapshot_id,
    s.imported_at as snapshot_imported_at,
    opening_doc.id as opening_document_id,
    opening_doc.doc_number as opening_doc_number,
    opening_doc.status as opening_document_status
  from public.warehouse_snapshot_items wsi
  join public.warehouse_snapshots s on s.id = wsi.snapshot_id
  left join public.warehouse_documents opening_doc
    on opening_doc.source_snapshot_id = s.id
   and opening_doc.document_kind = 'opening_balance'
  where wsi.item_id is not null
  order by wsi.item_id, s.imported_at desc, opening_doc.created_at desc nulls last
), finance_line as (
  select distinct on (i.warehouse_item_id, d.id)
    i.warehouse_item_id,
    d.id as finance_document_id,
    d.doc_number as finance_doc_number,
    d.document_type,
    fp.display_name as party_name,
    d.related_order_id,
    o.order_code,
    i.unit_price,
    i.line_total
  from public.finance_document_items i
  join public.finance_documents d on d.id = i.document_id
  left join public.finance_parties fp on fp.id = d.party_id
  left join public.orders o on o.id = d.related_order_id
  where i.warehouse_item_id is not null
  order by i.warehouse_item_id, d.id, i.line_no
), tx as (
  select
    wt.item_id,
    wi.item_code,
    wi.item_name_fa,
    wt.id as tx_id,
    wt.transaction_type,
    case when wt.transaction_type = 'issue' then 'out' else 'in' end as direction,
    wt.quantity,
    wt.document_id,
    wd.doc_number,
    wd.status as document_status,
    wt.reference_type,
    wt.reference_id,
    wt.created_by,
    wt.note,
    wt.created_at,
    ls.snapshot_imported_at,
    fl.party_name,
    fl.related_order_id,
    fl.order_code,
    fl.unit_price,
    fl.line_total,
    case
      when wd.document_kind in ('opening_balance', 'adjustment') then wd.document_kind
      when wt.reference_type = 'opening_balance' then 'opening_balance'
      when wt.reference_type = 'adjustment' then 'adjustment'
      when coalesce(wt.note, '') ilike '%موجودی اولیه%' then 'opening_balance'
      when wt.transaction_type = 'adjustment' or coalesce(wt.note, '') ilike 'count_correction%' then 'adjustment'
      else coalesce(wd.document_kind, 'movement')
    end as document_kind
  from public.warehouse_transactions wt
  join public.warehouse_items wi on wi.id = wt.item_id
  left join public.warehouse_documents wd on wd.id = wt.document_id
  left join latest_snapshot ls on ls.item_id = wt.item_id
  left join finance_line fl
    on fl.finance_document_id = wt.reference_id
   and fl.warehouse_item_id = wt.item_id
), historical as (
  select
    t.*,
    sum(
      case
        when t.transaction_type = 'issue' then -t.quantity
        when t.transaction_type in ('receipt', 'reversal', 'adjustment') then t.quantity
        else 0
      end
    ) over (
      partition by t.item_id
      order by t.created_at, t.tx_id
      rows between unbounded preceding and current row
    ) as running_balance
  from tx t
  where t.snapshot_imported_at is not null
    and t.created_at <= t.snapshot_imported_at
), after_snapshot as (
  select
    t.*,
    coalesce(ls.snapshot_qty, 0) + sum(
      case
        when t.transaction_type = 'issue' then -t.quantity
        when t.transaction_type in ('receipt', 'reversal', 'adjustment') then t.quantity
        else 0
      end
    ) over (
      partition by t.item_id
      order by t.created_at, t.tx_id
      rows between unbounded preceding and current row
    ) as running_balance
  from tx t
  left join latest_snapshot ls on ls.item_id = t.item_id
  where t.snapshot_imported_at is null
     or t.created_at > t.snapshot_imported_at
), opening as (
  select
    ls.item_id,
    wi.item_code,
    wi.item_name_fa,
    ls.snapshot_id as tx_id,
    'adjustment'::public.warehouse_transaction_type as transaction_type,
    'in'::text as direction,
    ls.snapshot_qty as quantity,
    ls.opening_document_id as document_id,
    coalesce(ls.opening_doc_number, 'موجودی اول دوره') as doc_number,
    ls.opening_document_status as document_status,
    'snapshot'::text as reference_type,
    ls.snapshot_id as reference_id,
    null::uuid as created_by,
    'موجودی اول دوره / ورود اطلاعات انبار'::text as note,
    ls.snapshot_imported_at as created_at,
    ls.snapshot_imported_at,
    null::text as party_name,
    null::uuid as related_order_id,
    null::text as order_code,
    null::numeric as unit_price,
    null::numeric as line_total,
    'opening_balance'::text as document_kind,
    ls.snapshot_qty as running_balance
  from latest_snapshot ls
  join public.warehouse_items wi on wi.id = ls.item_id
), combined as (
  select * from historical
  union all
  select * from opening
  union all
  select * from after_snapshot
)
select
  item_id,
  item_code,
  item_name_fa,
  tx_id,
  transaction_type,
  direction,
  quantity,
  document_id,
  doc_number,
  document_status,
  reference_type,
  reference_id,
  created_by,
  note,
  created_at,
  running_balance,
  party_name,
  related_order_id,
  order_code,
  unit_price,
  line_total,
  document_kind,
  (document_kind = 'opening_balance') as is_opening_balance,
  (document_kind in ('opening_balance', 'adjustment') or transaction_type = 'adjustment') as is_adjustment
from combined;

grant execute on function public.fn_materialize_warehouse_opening_document(uuid) to authenticated;
grant execute on function public.fn_record_stock_movement(uuid,text,numeric,text,text) to authenticated;
grant execute on function public.fn_cancel_warehouse_document(uuid,text) to authenticated;
grant select on public.v_warehouse_documents_summary to authenticated;
grant select on public.v_warehouse_kardex to authenticated;

notify pgrst, 'reload schema';

commit;
