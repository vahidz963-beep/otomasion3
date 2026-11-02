# مانیفست نسخه ۱۳۹.۰.۴

## شناسه انتشار

- برنامه: `139.0.4`
- Migrationهای جدید: `136` و `137`
- Artifact نهایی: `Otomasion2_DEPLOY_VERSION_139.0.4_FLAT.zip`
- راهنمای استقرار: `DEPLOY_VERSION_139_FA.md`

## جمع‌ها، شماره‌گذاری انبار و حواله در دریافت/پرداخت (جدید در 139.0.4)

- فاکتور: همه سطرهای جمع و «مانده حساب نهایی» و «مبلغ به حروف» ریال دارند؛ ستون‌های ردیف بدون واحد.
- صورت‌حساب اشخاص: tfoot و کادر جمع‌ها و «مانده به حروف» واحد انتخابی (تومان/ریال) را نشان می‌دهند؛ ردیف‌ها بدون واحد؛ کادر پایانی «واحد تمام مبالغ» حفظ شد.
- Migration 138 (`138_warehouse_auto_receipt_document_numbers.sql`): تریگر `fn_assign_warehouse_auto_doc_number` برای سند ورود نهایی بدون شماره + Backfill Idempotent + Guard قراردادی؛ اسناد موقت دست‌نخورده.
- فرم دریافت/پرداخت: گزینه همیشگی «حواله مستقیم (غیرنقدی)».
- KPI حسابداری: «دریافت‌های ماه (با حواله مستقیم)» و «پرداخت‌های ماه (با حواله مستقیم)» از `v_finance_direct_expense_offset_details` فقط اسناد posted ماه جاری را می‌شمارند.
- امنیت/سرعت: هدرهای امنیتی Netlify، کش immutable برای assets، سقف `MAX_PAGED_ROWS = 20000` در `useAccountingData`.
- تست‌ها: قراردادهای 138 و KPI و واحد جمع‌ها به `ui-workflow-regressions`، `finance-print-layout` و `currency-output-policy` اضافه شد؛ بازپخش کامل PGlite تا 138 موفق.

## اسکریپت تشخیصی و لغو امن قسط (جدید در 139.0.3)

- `supabase/CHECK_139_DIAGNOSTIC.sql`: گزارش یک‌جای وجود/ستون/دسترسی جدول‌ها، Viewها، تابع‌ها، Enumها و RLS + تازه‌سازی کش Schema (فقط خواندنی؛ روی محیط بازپخش‌شده تا Migration 137 با نتیجه «همه OK» تأیید شد).
- `archiveFinanceLoanInstallment`: در نبود RPC، قسط پرداخت‌نشده به‌صورت امن لغو و دلیل در یادداشت حفظ می‌شود؛ اقساط پرداخت‌شده هرگز لغو نمی‌شوند.

## تعمیر ویرایش گردش حساب (جدید در 139.0.2)

- `sanitizeFinancePaymentPayload` در `src/lib/financeApi.js` فقط ستون‌های واقعی `finance_payments` را به Insert/Update می‌فرستد.
- گارد سراسری «این سند از بخش دیگری ساخته شده است» از مسیر ویرایش حذف شد؛ مسیرهای محافظت‌شده (حواله مستقیم، وام، حقوق، چک متصل) در `openPaymentEdit` هدایت می‌شوند.
- `PAYMENT_METHOD_LABELS` و `methodLabel` برچسب فارسی روش‌ها را در جدول گردش و مودال جزئیات پرداخت نمایش می‌دهند.
- فرم دریافت/پرداخت: گزینه «انتقال بین حساب‌ها»، فیلد اجباری حساب مقصد و اعتبارسنجی تفاوت مبدأ/مقصد.
- `errorMessages.js`: نام شیء/ستون گمشده در پیام‌های PGRST205 و 42703 نمایش داده می‌شود.
- تست قرارداد جدید: `tests/cashflow-editability.test.mjs` (در زنجیره `npm run check`).

## سیاست واحد خروجی (جدید در 139.0.1)

- فاکتور، پیش‌فاکتور، PDF ساده اسناد و نمای فقط‌خواندنی سفارش‌ها همیشه بر پایه ریال خروجی می‌گیرند و از تنظیم «واحد نمایش» پیروی نمی‌کنند.
- واژه «ریال» فقط در سطرهای «جمع فاکتور» و «قابل پرداخت» نوشته می‌شود؛ ستون‌های مبلغ واحد، مبلغ کل، تخفیف، خالص، مالیات و مانده بدون پسوند واحد هستند.
- صورت‌حساب اشخاص (PDF و Excel) همه مبالغ را بدون پسوند واحد نمایش می‌دهد و واحد تومان/ریال را فقط یک‌بار در انتهای خروجی درج می‌کند؛ مبنای تبدیل، انتخاب ذخیره‌شده کاربر در تنظیمات چاپ است.
- «مبلغ به حروف» با همان مقیاس انتخابی صورت‌حساب خوانده می‌شود و هیچ واحدی به آن اضافه نمی‌شود.
- تست قرارداد جدید: `tests/currency-output-policy.test.mjs` (در زنجیره `npm run check`).

