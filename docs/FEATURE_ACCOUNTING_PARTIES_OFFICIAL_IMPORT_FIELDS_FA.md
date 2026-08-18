# افزودن فیلدهای رسمی به ورود Excel اشخاص مالی

## درخواست
در بخش مالی/حسابداری، هنگام ورود لیست اشخاص از Excel، فیلدهای لازم برای فاکتور رسمی اضافه شود و ایمیل حذف شود.

## اصلاحات انجام‌شده
- ستون «ایمیل» از قالب Excel اشخاص حذف شد.
- ستون‌های زیر به قالب Excel اشخاص اضافه شد:
  - کد اقتصادی
  - شماره ثبت
  - شناسه ملی
  - کد پستی
- فرم ورود گروهی Excel این ستون‌ها را می‌خواند و در اطلاعات شخص ذخیره می‌کند.
- پیش‌نمایش فایل Excel در Modal اشخاص هم ستون‌های جدید را نشان می‌دهد.
- فرم ثبت دستی شخص جدید هم همین فیلدهای رسمی را دارد.
- چاپ فاکتور رسمی از این اطلاعات برای مشخصات خریدار استفاده می‌کند.
- فایل قالب آماده به‌روزرسانی شد:

```txt
public/templates/finance_parties_import_template.xlsx
```

## SQL جدید
برای ذخیره شماره ثبت و کد پستی در دیتابیس، SQL جدید ساخته شد:

```txt
supabase/migrations/054_finance_parties_official_fields_import.sql
```

## فایل‌های تغییرکرده
```txt
src/lib/financeApi.js
src/modules/accounting/AccountingModule.jsx
src/modules/accounting/FinanceDocumentDetails.jsx
src/hooks/useAccountingData.js
public/templates/finance_parties_import_template.xlsx
supabase/migrations/054_finance_parties_official_fields_import.sql
```

## تست
Build پروژه با موفقیت انجام شد:

```txt
npm run build
✓ built successfully
```
