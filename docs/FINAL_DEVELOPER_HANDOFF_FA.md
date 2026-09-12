# بسته نهایی تغییرات کد مشتری و نمایش داده‌ها

## وضعیت واقعی

- فایل قدیمی: 273 کد یکتای مشتری.
- مشتریان فعلی: 284 رکورد.
- اشخاص حسابداری: 271 رکورد.
- 271 کد از یادداشت حسابداری به مشتری مرتبط منتقل شده است.
- مهندس جعفری: کد 294.
- کدهای 76 و 213: مبهم و عمداً بدون انتساب خودکار.
- 12 مشتری بدون کد: حذف نمی‌شوند؛ باید غیرفعال بمانند تا اسناد قبلی آسیب نبینند.
- هیچ حذف یا بازسازی سفارش، فاکتور، گردش حساب، تولید یا انبار مجاز نیست.

## فایل‌های اصلی

- `supabase/migrations/068_customer_codes_and_full_party_lists.sql` — اصلاح‌شده برای کدهای عددی قدیمی و کدهای جدید.
- `supabase/migrations/069_customer_code_cross_module_views.sql` — نمایش کد در سفارش، تولید، R&D و انبار.
- `supabase/migrations/070_customer_code_finalization.sql` — Migration نهایی idempotent؛ قبل از اجرا backup بگیرید.
- `docs/customer_matching_final_report.md` — گزارش تطبیق.
- `docs/customer_matching_final_report.csv` — جزئیات هر کد و customer_id.
- `docs/legacy_customer_mapping_for_developer.xlsx` — فایل مرجع مشتریان قدیمی.

## ترتیب اجرا

1. از Supabase backup/export بگیرید.
2. مطمئن شوید Migration مرحله ساخت ستون‌ها و ثبت کدهای تأییدشده قبلاً اجرا شده یا 070 را روی محیط staging اجرا کنید.
3. `070_customer_code_finalization.sql` را در محیط staging اجرا کنید.
4. Queryهای کنترل پایین را اجرا کنید.
5. صفحات حسابداری، CRM، سفارش، فاکتور، تولید و انبار را تست کنید.
6. پس از تأیید نتیجه، همان Migration را روی production اجرا کنید.

## کنترل نهایی

```sql
select count(*) as coded_customers
from public.customers
where customer_code is not null;

select customer_code, count(*)
from public.customers
where customer_code is not null
group by customer_code
having count(*) > 1;

select id, company_name, customer_code, is_active
from public.customers
where regexp_replace(trim(company_name), '[[:space:]]+', ' ', 'g') = 'مهندس جعفری';

select id, company_name, customer_code, is_active
from public.customers
where customer_code is null;
```

## نمایش بدون سقف کورکورانه

برای لیست‌های زیاد، از Pagination/Load More یا `range(from,to)` استفاده شود؛ افزایش بی‌نهایت `limit` ممنوع است. کد مشتری باید در لیست اشخاص، اسناد، مانده‌ها، CRM، سفارش، تولید و انبار نمایش داده شود.

## نکته توسعه

- `customer_code` رشته متنی است تا کدهای قدیمی مثل `1`، `24` و `293` عیناً حفظ شوند.
- شماره‌گذاری بعدی از 295 ادامه پیدا می‌کند، چون 294 به مهندس جعفری اختصاص یافته است.
- تطبیق بر اساس `customers.id` است؛ نام به‌تنهایی معیار ادغام نیست.
- 76 و 213 تا زمان تعیین رکورد دقیق، نباید به مشتری موجود الصاق شوند.
