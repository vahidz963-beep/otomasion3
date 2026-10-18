# صورت‌جلسه تحویل نسخه ۱۳۲

تاریخ آزمون: 2026-10-18

## وضعیت تحویل

- نسخه برنامه: `132.0.0`
- نسخه افزونه WordPress: `1.1.0`
- نسخه موتور محاسبه: `calculator-engine-1.1.0` بدون تغییر فرمول
- Migration جدید: ندارد
- Migration مبنا: `123_calculator_center_integration.sql`
- وضعیت Feature Flag قیمت عمومی: باید تا تأیید کالیبراسیون خاموش بماند
- وضعیت استقرار Edge نسخه ۱۳۲: فایل آماده است، اما Deploy محیط واقعی باید طبق راهنمای استقرار انجام شود

## فایل‌های اصلی تغییرکرده

- `src/lib/calculatorApi.js`
- `src/modules/calculator/CalculatorModule.jsx`
- `src/modules/calculator/CalculatorModule.css`
- `src/modules/calculator/calculatorVisuals.js`
- `supabase/functions/calculator-api/index.ts`
- `supabase/functions/_shared/calculator-policy.js`
- `tests/calculator-engine.test.mjs`
- `wordpress/aryaman-calculator-connector/aryaman-calculator-connector.php`
- `wordpress/aryaman-calculator-connector/assets/calculator.js`
- `wordpress/aryaman-calculator-connector/assets/calculator.css`
- `wordpress/aryaman-calculator-connector/readme.txt`
- `DEPLOY_VERSION_132_FA.md`
- `CALCULATOR_132_AUDIT_FA.md`

## معیارهای پذیرفته‌شده

- دکمه افزودن سیم‌پیچ پس از جدول و سمت راست قرار گرفت.
- نوار ۱ تا ۱۰۰ درصد به‌صورت زنده و بدون ثبت Quote به‌روزرسانی می‌شود.
- Preview داخلی و عمومی هیچ Snapshotی ذخیره نمی‌کند.
- Confirm داخلی و عمومی محاسبه را در سرور تکرار و فقط نتیجه معتبر را ثبت می‌کند.
- نام مشتری، شماره تماس و عنوان پروژه در Edge برای Confirm الزامی هستند.
- تغییر هر ورودی نتیجه قبلی را بی‌اعتبار می‌کند؛ پاسخ دیررس Preview نیز نمی‌تواند نتیجه قدیمی را دوباره فعال کند.
- اطلاعات فنی و مهندسی از قیمت و اطلاعات سفارش جدا شده است.
- تصویر ۱ یک مستطیل یک‌رنگ برای هر سیم‌پیچ دارد، فاقد رگه سفید است و عایق طلایی ضخیم‌تر دارد.
- Overfill تصویر ۱ تمام ارتفاع پنجره را پر می‌کند و کوچک نمی‌شود.
- هر دو تصویر در گزارش مشتری و گزارش داخلی باقی مانده‌اند؛ تصویر ۲ فقط نمای بالا است.
- `service_role`، فرمول و بهای تمام‌شده در Edge باقی مانده‌اند.
- پاسخ عمومی فاقد بهای تمام‌شده، درصد سود، موجودی خام و شناسه انبار است.
- رفتار Actionهای قدیمی نسخه ۱۳۱ برای سازگاری حفظ شده است.

## نتیجه آزمون‌ها

| آزمون | نتیجه |
|---|---|
| تست موتور، فرمول مرجع، BOM، واحد گرم و حداقل سفارش | موفق |
| تست Policy ذخیره Preview/Confirm | موفق |
| تست قرارداد UI و بی‌اعتبارشدن نتیجه | موفق |
| تست SVG، تعداد نوارها، نبود رگه سفید، عایق و Overfill | موفق |
| تست قرارداد Edge و خروج Preview پیش از Save RPC | موفق |
| تست قرارداد افزونه WordPress Preview/Confirm | موفق |
| بررسی Syntax جاوااسکریپت افزونه | موفق |
| Parse فایل PHP با AST parser | موفق |
| Bundle آزمایشی Edge Function با esbuild | موفق |
| Build تولید Vite | موفق |
| تست صحت ZIP افزونه | موفق |

فرمان اصلی آزمون:

```bash
npm run check
```

Build با هشدار قدیمی Chunk بزرگ Accounting تمام شد؛ هشدار مانع تولید نیست و به تغییرات مرکز محاسبه مربوط نمی‌شود.

`npm audit --omit=dev` یک آسیب‌پذیری High در وابستگی قدیمی و مستقیم `xlsx@0.18.5` گزارش می‌کند (Prototype Pollution/ReDoS). همین وابستگی در نسخه ۱۳۱ نیز وجود داشته و برای آن اصلاح خودکار امن در npm ارائه نشده است؛ در این نسخه برای جلوگیری از رگرسیون ماژول‌های Excel جایگزین نشده و باید در یک ارتقای مستقل بررسی شود. Credential یا آسیب‌پذیری جدیدی در کد مرکز محاسبه شناسایی نشد.

## بسته افزونه

- مسیر: `wordpress/aryaman-calculator-connector-v1.1.0.zip`
- SHA-256: `ee09a438af5a2b70214fec5328a7fe5d8e03c88bd125bf5756e3181af90a72cf`

## کنترل رگرسیون مالی

نسخه ۱۳۲ هیچ فایل ماژول حسابداری، Migration مالی، حد گردش حساب ۳۰۰۰ یا منطق شماره ردیف سراسری را تغییر نداده است. حذف فیزیکی مالی نیز اضافه نشده است.

## محدودیت کالیبراسیون

وزن سیم با قطر ثبت‌شده شامل لاک برآورد می‌شود، چون جرم واقعی بر متر یا قطر بدون لاک در مدل موجود نیست. این نکته در `CALCULATOR_132_AUDIT_FA.md` ثبت شده و یکی از دلایل خاموش‌ماندن قیمت عمومی تا کالیبراسیون واقعی است.