## تغییرات دیتابیس

### Migration 136

فایل `supabase/migrations/136_finance_payment_ledger_bank_name_contract.sql`:

- ستون `bank_name` را در انتهای View `v_finance_payment_ledger` بازمی‌گرداند؛
- Contract را داخل خود Migration اعتبارسنجی می‌کند؛
- دسترسی Select و Reload Schema Cache را حفظ می‌کند.

### Migration 137

فایل `supabase/migrations/137_direct_transfer_mixed_allocations.sql`:

- مدل قبلی را بدون حذف یا انتقال سوابق به حواله مستقیم مختلط ارتقا می‌دهد؛
- `line_type`، `target_party_id` و `target_payment_id` را اضافه می‌کند؛
- برابری دقیق مبلغ دریافتی و جمع تخصیص‌ها را در RPC و Constraint دیتابیس حفظ می‌کند؛
- RPCهای ثبت، اصلاح نسخه‌دار و ابطال امن را اضافه می‌کند؛
- پرداخت مبدأ و مقصد را بدون بانک/صندوق در صورت‌حساب اشخاص ثبت می‌کند؛
- فقط ردیف‌های هزینه را وارد Expense Ledger، داشبورد هزینه و سودآوری سفارش می‌کند؛
- حذف فیزیکی Header و Line را مسدود نگه می‌دارد؛
- نام‌های RPC قبلی را برای سازگاری به Wrapperهای امن تبدیل می‌کند.

## تغییرات Frontend

- `src/modules/accounting/AccountingForms.jsx`
  - فرم حواله مستقیم با مبلغ دریافتی مستقل؛
  - ردیف‌های مخلوط هزینه/پرداخت به شخص؛
  - کنترل تراز دقیق و نمایش مانده قبل/بعد بدون سقف بدهی مبدأ.
- `src/modules/accounting/AccountingModule.jsx`
  - حذف حواله از Hero و گردش بانک/صندوق؛
  - کارت مستقل ثبت، جست‌وجو، مشاهده، مدیریت نسخه و ابطال در هزینه‌ها؛
  - Detail مختلط با تفکیک اثر هر ردیف.
- `src/lib/financeApi.js`
  - اتصال به RPCهای Migration 137؛
  - حفظ سازگاری نام‌های قبلی؛
  - بازگشت CSS چاپ به مبنای نسخه `136.0.1` همراه با موتور تک‌صفحه‌ای و Auto-fit سلولی.
- `src/modules/accounting/FinanceDocumentDetails.jsx`
  - حذف ساختار مبلغ/واحد دوخطی و `colgroup` درصدی؛
  - بازگشت عرض‌های ثابت و قالب تأییدشده نسخه ۱۳۶.
- `src/modules/orders/OrdersModule.jsx`
  - دو کارت مستقل فاکتور و پیش‌فاکتور با State جست‌وجوی مستقل، شمارنده و حالت خالی.

## تست‌های Contract و Integration

- Contract ستون `bank_name` و Query واقعی View؛
- Replay Migrationهای جدید در PGlite؛
- نمونه مختلط ۱۰۰/۶۰/۴۰؛
- عبور مبلغ مبدأ از مانده بدهکار به مانده بستانکار؛
- اثر صحیح صورت‌حساب مبدأ و مقصد؛
- عدم نشت به بانک، صندوق و Payment Ledger خزانه؛
- تفکیک هزینه واقعی از پرداخت به شخص؛
- Idempotency، تراز Journal، اصلاح نسخه‌دار، ابطال امن و منع حذف فیزیکی؛
- منع ثبت توسط نقش فروش؛
- Contract دو کارت مستقل اسناد سفارش؛
- Contract بازگشت ظاهر چاپ نسخه ۱۳۶، Auto-fit و تک‌صفحه‌ای.

## وضعیت کنترل نهایی

Full Check نهایی نسخه `139.0.0` موفق بود:

- Calculator Engine: موفق
- Inventory Valuation: موفق
- Warehouse/Shipment Contracts: موفق
- Jalali Input: موفق
- UI Workflow Regressions: موفق
- Finance Print Layout و Single-page Auto-fit: موفق
- Backup/Restore Contract: موفق
- Server Syntax: موفق
- Replay Migrationهای 128 تا 137 در PGlite: موفق
- Integration حواله مستقیم مختلط، RLS، Idempotency، Revision و Safe Void: موفق
- Production Build با Vite: موفق؛ ۲۴۹۲ ماژول Transform شد.

تنها پیام Build، هشدار غیرمسدودکننده اندازه Chunk حسابداری بود و هیچ خطا یا شکست تست وجود نداشت.
