# راهنمای آپلود نسخه نهایی اتوماسیون آریامن - ۱۴۰۵/۰۵/۲۴

این نسخه شامل تمام تغییرات تا مرحله ۰۴۱ است.

## فایل‌های مهم SQL جدید

اگر قبلاً اجرا نشده‌اند، به ترتیب زیر در Supabase SQL Editor اجرا شوند:

```txt
supabase/migrations/038_cross_module_inventory_finance_production_coordination.sql
supabase/migrations/039_finance_bank_cards_print_templates.sql
supabase/migrations/041_finance_warehouse_dashboard_office_enhancements.sql
```

اگر هر SQL خطا داد، **ادامه نده و عکس/متن خطا را بفرست**.

---

## روش ۱: آپلود روی GitHub و Netlify

1. ZIP کامل را Extract کن.
2. محتویات پوشه پروژه را داخل مخزن GitHub فعلی جایگزین کن.
3. در GitHub Desktop تغییرات را ببین.
4. Commit Summary پیشنهادی:

```txt
Final operational update v041 - accounting, warehouse, office, dashboard stability
```

5. Commit کن.
6. Push کن.
7. در Netlify اگر لازم شد:

```txt
Deploys → Trigger deploy → Clear cache and deploy site
```

---

## روش ۲: آپلود مستقیم روی هاست ایران

اگر می‌خواهی اتوماسیون را مستقیماً روی هاست ایران قرار دهی، فقط محتوای پوشه زیر را آپلود کن:

```txt
hosting_dist/
```

محتوای این پوشه باید داخل Document Root زیر دامنه قرار بگیرد، مثلاً:

```txt
/domains/aryaman-co.ir/public_html/automation
```

یا هر مسیری که DirectAdmin برای زیر دامنه ساخته است.

داخل `hosting_dist` فایل `.htaccess` وجود دارد تا مسیرهای React درست کار کنند.

---

## تنظیمات Supabase برای دامنه رسمی

در Supabase مسیر زیر:

```txt
Authentication → URL Configuration
```

Site URL:

```txt
https://automation.aryaman-co.ir/
```

Redirect URLs:

```txt
https://automation.aryaman-co.ir/
https://automation.aryaman-co.ir/*
https://automation.aryaman-co.ir/reset-password
```

آدرس‌های قبلی را حذف نکن.

---

## متغیرهای محیطی لازم در Netlify

```txt
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

`SUPABASE_SERVICE_ROLE_KEY` فقط در Netlify Environment Variables وارد شود و نباید عمومی شود.

---

## تست بعد از آپلود

1. ورود به سایت:

```txt
https://automation.aryaman-co.ir/
```

2. تست ماژول‌ها:

```txt
داشبورد
سفارش‌ها
حسابداری
انبار
تولید
R&D
اداری
کاربران
```

3. تست جریان اصلی:

```txt
سفارش → تولید → خروجی انبار → فاکتور → خروج انبار → لیست ارسال‌شده‌ها
```

4. اگر خطایی دیدی، عکس دقیق همان صفحه را بفرست.
