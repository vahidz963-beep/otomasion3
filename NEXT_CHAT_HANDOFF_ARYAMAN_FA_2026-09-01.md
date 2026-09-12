# خلاصه انتقال پروژه اتوماسیون آریامن / آریامان برای ادامه در چت جدید

این فایل برای این است که در یک چت جدید، کار دقیقاً از همین نقطه ادامه پیدا کند و نیاز نباشد همه تاریخچه قبلی دوباره بررسی شود.

---

## 1. لحن و روش کار با کاربر

کاربر فارسی‌زبان است و می‌خواهد همه چیز خیلی ساده، دقیق و مرحله‌به‌مرحله گفته شود.

لحن مناسب:
- مستقیم و مسئولانه.
- بدون توضیح اضافه و توجیه زیاد.
- اگر خطا یا تأخیر از سمت ما بوده، صادقانه قبول شود.
- کاربر چند بار گفته: «فکر کن من هیچی بلد نیستم و گام به گام بگو کجا چیکار کنم».
- کاربر از ایرادهای زیاد خسته شده، پس پاسخ‌ها باید آرام، دقیق و مطمئن باشند.

نکته بسیار مهم:
- کاربر تعداد Deploy/Development محدود دارد.
- تا وقتی خودش نگفته، Deploy پیشنهاد نشود.
- تغییرات کدی انجام شود، Build گرفته شود، ولی Deploy فقط وقتی کاربر تأیید کرد.
- هر جا مشکل با SQL یا تنظیمات Supabase/Netlify حل می‌شود، اول همان مسیر پیشنهاد شود، نه Deploy اضافه.

بعد از هر تغییر کدی:
```bash
npm run build
```
اگر خطای `vite: not found` آمد:
```bash
npm install && npm run build
```

اگر SQL خطا داد:
- بگو ادامه نده.
- عکس یا متن خطا را بفرست.
- SQL را اصلاح کن.

---

## 2. مسیر پروژه اصلی

پروژه اصلی در Workspace:

```txt
/home/user/Otomasion2
```

بعد از پاکسازی اخیر، Workspace سبک شده و فقط همین پروژه اصلی باید مهم باشد.

در پاکسازی اخیر حذف شد:
- ZIPهای قدیمی
- فایل‌های SHA قدیمی
- عکس‌های آپلودی
- previewهای اضافی
- `node_modules`
- cache مربوط به npm

پس اگر Build لازم شد، احتمالاً باید اجرا شود:

```bash
cd /home/user/Otomasion2
npm install && npm run build
```

---

## 3. آدرس‌ها و سرویس‌ها

### Netlify فعال
```txt
https://automationaryaman.netlify.app/
```

### دامنه اختصاصی
```txt
https://automation.aryaman-co.ir/
```

### Supabase
Project ID:
```txt
wsmtxzkdmdkdqjlbkezx
```

Supabase URL:
```txt
https://wsmtxzkdmdkdqjlbkezx.supabase.co
```

### متغیرهای لازم Netlify
```txt
VITE_SUPABASE_URL=https://wsmtxzkdmdkdqjlbkezx.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_URL=https://wsmtxzkdmdkdqjlbkezx.supabase.co
SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role key>
```

نکته مهم برای `SUPABASE_SERVICE_ROLE_KEY`:
- باید از Supabase مسیر زیر گرفته شود:
```txt
Project Settings > API Keys > Legacy anon, service_role API keys
```
- کلید درست معمولاً با `eyJ...` شروع می‌شود.
- کلیدهای جدید `sb_secret_...` برای Function قبلاً مشکل ایجاد کرده بودند.

---

## 4. وضعیت کلی پروژه

پروژه اتوماسیون شرکت آریامن/آریامان شامل این بخش‌هاست:

- داشبورد مدیریتی
- سفارش‌ها و CRM فروش
- حسابداری/مالی
- انبار
- تولید
- R&D
- اداری
- کاربران و تاریخچه

کاربر در حال رساندن سیستم به نسخه تست داخلی / تقریباً نهایی است.

هدف فعلی:
- رفع ایرادهای باقی‌مانده
- اجرای SQLهای لازم در Supabase
- آماده‌سازی فایل نهایی GitHub/Deploy
- Deploy نهایی فقط با تأیید کاربر

