# صورت‌جلسه تحویل نسخه ۱۳۱

تاریخ آماده‌سازی: ۱۴۰۵/۰۷/۲۶ (2026-10-18)

## مبنا

- بسته مبنا: `Otomasion2_DEPLOY_VERSION_130_FLAT.zip`
- SHA-256 مبنا: `0e8b89af639fdafbdf46265fd6674b9c6c55cbffa572fa735f25b31370cdd751`
- Migration جدید: فقط `123_calculator_center_integration.sql`
- Migration 119 تکرار نشده است.

## فایل‌های جدید اصلی

- `src/modules/calculator/CalculatorModule.jsx`
- `src/modules/calculator/CalculatorModule.css`
- `src/modules/calculator/calculatorVisuals.js`
- `src/modules/calculator/transformerDiagramEngine.js`
- `src/lib/calculatorApi.js`
- `supabase/migrations/123_calculator_center_integration.sql`
- `supabase/functions/calculator-api/index.ts`
- `supabase/functions/_shared/calculator-engine.js`
- `supabase/config.toml`
- `wordpress/aryaman-calculator-connector-v1.0.0.zip`
- SHA-256 افزونه: `741305d1e7a90554c904b965a54ba0e6f84769d6b9b74bfe6df723c455d10e01`
- `tests/calculator-engine.test.mjs`
- `DEPLOY_VERSION_131_FA.md`

## قابلیت افزوده‌شده برای مدل‌های جدید

از داخل مرکز محاسبه می‌توان:

- هسته جدید با مشخصات دقیق مهندسی ثبت کرد؛
- بوبین جدید را به هسته متناظر افزود؛
- سیم مسی لاکی جدید ثبت کرد؛
- قطعه را به قلم موجود انبار نسخه ۱۳۰ وصل کرد؛
- یا با نقش مدیر/انبار، قلم جدید انبار، موجودی اولیه و قیمت ارزی را در همان عملیات ساخت؛
- اتصال و مشخصات مدل‌های موجود را ویرایش کرد.

مدل فنی قیمت و موجودی را کپی نمی‌کند؛ فقط `warehouse_item_id` را نگه می‌دارد و مقدار روز را از انبار می‌خواند. ثبت قلم، موجودی اولیه، قیمت و اتصال فنی در یک تراکنش انجام می‌شود. مدل بدون اطلاعات کامل یا بدون اتصال انبار دیده می‌شود ولی قابل محاسبه نیست.

## نتیجه آزمون‌ها

- `npm run check`: موفق (`test:calculator` و Build نهایی)
- `npm run test:calculator`: موفق
- `npm run build`: موفق؛ ۲۴۸۲ ماژول تبدیل شد
- تصویر ۱: تعداد نوار رنگی دقیقاً برابر تعداد سیم‌پیچ‌ها
- تصویر ۱: نسبت ارتفاع نوارها با سهم مصرف پنجره آزمون شد
- تصویر ۱: تعداد عایق‌ها دقیقاً `تعداد سیم‌پیچ منهای یک`
- تصویر ۲: فقط «نمای بالا»
- تصویر ۲: بدون `Winding Specification`
- بازتولید هر دو گزارش از Snapshot ذخیره‌شده در صف سفارش‌ها: موفق در Build و تست ساختاری
- قواعد سفارش نمونه و حداقل ۱۰۰ عدد: موفق
- یک هسته و یک بوبین به‌ازای هر ترانس: موفق
- نبود سرسیم/کابلشو در BOM: موفق
- Migration 123 در PostgreSQL جاسازی‌شده اجرا شد: ۲۱ هسته Seed شد
- ثبت اتمیک هسته و بوبین جدید همراه ایجاد قلم و موجودی اولیه انبار اجرا شد: موفق
- انتشار نسخه جدید فرمول و خاموش‌شدن خودکار انتشار عمومی اجرا شد: موفق
- گردش SQL رزرو ← مصرف قطعی اجرا شد: ۳ قلم به `consumed` رسید، سند خروج نهایی با ۳ ردیف ساخته شد و Quote به `produced` تغییر کرد
- خروجی بازیابی گزارش برای نقش غیرمدیر آزموده شد و `pricing_snapshot` محرمانه خالی بود
- TypeScript Edge Function با esbuild parse/bundle شد: موفق
- JavaScript افزونه با `node --check` و PHP آن با Parser مستقل بررسی شد: موفق
- اسکن credential/JWT/کلید ابری: صفر مورد
- اسکن قیمت و موجودی نمونه قدیمی Prototype: صفر مورد در کد عملیاتی
- مقایسه با نسخه ۱۳۰: هیچ فایل مالی/حسابداری و هیچ Migration مالی تغییر نکرده است

## وضعیت انتشار

- ماژول داخلی برای نقش‌های مجاز فعال است.
- `public_quote_enabled = false`
- `public_quote_calibrated = false`
- قیمت عمومی WordPress تا تأیید کالیبراسیون مدیر پاسخ داده نمی‌شود.
- هیچ credential در بسته قرار ندارد.

## نکته استقرار

موفقیت Build به معنای اتصال خودکار به پروژه Supabase مقصد نیست. برای بهره‌برداری باید Migration 123 و Edge Function مطابق `DEPLOY_VERSION_131_FA.md` در محیط مقصد Deploy شوند و سپس قطعات فنی به اقلام واقعی انبار متصل شوند.
