-- Migration 150: دسترسی REST پل وردپرس (رفع خطای «همگام‌سازی کامل ناموفق بود»)
--
-- علت: افزونهٔ پل با کلید service_role از REST خوانده می‌کند:
--   GET /rest/v1/v_app_inventory_catalog  (همگام‌سازی کامل)
--   GET /rest/v1/warehouse_items          (تست اتصال)
-- نمای v_app_inventory_catalog با security_invoker ساخته شده و فقط به authenticated گرنت دارد؛
-- کلید service_role از API نقش service_role می‌گیرد نه authenticated → خطای permission.
-- امنیت: کلید service_role فقط در PHP سایت است (هرگز به مرورگر نمی‌رود) — دسترسی خواندنِ این دو
-- برای service_role بی‌خطر است و با RLS جدول‌ها تداخلی ندارد.

grant select on public.v_app_inventory_catalog to service_role;
grant select on public.warehouse_items to service_role;
