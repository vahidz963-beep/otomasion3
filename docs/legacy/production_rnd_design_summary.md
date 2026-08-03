# خلاصه طراحی: بخش تولید و R&D

## هدف این فایل
هماهنگی بین چت‌های موازی پروژه (سفارش، انبار، حسابداری، R&D، تولید).
فایل‌های SQL کامل: `production_module_schema.sql` و `rnd_module_schema.sql`
(ترتیب اجرا: ابتدا production، سپس rnd — چون rnd به `product_categories`
و `production_orders` وابسته است).

---

## ۱. دسته‌بندی محصول (پایه مشترک)
چهار دسته که هم تولید و هم R&D از آن استفاده می‌کنند:

| کد | نام فارسی | توضیح |
|---|---|---|
| PCB_ASSY | برد آرایه‌شده (اسمبلی) | بیشترین حجم تولید |
| PCB_SPEC | برد با مشخصات معین | |
| TRANSFORMER | ترانس سوئیچینگ | |
| FULL_PRODUCT | محصول کامل | کمترین حجم تولید |

هر دسته می‌تواند تعداد مراحل تولید/طراحی کاملاً متفاوت داشته باشد
(نه محدود به بازه ثابت). مثال‌های پیاده‌شده:
- ترانس: ۴ مرحله
- برد آرایه‌شده: ۷ مرحله
- محصول کامل: ۵ مرحله
- برد با مشخصات معین (PCB_SPEC): **هنوز template تعریف نشده** — باز است

---

## ۲. بخش تولید (Production)

### جداول اصلی
- `production_orders` — سفارش تولید؛ `source_type` می‌تواند `direct_order`
  یا `rnd_project` باشد
- `production_stage_templates` — قالب مراحل به‌ازای هر دسته محصول
- `production_order_stages` — نمونه واقعی مراحل هر سفارش (پشتیبانی از
  مرحله سفارشی via `is_custom`)
- `production_material_usage` — کسر مواد اولیه، تریگر خودکار به
  `warehouse_transactions`
- `production_qc_checks` — کنترل کیفیت
- `production_output` — خروجی نهایی، تریگر خودکار ثبت در انبار
- `production_progress_logs` — لاگ پیشرفت + تریگر محاسبه % خودکار

### کلید یکپارچگی گزارش‌ها
`stage_type` (enum مشترک بین همه دسته‌ها: planning, material_prep,
assembly, soldering, winding, programming_test, assembly_final, qc,
packaging, final_output, custom) — با وجود تعداد مراحل متفاوت هر دسته،
گزارش‌های مقایسه‌ای (مثلاً میانگین زمان QC در کل کارخانه) ممکن است.

### Views
- `v_production_dashboard` — داشبورد مدیریتی
- `v_stage_performance` — مقایسه عملکرد مراحل بین دسته‌های مختلف

---

## ۳. بخش R&D

### جداول اصلی
- `rnd_projects` — پروژه طراحی؛ `output_destination`: تولید داخلی /
  تحویل مشتری / هر دو
- `rnd_design_revisions` — نسخه‌بندی طراحی
- `rnd_stage_templates` + `rnd_project_stages` — مراحل طراحی، منعطف
  (فقط template دسته PCB_ASSY فعلاً کامل است)
- `rnd_material_usage` — **مستقل و بدون اتصال به انبار اصلی**
  (توضیح در بخش ۵)
- `rnd_prototype_tests` — تست عملکردی نمونه
- `rnd_production_handoffs` + تابع `fn_handoff_to_production()` —
  اتصال رسمی R&D به تولید (وقتی status = 'approved'، خودکار یک
  `production_order` با `source_type='rnd_project'` می‌سازد)

### Views
- `v_rnd_dashboard`

---

## ۴. نکات باز برای هماهنگی با سایر چت‌ها

| مورد | وضعیت | وابسته به چت |
|---|---|---|
| `production_orders.source_order_id` | plain UUID، بدون FK واقعی | سفارش (Order) |
| `rnd_projects.source_order_id` | plain UUID، بدون FK واقعی | سفارش (Order) |
| اسم ستون‌های `warehouse_items` / `warehouse_transactions` | فرضی، نیاز به تطبیق | انبار |
| قالب مراحل PCB_SPEC (تولید و R&D) | تعریف نشده | داخلی (بعداً) |
| قالب مراحل R&D برای TRANSFORMER / FULL_PRODUCT | تعریف نشده | داخلی (بعداً) |

---

## ۵. نکته مهم: انبار R&D مستقل است
مواد و لوازم مصرفی R&D (نمونه‌سازی) از انبار اصلی شرکت **جدا** است و
انبار کوچک مخصوص به خود دارد. این ماژول فعلاً **هیچ اتصالی** به
`warehouse_transactions` برای R&D ندارد. جدول `rnd_material_usage`
صرفاً یک لاگ توصیفی ساده است (بدون FK به کالای انبار، بدون تریگر).

ستون `future_rnd_warehouse_item_id` برای اتصال بعدی رزرو شده؛ وقتی
انبار کوچک R&D طراحی شد، فقط کافی است این ستون FK شود — بدون نیاز به
migration یا تغییر داده‌های قبلی.

---

## ۶. وضعیت کلی پیشرفت

| مورد | وضعیت |
|---|---|
| Schema دیتابیس (تولید + R&D) | ✅ طراحی کامل |
| اجرای واقعی روی Supabase | ❌ هنوز نه |
| RLS Policies این دو ماژول | ❌ هنوز نه (فقط کلیات پیشنهادی) |
| فرانت‌اند/UI | ❌ هنوز نه |
| بخش سفارش (Order) | در چت جدا در حال طراحی |

### پیشنهاد RLS (کلیات، هنوز کد نشده)
- **مسئول تولید**: خواندن/نوشتن کامل روی جداول تولید
- **انباردار**: فقط خواندن `production_material_usage` و
  `production_output`
- **مدیر کل**: فقط خواندن (داشبوردها)
- **حسابدار**: خواندن `production_output` برای بهای تمام‌شده