---

## 5. آخرین فایل‌های ZIP ساخته‌شده

قبل از پاکسازی، آخرین فایل GitHub/Full ساخته‌شده:

```txt
Otomasion_FULL_FINAL_ALL_CHANGES_V066_2026-08-23.zip
```

آخرین فایل مخصوص Hosting/Dist:

```txt
Otomasion_HOSTING_DIST_ALL_CHANGES_V066_2026-08-23.zip
```

اما بعد از آن تغییر مهم V067 انجام شد، پس اگر کاربر دوباره فایل نهایی خواست باید ZIP جدیدتر ساخته شود، مثلاً:

```txt
Otomasion_FULL_FINAL_ALL_CHANGES_V067_2026-09-01.zip
Otomasion_HOSTING_DIST_ALL_CHANGES_V067_2026-09-01.zip
```

برای فایل GitHub باید فایل Full داده شود، نه فقط Dist.

---

## 6. SQLهای مهم و ترتیب اجرای جدید

SQLهای جدید و مهم آخر پروژه:

```txt
063_accounting_fiscal_year_create_and_periods.sql
064_accounting_balance_sheet_report.sql
065_unified_customer_accounting_contacts.sql
066_performance_full_system_indexes.sql
067_fast_orders_dashboard_loading.sql
```

اگر هیچ‌کدام اجرا نشده‌اند، ترتیب درست:

```txt
1. supabase/migrations/063_accounting_fiscal_year_create_and_periods.sql
2. supabase/migrations/064_accounting_balance_sheet_report.sql
3. supabase/migrations/065_unified_customer_accounting_contacts.sql
4. supabase/migrations/066_performance_full_system_indexes.sql
5. supabase/migrations/067_fast_orders_dashboard_loading.sql
```

اگر قبلی‌ها اجرا شده‌اند و فقط مشکل کندی سفارش‌ها/داشبورد وجود دارد:

```txt
فقط 067_fast_orders_dashboard_loading.sql اجرا شود.
```

اگر SQL خطا داد:
- ادامه نده.
- متن کامل یا عکس خطا را بفرست.

---

## 7. نکته مهم درباره SQL 061

کاربر قبلاً عکس خطای SQL 061 فرستاد:

```txt
Error: Failed to fetch (api.supabase.com)
```

این خطا معمولاً خطای SQL نیست؛ یعنی خود صفحه Supabase نتوانسته به API وصل شود.
علت‌های احتمالی:
- اینترنت
- VPN/فیلترشکن
- قطع لحظه‌ای Supabase
- timeout مرورگر

اگر دوباره همین خطا آمد:
- صفحه Supabase را refresh کند.
- دوباره Run بزند.
- اگر خطای واقعی SQL آمد، متن/عکس آن را بفرستد.

---

## 8. آخرین مشکل مهم: کندی سفارش‌ها و داشبورد

کاربر دو خطا/تصویر فرستاد:

### سفارش‌ها
پیام:
```txt
زمان پاسخگویی سرور طولانی شد. چند لحظه بعد دوباره تلاش کنید.
canceling statement due to statement timeout
```

### داشبورد مدیریتی
پیام:
```txt
هشدار سلامت داده‌ها
برخی View/RPCها هنوز کامل اجرا نشده‌اند؛ داشبورد با داده‌های موجود نمایش داده می‌شود.
زمان پاسخگویی سرور طولانی شد. چند لحظه بعد دوباره تلاش کنید.
```

تشخیص:
- مشکل فقط کندی UI نبود.
- Query/Viewهای سنگین Supabase قبل از پایان توسط Supabase قطع می‌شدند.
- علت اصلی: Viewهای سنگین سفارش‌ها و داشبورد که قبل از محدودسازی، join/group روی جدول‌های زیاد انجام می‌دادند.

اقدام انجام‌شده:
- فایل SQL جدید ساخته شد:
```txt
supabase/migrations/067_fast_orders_dashboard_loading.sql
```

این SQL اضافه می‌کند:
```txt
v_customer_accounting_contacts_fast
fn_orders_fast_overview
```

