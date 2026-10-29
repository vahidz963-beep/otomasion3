# Otomasion2 — Company Automation System

سیستم اتوماسیون آنلاین شرکت کوچک، با React/Vite روی Netlify و Supabase به‌عنوان Auth/DB/Storage.

## وضعیت این نسخه

نسخه جاری `139.0.0` است. این انتشار سه ارتقای هماهنگ دارد: قرارداد `bank_name` داشبورد را در Migration مستقل و دائمی بازمی‌گرداند؛ چاپ رسمی/شرکتی را به چیدمان تأییدشده نسخه `136.0.1` برمی‌گرداند و در عین حال تک‌صفحه‌ای و Auto-fit سلولی را حفظ می‌کند؛ و «تسویه مستقیم هزینه» را به «حواله مستقیم» تعمیم می‌دهد تا یک مبلغ دریافتی از شخص مبدأ دقیقاً میان ردیف‌های هزینه یا پرداخت به اشخاص دیگر تقسیم شود. حواله مستقیم هیچ بانک یا صندوقی را درگیر نمی‌کند، سقف مانده بدهکار برای مبدأ ندارد و اصلاح/حذف آن فقط نسخه‌دار یا با ابطال امن و حفظ Audit است. تب اسناد سفارش نیز فاکتورها و پیش‌فاکتورها را در دو کارت فقط‌خواندنی با جست‌وجوی مستقل نمایش می‌دهد. راهنمای استقرار در `DEPLOY_VERSION_139_FA.md` است.

این نسخه، کدهای پراکنده‌ی قبلی را به یک ساختار اجرایی تبدیل کرده است:

- Frontend قابل build با Vite در `src/`
- Netlify Function مدیریت کاربران در `netlify/functions/admin-users.js`
- SQL migrations یکپارچه در `supabase/migrations/`
- قرارداد واحد نقش‌ها و RLS
- داشبورد اولیه، Login/Reset Password، پنل مدیریت کاربران، Audit Log، و ماژول R&D نمایشی

فایل‌های قدیمی و طرح‌های قبلی حذف نشده‌اند؛ برای مرجع در `docs/legacy/` قرار گرفته‌اند.

## نقش‌های نهایی سیستم

همه‌ی کد و SQL جدید فقط از این نقش‌ها استفاده می‌کند:

```txt
admin
sales
sales_manager
rnd
production
warehouse
accountant
office_admin
```

## ساختار مهم پروژه

```txt
src/
  auth/                  Login, Reset Password, AuthProvider
  components/admin/       User Management + Audit Log
  modules/dashboard/      Dashboard MVP
  modules/rnd/            R&D UI فعلی، هنوز mock/local state
  modules/placeholder/    Placeholder برای بخش‌های بعدی
  lib/                    Supabase client + roles
  hooks/                  data hooks

netlify/functions/
  admin-users.js          عملیات امن مدیریت کاربران با service_role

supabase/migrations/
  001_core_auth_profiles.sql
  002_orders_core.sql
  003_warehouse.sql
  004_production.sql
  005_rnd.sql
  006_sales_extensions.sql
  007_accounting_finance.sql
  008_finance_backend_workflow.sql
  009_orders_backend_workflow.sql
  010_deploy_readiness_hardening.sql
  013_app_order_finance_sync_fix.sql
  014_warehouse_documents_kardex_backend.sql
```

## اجرای محلی

```bash
npm install
cp .env.example .env
# مقادیر Supabase را در .env قرار بدهید
npm run dev
```

برای تست build:

```bash
npm run build
```

## متغیرهای محیطی Netlify

Frontend:

