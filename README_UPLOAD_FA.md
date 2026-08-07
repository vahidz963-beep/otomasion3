# راهنمای آپلود نسخه کامل پروژه اتوماسیون آریامان — CRM Fix

این ZIP نسخه کامل سورس پروژه است و شامل اصلاح جدی بخش CRM/پیگیری‌هاست.

## مهم‌ترین اصلاح این نسخه
- مشکل ثبت نشدن پیگیری CRM اصلاح شد.
- ثبت پیگیری حالا رکورد واقعی در `crm_followups` می‌سازد.
- همزمان سابقه تعامل در `crm_interactions` ثبت می‌شود.
- تاریخ پیگیری بعدی مشتری به‌روزرسانی می‌شود.
- دکمه «انجام شد» برای بستن پیگیری اضافه شد.
- ظاهر CRM به HTML سفارش‌ها نزدیک‌تر شده است.

## روش آپلود با GitHub Desktop
1. فایل ZIP را Extract کن.
2. وارد پوشه Extract شده شو.
3. همه فایل‌ها و پوشه‌های داخل آن را Copy کن.
4. برو به پوشه پروژه اصلی روی کامپیوترت که به GitHub وصل است: `otomasion3`.
5. Paste کن و اگر پرسید Replace / Overwrite، تأیید کن.
6. GitHub Desktop را باز کن.
7. در Summary بنویس:
   `crm followup real save and ui fix`
8. Commit to main را بزن.
9. Push origin را بزن.
10. در Netlify منتظر Deploy بمان. اگر لازم بود:
    `Trigger deploy > Clear cache and deploy site`
11. سایت را با این آدرس باز کن:
    `https://otomasion3.netlify.app/?v=2026-08-07-crm-fix`

## SQL جدید لازم در Supabase
بعد از آپلود و Deploy، فایل زیر را در SQL Editor اجرا کن:

`supabase/migrations/018_crm_followup_real_save_and_ui_support.sql`

روش اجرا:
Supabase Dashboard → SQL Editor → New query → متن فایل 018 را Paste کن → Run

اگر هر خطایی دیدی، ادامه نده و عکس/متن خطا را بفرست.

## تست CRM
1. سایت را باز کن.
2. وارد بخش سفارش‌ها شو.
3. تب `CRM مشتریان` را باز کن.
4. روی `＋ پیگیری CRM` بزن.
5. مشتری، تاریخ، ساعت و عنوان را وارد کن.
6. ثبت کن.
7. باید در `پیگیری‌های امروز و باز` نمایش داده شود.
8. روی `انجام شد` بزن.
9. باید از پیگیری‌های باز حذف شود و در آخرین تعاملات ثبت شود.