هدف:
- لیست سفارش‌ها و مشتری‌ها اول سبک و سریع بیاید.
- داده‌های سنگین بعداً در پس‌زمینه لود شوند.
- خطای timeout باعث خراب شدن کل صفحه نشود.

فایل‌های تغییرکرده برای V067:
```txt
src/hooks/useOrdersData.js
src/hooks/useDashboardData.js
supabase/migrations/067_fast_orders_dashboard_loading.sql
docs/BUGFIX_ORDERS_DASHBOARD_STATEMENT_TIMEOUT_PERFORMANCE_V067_FA.md
```

بعد از تغییرات V067، Build موفق بوده.

---

## 9. بهینه‌سازی سرعت قبلی V066

کاربر بسته کامل افزایش سرعت را انتخاب کرد.

انجام شد:
- حسابداری دو مرحله‌ای‌تر شد.
- سفارش‌ها و داشبورد refresh سبک‌تر گرفتند.
- Health Check داشبورد از لود اصلی جدا شد.
- SQL ایندکس کامل ساخته شد:

```txt
supabase/migrations/066_performance_full_system_indexes.sql
```

این SQL برای بخش‌های زیر ایندکس اضافه می‌کند:
- حسابداری
- فاکتورها
- پرداخت‌ها
- اسناد حسابداری
- اشخاص مالی
- مشتریان و CRM
- سفارش‌ها
- مراحل سفارش
- ارجاعات
- انبار و کاردکس
- تولید
- R&D
- حقوق و دستمزد
- وام‌ها
- هزینه‌ها و درآمدها

---

## 10. وضعیت حسابداری

### انجام‌شده‌های مهم حسابداری
- فاکتور رسمی/غیررسمی
- چاپ فاکتور و صورت‌حساب با تنظیمات چاپ
- تنظیمات چاپ داخل حسابداری
- حاشیه A4، اندازه متن، اندازه عدد، جهت چاپ
- فشرده‌سازی چاپ فاکتور
- فیلد یادداشت چاپ زیر فاکتور
- دریافت/پرداخت
- چک‌ها
- صندوق و گردش حساب
- کارت‌های بانکی با flip card
- ویرایش/حذف کارت بانکی امن
- اشخاص مالی + ورود از Excel
- اطلاعات رسمی اشخاص:
  - کد اقتصادی
  - شماره ثبت
  - شناسه ملی
  - کد پستی
- جستجوی شخص/مشتری در فاکتور و پرداخت
- MoneyInput با جداکننده هزارگان و نمایش تومان
- تاریخ شمسی با تایپ عددی بدون `/`
- سود سفارش‌ها + ریز هزینه‌ها
- وام‌ها
- حقوق و دستمزد داخل حسابداری
- سند پرداخت حقوق و کاهش مانده فیش
- هزینه‌ها و درآمدها
- لیست اسناد هزینه/درآمد با ویرایش/حذف امن
- دوره مالی با افزودن سال مالی و ساخت خودکار ۱۲ ماه
- ترازنامه حسابداری با خروجی PDF و Excel

### فایل‌های مهم حسابداری
```txt
src/modules/accounting/AccountingModule.jsx
src/modules/accounting/AccountingModule.css
src/modules/accounting/AccountingForms.jsx
src/modules/accounting/FinanceDocumentDetails.jsx
src/lib/financeApi.js
src/hooks/useAccountingData.js
src/components/MoneyInput.jsx
src/components/JalaliDateInput.jsx
src/components/SearchableSelect.jsx
src/components/ProductPicker.jsx
```

---

## 11. هزینه‌ها و درآمدها

تصمیم طراحی:
- عنوان‌های هزینه/درآمد داخل خود تب «هزینه‌ها و درآمدها» باشد، نه در تنظیمات عمومی حسابداری.

علت:
- حسابدار هنگام ثبت سند باید همان‌جا بتواند عنوان جدید اضافه کند.
- تنظیمات حسابداری برای تنظیمات عمومی مثل چاپ و شماره‌گذاری بماند.

