# مانیفست نسخه ۱۴۰.۰.۰

## هویت انتشار

- نسخه برنامه: `140.0.0`
- نسخه موتور محاسبه: `calculator-engine-1.2.0` (بدون تغییر نسبت به ۱۳۹ — فرمول‌ها دست نخورده)
- Migration جدید: `140_calculator_ams_am_numbering_and_test_data.sql` (تک‌مورد؛ پس از 139)
- Edge Function تغییرکرده: `calculator-api` (پاک‌سازی و ذخیره `test_data`، بازگرداندن کدهای سند)

## محتوا

1. **دیتاشیت انگلیسی مشتری (یک صفحه)** — بازنویسی کامل `src/modules/calculator/calculatorReports.js`:
   - سربرگ «Switching Transformer Datasheet | Model: … | Document ID: …» + لوگو.
   - ۱) Basic Information: Document ID / Project / Customer / Designer (`aryaman`) / Date (جلالی با ارقام لاتین) / Order Quantity. Project و Customer از فرم سفارش خوانده می‌شوند و می‌توانند فارسی بمانند.
   - ۲) Core Specifications: Core Type / Family / Material / Bobbin (فقط مدل) / Ae و Air Gap اختیاری — بدون Window و MLT.
   - ۳) Winding Specification: ستون‌های Winding / Start Pin / To Pin / Turns / Wire mm / Strand / Layer / Direction / Insulation (یک عدد = دور عایق هر لایه، پیش‌فرض ۳) — بدون ستون طول سیم.
   - ۴) Transformer Diagrams: دو نقشه پرشدگی و نمای پایه با همان موتور رسم قبلی (`buildWindowFillSvg`/`buildPinDiagramSvg`) بدون هیچ تغییری.
   - ۵ و ۵.۱) Inductance و Electrical Test — اختیاری؛ فقط در صورت پرشدن (Primary/Leakage/Secondary، Turns Ratio، Hi-Pot، DCR اولیه/ثانویه/کمکی + شرایط).
   - ۶) Order Summary: دقیقاً شش قلم — Occupancy، وزن مس، تعداد، قیمت واحد، هزینه ستاپ، مبلغ نهایی.
   - جدول‌ها با پس‌زمینه سرمه‌ای Item/Value و گوشه گرد؛ فوتر «کد سند | Page 1/1».
2. **خروجی همکاران (دو صفحه)**: صفحه ۱ = همان دیتاشیت مشتری؛ صفحه ۲ = فارسی RTL «ریز محاسبات و قیمت‌گذاری» با الف) جدول محاسبات قیمت کامل (شامل ردیف‌های نوار مایلار و چسب هسته)، ب) پارامترهای محاسبه و تولید، ج) چک‌لیست هشت‌قلمی کنترل کیفیت با نام بازرس/تاریخ/امضا.
3. **شماره‌گذاری AMS/AM (Migration 140)**:
   - `quotes.ams_code = 'AMS<n>'` برای همه اسناد (Backfill به ترتیب ایجاد) و Default برای اسناد جدید از توالی `calculator.ams_number_seq`.
   - `quotes.am_code = 'AM<n>'` فقط با `fn_calculator_convert_quote_to_am` توسط مدیر، پس از اتصال سفارش و رسیدن به تعداد (رزرو/در تولید/تکمیل)؛ یک‌بار، Idempotent، با Audit (`quote_renumbered_to_am`).
   - Document ID دیتاشیت = `am_code` در صورت وجود، وگرنه `ams_code`.
