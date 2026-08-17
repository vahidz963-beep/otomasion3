# اصلاح انبار - خطای دسترسی ثبت دستی لیست ارسال‌شده‌ها

تاریخ: ۱۴۰۵/۰۵/۲۶

## مشکل
در تب «لیست ارسال‌شده‌ها» هنگام ثبت دستی ارسال، خطای دسترسی/RLS نمایش داده می‌شد:

```txt
دسترسی لازم برای این عملیات وجود ندارد...
```

## علت
جدول `warehouse_shipments` برای Insert/Update توسط نقش انباردار Policy کافی نداشت یا SQL مرحله ۰۴۱/۰۴۳ به‌طور کامل اجرا نشده بود.

## اصلاح انجام‌شده
Migration جدید ساخته شد:

```txt
supabase/migrations/044_fix_warehouse_shipments_rls_permissions.sql
```

این SQL:

- RLS جدول `warehouse_shipments` را فعال و تنظیم می‌کند.
- اجازه مشاهده برای نقش‌های مرتبط را می‌دهد.
- اجازه ثبت و ویرایش را به نقش‌های `admin` و `warehouse` می‌دهد.
- اگر `created_by` از Frontend ارسال نشود، قبل از Insert با `auth.uid()` پر می‌شود.
- وضعیت پیش‌فرض ارسال را `ready` قرار می‌دهد.

## ترتیب اجرای SQL
بعد از اجرای SQLهای مربوط به ارسال‌شده‌ها، این SQL اجرا شود:

```txt
041_finance_warehouse_dashboard_office_enhancements.sql
043_warehouse_shipments_ready_from_final_flows.sql
044_fix_warehouse_shipments_rls_permissions.sql
```

اگر SQL خطا داد، ادامه نده و عکس/متن خطا را بفرست.

## تست Frontend

```txt
npm run build
✓ built successfully
```
