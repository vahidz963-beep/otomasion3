-- =====================================================================
-- 138_WAREHOUSE_AUTO_RECEIPT_DOCUMENT_NUMBERS
-- رسیدهای خودکار «ورود اقلام فاکتور خرید» باید مثل بقیه اسناد انبار
-- شماره سند قطعی بگیرند و در شرح سند، فاکتور خرید مبدأ و شماره سند
-- انبار به‌صورت صریح نوشته شود.
--
-- قواعد:
--  1) هر سند «ورود» نهایی که بدون شماره ساخته شود (فقط مسیر سینک
--     فاکتور خرید) بلافاصله شماره «WH-IN-<سال جلالی>-<شماره>» می‌گیرد.
--  2) سندهای موقت (draft) دست‌نخورده می‌مانند؛ شماره‌گذاری آن‌ها همچنان
--     در لحظه «ثبت نهایی» انجام می‌شود تا رفتار فعلی تغییر نکند.
--  3) همه سندهای ورود نهاییِ بدون شمارهٔ موجود، Idempotent شماره و
--     شرح آنها تکمیل می‌شود.
--  4) هیچ ردیف تراکنش، خط سند یا سوابقی حذف یا منتقل نمی‌شود؛ فقط
--     شماره و شرح تکمیل می‌شود.
-- =====================================================================

create or replace function public.fn_assign_warehouse_auto_doc_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- فقط سند ورودِ «نهاییِ» بدون شماره؛ یعنی رسید خودکار سینک فاکتور خرید.
  -- اسناد موقت و خروج‌ها از مسیرهای خودشان شماره می‌گیرند.
  if new.type::text = 'in'
     and new.status::text = 'final'
     and (new.doc_number is null or btrim(new.doc_number) = '') then
    new.doc_number := 'WH-IN-'
      || public.fn_jalali_year(coalesce(new.created_at::date, current_date))
      || '-'
      || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
    if new.note is null or new.note = '' then
      new.note := 'سند ورود نهایی؛ شماره سند انبار: ' || new.doc_number;
    elsif position('شماره سند انبار:' in new.note) = 0 then
      new.note := new.note || ' — از طریق فاکتور خرید مبدأ؛ شماره سند انبار: ' || new.doc_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_warehouse_auto_doc_number on public.warehouse_documents;
create trigger trg_assign_warehouse_auto_doc_number
before insert on public.warehouse_documents
for each row execute function public.fn_assign_warehouse_auto_doc_number();

-- تکمیل Idempotent سندهای قبلیِ ساخته‌شده توسط Migration 130 (بدون شماره).
do $$
declare
  v_row record;
  v_number text;
begin
  for v_row in
    select id, created_at, note
    from public.warehouse_documents
    where type::text = 'in'
      and status::text = 'final'
      and (doc_number is null or btrim(doc_number) = '')
    order by created_at, id
  loop
    v_number := 'WH-IN-'
      || public.fn_jalali_year(coalesce(v_row.created_at::date, current_date))
      || '-'
      || lpad(nextval('public.warehouse_in_doc_seq')::text, 4, '0');
    update public.warehouse_documents
    set doc_number = v_number,
        note = case
          when v_row.note is null or v_row.note = ''
            then 'ورود خودکار اقلام فاکتور خرید — از طریق فاکتور خرید مبدأ؛ شماره سند انبار: ' || v_number
          when position('شماره سند انبار:' in v_row.note) > 0
            then v_row.note
          else v_row.note || ' — از طریق فاکتور خرید مبدأ؛ شماره سند انبار: ' || v_number
        end
    where id = v_row.id
      and (doc_number is null or btrim(doc_number) = '');
  end loop;
end;
$$;

-- قرارداد پایدار: هیچ سند ورود نهایی‌ای بدون شماره نماند.
do $$
begin
  if (select count(*) from public.warehouse_documents
      where type::text = 'in' and status::text = 'final'
        and (doc_number is null or btrim(doc_number) = '')) > 0 then
    raise exception 'قرارداد شماره‌گذاری رسید خودکار برقرار نشد؛ سند ورود نهایی بدون شماره باقی مانده است';
  end if;
end;
$$;
