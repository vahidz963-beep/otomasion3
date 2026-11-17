-- Migration 150b: تکمیل دسترسی REST پل وردپرس — زنجیرهٔ کامل نمای کاتالوگ
--
-- v_app_inventory_catalog با security_invoker=true ساخته شده؛ یعنی با نقش فراخوان اجرا می‌شود و
-- به نما‌های زیر هم نیاز دارد. همهٔ آن‌ها فقط به authenticated گرنت بودند → با کلید service_roleِ
-- پل وردپرس خطا می‌داد. (service_role از RLS و گرنت‌های خودش عبور می‌کند؛ کلید فقط در PHP سایت است.)
-- اجرای مجدد بی‌اثر است (idempotent).

grant select on public.v_app_inventory_catalog to service_role;
grant select on public.v_sales_stock_overview to service_role;
grant select on public.v_warehouse_current_stock to service_role;
grant select on public.v_finance_item_last_sale to service_role;
grant select on public.warehouse_items to service_role;
