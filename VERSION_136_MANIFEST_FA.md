# مانیفست نسخه ۱۳۶

## مشخصات

- برنامه: `136.0.1`
- نسخه مبنا: `135.0.1`
- سازگار با معماری ارسال جزئی Migration 126 و اصلاحات Migration 127
- Migrationهای جدید: `128` تا `131`

## Patch رابط نسخه 136.0.1

- PDF صورت‌حساب اشخاص دارای عرض ثابت و حرفه‌ای برای هفت ستون است؛ مبلغ و واحد پول به‌صورت مستقل و داخل همان سلول نمایش داده می‌شوند.
- اندازه مبلغ بر اساس طول آن کاهش می‌یابد و برای اعداد بسیار بلند شکست امن دارد؛ هیچ متن یا عددی نباید از کادر جدول خارج شود.
- دکمه × پاک‌کردن Product Picker سفارش، حسابداری و تولید و Searchable Select به سمت چپ فیزیکی منتقل شده و فضای مستقل داخل ورودی دارد.

## Migrationها

- `128_professional_backup_center.sql`
  - Job و وضعیت بکاپ، مجوزهای تفکیک‌شده، Restore Session یک‌بارمصرف و Bucket خصوصی.
- `129_investment_full_purchase_sale.sql`
  - خرید پرداخت‌شده، ثبت دارایی موجود بدون گردش نقدی، فروش کامل و سود/زیان تحقق‌یافته.
- `130_purchase_invoice_inventory_sync.sql`
  - Receipt خودکار، اجرای Idempotent، Delta ویرایش، برگشت ابطال و View تطبیق تاریخی.
- `131_order_stage_safe_editing.sql`
  - Revision Snapshot، optimistic lock، محدودیت مرحله، کنترل اعتبار و Idempotency ساخت سفارش.

## Backend و پاک‌سازی انتقال

- `netlify/backupService.js`
- `netlify/functions/system-backups.js`
- `netlify/functions/scheduled-backup-cleanup.js`
- `netlify.toml` — فقط پاک‌سازی ساعتی فایل‌های انتقالی منقضی؛ هیچ بکاپ زمان‌بندی‌شده سروری ندارد.

ویژگی‌های امنیتی بکاپ Local-only:

- آرشیو کامل، فشرده و رمزگذاری‌شده AES-256-GCM.
- انتخاب پوشه با File System Access API و نوشتن مستقیم فایل در سیستم کاربر.
- کنترل اندازه و Magic فایل پس از نوشتن؛ آرشیو نیز قبل از انتقال روی سرور رمزگشایی آزمایشی می‌شود.
- نگهداری حداکثر ۵ نسخه در همان پوشه و حذف نسخه‌های قدیمی فقط هنگام اقدام کاربر.
- هشدار در صورت گذشت ۴۸ ساعت از آخرین بکاپ ثبت‌شده در همان مرورگر.
- فایل فقط برای انتقال در Bucket خصوصی قرار می‌گیرد؛ پس از ذخیره موفق فوراً حذف و در حالت قطع عملیات پس از انقضای ۶۰ دقیقه‌ای با پاک‌ساز ساعتی پاک می‌شود.
- هیچ آرشیو دائمی بکاپ روی سرور نگهداری نمی‌شود.
- بارگذاری Restore با Signed Upload و حذف فایل پس از پایان عملیات.
- اعتبارسنجی Restore، توکن یک‌بارمصرف ۱۵ دقیقه‌ای و عبارت تأیید صریح.
- بکاپ ایمنی Local-only پیش از هر Restore اجباری است.
- حفظ حساب‌های ورود، Profileها و مجوزهای مرکز بکاپ در بازیابی کسب‌وکار.

## Frontend/API

- `src/modules/backup/BackupCenter.jsx`
- `src/modules/backup/BackupCenter.css`
- `src/lib/backupApi.js`
- `src/lib/financeApi.js`
- `src/hooks/useAccountingData.js`
- `src/modules/accounting/AccountingModule.jsx`
- `src/modules/accounting/AccountingModule.css`
- `src/lib/orderApi.js`
- `src/hooks/useOrdersData.js`
- `src/modules/orders/OrdersModule.jsx`
- `src/modules/orders/OrdersModule.css`
- `src/App.jsx`

## تست‌ها

- `tests/professional-operations.integration.test.mjs`
  - Replay Migrationها و آزمون واقعی گردش سرمایه‌گذاری، خرید/انبار و سفارش با PGlite.
- `tests/backup-center.test.mjs`
  - Round-trip رمزگذاری، تشخیص دست‌کاری و قرارداد Summary/Runtime.
- `tests/ui-workflow-regressions.test.mjs`
  - قراردادهای UI/API قابلیت‌های جدید و ممنوعیت SHA-256 ناخواسته.
- تست‌های قبلی محاسبه‌گر، تاریخ شمسی، ارسال جزئی و گردش UI حفظ شده‌اند.

### نتیجه نهایی Patch 136.0.1 — ۱۴۰۵/۰۸/۰۲ (2026-10-24)

- آزمون قرارداد ضدسرریز PDF، Auto-fit پیش از چاپ و محل فیزیکی چپ دکمه‌های پاک‌کردن: PASS
- `npm run check`: موفق
- تست محاسبه‌گر: PASS
- تست ارسال جزئی: PASS
- تست ورودی تاریخ شمسی: PASS
- تست قراردادهای UI: `UI_WORKFLOW_REGRESSIONS_OK`
- تست بکاپ: `BACKUP_CENTER_ENCRYPTION_RESTORE_CONTRACT_OK`
- Syntax همه Functionهای بکاپ: PASS
- PGlite و Integration چهار Migration جدید: PASS
- Vite production build: PASS (هشدار غیرمسدودکننده اندازه Chunk حسابداری باقی است)

## اصول عدم تخریب

- فروش سرمایه‌گذاری فقط کامل است؛ فروش جزئی ارائه نمی‌شود.
- «دارایی از قبل موجود» هیچ Payment یا برداشت بانک/صندوق ایجاد نمی‌کند.
- فاکتور خرید تأییدشده سند ورود را فقط با Deltaهای قابل Audit اصلاح می‌کند.
- ابطال فاکتور خرید تنها در صورت امکان برگشت موجودی اجرا می‌شود.
- ویرایش سفارش از مقدار ارسال/تولیدشده پایین‌تر نمی‌رود.
- محموله فیزیکی Final و Journal ثبت‌شده مستقیم بازنویسی نمی‌شوند.
- عملیات حساس دارای Idempotency و قفل تراکنشی‌اند.

## استقرار

راهنمای کامل: `DEPLOY_VERSION_136_FA.md`
