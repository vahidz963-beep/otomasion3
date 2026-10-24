-- ============================================================================
-- 130_PURCHASE_INVOICE_INVENTORY_SYNC
-- Final purchase invoices create one idempotent IN document. Confirmed edits
-- append only quantity deltas; void appends an audited reversal. Historical
-- invoices are exposed through a dry-run reconciliation view before applying.
-- ============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.finance_documents
  add column if not exists warehouse_receipt_document_id uuid references public.warehouse_documents(id) on delete set null,
  add column if not exists purchase_inventory_sync_state text not null default 'not_synced'
    check (purchase_inventory_sync_state in ('not_synced','not_applicable','synced','delta_synced','void_reversed','review_required','failed')),
  add column if not exists purchase_inventory_revision_no integer not null default 0,
  add column if not exists purchase_inventory_last_synced_at timestamptz,
  add column if not exists purchase_inventory_sync_note text;

create unique index if not exists uq_finance_purchase_receipt_document
  on public.finance_documents(warehouse_receipt_document_id)
  where warehouse_receipt_document_id is not null;

insert into public.system_settings(key,value)
values ('purchase_inventory_sync_started_at',to_jsonb(clock_timestamp()::text))
on conflict(key) do nothing;

create table if not exists public.finance_purchase_inventory_sync_audit (
  id uuid primary key default gen_random_uuid(),
  finance_document_id uuid not null references public.finance_documents(id) on delete restrict,
  warehouse_document_id uuid references public.warehouse_documents(id) on delete restrict,
  revision_no integer not null default 0,
  mode text not null check (mode in ('initial','delta','idempotent','not_applicable','historical_review','void_reversal')),
  reason text,
  adjustments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_inventory_audit_document
  on public.finance_purchase_inventory_sync_audit(finance_document_id,created_at desc);

alter table public.finance_purchase_inventory_sync_audit enable row level security;
drop policy if exists purchase_inventory_sync_audit_read on public.finance_purchase_inventory_sync_audit;
create policy purchase_inventory_sync_audit_read
on public.finance_purchase_inventory_sync_audit for select to authenticated
using (public.has_role(array['admin','accountant','warehouse']));

grant select on public.finance_purchase_inventory_sync_audit to authenticated,service_role;
revoke insert,update,delete on public.finance_purchase_inventory_sync_audit from authenticated;

create or replace function public.fn_purchase_invoice_has_manual_receipt_risk(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.finance_documents d
    join public.finance_document_items fi on fi.document_id=d.id and fi.warehouse_item_id is not null
    join public.warehouse_transactions wt
      on wt.item_id=fi.warehouse_item_id
     and wt.transaction_type::text in ('receipt','reversal','adjustment')
     and wt.quantity=fi.quantity
     and wt.created_at::date between d.issue_date-3 and d.issue_date+3
    where d.id=p_document_id
      and not (wt.reference_type='purchase_invoice' and wt.reference_id=d.id)
  );
$$;

create or replace function public.fn_sync_purchase_invoice_inventory(
  p_document_id uuid,
  p_reason text default null,
  p_force_historical boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_wh public.warehouse_documents%rowtype;
  v_actor uuid := auth.uid();
  v_cutoff timestamptz;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason,'')),''),'تأیید نهایی/اصلاح فاکتور خرید');
  v_line record;
  v_tx_id uuid;
  v_line_id uuid;
  v_delta numeric;
  v_stock numeric;
  v_revision integer;
  v_adjustments jsonb := '[]'::jsonb;
  v_adjustment_count integer := 0;
  v_desired_count integer := 0;
  v_is_initial boolean := false;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.has_role(array['admin','accountant','warehouse']) then
    raise exception 'دسترسی همگام‌سازی فاکتور خرید و انبار را ندارید';
  end if;

  select * into v_doc from public.finance_documents where id=p_document_id for update;
  if not found then raise exception 'فاکتور خرید یافت نشد'; end if;
  if v_doc.document_type::text <> 'purchase_invoice' then
    return jsonb_build_object('mode','not_purchase_invoice');
  end if;
  if v_doc.status::text not in ('approved','sent','partially_paid','paid') then
    raise exception 'ورود انبار فقط پس از تأیید نهایی فاکتور خرید مجاز است';
  end if;

  v_actor := coalesce(v_actor,v_doc.created_by);
  if v_actor is null then raise exception 'کاربر ثبت‌کننده سند انبار مشخص نیست'; end if;

  select (value #>> '{}')::timestamptz into v_cutoff
  from public.system_settings where key='purchase_inventory_sync_started_at';
  if v_doc.created_at < coalesce(v_cutoff,now())
     and not p_force_historical
     and public.fn_purchase_invoice_has_manual_receipt_risk(p_document_id) then
    update public.finance_documents
    set purchase_inventory_sync_state='review_required',
        purchase_inventory_sync_note='احتمال وجود رسید دستی هم‌تاریخ؛ نیازمند تأیید تطبیق تاریخی',
        updated_at=now()
    where id=p_document_id;
    insert into public.finance_purchase_inventory_sync_audit(
      finance_document_id,warehouse_document_id,revision_no,mode,reason,adjustments,created_by
    ) values(p_document_id,v_doc.warehouse_receipt_document_id,v_doc.purchase_inventory_revision_no,
      'historical_review',v_reason,'[]'::jsonb,v_actor);
    raise exception 'برای این فاکتور قدیمی رسید دستی مشابه دیده شد؛ ابتدا گزارش تطبیق را بررسی و سپس «اعمال با تأیید» را اجرا کنید';
  end if;

  select count(*) into v_desired_count
  from (
    select warehouse_item_id
    from public.finance_document_items
    where document_id=p_document_id and warehouse_item_id is not null and quantity>0
    group by warehouse_item_id
  ) q;

  if v_desired_count=0 then
    update public.finance_documents
    set purchase_inventory_sync_state='not_applicable',
        purchase_inventory_last_synced_at=now(),
        purchase_inventory_sync_note='فاکتور فاقد قلم متصل به انبار است',updated_at=now()
    where id=p_document_id;
    insert into public.finance_purchase_inventory_sync_audit(
      finance_document_id,revision_no,mode,reason,adjustments,created_by
    ) values(p_document_id,v_doc.purchase_inventory_revision_no,'not_applicable',v_reason,'[]'::jsonb,v_actor);
    return jsonb_build_object('mode','not_applicable','adjustments',0);
  end if;

  if v_doc.warehouse_receipt_document_id is null then
    insert into public.warehouse_documents(
      doc_number,type,status,created_by,created_at,finalized_at,note,
      finance_sync_state,finance_revision_no,finance_last_synced_at,finance_sync_note
    ) values(
      null,'in','final',v_actor,now(),now(),
      'ورود خودکار اقلام فاکتور خرید '||v_doc.doc_number||' — سند یکتا و قابل حسابرسی',
      'registered',0,now(),v_reason
    ) returning * into v_wh;
    update public.finance_documents
    set warehouse_receipt_document_id=v_wh.id
    where id=p_document_id;
    v_is_initial := true;
  else
    select * into v_wh from public.warehouse_documents
    where id=v_doc.warehouse_receipt_document_id for update;
    if not found then raise exception 'سند ورود مرتبط فاکتور یافت نشد'; end if;
    if v_wh.type::text<>'in' or v_wh.status::text<>'final' then
      raise exception 'سند ورود مرتبط باید نهایی و فعال باشد';
    end if;
  end if;

  v_revision := v_doc.purchase_inventory_revision_no+1;

  for v_line in
    with desired as (
      select warehouse_item_id as item_id,sum(quantity)::numeric as desired_qty
      from public.finance_document_items
      where document_id=p_document_id and warehouse_item_id is not null and quantity>0
      group by warehouse_item_id
    ), current_net as (
      select item_id,
        sum(case when transaction_type::text in ('receipt','reversal','adjustment') then quantity
                 when transaction_type::text='issue' then -quantity else 0 end)::numeric as current_qty
      from public.warehouse_transactions
      where reference_type='purchase_invoice' and reference_id=p_document_id
      group by item_id
    )
    select coalesce(d.item_id,c.item_id) as item_id,
      coalesce(d.desired_qty,0)::numeric as desired_qty,
      coalesce(c.current_qty,0)::numeric as current_qty
    from desired d full join current_net c on c.item_id=d.item_id
    order by coalesce(d.item_id,c.item_id)
  loop
    v_delta := round(v_line.desired_qty-v_line.current_qty,6);
    if v_delta=0 then continue; end if;

    if v_delta<0 then
      select coalesce(current_qty,0) into v_stock
      from public.v_warehouse_current_stock where item_id=v_line.item_id;
      if coalesce(v_stock,0)<abs(v_delta) then
        raise exception 'کاهش فاکتور خرید برای قلم % از موجودی فعلی بیشتر است؛ ابتدا مصرف/خروج وابسته را بررسی کنید',v_line.item_id;
      end if;
    end if;

    insert into public.warehouse_transactions(
      item_id,transaction_type,quantity,reference_type,reference_id,created_by,note,document_id
    ) values(
      v_line.item_id,
      case when v_delta>0 then 'receipt'::public.warehouse_transaction_type else 'issue'::public.warehouse_transaction_type end,
      abs(v_delta),'purchase_invoice',p_document_id,v_actor,
      case when v_is_initial then 'ورود خودکار فاکتور خرید ' else 'اصلاح مقداری فاکتور خرید ' end
        ||v_doc.doc_number||' — نسخه '||v_revision::text||': '||v_reason,
      v_wh.id
    ) returning id into v_tx_id;

    insert into public.warehouse_document_lines(document_id,item_id,quantity,reason,note,tx_id)
    values(
      v_wh.id,v_line.item_id,abs(v_delta),
      case when v_delta>0 then 'purchase_invoice_receipt' else 'purchase_invoice_delta_reversal' end,
      'نسخه '||v_revision::text||'؛ مقدار هدف '||v_line.desired_qty::text||'؛ مقدار قبلی '||v_line.current_qty::text,
      v_tx_id
    ) returning id into v_line_id;

    v_adjustments := v_adjustments||jsonb_build_array(jsonb_build_object(
      'item_id',v_line.item_id,'previous_quantity',v_line.current_qty,
      'desired_quantity',v_line.desired_qty,'delta',v_delta,
      'transaction_id',v_tx_id,'document_line_id',v_line_id
    ));
    v_adjustment_count := v_adjustment_count+1;
  end loop;

  update public.finance_documents
  set purchase_inventory_sync_state=case when v_is_initial then 'synced' else case when v_adjustment_count=0 then purchase_inventory_sync_state else 'delta_synced' end end,
      purchase_inventory_revision_no=case when v_adjustment_count>0 then v_revision else purchase_inventory_revision_no end,
      purchase_inventory_last_synced_at=now(),
      purchase_inventory_sync_note=case when v_adjustment_count=0 then 'بدون تغییر؛ اجرای Idempotent' else v_reason end,
      updated_at=now()
  where id=p_document_id;

  update public.warehouse_documents
  set finance_sync_state=case when v_adjustment_count=0 then finance_sync_state else 'edited_registered' end,
      finance_revision_no=case when v_adjustment_count>0 then finance_revision_no+1 else finance_revision_no end,
      finance_last_synced_at=now(),finance_sync_note=v_reason
  where id=v_wh.id;

  insert into public.finance_purchase_inventory_sync_audit(
    finance_document_id,warehouse_document_id,revision_no,mode,reason,adjustments,created_by
  ) values(
    p_document_id,v_wh.id,case when v_adjustment_count>0 then v_revision else v_doc.purchase_inventory_revision_no end,
    case when v_adjustment_count=0 then 'idempotent' when v_is_initial then 'initial' else 'delta' end,
    v_reason,v_adjustments,v_actor
  );

  return jsonb_build_object(
    'mode',case when v_adjustment_count=0 then 'idempotent' when v_is_initial then 'initial' else 'delta' end,
    'warehouse_document_id',v_wh.id,'warehouse_doc_number',v_wh.doc_number,
    'revision_no',case when v_adjustment_count>0 then v_revision else v_doc.purchase_inventory_revision_no end,
    'adjustments',v_adjustments,'adjustment_count',v_adjustment_count
  );
end;
$$;

create or replace function public.fn_reverse_purchase_invoice_inventory(
  p_document_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_doc public.finance_documents%rowtype;
  v_actor uuid:=auth.uid();
  v_line record;
  v_tx uuid;
  v_stock numeric;
  v_adjustments jsonb:='[]'::jsonb;
  v_reason text:=coalesce(nullif(trim(coalesce(p_reason,'')),''),'ابطال فاکتور خرید');
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.has_role(array['admin','accountant']) then
    raise exception 'دسترسی برگشت ورود فاکتور خرید را ندارید';
  end if;
  select * into v_doc from public.finance_documents where id=p_document_id for update;
  if not found or v_doc.document_type::text<>'purchase_invoice' then return jsonb_build_object('mode','not_purchase_invoice'); end if;
  if v_doc.warehouse_receipt_document_id is null then
    update public.finance_documents set purchase_inventory_sync_state='void_reversed',purchase_inventory_last_synced_at=now(),purchase_inventory_sync_note='سند ورود نداشت' where id=p_document_id;
    return jsonb_build_object('mode','no_receipt');
  end if;
  if v_doc.purchase_inventory_sync_state='void_reversed' then return jsonb_build_object('mode','idempotent'); end if;
  v_actor:=coalesce(v_actor,v_doc.created_by);

  for v_line in
    select item_id,sum(case when transaction_type::text in ('receipt','reversal','adjustment') then quantity when transaction_type::text='issue' then -quantity else 0 end) as net_qty
    from public.warehouse_transactions
    where reference_type='purchase_invoice' and reference_id=p_document_id
    group by item_id
    having sum(case when transaction_type::text in ('receipt','reversal','adjustment') then quantity when transaction_type::text='issue' then -quantity else 0 end)>0
    order by item_id
  loop
    select coalesce(current_qty,0) into v_stock from public.v_warehouse_current_stock where item_id=v_line.item_id;
    if coalesce(v_stock,0)<v_line.net_qty then
      raise exception 'ابطال امن ممکن نیست؛ از قلم % بخشی مصرف/خارج شده است. ابتدا گردش وابسته را برگشت دهید',v_line.item_id;
    end if;
    insert into public.warehouse_transactions(item_id,transaction_type,quantity,reference_type,reference_id,created_by,note,document_id)
    values(v_line.item_id,'issue',v_line.net_qty,'purchase_invoice',p_document_id,v_actor,
      'برگشت کنترل‌شده ورود به علت ابطال '||v_doc.doc_number||': '||v_reason,v_doc.warehouse_receipt_document_id)
    returning id into v_tx;
    insert into public.warehouse_document_lines(document_id,item_id,quantity,reason,note,tx_id)
    values(v_doc.warehouse_receipt_document_id,v_line.item_id,v_line.net_qty,'purchase_invoice_void_reversal',v_reason,v_tx);
    v_adjustments:=v_adjustments||jsonb_build_array(jsonb_build_object('item_id',v_line.item_id,'reversed_quantity',v_line.net_qty,'transaction_id',v_tx));
  end loop;

  update public.finance_documents
  set purchase_inventory_sync_state='void_reversed',purchase_inventory_revision_no=purchase_inventory_revision_no+1,
      purchase_inventory_last_synced_at=now(),purchase_inventory_sync_note=v_reason,updated_at=now()
  where id=p_document_id;
  update public.warehouse_documents
  set finance_sync_state='void_reversed',finance_revision_no=finance_revision_no+1,
      finance_last_synced_at=now(),finance_sync_note=v_reason
  where id=v_doc.warehouse_receipt_document_id;
  insert into public.finance_purchase_inventory_sync_audit(
    finance_document_id,warehouse_document_id,revision_no,mode,reason,adjustments,created_by
  ) values(p_document_id,v_doc.warehouse_receipt_document_id,v_doc.purchase_inventory_revision_no+1,'void_reversal',v_reason,v_adjustments,v_actor);
  return jsonb_build_object('mode','void_reversal','adjustments',v_adjustments);
end;
$$;

create or replace function public.fn_purchase_invoice_inventory_status_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.document_type::text='purchase_invoice' then
    if new.status::text='void' and old.status::text is distinct from 'void' then
      perform public.fn_reverse_purchase_invoice_inventory(new.id,coalesce(new.void_reason,'ابطال فاکتور خرید'));
    elsif new.status::text in ('approved','sent','partially_paid','paid')
      and old.status::text not in ('approved','sent','partially_paid','paid') then
      perform public.fn_sync_purchase_invoice_inventory(new.id,'تأیید نهایی فاکتور خرید',true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_invoice_inventory_status on public.finance_documents;
create trigger trg_purchase_invoice_inventory_status
after update of status on public.finance_documents
for each row execute function public.fn_purchase_invoice_inventory_status_trigger();

-- Migration 127 finishes an atomic confirmed-document edit by updating its
-- revision snapshot. Hook that final step so purchase inventory Delta is part
-- of the same database transaction, not a later browser-side best effort.
create or replace function public.fn_purchase_inventory_after_finance_revision()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.warehouse_sync_result is distinct from old.warehouse_sync_result
     and exists (
       select 1 from public.finance_documents d
       where d.id=new.document_id and d.document_type::text='purchase_invoice'
         and d.status::text in ('approved','sent','partially_paid','paid')
     ) then
    perform public.fn_sync_purchase_invoice_inventory(
      new.document_id,
      'اصلاح اتمیک نسخه '||new.revision_no::text||' فاکتور خرید: '||new.reason,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_inventory_after_finance_revision on public.finance_document_revision_snapshots;
create trigger trg_purchase_inventory_after_finance_revision
after update of warehouse_sync_result on public.finance_document_revision_snapshots
for each row execute function public.fn_purchase_inventory_after_finance_revision();

create or replace view public.v_purchase_invoice_inventory_reconciliation
with (security_invoker=true)
as
select
  d.id,d.doc_number,d.issue_date,d.created_at,d.status,d.party_id,p.display_name as party_name,
  d.total_amount,d.warehouse_receipt_document_id,wd.doc_number as warehouse_doc_number,
  d.purchase_inventory_sync_state,d.purchase_inventory_revision_no,d.purchase_inventory_last_synced_at,
  count(fi.id) filter(where fi.warehouse_item_id is not null)::integer as inventory_line_count,
  coalesce(sum(fi.quantity) filter(where fi.warehouse_item_id is not null),0) as inventory_quantity,
  ((select (value #>> '{}')::timestamptz from public.system_settings where key='purchase_inventory_sync_started_at')>d.created_at) as is_historical,
  public.fn_purchase_invoice_has_manual_receipt_risk(d.id) as possible_manual_receipt,
  case
    when count(fi.id) filter(where fi.warehouse_item_id is not null)=0 then 'not_applicable'
    when d.purchase_inventory_sync_state in ('synced','delta_synced','void_reversed') then 'done'
    when public.fn_purchase_invoice_has_manual_receipt_risk(d.id) then 'review_required'
    else 'ready'
  end as reconciliation_status
from public.finance_documents d
left join public.finance_parties p on p.id=d.party_id
left join public.finance_document_items fi on fi.document_id=d.id
left join public.warehouse_documents wd on wd.id=d.warehouse_receipt_document_id
where d.document_type::text='purchase_invoice'
group by d.id,p.display_name,wd.doc_number;

grant select on public.v_purchase_invoice_inventory_reconciliation to authenticated,service_role;
grant execute on function public.fn_sync_purchase_invoice_inventory(uuid,text,boolean) to authenticated,service_role;
grant execute on function public.fn_reverse_purchase_invoice_inventory(uuid,text) to authenticated,service_role;

commit;

notify pgrst, 'reload schema';