انجام شد:
- عنوان‌های هزینه
- عنوان‌های درآمد
- زیرعنوان‌ها
- ثبت هزینه/درآمد
- لیست تمام اسناد
- فیلتر ماه شمسی
- جمع درآمد ماه
- جمع هزینه ماه
- خالص ماه
- ویرایش سند دستی
- حذف امن سند دستی با ابطال، نه حذف واقعی

SQL مربوط:
```txt
062_accounting_income_expense_categories.sql
```

---

## 12. دوره مالی و ترازنامه

### سال مالی
در حسابداری > دوره مالی:
- امکان افزودن سال مالی اضافه شد.
- با ثبت سال شمسی مثل ۱۴۰۶، ۱۲ ماه فروردین تا اسفند خودکار ساخته می‌شود.
- بستن سال، همه ماه‌های آن را می‌بندد.
- بازگشایی سال، همه ماه‌های آن را باز می‌کند.
- هر ماه جداگانه هم قابل بستن/بازگشایی است.

SQL:
```txt
063_accounting_fiscal_year_create_and_periods.sql
```

### ترازنامه
در همان بخش دوره مالی، گزارش ترازنامه اضافه شد.

ساختار ترازنامه:
```txt
دارایی‌ها = بدهی‌ها + حقوق مالکانه
```

گزارش از اسناد حسابداری قطعی‌شده ساخته می‌شود.

قابلیت‌ها:
- دارایی‌ها
- بدهی‌ها
- حقوق مالکانه
- سود/زیان سال جاری در حقوق مالکانه
- کنترل اختلاف تراز
- خروجی PDF
- خروجی Excel واقعی `.xlsx`

SQL:
```txt
064_accounting_balance_sheet_report.sql
```

نکته آموزشی که به کاربر گفته شد:
- ترازنامه دستی پر نمی‌شود.
- از سندهای حسابداری قطعی پر می‌شود.
- افتتاحیه، سرمایه اولیه، دارایی‌های قدیمی، استهلاک، مالیات و اصلاحات پایان سال باید با سند حسابداری/افتتاحیه ثبت شوند.

---

## 13. صندوق و گردش حساب

در بخش حسابداری > صندوق و گردش حساب:
- برای هر ردیف دریافت/پرداخت دکمه گرد با آیکن مداد اضافه شد.
- همه پرداخت‌ها/دریافت‌های دستی قابل ویرایش هستند.
- اگر سند به فاکتور وصل باشد، ارتباط حفظ می‌شود.
- بعد از ویرایش:
  - سند حسابداری قبلی باطل می‌شود.
  - سند حسابداری جدید ساخته می‌شود.
- اسنادی که از بخش‌هایی مثل چک، حقوق یا اقساط ساخته شده‌اند، برای حفظ سوابق باید از همان بخش اصلی اصلاح شوند.

فایل‌های مهم:
```txt
src/modules/accounting/AccountingModule.jsx
src/modules/accounting/AccountingModule.css
src/modules/accounting/AccountingForms.jsx
src/lib/financeApi.js
```

---

## 14. سفارش‌ها و مشتریان / همگام‌سازی با حسابداری

مشکل قبلی:
- یک شخص در حسابداری ثبت شده بود اما در سفارش‌ها قابل انتخاب نبود.

تصمیم:
- سرنخ‌ها جدا بمانند.
- مشتری واقعی بین سفارش‌ها و حسابداری مشترک باشد.

انجام شد:
- SQL جدید:
```txt
065_unified_customer_accounting_contacts.sql
```

رفتار نهایی:
```txt
سرنخ = فقط CRM / سفارش‌ها
مشتری واقعی = مشترک بین سفارش‌ها و حسابداری
```

اگر در حسابداری شخص با نوع مشتری ثبت شود:
- در سفارش‌ها هم دیده می‌شود.

اگر در سفارش‌ها مشتری واقعی ثبت/ویرایش شود:
- در اشخاص حسابداری هم به‌روز می‌شود.

اگر برای سرنخ سفارش ثبت شود:
- به مشتری فعال تبدیل می‌شود.
- با حسابداری همگام می‌شود.

اطلاعات رسمی مشترک:
- کد اقتصادی
- شماره ثبت
- شناسه ملی
- کد پستی
- یادداشت حسابداری

