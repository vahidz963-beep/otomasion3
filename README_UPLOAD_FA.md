# راهنمای آپلود نسخه کامل پروژه — Finance Fixed

این ZIP نسخه کامل سورس پروژه اتوماسیون است و شامل آخرین اصلاحات مالی، انبار، تولید، R&D، ارجاعات و فایل‌های اشتراکی است.

## نکته مهم
این فایل را به صورت کامل روی پروژه اصلی جایگزین کن، نه فقط پوشه patch را داخل پروژه کپی کنی.

## روش نصب
1. ZIP را Extract کن.
2. وارد پوشه Extract شده شو.
3. همه فایل‌ها و پوشه‌های داخل آن را Copy کن.
4. داخل پروژه اصلی یا ریپوی متصل به Netlify Paste کن.
5. Replace / Overwrite را تأیید کن.
6. GitHub Desktop را باز کن.
7. Summary بنویس:
   `full project finance fixed final`
8. Commit to main بزن.
9. Push origin بزن.
10. در Netlify گزینه Clear cache and deploy site را بزن.
11. بعد با این آدرس تست کن:
   `https://automation.ariyaman-elec.workers.dev/?v=finance-fixed-2026-08-14`

## SQLهای مالی که اگر قبلاً اجرا نکردی باید اجرا شوند
- `supabase/migrations/028_finance_treasury_checks_investments.sql`
- `supabase/migrations/029_finance_document_summary_converted_from.sql`
- `supabase/migrations/030_jalali_document_numbering.sql`

اگر SQL خطا داد، ادامه نده و عکس/متن خطا را بفرست.
