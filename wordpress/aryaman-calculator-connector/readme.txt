=== Aryaman Calculator Connector ===
Contributors: aryaman
Tags: calculator, woocommerce, supabase, transformer
Requires at least: 6.2
Requires PHP: 8.0
Stable tag: 1.2.0
License: Proprietary

اتصال امن دوطرفه WordPress/WooCommerce به مرکز محاسبه اتوماسیون آریامن.

== نصب ==

1. پوشه aryaman-calculator-connector را در wp-content/plugins قرار دهید یا ZIP آن را از بخش افزونه‌ها بارگذاری کنید.
2. افزونه را فعال کنید.
3. در تنظیمات ← مرکز محاسبه آریامن، نشانی کامل Edge Function و راز مشترک HMAC حداقل ۳۲ نویسه را وارد کنید.
4. همان راز را فقط در Supabase Edge Secret با نام WORDPRESS_SHARED_SECRET ثبت کنید.
5. برای اتصال WooCommerce یک محصول ساده و ترجیحاً مجازی بسازید و شناسه آن را در تنظیمات افزونه وارد کنید.
6. Shortcode زیر را در برگه سایت قرار دهید:

[aryaman_calculator]

== امنیت ==

* Service Role یا کلید دیتابیس در WordPress و مرورگر ذخیره نمی‌شود.
* همه درخواست‌های WordPress با HMAC-SHA256، timestamp و event ID امضا می‌شوند.
* رویداد پرداخت/تأیید، رزرو مواد را ایجاد می‌کند؛ لغو، رزرو را آزاد می‌کند.
* پایان تولید و کسر قطعی فقط در اتوماسیون و با نقش تولید/انبار/مدیر انجام می‌شود.
* فرمول، بهای تمام‌شده، حاشیه سود، مقدار خام موجودی و اطلاعات محرمانه انبار به مرورگر مشتری ارسال نمی‌شود؛ فقط وضعیت موجود/ناموجود نمایش داده می‌شود.
* API عمومی در Migration 123 به‌صورت پیش‌فرض خاموش است و تا تأیید کالیبراسیون پاسخ قیمت نمی‌دهد.

== رویدادهای WooCommerce ==

* payment_complete → payment_confirmed
* status_processing → order_approved
* cancelled/refunded/failed → order_cancelled

Event ID پایدار است؛ تکرار webhook باعث رزرو یا کسر دوباره نمی‌شود.

== تغییرات ==

= 1.2.0 =
* دسته‌بندی نتیجه به خلاصه ساخت/موجودی/قیمت و پرونده فنی سیم‌پیچی
* نمایش وضعیت موجودی زیر هسته، بوبین و سیم انتخاب‌شده بدون افشای مقدار خام انبار
* افزودن خروجی PDF مشتری پس از ثبت نهایی
* اصلاح عنوان سفارش نمونه ترانس و سفارش تعداد

= 1.1.0 =
* پیش‌نمایش قیمت و اطلاعات فنی بدون ساخت Snapshot یا سفارش
* نوار زنده پرشدگی پنجره و تفکیک اطلاعات فنی از قیمت
* ثبت Snapshot فقط پس از «تأیید نهایی و ثبت درخواست»
* بی‌اعتبارشدن نتیجه با هر تغییر ورودی

= 1.0.0 =
* اتصال HMAC به Supabase Edge Function
* Shortcode محاسبه‌گر
* اتصال امن Snapshot قیمت به سبد WooCommerce
* ارسال idempotent رویدادهای پرداخت، تأیید و لغو