4. **داده‌های اختیاری آزمون**: ستون `quotes.test_data jsonb`؛ ورودی UI در بخش تاشوی فرم طراح؛ پاک‌سازی در Edge Function (کلیدهای مجاز، ≤۸۰ نویسه)؛ چاپ شرطی در بخش‌های ۵/۵.۱.
5. **UI مرکز محاسبه**: کارت‌های موجودی هسته/بوبین با پس‌زمینه سبز/قرمز (`stock-bg`)؛ حذف نمایش موجودی سیم از جدول نتیجه و حذف هشدار `WIRE_STOCK_LOW` از نما؛ خلاصه نتیجه در ردیف‌های یکنواخت چهارستونی؛ بخش داده‌های آزمون به‌صورت پیش‌فرض باز و هایلایت طلایی با امکان جمع‌کردن.
6. **نقشه‌ها**: موتور رسم همان است؛ فقط برچسب‌ها دوزبانه شدند — دیتاشیت انگلیسی (`lang:'en'`)، نمای داخلی همان فارسی قبلی. نقشه پرشدگی: شماره/درصد داخل هر نوار + ابعاد BW/HW + علامت OVERFILL؛ موتور پین‌دیاگرام پارامتر اختیاری `title` گرفت (پیش‌فرض فارسی بدون تغییر).
7. **قلم چسب جدید**: `fn_calculator_save_consumable` (Migration 141) + مودال سریع در فرمول و فرم بوبین؛ واحد متر/گرم سمت سرور قفل است.
8. **خروجی و تأیید**: روند PDF مثل چاپ فاکتور (پیش‌نمایش + دکمه «چاپ / ذخیره PDF»)؛ دو کادر نقشه هم‌اندازه با راهنمای رنگ لایه‌ها و توضیح؛ تأیید نهایی بعد از بخش ۲ با تعداد/قیمت واحد/قیمت کل و خطای محلی؛ چیپ موجودی زیر انتخاب هسته/بوبین؛ کادر تعداد هم‌اندازه.
9. **چسب هر لایه هر سیم‌پیچ**: ستون «چسب هر لایه (دور)» در جدول سیم‌پیچ (پیش‌فرض ۳)؛ موتور 1.2.0 آن را به‌ازای هر ردیف اعمال می‌کند (`row.insulation_wraps`، سقف ۲۰) و Edge هم عبور می‌دهد؛ پیش‌فرض‌ها بدون تغییر (baseline تست پابرجا).
10. **افزونه وردپرس 1.3.0**: هم‌گام با موارد فوق — `wordpress/aryaman-calculator-connector-v1.3.0.zip`.

## فایل‌های کلیدی

- `src/modules/calculator/calculatorReports.js` — بازنویسی کامل (دیتاشیت انگلیسی + صفحه همکاران).
- `src/modules/calculator/CalculatorModule.jsx` — فیلدهای آزمون، docCode/testData در هر دو نقطه چاپ، دکمه تبدیل AM در مودال گزارش، سبز/قرمز موجودی، حذف موجودی سیم.
- `src/modules/calculator/CalculatorModule.css` — `stock-bg`، `calc-test-data/.calc-test-grid`، چیدمان چهارستونی خلاصه.
- `src/lib/calculatorApi.js` — تابع جدید `convertCalculatorQuoteToAm`.
- `supabase/functions/calculator-api/index.ts` — `sanitizeTestData` + عبور `test_data`.
- `supabase/migrations/140_calculator_ams_am_numbering_and_test_data.sql`.
- `tests/calculator-engine.test.mjs` + `tests/calculator-report-fixture.mjs` — قراردادهای جدید خروجی و Migration 140.
- `tests/warehouse-shipments.test.mjs` — Assert نسخه `140.0.0`.

## ناسازگاری‌ها و یادداشت‌ها

- ساختار HTML خروجی PDF مرکز محاسبه عوض شده است (کلاس‌های `report-*` قدیمی → `ds-*`)؛ هر سفارشی‌سازی چاپی روی کلاس‌های قدیمی باید به کلاس‌های جدید منتقل شود.
- `fn_calculator_save_quote` و `fn_calculator_list_quotes` جایگزین کامل شده‌اند؛ امضای فراخوانی تغییری نکرده است.
- شماره‌های `CALC-…` همچنان به‌عنوان کد عمومی حفظ می‌شوند؛ `AMS/AM` شناسه سند دیتاشیت است.
- موتور محاسبه و Migration 139 بدون تغییرند؛ گارد نسخه موتور در Edge Function فعال است.
