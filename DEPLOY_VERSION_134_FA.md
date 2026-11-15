# راهنمای استقرار نسخه ۱۳۴ — ارسال جزئی سفارش و خروج اتمیک انبار

تاریخ: 2026-10-19  
نسخه برنامه: `134.0.0`  
پروژه Supabase: `wsmtxzkdmdkdqjlbkezx`

## هشدار مهم درباره Migration 125

SQL فایل `125_repair_accidental_legacy_migration_replay.sql` قبلاً روی دیتابیس واقعی به‌صورت دستی اجرا شده، ولی Version آن هنوز در Remote Migration History ثبت نشده است. بنابراین **نباید SQL 125 دوباره اجرا شود**؛ فقط History آن باید به `applied` Repair شود.

## ترتیب امن استقرار

### ۱. تهیه Backup

پیش از Migration 126 یک Backup قابل بازیابی از دیتابیس واقعی تهیه کنید. Migration 126 حذف فیزیکی تاریخچه ارسال ندارد، اما منطق رزرو و خروج انبار را عوض می‌کند.

### ۲. کنترل و Repair کردن History مربوط به 125

در Windows PowerShell از `npx.cmd` استفاده کنید؛ Execution Policy را تغییر ندهید:

```powershell
npx.cmd --yes supabase@latest migration list --project-ref wsmtxzkdmdkdqjlbkezx
```

اگر `125` در ستون Remote به‌صورت Applied دیده نمی‌شود، فقط History را اصلاح کنید:

```powershell
npx.cmd --yes supabase@latest migration repair --status applied 125 --project-ref wsmtxzkdmdkdqjlbkezx
```

سپس دوباره `migration list` را کنترل کنید. 125 باید Applied باشد.

### ۳. Dry-run اجباری

```powershell
npx.cmd --yes supabase@latest db push --dry-run --project-ref wsmtxzkdmdkdqjlbkezx
```

خروجی مجاز باید فقط Migration زیر را برای اجرا نشان دهد:

```text
126_order_driven_partial_shipments.sql
```

اگر 001، 002، 003، 119، 123، 124 یا 125 در فهرست اجرای Dry-run ظاهر شد، ادامه ندهید و History را اصلاح کنید.

### ۴. اجرای Migration 126

```powershell
npx.cmd --yes supabase@latest db push --project-ref wsmtxzkdmdkdqjlbkezx
```

این Migration:

- Triggerهای تولید خودکار محموله از فاکتور، سفارش، تولید، R&D و سند خروج عمومی را قطع می‌کند.
- خطوط ساختاریافته محموله را اضافه می‌کند.
- رزرو پس از فاکتور را جایگزین خروج زودهنگام می‌کند.
- ثبت ارسال جزئی و برگشت را اتمیک می‌کند.
- رکوردهای قدیمی ناسازگار/تکراری را بدون حذف بایگانی و طبقه‌بندی می‌کند.
- Viewهای ارسال و پیشرفت اقلام سفارش را بازسازی می‌کند.

### ۵. Refresh کردن Schema Cache

Migration در پایان `notify pgrst, 'reload schema'` دارد. پس از اجرا ۳۰ تا ۶۰ ثانیه صبر کنید و در صورت نیاز یک بار صفحه برنامه را Hard Refresh کنید.

### ۶. استقرار Frontend

این نسخه Edge Function جدیدی ندارد و `calculator-api` نسخه ۱۳۳ نیاز به Deploy دوباره ندارد.

در CI یا محیط Build:

```bash
npm ci
npm run check
```

سپس خروجی Vite نسخه `134.0.0` را روی سایت مستقر کنید.

## آزمون دود عملیاتی

آزمون را با یک سفارش تستی و یک کالای دارای موجودی انجام دهید:

1. سفارش با دو قلم بسازید و فاکتور فروش آن را تأیید کنید.
2. کنترل کنید تأیید فاکتور فقط رزرو ساخته و موجودی قطعی کم نشده باشد.
3. داخل سفارش، «ثبت ارسال جدید» را باز کنید.
4. از قلم اول بخشی از تعداد و از قلم دوم صفر ثبت کنید.
5. کنترل کنید یک محموله، یک سند خروج نهایی و خطوط دقیق ساخته شده باشد.
6. موجودی قلم اول باید فقط به اندازه همین ارسال کم شده باشد.
7. مانده قلم اول و کل مانده قلم دوم باید در سفارش دیده شود.
8. ارسال دوم را برای مانده ثبت کنید؛ هر دو محموله باید جداگانه در مدیریت ارسال‌ها دیده شوند.
9. پایان یک تولید متصل را تست کنید؛ محصول باید وارد انبار شود ولی محموله مشتری خودکار ساخته نشود.
10. یک سند خروج داخلی تولید/R&D ثبت کنید؛ نباید در لیست ارسال مشتری ظاهر شود.
11. یک ثبت دستی متنی بسازید؛ نباید موجودی یا کاردکس را تغییر دهد.
12. روی یک محموله تستی «برگشت ارسال» بزنید؛ سند ورود، افزایش موجودی، وضعیت لغو و مانده قابل ارسال باید هم‌زمان دیده شوند.
13. بایگانی را تست کنید؛ ردیف از فهرست فعال پنهان شود ولی سند و کاردکس باقی بمانند.

## Queryهای بررسی اختیاری

```sql
-- هر محموله با خطوط خودش؛ چند محموله یک سفارش مجاز است.
select shipment_number, order_code, status, shipment_date, line_items
from public.v_warehouse_shipment_overview
order by shipment_date desc, created_at desc
limit 30;

-- مانده دقیق اقلام یک سفارش
select *
from public.v_order_shipment_item_progress
where order_id = '<ORDER_UUID>';

-- اطمینان از قطع Triggerهای قدیمی تولید محموله
select event_object_table, trigger_name
from information_schema.triggers
where trigger_name in (
  'trg_warehouse_shipment_sync',
  'trg_warehouse_order_final_shipment',
  'trg_warehouse_production_final_shipment',
  'trg_warehouse_rnd_final_shipment',
  'trg_finance_issue_inventory_on_approval',
  'trg_finance_inventory_issue_after_approval'
);
```

Query آخر باید صفر ردیف برگرداند.

## بازگشت امن

- Migration 126 را با `DELETE` یا حذف جدول‌ها Rollback نکنید.
- برای خطای رابط، می‌توان Frontend را موقتاً به نسخه قبل برگرداند، اما Checkbox نسخه قدیمی عمداً در دیتابیس خطای راهنما می‌دهد و دیگر خروج انبار انجام نمی‌دهد.
- برگشت عملیات تجاری از دکمه «برگشت ارسال» انجام شود تا سند ورود و Audit Trail باقی بماند.
- هیچ محموله، سند، تراکنش، رزرو یا سابقه مالی را فیزیکی حذف نکنید.
