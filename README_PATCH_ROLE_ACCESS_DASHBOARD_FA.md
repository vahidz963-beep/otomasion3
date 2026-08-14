# پچ نقش‌ها، دسترسی منوها و داشبورد اختصاصی

تاریخ آماده‌سازی: 2026-08-14

## هدف
هر کاربر فقط صفحه‌ها/ماژول‌های مربوط به نقش خودش را ببیند و یک داشبورد مختصر مرتبط با همان نقش داشته باشد. مدیر کل داشبورد کامل شرکت و همه ماژول‌ها را می‌بیند.

## دسترسی منوها

### مدیر کل
همه بخش‌ها:
- داشبورد کامل مدیریتی
- سفارش‌ها
- انبار
- تولید
- R&D
- مالی/حسابداری
- اداری
- کاربران
- تاریخچه

### مدیر فروش / فروش
فقط:
- داشبورد فروش
- سفارش‌ها

### انباردار
فقط:
- داشبورد انبار
- انبار

### تولید
فقط:
- داشبورد تولید
- تولید

### R&D
فقط:
- داشبورد R&D
- R&D

### حسابدار
فقط:
- داشبورد مالی
- مالی/حسابداری

### اداری
فقط:
- داشبورد اداری
- اداری

اگر کاربر چند نقش داشته باشد، فقط ماژول‌های همان نقش‌ها را می‌بیند.

## داشبورد
داشبورد بر اساس نقش فیلتر می‌شود:
- مدیر کل: نمای کامل شرکت + Health Check
- فروش: سفارش‌ها و ارجاعات فروش
- مالی: دریافتنی، پرداختنی، گردش‌ها و چک‌ها
- انبار: کم‌موجودی و ارجاعات انبار
- تولید: تولیدهای در جریان
- R&D: پروژه‌های R&D
- اداری: ارجاعات اداری

## فایل‌های تغییرکرده
- `src/App.jsx`
- `src/auth/AuthProvider.jsx`
- `src/lib/supabaseClient.js`
- `src/components/admin/AdminUserPanel.jsx`
- `src/components/admin/AdminUserPanel.css`
- `netlify/functions/admin-users.js`
- `src/hooks/useDashboardData.js`
- `src/modules/dashboard/Dashboard.jsx`
- `src/modules/dashboard/Dashboard.css`
- `supabase/migrations/026_users_multirole_shared_files_cleanup.sql`
- `supabase/migrations/032_system_health_report.sql`

## SQL لازم
اگر قبلاً اجرا نکرده‌ای:

1. `026_users_multirole_shared_files_cleanup.sql`
2. `032_system_health_report.sql`

اگر اجرا شده‌اند، لازم نیست دوباره اجرا شوند.

اگر SQL خطا داد، ادامه نده و عکس خطا را بفرست.

## نصب پچ
1. ZIP را Extract کن.
2. فایل‌ها را روی پروژه اصلی کپی کن.
3. Replace / Overwrite را تأیید کن.
4. Commit و Push کن.
5. Netlify را Clear cache deploy کن.
6. تست:
   `https://automation.ariyaman-elec.workers.dev/?v=roles-dashboard-v1`
