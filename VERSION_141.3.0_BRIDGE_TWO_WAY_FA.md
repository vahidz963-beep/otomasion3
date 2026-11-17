# نسخهٔ ۱۴۱.۳.۰ — پل انبار دوطرفهٔ کامل («همان‌لحظه‌ای» شد)

## حالت نهایی چرخهٔ فروش ↔ انبار
| جهت | محرک | سازکار | وضعیت |
|---|---|---|---|
| سایت → انبار | پرداخت موفق ووکامرس | پل وردپرس رویداد امضاشده می‌فرستد → Edge Function ثبت idempotent → **پردازش فوری** `fn_warehouse_bridge_process_event` → رزرو واقعی انبار | ✅ همان لحظه |
| سایت → انبار | لغو/برگشت سفارش | `order_release` → آزادسازی رزرو (BOM محاسبه یا رزرو عمومی) | ✅ همان لحظه |
| انبار → سایت | نهایی‌شدن سند خروج در اتوماسیون | UI انبار بعد از `finalize`/لغو سند نهایی، کدهای اقلام را به `push_stock_to_site` می‌فرستد → Edge Function موجودی قابل‌فروش را می‌خواند و با امضای HMAC به endpoint پل سایت می‌زند → موجودی محصول ووکامرس آپدیت | ✅ همان لحظه |
| انبار → سایت | دستی هر زمان | دکمهٔ «همگام‌سازی کامل موجودی» در تنظیمات پل | ✅ آماده |

## اجزای جدید
### Migration 148 — `supabase/migrations/148_warehouse_bridge_processor.sql`
- جدول `warehouse_bridge_reservations` (رزرو کالای عمومی سایت؛ RLS: فقط service_role می‌نویسد، authenticated فقط می‌خواند).
- **v_sales_stock_overview به‌روز شد:** «قابل رزرو» = موجودی − رزرو سفارش‌ها − رزروهای پل → رزرو سایت همان لحظه در موجودی قابل‌فروش اتوماسیون اثر می‌گذارد.
- `fn_warehouse_bridge_process_event(uuid)`: پردازش قطعی یک رویداد:
  - سفارش‌های مرکز محاسبه → کل BOM (هسته/بوبین/سیم/چسب) با منطق نسخهٔ ۱۲۳ رزرو؛ کمبود → رویداد «failed» با دلیل در جدول؛ تولیدشده‌ها دست‌نخورده.
  - لغو سایت → آزادسازی + علامت لغو محاسبه (به‌جز تولیدشده).
  - کالای عمومی → رزرو/آزادسازی در جدول پل (idempotent با event_id).
- `fn_warehouse_bridge_process_pending(limit)` + **pg_cron هر ۱ دقیقه** (در نبود pg_cron بی‌خطر رد می‌شود؛ Edge هم پردازش فوری دارد).
- فقط service_role اجرا می‌کند؛ همه‌چیز در `warehouse_bridge_events` ردیابی می‌شود (received/processed/failed + note).

### Edge Function `warehouse-bridge` (به‌روز شد)
- بعد از ثبت رویداد ورودی، همان لحظه `fn_warehouse_bridge_process_event` را صدا می‌زند و وضعیت (processed/queued) در پاسخ می‌آید.
- شاخهٔ جدید `push_stock_to_site`: فقط کاربر واردشدهٔ اتوماسیون با نقش admin/warehouse؛ خواندن موجودی قابل‌فروش اقلام و POST امضاشده به `<WOOCOMMERCE_SITE_URL>/wp-json/aryaman-bridge/v1/stock-update`؛ ثبت خروجی در جدول رویدادها (`stock_push_out`).
- **Secret جدید لازم:** `WOOCOMMERCE_SITE_URL` (آدرس سایت، بدون اسلش) — در همان مسیر Secretهای Supabase کنار WORDPRESS_SHARED_SECRET.

### اتوماسیون (src/lib/warehouseApi.js)
- بعد از موفقیت `finalizeWarehouseDocument` (سند خروج نهایی شد) و `cancelWarehouseDocument` → پوش بی‌صدها به پل (اگر ناموفق بود، همگام‌سازی دستی در پل جایگزین است؛ گردش کار انبار هیچ‌وقت بلاک نمی‌شود).

## تنظیمات کاربر (ترتیب اجرا)
1. Migrationها به ترتیب: ۱۴۲ → ۱۴۳ → ۱۴۴ → ۱۴۵ → ۱۴۶ → ۱۴۷ → **۱۴۸**
2. Secretهای Supabase: `WORDPRESS_SHARED_SECRET` + **`WOOCOMMERCE_SITE_URL`** (مثل `https://aryaman-co.ir`)
3. Deploy تابع `warehouse-bridge` (کد در FLAT).
4. نصب/به‌روزرسانی پل وردپرس v1.0.0؛ در تنظیمات پل: «راز مشترک HMAC» = همان WORDPRESS_SHARED_SECRET + فعال‌سازی.
5. نگاشت محصولات: SKU یا متای `_aryaman_item_code` = کد قلم انبار.

## تست
- Full Check EXIT=0 (Migration 148 روی PGlite هم PASS — باگ dollar-quote تو در تو رفع شد).
- package.json = 141.3.0؛ FLAT: `Otomasion2_DEPLOY_VERSION_141.3.0_FLAT.zip`.
