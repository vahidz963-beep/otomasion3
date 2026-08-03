# زیرساخت Auth / نقش‌ها — سیستم اتوماسیون شرکت

## ترتیب اجرا در Supabase SQL Editor
1. `sql/01_schema_profiles.sql` — enum نقش‌ها، جدول `profiles`، توابع `current_role() / is_active_user() / is_admin()`، RLS پروفایل‌ها.
2. `sql/02_rls_orders_template.sql` — **الگو**، نه نسخه‌ی نهایی. وقتی جدول `orders` در چت «سفارش» ساخته شد، این فایل را با نام واقعی ستون‌ها تطبیق بده و اجرا کن.
3. `sql/03_audit_log.sql` — جدول تاریخچه‌ی تغییرات نقش/فعال‌بودن کاربران (چه کسی، چه زمانی، چه تغییری).

## متغیرهای محیطی
**Netlify (frontend, در build settings):**
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

**Netlify Functions (فقط سرور، هرگز در کد کلاینت):**
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # از Supabase > Project Settings > API
```

## راه‌اندازی اولین حساب مدیر کل (فقط یک‌بار)
چون پنل مدیریت کاربران خودش نیاز به یک مدیر کل موجود داره، اولین مدیر کل باید دستی ساخته بشه:

1. در Supabase Dashboard برو به **Authentication > Users > Add user**، ایمیل و رمز عبور مدیر کل رو وارد کن (گزینه‌ی «Auto Confirm User» رو فعال کن تا نیاز به تایید ایمیل نباشه).
2. بعد از ساخته‌شدن کاربر، UUID اون رو از همون صفحه کپی کن.
3. در **SQL Editor** این کوئری رو با UUID واقعی اجرا کن:
```sql
insert into public.profiles (id, full_name, role, is_active, preferred_language)
values ('UUID-کپی‌شده-اینجا', 'نام مدیر کل', 'admin', true, 'fa');
```
4. از همین لحظه، همه‌ی کاربران بعدی رو از طریق پنل مدیریت کاربران (که همین حساب می‌سازه) اضافه کن — دیگه نیازی به SQL دستی نیست.

## تنظیم مدت نشست (Session) روی ۱۵ دقیقه
در Supabase Dashboard برو به **Authentication > Settings > Sessions** (یا **JWT Settings** بسته به نسخه) و مقدار **JWT expiry** رو روی `900` ثانیه (۱۵ دقیقه) تنظیم کن.
با `autoRefreshToken: true` که در `supabaseClient.js` فعال شده، تا وقتی مرورگر کاربر باز و صفحه فعاله، توکن هر بار قبل از انقضا خودکار تمدید می‌شه (دقیقاً همون رفتاری که خواستی: تا فعالیت هست، هر ۱۵ دقیقه تمدید می‌شه؛ اگه کاربر تب رو ببنده/غیرفعال بمونه، نشست بعد از انقضا باطل می‌شه و باید دوباره لاگین کنه).

## نصب پکیج مورد نیاز تابع سرور
```
npm install @supabase/supabase-js
```

## نکته‌ی مهم امنیتی
`SUPABASE_SERVICE_ROLE_KEY` فقط در Netlify Function اجرا می‌شود (سمت سرور)، هرگز در کد React/کلاینت import نشود؛ در غیر این‌صورت RLS کل سیستم بی‌اثر می‌شود.

## قرارداد برای بقیه‌ی چت‌ها (سفارش، R&D، تولید، انبار، مالی، اداری، داشبورد)
هر جدول جدید در هر چت باید:
1. `alter table <table> enable row level security;`
2. Policyهای `select/insert/update/delete` را با همین سه تابع بسازد:
   - `public.current_role()` → نقش کاربر جاری
   - `public.is_active_user()` → آیا کاربر فعال است (**همیشه باید در همه‌ی Policyها چک شود**)
   - `public.is_admin()` → میان‌بر برای `current_role() = 'admin'`
3. اگر نیاز به «خلاصه‌ی وضعیت بدون جزئیات» بود (مثل R&D/تولید که باید بقیه‌ی مراحل را خلاصه ببینند)، از الگوی تابع `security definer` مشابه `get_orders_overview()` در فایل ۰۲ استفاده شود، نه از view معمولی.

## فایل‌های frontend
- `src/lib/supabaseClient.js` — کلاینت Supabase + لیست نقش‌ها + helper فراخوانی تابع مدیریت کاربران.
- `src/components/LoginPage.jsx` — صفحه‌ی ورود دوزبانه (fa/en، RTL/LTR)، شامل فراموشی رمز عبور (ایمیل ری‌ست)، بعد از ورود وضعیت `is_active` را چک و کاربر غیرفعال را فوراً خارج می‌کند.
- `src/components/ResetPasswordPage.jsx` — صفحه‌ای که کاربر از لینک ایمیل بازیابی به آن می‌رسد و رمز جدید تعیین می‌کند. باید روی مسیر `/reset-password` mount شود.
- `src/components/AdminUserPanel.jsx` — پنل مدیریت کاربران برای مدیر کل (ایجاد، تغییر نقش، فعال/غیرفعال، **تغییر دستی رمز عبور**، حذف).
- `src/components/AuditLogPanel.jsx` — نمایش تاریخچه‌ی تغییرات کاربران (چه کسی/چه زمانی/چه تغییری)، فقط برای مدیر کل.
- `src/components/RouteGuard.jsx` — لایه‌ی محافظ عمومی سمت frontend؛ در هر چت/بخش دیگر با `<RouteGuard allowedRoles={[...]}>` دور صفحات محافظت‌شده استفاده شود. **جایگزین RLS نیست**، فقط تجربه‌ی کاربری را بهتر می‌کند.
- `netlify/functions/admin-users.js` — تنها نقطه‌ای که کاربر واقعاً ساخته/حذف/تغییر نقش/ری‌ست رمز داده می‌شود؛ اول با anon key هویت و نقش «مدیر کل» فرستنده را تایید می‌کند، بعد با service role عملیات را انجام می‌دهد و در `audit_log` ثبت می‌کند.

## نکته‌ی routing برای صفحه‌ی بازیابی رمز
چون این یک SPA است، Netlify باید مسیر `/reset-password` را هم به `index.html` هدایت کند (مثل بقیه‌ی مسیرهای اپ). در فایل `netlify.toml` یا `public/_redirects` این خط باید موجود باشد:
```
/*    /index.html   200
```
این معمولاً همان تنظیمی است که برای کل SPA در چت‌های دیگر هم لازم است، پس احتمالاً از قبل موجوده.

## چرا signup عمومی وجود ندارد
چون تعداد کاربران محدود (۴ تا ۱۰ نفر) و نقش‌ها از پیش مشخص است، ایجاد کاربر فقط از پنل مدیر کل انجام می‌شود، نه فرم ثبت‌نام عمومی. این هم امنیت را بالا می‌برد و هم از نقش «بدون تعیین‌تکلیف» جلوگیری می‌کند.
