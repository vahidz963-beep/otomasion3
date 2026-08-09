# رفع خطاهای Production و R&D

تاریخ: 2026-08-09

این نسخه دو خطای آنلاین را رفع می‌کند:

## خطا ۱
`column "created_by" of relation "order_events" does not exist`

علت: جدول `order_events` در نسخه قدیمی ستون `actor_id` داشت اما بعضی RPCهای جدید تولید/R&D با نام `created_by` می‌نوشتند.

راه‌حل: Migration شماره 024 ستون سازگار `created_by` را اضافه می‌کند و داده‌های قبلی را از `actor_id` پر می‌کند.

## خطا ۲
`column v_warehouse_current_stock.available_for_sale_qty does not exist`

علت: در هوک‌های تولید/R&D از view موجودی قدیمی خوانده می‌شد ولی ستون `available_for_sale_qty` در آن view نبود.

راه‌حل:
- فرانت تولید و R&D به `v_sales_stock_overview` وصل شد.
- همچنین Migration شماره 024 ستون‌های `reserved_qty` و `available_for_sale_qty` را به انتهای `v_warehouse_current_stock` اضافه می‌کند تا سازگاری کامل ایجاد شود.

## SQL لازم

در Supabase اجرا کن:

`supabase/migrations/024_fix_production_rnd_order_events_and_stock_view.sql`

اگر خطا داد، ادامه نده و عکس/متن خطا را بفرست.

## Build

Build با `npm run build` موفق بود.
