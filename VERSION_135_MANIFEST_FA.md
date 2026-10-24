# مانیفست نسخه ۱۳۵

## شناسه نسخه

- برنامه: `135.0.1`
- Migration جدید: `127_ui_search_order_and_safe_finance_warehouse_edit.sql`
- Hotfix داده واقعی: رفع برخورد `uq_warehouse_shipments_document` در Migration 126 هنگام وجود مالک آرشیوشده سند انبار
- مبنا: نسخه `134.0.0` و معماری ارسال سفارش‌محور

## فایل‌های کلیدی تغییرکرده

- `src/lib/jalaliInput.js`
- `src/components/JalaliDateInput.jsx`
- `src/components/JalaliMonthInput.jsx`
- `src/modules/accounting/AccountingModule.jsx`
- `src/modules/accounting/AccountingForms.jsx`
- `src/modules/accounting/AccountingModule.css`
- `src/modules/warehouse/WarehouseModule.jsx`
- `src/modules/warehouse/WarehouseModule.css`
- `src/hooks/useAccountingData.js`
- `src/hooks/useWarehouseData.js`
- `src/hooks/useOrdersData.js`
- `src/lib/orderApi.js`
- `src/lib/financeApi.js`
- `supabase/migrations/127_ui_search_order_and_safe_finance_warehouse_edit.sql`
- `tests/jalali-input.test.mjs`
- `tests/ui-workflow-regressions.test.mjs`
- `tests/warehouse-shipments.test.mjs`
- `DEPLOY_VERSION_135_FA.md`

## قراردادهای حفظ‌شده

- خروج قطعی کالای سفارش فقط هنگام ثبت قطعی ارسال توسط انبار انجام می‌شود.
- چند ارسال و ارسال جزئی برای هر سفارش حفظ شده است.
- ویرایش مالی هیچ محموله فیزیکی را لغو، بازنویسی یا دوباره صادر نمی‌کند.
- برگشت محموله فیزیکی فقط از RPC و رابط مدیریت ارسال‌ها انجام می‌شود.
- حذف فیزیکی سند مالی انجام نمی‌شود؛ اصلاحات تأییدشده دارای Snapshot نسخه قبلی هستند و ابطال به‌صورت منطقی باقی می‌ماند.
- `service_role` و داده‌های محرمانه فقط در مسیرهای سروری باقی می‌مانند.
- افزونه WordPress در این نسخه تغییر نکرده است.

## اعتبارسنجی دیتابیس

Migrationهای پروژه تا 127 روی PostgreSQL واقعی PGlite اجرا شدند (در Schema تازه، Migration قدیمی 116 مطابق محدودیت شناخته‌شده Runner رد شد). نتیجه:

- وجود RPC اصلاح اتمیک سند مالی: موفق
- وجود RPC همگام‌سازی امن انبار: موفق
- ستون ترتیب پایدار `order_items.line_no`: موفق
- فیلدهای جست‌وجوی View مالی و انبار: موفق
- سناریوی ترتیب سفارش ← پیش‌فاکتور ← فاکتور: موفق
- سناریوی اصلاح سند قدیمی بدون لغو و با Delta صحیح موجودی: موفق
- سناریوی حفاظت کامل سند محموله فیزیکی هنگام اصلاح مالی: موفق
- سناریوی ابطال واقعی سند مالی قدیمی و برگشت خالص موجودی: موفق
- سناریوی جلوگیری از ابطال فاکتور دارای محموله فعال: موفق
- بازتولید خطای واقعی 23505 با مالک آرشیوشده + رکورد استنباطی فعال: موفق؛ Migration 126 بدون برخورد اجرا و مالک صحیح دوباره فعال شد

## نتیجه کنترل نهایی

`npm ci --no-audit --no-fund && npm run check` با موفقیت کامل شد:

- تست محاسبه‌گر: PASS
- تست قرارداد ارسال: PASS (پس از Hotfix 135.0.1 نیز دوباره موفق شد)
- تست Regression واقعی Migration 126 روی PGlite: `MIGRATION_126_ARCHIVED_OWNER_REGRESSION_OK`
- تست تایپ تاریخ/ماه شمسی: `JALALI_INPUT_TEST_OK`
- تست قراردادهای UI و گردش کار: `UI_WORKFLOW_REGRESSIONS_OK`
- Build تولید Vite: موفق
- تعداد ماژول‌های Transformشده: ۲۴۸۷
- Scan Credential: کلید واقعی پیدا نشد؛ `service_role` فقط در کدهای سروری و Placeholder محیطی است
- فایل محیطی واقعی: وجود ندارد

هشدار غیرمسدودکننده Chunk بزرگ حسابداری و هشدار منسوخ‌شدن شاخه Recharts 2 باقی مانده‌اند.
