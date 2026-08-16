# مرحله ۰۴۰ - پایدارسازی پیام خطاها و تجربه کاربری

تاریخ انجام: ۱۴۰۵/۰۵/۲۴

## هدف
در ماژول‌های مختلف، خطاهای خام انگلیسی/قرمز دیتابیس و شبکه مستقیم به کاربر نمایش داده نشوند و پیام فارسی قابل فهم جایگزین شود.

## فایل جدید

```txt
src/lib/errorMessages.js
```

## امکانات فایل خطای مشترک
تابع اصلی:

```js
getFriendlyErrorMessage(error, fallback)
```

برای این موارد پیام فارسی و قابل فهم می‌دهد:

- مشکل شبکه / فیلترینگ / Failed to fetch
- منقضی شدن نشست کاربر / JWT
- خطای دسترسی / RLS / Permission denied
- اجرا نشدن SQL و نبودن RPC
- نبودن View/Table
- نبودن ستون‌های جدید دیتابیس
- خطای تغییر ترتیب ستون View
- رکورد تکراری
- خطای Foreign Key
- فیلد ضروری خالی
- فرمت اشتباه تاریخ/عدد/شناسه
- Timeout
- مشکل SSL

تابع دوم:

```js
getTechnicalErrorMessage(error)
```

برای نمایش جزئیات فنی کوچک، مخصوص پشتیبانی و عیب‌یابی.

## بخش‌های وصل‌شده به پیام خطای فارسی

```txt
src/modules/orders/OrdersModule.jsx
src/modules/accounting/AccountingModule.jsx
src/modules/production/ProductionModule.jsx
src/modules/warehouse/WarehouseModule.jsx
src/modules/rnd/RnDModule.jsx
src/modules/dashboard/Dashboard.jsx
src/hooks/useDashboardData.js
src/components/referrals/ReferralPanel.jsx
src/components/shared/SharedFilesPanel.jsx
src/components/admin/AuditLogPanel.jsx
src/auth/LoginPage.jsx
```

## نتیجه
اگر SQLهای جدید مثل ۰۳۸ و ۰۳۹ هنوز اجرا نشده باشند یا View/RPC آماده نباشد، کاربر پیام واضح فارسی می‌بیند؛ مثل:

```txt
تابع مورد نیاز در دیتابیس پیدا نشد. احتمالاً SQLهای جدید هنوز در Supabase اجرا نشده‌اند.
```

یا:

```txt
ستون جدید مورد نیاز در دیتابیس وجود ندارد. احتمالاً دیتابیس با آخرین SQLها به‌روزرسانی نشده است.
```

## تست Build

```txt
npm run build
✓ built successfully
```

## نکته
این مرحله فقط روی کد Frontend است و SQL جدید نیاز ندارد.
