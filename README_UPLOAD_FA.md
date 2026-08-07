# راهنمای آپلود نسخه کامل پروژه — CRM + تاریخ شمسی + مراحل سفارش

این ZIP نسخه کامل سورس پروژه است و شامل اصلاحات جدید CRM، تاریخ شمسی و نوار مراحل سفارش است.

## اصلاحات مهم این نسخه
- اضافه شدن اسکرول داخلی برای لیست مشتریان CRM تا با زیاد شدن مشتری‌ها صفحه بی‌جهت پایین نیاید.
- انتقال پرونده مشتری / Customer File دقیقاً به زیر لیست مشتریان.
- تبدیل نوار مراحل سفارش به Stepper خطی شبیه فایل HTML.
- حذف ورودی‌های تاریخ میلادی `type=date` از سورس React.
- اضافه شدن ورودی تاریخ شمسی واقعی با فرمت نمونه `۱۴۰۵/۰۵/۱۷`.
- تاریخ شمسی در سفارش، CRM، مالی، ارجاعات، داشبورد و R&D.

## روش آپلود با GitHub Desktop
1. فایل ZIP را Extract کن.
2. وارد پوشه Extract شده شو.
3. همه فایل‌ها و پوشه‌های داخل آن را Copy کن.
4. برو به پوشه پروژه اصلی خودت که به GitHub وصل است: `otomasion3`.
5. Paste کن و اگر پرسید Replace / Overwrite، تأیید کن.
6. GitHub Desktop را باز کن.
7. در Summary بنویس:
   `fix crm scroll jalali dates and order stepper`
8. Commit to main را بزن.
9. Push origin را بزن.
10. در Netlify اگر لازم بود:
    `Trigger deploy > Clear cache and deploy site`
11. سایت را با این آدرس باز کن:
    `https://otomasion3.netlify.app/?v=2026-08-07-crm-date-flow`

## SQL
اگر Migration شماره 018 را قبلاً اجرا نکردی، باید اجرا شود:

`supabase/migrations/018_crm_followup_real_save_and_ui_support.sql`

اگر SQL خطا داد، ادامه نده و عکس/متن خطا را بفرست.
