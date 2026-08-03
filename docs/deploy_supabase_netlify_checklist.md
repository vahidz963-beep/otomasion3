# چک‌لیست آنلاین‌کردن Otomasion2 روی Supabase + Netlify

این سند برای وقتی است که بخواهیم نسخه تست آنلاین ماژول‌های «مالی» و «سفارش‌ها» را بالا بیاوریم.

## وضعیت فعلی

پروژه اکنون یک Web App از نوع React/Vite است و برای Netlify مناسب است. بک‌اند روی Supabase طراحی شده و migrations تا اینجا آماده‌اند.

نسخه تست آنلاین قابل انجام است، اما نسخه عملیاتی نهایی شرکت هنوز نیاز به تست RLS، تست داده واقعی، اصلاحات UX و اتصال کامل ماژول‌های بعدی دارد.

## 1) ترتیب اجرای SQL در Supabase

در Supabase SQL Editor، فایل‌ها را دقیقاً به این ترتیب اجرا کنید:

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

نکته: اگر هر فایل خطا داد، ادامه ندهید؛ همان خطا باید اصلاح شود و بعد ادامه اجرا شود.


## 1.1) تست سلامت بعد از اجرای migrationها

بعد از اجرای همه migrationها، این دستور را در SQL Editor اجرا کنید:

```sql
select public.fn_get_deploy_health();
```

خروجی باید نشان دهد که جدول‌ها و viewهای اصلی وجود دارند و تعداد قواعد شماره‌گذاری و قالب‌های سفارش بیشتر از صفر است.

## 1.2) داده نمونه برای تست

بعد از ساخت admin اولیه، می‌توانید فایل زیر را در SQL Editor اجرا کنید:

```txt
supabase/seed/001_demo_data.sql
```

این فایل برای تست سریع ماژول مالی و سفارش‌هاست.

## 2) ساخت اولین مدیر کل

بعد از اجرای migration اول، در Supabase:

1. Authentication > Users > Add user
2. ایمیل و رمز عبور مدیر را وارد کنید.
3. Auto Confirm را فعال کنید.
4. UUID کاربر را کپی کنید.
5. در SQL Editor اجرا کنید:

```sql
insert into public.profiles (id, email, full_name, role, is_active, preferred_language)
values ('AUTH-USER-UUID', 'admin@example.com', 'مدیر کل', 'admin', true, 'fa')
on conflict (id) do update
set role = 'admin', is_active = true, email = excluded.email, full_name = excluded.full_name;
```

## 3) تنظیم Auth Redirect در Supabase

در Supabase > Authentication > URL Configuration:

- Site URL:

```txt
https://YOUR-NETLIFY-SITE.netlify.app
```

- Redirect URLs:

```txt
https://YOUR-NETLIFY-SITE.netlify.app/*
http://localhost:5173/*
```

برای reset password مسیر زیر لازم است:

```txt
https://YOUR-NETLIFY-SITE.netlify.app/reset-password
```

## 4) متغیرهای محیطی Netlify

در Netlify > Site settings > Environment variables:

Frontend:

```txt
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Functions:

```txt
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

کلید service role فقط در Netlify Functions باشد، نه در frontend.

## 5) تنظیمات Build در Netlify

Build command:

```txt
npm run build
```

Publish directory:

```txt
dist
```

Functions directory:

```txt
netlify/functions
```

## 6) فایل‌های ضروری برای Netlify

این فایل‌ها آماده هستند:

```txt
package.json
vite.config.js
netlify.toml
public/_redirects
src/
netlify/functions/admin-users.js
```

## 7) قبل از deploy باید روی GitHub push شود

در سیستم خودتان:

```bash
git add .
git commit -m "Build finance and orders modules"
git push origin main
```

اگر branch اصلی `master` است:

```bash
git push origin master
```

## 8) تست‌های بعد از آنلاین‌شدن

بعد از deploy:

1. صفحه login باز شود.
2. با admin وارد شوید.
3. پنل کاربران باز شود.
4. یک کاربر sales بسازید.
5. کاربر sales وارد شود.
6. ماژول سفارش‌ها باز شود.
7. ثبت سفارش تستی انجام شود.
8. از سفارش، پیش‌فاکتور/فاکتور ساخته شود.
9. ماژول مالی سند را نشان دهد.
10. دریافت/پرداخت تستی ثبت شود.
11. چک تستی ثبت شود.
12. CRM مشتری و پیگیری تست شود.
13. RLS با نقش‌های مختلف تست شود.

## 9) وضعیت برای استفاده واقعی

برای demo/test آنلاین: آماده نزدیک به اجرا است.

برای استفاده واقعی شرکت: قبل از استفاده باید این‌ها کامل تست شوند:

- RLS همه نقش‌ها
- فرم‌های سفارش با داده واقعی
- فرم‌های مالی با داده واقعی
- خروجی PDF/Excel
- خطاهای SQL migration در Supabase واقعی
- فرآیند ساخت کاربر
- فرآیند reset password
- اتصال عملی انبار، تولید و R&D

## 10) پیشنهاد مسیر اجرا

اول نسخه تست آنلاین با فقط admin و یک کاربر sales بالا بیاید. بعد روی همان نسخه تست، ماژول مالی و سفارش را با داده نمونه تست کنیم. بعد برویم سراغ انبار و تولید.
