-- Migration 151: رفع خطای «duplicate key value violates unique constraint transformer_bobbins_warehouse_item_id_key»
--
-- علت: در نسخهٔ ۱۲۳ ستون warehouse_item_id جدول بوبین‌ها unique تعریف شده بود (هر قلم انبار فقط
-- یک بوبین). این محدودیت اشتباه است: یک قلم انبار (مثلاً یک بوبین عمومی خریداری‌شده) می‌تواند
-- به چند بوبینِ منطقی (افقی/عمودی، پین‌های متفاوت) اشاره کند.
-- رفع: حذف unique از این ستون (فقط FK می‌ماند). idempotent.

alter table calculator.transformer_bobbins
  drop constraint if exists transformer_bobbins_warehouse_item_id_key;