---

## 15. جستجوی کالا در سفارش جدید

مشکل قبلی:
- ضربدر پاک‌کردن کالا در سمت راست دیده می‌شد.

اصلاح انجام شد:
- در `ProductPicker` به صورت قطعی ضربدر به سمت چپ منتقل شد.
- اصلاح روی همه بخش‌هایی که از ProductPicker استفاده می‌کنند اعمال می‌شود.

فایل:
```txt
src/components/ProductPicker.jsx
```

---

## 16. کاربران و پنل مدیریت

مشکل قبلی پنل کاربران:
```json
{
  "error": "دسترسی دیتابیس برای مدیریت کاربران کافی نیست. مقدار SUPABASE_SERVICE_ROLE_KEY در Netlify و SQL دسترسی کاربران باید بررسی شود."
}
```

علت نهایی:
- فقط کلید نبود.
- Grant/Policy جدول‌های `profiles` و `audit_log` مشکل داشت.

SQL نهایی که حل کرد:
```txt
supabase/migrations/057_admin_users_service_role_grants.sql
```

کاربر بعد از اجرای SQL 057 گفت مشکل درست شد.

فایل‌های مهم پنل کاربران:
```txt
netlify/functions/admin-users.js
src/components/admin/AdminUserPanel.jsx
src/components/admin/AdminUserPanel.css
src/components/admin/AuditLogPanel.jsx
```

---

## 17. Auth / خروج خودکار / آنلاین و آفلاین

مشکل قبلی:
- کاربر هنگام کار با سیستم بعد از مدتی خارج می‌شد.

اصلاح شد:
- KeepAlive اضافه شد.
- Idle logout روی ۶۰ دقیقه تنظیم شد.
- فعالیت‌های کاربر مثل click, keydown, mousemove, scroll و focus ثبت می‌شوند.
- session هر چند دقیقه refresh می‌شود.

فایل:
```txt
src/auth/AuthProvider.jsx
```

همچنین نشانگر آنلاین/آفلاین در Nav اضافه شد.

---

## 18. چاپ فاکتور

وضعیت:
- چاپ رسمی/غیررسمی فاکتور خیلی اصلاح شده.
- تنظیمات چاپ داخل حسابداری وجود دارد.
- فاکتور فشرده‌تر شده.
- کاربر قبلاً گفته بود با یک ردیف هم ممکن است دو صفحه شود.
- بعد از آن compact CSS اعمال شد ولی هنوز تأیید نهایی از کاربر گرفته نشده.

اگر دوباره ایراد چاپ گفت، فایل‌های اصلی:
```txt
src/lib/financeApi.js
src/modules/accounting/FinanceDocumentDetails.jsx
src/modules/accounting/AccountingModule.jsx
src/modules/accounting/AccountingModule.css
```

نکته:
- در مرورگر هنگام چاپ باید Headers and footers خاموش باشد، ولی کاربر ترجیح می‌دهد سیستم خودش تا حد ممکن یک صفحه‌ای کند.

---

## 19. Reset شروع شرکت واقعی

فایل پاکسازی داده‌های تستی:
```txt
supabase/maintenance/RESET_TO_REAL_COMPANY_START_2026-08-18.sql
```

راهنما:
```txt
docs/REAL_COMPANY_START_RESET_GUIDE_FA.md
```

این Reset کاربران، نقش‌ها، templates، تنظیمات پایه، شماره‌گذاری و fiscal base را نگه می‌دارد اما داده‌های عملیاتی را پاک می‌کند.

Storage باید دستی در Supabase پاک شود:
```txt
automation-shared-files
order-attachments
```

---

## 20. حذف‌ها باید امن باشند

قواعد حذف امن در پروژه:

- سفارش = لغو
- مشتری/شخص = غیرفعال/آرشیو
- فاکتور = ابطال/برگشتی
- کالا = غیرفعال
- سند انبار draft = حذف/لغو
- سند انبار final = ابطال/اصلاح با برگشت موجودی
- کارت بانکی = `is_active=false`
- وام = archived
- فیش حقوقی = archived
- سند هزینه/درآمد = ابطال، نه حذف واقعی

