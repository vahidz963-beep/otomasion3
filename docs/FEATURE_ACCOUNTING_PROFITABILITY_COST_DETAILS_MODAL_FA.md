# نمایش ریز هزینه‌های سفارش در سود و زیان مالی

## درخواست
در بخش مالی/حسابداری، تب «سود سفارش‌ها»، با کلیک روی هر ردیف یا مبلغ هزینه، ریز تمام هزینه‌های آن سفارش در یک جدول وسط صفحه نمایش داده شود.

## اصلاحات انجام‌شده
- ردیف‌های جدول سود و زیان سفارش‌ها کلیک‌پذیر شدند.
- ستون «هزینه» به دکمه ریز هزینه تبدیل شد.
- با کلیک روی ردیف یا هزینه، Modal وسط صفحه باز می‌شود.
- داخل Modal جدول ریز هزینه‌ها نمایش داده می‌شود:
  - تاریخ
  - منبع هزینه
  - نوع هزینه
  - شرح
  - مبلغ
- جمع کل ریز هزینه‌ها در پایین جدول نمایش داده می‌شود.
- هزینه‌های دستی مالی، تولید/BOM، R&D و فاکتورهای خرید/هزینه در View یکپارچه هزینه‌ها لحاظ شدند.

## SQL جدید
برای اینکه ریز هزینه‌ها از همه منابع بیاید، View زیر به‌روزرسانی شد:

```txt
v_order_unified_costs
```

و محاسبه سود سفارش‌ها هم اصلاح شد تا هزینه‌های اسنادی دوباره‌شماری نشوند.

فایل SQL:

```txt
supabase/migrations/055_order_profitability_cost_details_view.sql
```

## فایل‌های تغییرکرده
```txt
src/hooks/useAccountingData.js
src/modules/accounting/AccountingModule.jsx
src/modules/accounting/AccountingModule.css
supabase/migrations/055_order_profitability_cost_details_view.sql
```

## تست
Build پروژه با موفقیت انجام شد:

```txt
npm run build
✓ built successfully
```

## نیاز به Deploy / SQL
- UI این قابلیت بعد از Deploy نهایی فعال می‌شود.
- SQL 055 را می‌توان قبل از Deploy در Supabase اجرا کرد تا Viewهای هزینه آماده شوند.