```txt
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Netlify Functions:

```txt
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://...   # اتصال مستقیم/Session Pooler با نقش postgres
BACKUP_ENCRYPTION_KEY=...         # راز تصادفی طولانی و ثابت؛ خارج از سورس
BACKUP_LOCAL_MAX_VERSIONS=5
BACKUP_LOCAL_OVERDUE_HOURS=48
BACKUP_TRANSFER_TTL_MINUTES=60
APP_VERSION=139.0.0
```

> `SUPABASE_SERVICE_ROLE_KEY`، رشته اتصال دیتابیس و کلید رمزگذاری فقط باید در Netlify Function باشند و هرگز نباید با پیشوند `VITE_` به مرورگر برسند. تغییر یا گم‌کردن `BACKUP_ENCRYPTION_KEY` باعث غیرقابل‌بازیابی‌شدن آرشیوهای قبلی می‌شود.

## ترتیب اجرای SQL در Supabase

فایل‌ها را به همین ترتیب اجرا کنید:

1. `supabase/migrations/001_core_auth_profiles.sql`
2. `supabase/migrations/002_orders_core.sql`
3. `supabase/migrations/003_warehouse.sql`
4. `supabase/migrations/004_production.sql`
5. `supabase/migrations/005_rnd.sql`
6. `supabase/migrations/006_sales_extensions.sql`
7. `supabase/migrations/007_accounting_finance.sql`
8. `supabase/migrations/008_finance_backend_workflow.sql`
9. `supabase/migrations/009_orders_backend_workflow.sql`
10. `supabase/migrations/010_deploy_readiness_hardening.sql`
11. `supabase/migrations/013_app_order_finance_sync_fix.sql`
12. `supabase/migrations/014_warehouse_documents_kardex_backend.sql`

در پروژه‌های موجود، همه Migrationها باید به‌ترتیب شماره اجرا شوند. برای ارتقا از نسخه `138.0.1`، ابتدا Safety Backup محلی معتبر بگیرید و سپس فقط Migrationهای 136 و 137 را به‌ترتیب اجرا کنید. برای محیط‌های عقب‌تر، زنجیره زیر باید بدون جابه‌جایی شماره‌ها اجرا شود:

1. `128_professional_backup_center.sql`
2. `129_investment_full_purchase_sale.sql`
3. `130_purchase_invoice_inventory_sync.sql`
4. `131_order_stage_safe_editing.sql`
5. `132_direct_expense_debt_offset.sql`
6. `133_direct_expense_debt_offset.sql`
7. `134_warehouse_sales_catalog_and_order_documents.sql`
8. `135_orders_full_sales_access_and_complete_cancellation.sql`
9. `136_finance_payment_ledger_bank_name_contract.sql`
10. `137_direct_transfer_mixed_allocations.sql`

> Migration `132` فقط مقدار Enum را اضافه می‌کند و باید پیش از 133 کاملاً Commit شود. Migration `136` ستون قراردادی `bank_name` را در انتهای View دفتر پرداخت بازمی‌گرداند. Migration `137` مدل سازگار قبلی را بدون حذف سوابق به حواله مستقیم مختلط ارتقا می‌دهد، RPCهای اتمیک ثبت/اصلاح/ابطال را اضافه می‌کند و هزینه واقعی را از پرداخت به شخص جدا نگه می‌دارد.

## ساخت اولین مدیر کل

1. در Supabase Dashboard بروید به **Authentication > Users > Add user**.
2. ایمیل و رمز عبور مدیر کل را بسازید و Auto Confirm را فعال کنید.
3. UUID کاربر را کپی کنید.
4. این SQL را با UUID و ایمیل واقعی اجرا کنید:

```sql
insert into public.profiles (id, email, full_name, role, is_active, preferred_language)
values ('AUTH-USER-UUID', 'admin@example.com', 'مدیر کل', 'admin', true, 'fa')
on conflict (id) do update
set role = 'admin', is_active = true, email = excluded.email, full_name = excluded.full_name;
```

بعد از آن کاربران عادی را از پنل مدیریت کاربران داخل اپ بسازید.

## Netlify Redirect

برای SPA route مثل `/reset-password`، فایل `netlify.toml` و `public/_redirects` تنظیم شده‌اند:

```txt
/*    /index.html   200
```

## وضعیت ماژول‌ها

- Auth/User Management: آماده‌ی اتصال به Supabase
- Orders/Customers/Sales: UI عملیاتی، گردش Stage-safe، موجودی/قیمت فروش آنلاین و اسناد فروش فقط‌خواندنی
- Warehouse: موجودی، اسناد، کاردکس، ارزش‌گذاری روز و قیمت‌گذاری چندارزی عملیاتی
- Production: دیتابیس و اتصال عملیاتی به Warehouse/R&D و ارسال‌های جزئی
- R&D: گردش پروژه و اتصال به سفارش/تولید فعال
- Accounting/Finance: اسناد، خزانه، اشخاص، سرمایه‌گذاری، روش‌های تسویه و خروجی‌های چاپی عملیاتی

## انبار و سفارش‌ها — نسخه ۱۳۸.۰.۱

- فروشنده و مدیر فروش در محدوده ماژول سفارش‌ها همان دسترسی عملیاتی مدیر کل را دارند: همه سفارش‌ها، ثبت، ویرایش Stage-safe، مرحله، تنظیم قالب، کنترل اعتبار، رزرو، پیش‌فاکتور، ارسال و لغو کامل.
- لغو کامل سفارش به‌صورت اتمیک رزروها، مراحل ناتمام، ارجاع‌ها، پیگیری‌ها و فرصت باز را می‌بندد؛ سوابق مالی، تولید و ارسال فیزیکی نهایی را حفظ می‌کند.
- دسترسی اسناد مالی در سفارش‌ها همچنان فقط‌خواندنی است و عملیات پرداخت، خزانه، Journal، ابطال یا ویرایش مستقیم سند مالی اضافه نشده است.
- Migration `135_orders_full_sales_access_and_complete_cancellation.sql` این سطح دسترسی و RPCهای کنترل‌شده را فراهم می‌کند.
- نمای کلی انبار ارزش موجودی را با مبنای شفاف «موجودی لحظه‌ای × بهای خرید جاری» به تومان و دلار نشان می‌دهد؛ ارزش فروش مستقل است و اقلام فاقد قیمت یا موجودی منفی جداگانه اعلام می‌شوند.
- نرخ USD و CNY، وضعیت منبع و زمان آخرین بررسی در همان نما دیده می‌شود و دکمه به‌روزرسانی نرخ و ارزش وجود دارد.
- تب موجودی سفارش‌ها قیمت فروش جاری و مبنای ارزی هر کالا را از RPC امن `fn_get_order_sales_catalog` می‌خواند و با تغییر موجودی، قیمت یا نرخ ارز بدون Refresh دستی همگام می‌شود.
- تب «فاکتور و پیش‌فاکتور» و بخش اسناد هر سفارش فقط اسناد مرتبط و مجاز را نمایش می‌دهند؛ Viewer فقط خروجی رسمی و غیررسمی/شرکتی دارد و عملیات مالی یا خزانه‌ای ارائه نمی‌کند.
- Migration `134_warehouse_sales_catalog_and_order_documents.sql` سطح دسترسی محدود، Projectionهای بدون بهای تمام‌شده و Bundle چاپی امن را ایجاد می‌کند.

## مرکز محاسبه — نسخه ۱۳۳

نسخه ۱۳۳ خروجی گزارش را بر اساس الگوی تمیز و جدول‌محور AM05 بازطراحی می‌کند. گزارش مشتری دو صفحه و فاقد اطلاعات محرمانه است؛ گزارش داخلی کارکنان صفحه سوم محرمانه شامل ریز بهای هسته، بوبین، سیم، دستمزد، عملیات، سربار و سود دارد. نتیجه محاسبه نیز به دو گروه «خلاصه امکان ساخت، موجودی و قیمت» و «پرونده فنی، جدول‌ها و نقشه‌ها» تقسیم شده است.

Migration جدید `124_calculator_reports_and_pricing_visibility.sql` گزینه نسخه‌دار مدیر برای نمایش یا عدم نمایش ریز قیمت‌گذاری به کارکنان را اضافه می‌کند. موجودی دقیق در محیط داخلی و فقط وضعیت موجود/ناموجود در WordPress و PDF مشتری نمایش داده می‌شود. راهنمای استقرار در `DEPLOY_VERSION_133_FA.md` آمده است.

## مرکز محاسبه — نسخه ۱۳۲

در نسخه ۱۳۲، «محاسبه» فقط پیش‌نمایش بدون ذخیره می‌سازد و ثبت سفارش به دکمه مستقل «تأیید نهایی و ثبت سفارش» منتقل شده است. نوار پرشدگی پنجره بدون ثبت Quote و با تغییر ورودی‌ها به‌صورت زنده به‌روزرسانی می‌شود. خروجی فنی و قیمت از هم جدا شده‌اند و تصویر ۱ برای نمایش یک مستطیل یک‌رنگ به‌ازای هر سیم‌پیچ، عایق طلایی ضخیم‌تر و رفتار صحیح در پرشدگی بیش از ۱۰۰٪ بازطراحی شده است.

این نسخه Migration جدید ندارد و با Migration 123 سازگار است؛ فقط Frontend، Edge Function و افزونه WordPress نسخه 1.1.0 باید به‌روزرسانی شوند. Actionهای قدیمی برای سازگاری نسخه ۱۳۱ حفظ شده‌اند. جزئیات استقرار در `DEPLOY_VERSION_132_FA.md` و صورت‌جلسه آزمون در `VERSION_132_MANIFEST_FA.md` آمده است.

## مرکز محاسبه — نسخه ۱۳۱ (مبنای دیتابیس)

مرکز محاسبه واقعی در `src/modules/calculator/` قرار دارد و برای نقش‌های مدیر، فروش، مدیر فروش، تولید و انبار فعال است. Migration آن `123_calculator_center_integration.sql` و API امن آن Supabase Edge Function با نام `calculator-api` است.

مدل‌های هسته، بوبین و سیم از داخل ماژول قابل افزودن یا تکمیل‌اند. هر مدل با `warehouse_item_id` به قلم واقعی انبار متصل می‌شود؛ قیمت و موجودی در کاتالوگ فنی کپی نمی‌شود و برای هر محاسبه از انبار جاری خوانده می‌شود. راهنمای کامل استقرار و WordPress در `DEPLOY_VERSION_131_FA.md` آمده است.

## نکته امنیتی

RLS در migrations جدید برای جدول‌های اصلی فعال شده است. Frontend guard فقط برای UX است؛ امنیت واقعی باید همیشه در Supabase RLS/Functions بماند. فرمول، بهای تمام‌شده و `service_role` نباید به مرورگر مشتری فرستاده شوند.


## داده نمونه برای تست

بعد از اجرای migrationها و ساخت admin اولیه، برای تست سریع مالی و سفارش‌ها می‌توانید seed زیر را اجرا کنید:

```txt
supabase/seed/001_demo_data.sql
```

این seed چند مشتری، کالا، موجودی انبار، سفارش، فاکتور، پرداخت، CRM follow-up و ارجاع نمونه می‌سازد.