از `prompt/confirm` مرورگر استفاده نشود؛ Modal داخلی شیک استفاده شود.

نکته: هنوز در بخش سفارش‌ها برای لغو سفارش ممکن است `window.prompt` باقی مانده باشد و بهتر است در ادامه تبدیل به Modal شود.

---

## 21. وضعیت Build

آخرین Build بعد از اصلاحات V067 موفق بوده.

اگر در چت جدید Build لازم شد:

```bash
cd /home/user/Otomasion2
npm install && npm run build
```

چون در پاکسازی اخیر `node_modules` حذف شده است.

---

## 22. وضعیت Deploy

کاربر گفته بود فعلاً Deploy نزنیم مگر خودش بخواهد.

آخرین اصلاحات کدی بعد از V066 شامل V067 است و برای اعمال روی سایت باید:
1. SQL لازم اجرا شود.
2. فایل جدید GitHub/Full ساخته شود.
3. کاربر روی GitHub/Netlify Deploy کند یا با تأیید او Deploy انجام شود.

اگر کاربر فایل نهایی خواست:
1. Build بگیر:
```bash
cd /home/user/Otomasion2
npm install && npm run build
```
2. ZIP کامل پروژه بساز، نه فقط dist.
3. اگر خواست، ZIP dist هم بساز.
4. فایل کامل را `present_file` کن.

---

## 23. فایل‌های مهم جدید/اخیر

SQLهای اخیر:
```txt
supabase/migrations/057_admin_users_service_role_grants.sql
supabase/migrations/058_database_performance_indexes_and_analyze.sql
supabase/migrations/059_accounting_payroll_module.sql
supabase/migrations/060_dashboard_important_payables.sql
supabase/migrations/061_payroll_payment_documents.sql
supabase/migrations/062_accounting_income_expense_categories.sql
supabase/migrations/063_accounting_fiscal_year_create_and_periods.sql
supabase/migrations/064_accounting_balance_sheet_report.sql
supabase/migrations/065_unified_customer_accounting_contacts.sql
supabase/migrations/066_performance_full_system_indexes.sql
supabase/migrations/067_fast_orders_dashboard_loading.sql
```

Docs اخیر:
```txt
docs/FEATURE_ACCOUNTING_FISCAL_YEAR_CREATE_AUTO_PERIODS_FA.md
docs/FEATURE_ACCOUNTING_BALANCE_SHEET_REPORT_FA.md
docs/FEATURE_UNIFIED_CUSTOMER_ACCOUNTING_CONTACTS_FA.md
docs/OPTIMIZATION_FULL_SYSTEM_PERFORMANCE_066_FA.md
docs/BUGFIX_ORDERS_DASHBOARD_STATEMENT_TIMEOUT_PERFORMANCE_V067_FA.md
```

---

## 24. جمله آماده برای شروع چت جدید

کاربر می‌تواند در چت جدید این متن را بفرستد:

```txt
من پروژه اتوماسیون آریامن را می‌فرستم. لطفاً از فایل NEXT_CHAT_HANDOFF_ARYAMAN_FA_2026-09-01.md شروع کن و دقیقاً با همان لحن و روند ادامه بده. پروژه اصلی Otomasion2 است. آخرین اصلاح مهم V067 برای رفع کندی سفارش‌ها و داشبورد و خطای statement timeout بوده. قبل از هر Deploy باید SQLهای جدید بررسی و اجرا شوند. من می‌خواهم گام‌به‌گام و ساده راهنمایی شوم.
```

---

## 25. اولین کار پیشنهادی در چت جدید

اگر کاربر هنوز خطای سفارش‌ها/داشبورد دارد:
1. از او بپرس آیا SQL زیر اجرا شده یا نه:
```txt
067_fast_orders_dashboard_loading.sql
```
2. اگر اجرا نشده، راهنمای اجرای دقیق در Supabase بده.
3. اگر اجرا شده و هنوز مشکل هست، از DevTools > Network خطای دقیق query را بگیرد.
4. اگر لازم شد، SQL 067 را اصلاح کن.
5. بعد از هر تغییر کدی Build بگیر.
6. Deploy را فقط با اجازه کاربر انجام بده.
