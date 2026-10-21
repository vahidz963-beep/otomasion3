# Otomasion2 — Company Automation System

سیستم اتوماسیون آنلاین شرکت کوچک، با React/Vite روی Netlify و Supabase به‌عنوان Auth/DB/Storage.

## وضعیت این نسخه

نسخه جاری `135.0.0` است. این نسخه رفتار تایپ تاریخ شمسی را در همه ماژول‌ها یکدست می‌کند، جست‌وجوی حرفه‌ای فاکتورها و اسناد انبار را اضافه می‌کند، ترتیب اقلام سفارش را تا پیش‌فاکتور/فاکتور حفظ می‌کند، چیدمان همگام‌سازی انبار را اصلاح می‌کند و ویرایش فاکتور تأییدشده را بدون لغو سند خروج فیزیکی، اتمیک و قابل‌ردیابی انجام می‌دهد. معماری سفارش‌محور ارسال نسخه ۱۳۴ همچنان حفظ شده و خروج قطعی فقط هنگام ثبت ارسال توسط انبار رخ می‌دهد. راهنمای استقرار در `DEPLOY_VERSION_135_FA.md` است.

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
```

> `SUPABASE_SERVICE_ROLE_KEY` فقط باید در Netlify Function باشد، نه در frontend.

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
- Orders/Customers/Sales extensions: دیتابیس یکپارچه شده، UI عملیاتی هنوز ساخته نشده
- Warehouse: دیتابیس Snapshot + Transaction یکپارچه شده، UI هنوز ساخته نشده
- Production: دیتابیس و اتصال به Warehouse/R&D آماده شده، UI هنوز ساخته نشده
- R&D: UI فعلی build می‌شود ولی هنوز mock/local state است؛ دیتابیس R&D آماده شده
- Accounting/Finance: اسکیمای حرفه‌ای پایه + UI مدیریتی اولیه اضافه شده؛ CRUD عملیاتی فرم‌ها در مرحله بعد تکمیل می‌شود

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
