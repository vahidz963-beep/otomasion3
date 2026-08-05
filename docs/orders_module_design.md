# طراحی و پیاده‌سازی ماژول سفارش‌ها

## هدف

ماژول سفارش‌ها ستون فقرات اتوماسیون است و باید نمای کامل مسیر سفارش را از ثبت تا تحویل، تسویه، انبار، تولید، R&D و CRM نشان دهد.

## فایل‌های پیش‌نمایش HTML

- `orders_module_preview_v1.html` — اسکلت اولیه
- `orders_module_preview_v2.html` — مراحل خطی، درصد پیشرفت، روز مانده تا تحویل
- `orders_module_preview_v3.html` — اتصال نمایشی انبار و موجودی فروش
- `orders_module_preview_v4.html` — قالب مراحل ۴ تا ۱۲ مرحله‌ای قابل تنظیم توسط مدیر فروش
- `orders_module_preview_v5.html` — CRM مشتریان، پیگیری‌ها، قیف فروش
- `orders_module_preview_v6.html` — روش ارتباط، خروجی Excel/PDF، فیلتر ماهانه، تاریخ ثبت سفارش و اصلاح چیدمان

## بک‌اند

فایل:

- `supabase/migrations/009_orders_backend_workflow.sql`

امکانات:

- قالب مراحل سفارش: `order_workflow_templates`
- مراحل قالب: `order_workflow_template_steps`
- مراحل واقعی هر سفارش: `order_stage_instances`
- تاریخچه سفارش: `order_events`
- CRM: `crm_interactions`, `crm_followups`, `crm_opportunities`
- موجودی قابل فروش: `v_sales_stock_overview`
- وضعیت موجودی سفارش: `v_order_stock_status`
- رزرو موجودی: `order_inventory_reservations`
- نمای چرخه سفارش: `v_order_lifecycle_overview`
- CRM overview: `v_crm_customer_overview`, `v_crm_due_followups`
- ساخت پیش‌فاکتور از سفارش: `fn_create_sales_proforma_from_order`
- ساخت فاکتور از سفارش: `fn_create_sales_invoice_from_order`
- تغییر مرحله سفارش: `fn_set_order_stage`
- ارجاع سفارش: `fn_create_order_referral`

## فرانت‌اند React

فایل‌ها:

- `src/lib/orderApi.js`
- `src/hooks/useOrdersData.js`
- `src/modules/orders/OrdersModule.jsx`
- `src/modules/orders/OrdersModule.css`

تب‌های اصلی:

- نمای کلی
- CRM مشتریان
- مراحل سفارش
- لیست سفارش‌ها
- موجودی انبار
- تنظیم مراحل

## اتصال با مالی

ماژول سفارش‌ها به توابع مالی متصل است:

- `fn_create_sales_proforma_from_order`
- `fn_create_sales_invoice_from_order`
- `v_order_lifecycle_overview` وضعیت مالی را از `finance_documents` محاسبه می‌کند.

## اتصال با انبار

- فروش موجودی قابل فروش را از `v_sales_stock_overview` می‌بیند.
- وضعیت هر سفارش از `v_order_stock_status` محاسبه می‌شود.
- رزرو موجودی با `fn_reserve_order_inventory` انجام می‌شود.

## تصمیم طراحی مراحل

تعداد مراحل هنگام ثبت سفارش دستی تعیین نمی‌شود. مدیر فروش در تنظیمات، قالب‌های ۴ تا ۱۲ مرحله‌ای تعریف می‌کند. هنگام ثبت سفارش فقط قالب مناسب انتخاب می‌شود. این کار باعث نظم گزارش‌ها و یکپارچگی مسیر سفارش‌ها می‌شود.

## ماژول انبار — شروع پیاده‌سازی React و بک‌اند

فایل‌های جدید انبار:

- `warehouse_module_preview_v2.html` — پیش‌نمایش HTML اصلاح‌شده بر اساس نیازهای انبار.
- `supabase/migrations/014_warehouse_documents_kardex_backend.sql` — اسناد ورود/خروج، سند موقت خروج، کاردکس، قیمت مرجع، RPCها.
- `src/lib/warehouseApi.js` — توابع ارتباط با Supabase برای انبار.
- `src/hooks/useWarehouseData.js` — دریافت موجودی، اسناد، سند موقت، کاردکس، همگام‌سازی و ارجاعات.
- `src/modules/warehouse/WarehouseModule.jsx` و CSS — ماژول React واقعی انبار.

