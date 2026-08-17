# رفع مشکل حذف سفارش از لیست هزینه‌های R&D

## مشکل
در تب «هزینه‌ها» بخش R&D، برای پروژه‌های پایان‌یافته دکمه «حذف سفارش» فعال بود اما حذف/بایگانی درست انجام نمی‌شد.

## علت
تابع قبلی فرانت‌اند برای بایگانی پروژه، ستون `notes` را در جدول `rnd_projects` آپدیت می‌کرد؛ در حالی که جدول R&D ستون `technical_notes` دارد، نه `notes`. به همین دلیل عملیات حذف/بایگانی می‌توانست با خطای دیتابیس انجام نشود.

## اصلاحات انجام‌شده
- تابع `archiveRndProject` اصلاح شد.
- به جای ستون اشتباه `notes`، ستون درست `technical_notes` استفاده شد.
- یک RPC امن دیتابیسی ساخته شد:

```txt
fn_rnd_archive_project_from_costs(uuid,text)
```

- حذف امن فقط وقتی اجازه داده می‌شود که پروژه پایان‌یافته باشد:
  - وضعیت `approved`
  - یا `sent_to_production`
  - یا پیشرفت ۱۰۰٪
  - یا همه مراحل پروژه completed باشند
- بعد از حذف، پروژه واقعاً پاک نمی‌شود؛ فقط `archived` می‌شود تا از لیست هزینه‌ها خارج شود ولی سابقه باقی بماند.

## فایل‌های تغییرکرده
```txt
src/lib/rndApi.js
supabase/migrations/049_fix_rnd_archive_project_from_costs.sql
```

## تست
Build پروژه با موفقیت انجام شد:

```txt
npm install && npm run build
✓ built successfully
```

## نیاز به SQL
برای فعال شدن حذف امن، این SQL باید در Supabase اجرا شود:

```txt
supabase/migrations/049_fix_rnd_archive_project_from_costs.sql
```
