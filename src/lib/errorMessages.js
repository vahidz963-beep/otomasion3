export function getFriendlyErrorMessage(error, fallback = 'خطا در اجرای عملیات') {
  const raw = String(error?.message || error?.error_description || error || '').trim();
  const lower = raw.toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  if (!raw) return fallback;

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed') || lower.includes('fetch')) {
    return 'ارتباط با سرور برقرار نشد. اینترنت، فیلترشکن/فیلترینگ یا مسیر دسترسی را بررسی کنید و دوباره تلاش کنید.';
  }

  if (lower.includes('jwt') || lower.includes('refresh token') || lower.includes('invalid token') || lower.includes('session')) {
    return 'نشست کاربری معتبر نیست یا منقضی شده است. لطفاً یک بار خارج شوید و دوباره وارد شوید.';
  }

  if (lower.includes('permission denied') || lower.includes('not allowed') || lower.includes('violates row-level security') || lower.includes('row-level security') || code === '42501') {
    return 'دسترسی لازم برای این عملیات وجود ندارد. اگر نقش کاربر درست است، تنظیمات دسترسی/RLS باید بررسی شود.';
  }

  if (lower.includes('could not find the function') || lower.includes('function') && lower.includes('does not exist') || code === 'PGRST202') {
    return 'تابع مورد نیاز در دیتابیس پیدا نشد. احتمالاً SQLهای جدید هنوز در Supabase اجرا نشده‌اند.';
  }

  if (lower.includes('relation') && lower.includes('does not exist') || lower.includes('could not find the table') || lower.includes('schema cache') || code === 'PGRST205') {
    return 'جدول یا View مورد نیاز در دیتابیس پیدا نشد. احتمالاً بخشی از SQLهای جدید هنوز اجرا نشده است.';
  }

  if (lower.includes('column') && lower.includes('does not exist') || code === '42703') {
    return 'ستون جدید مورد نیاز در دیتابیس وجود ندارد. احتمالاً دیتابیس با آخرین SQLها به‌روزرسانی نشده است.';
  }

  if (lower.includes('cannot change name of view column') || code === '42P16') {
    return 'ساختار یکی از Viewهای دیتابیس با نسخه قبلی تداخل دارد. اجرای SQL باید متوقف شود و متن خطا بررسی شود.';
  }

  if (lower.includes('duplicate key') || code === '23505') {
    return 'این رکورد قبلاً ثبت شده است و امکان ثبت تکراری وجود ندارد.';
  }

  if (lower.includes('foreign key') || code === '23503') {
    return 'رکورد وابسته پیدا نشد یا هنوز در بخش مرتبط ثبت نشده است. ارتباط بین اسناد باید بررسی شود.';
  }

  if (lower.includes('not-null') || lower.includes('null value') || code === '23502') {
    return 'یکی از فیلدهای ضروری خالی است. لطفاً اطلاعات فرم را کامل کنید.';
  }

  if (lower.includes('invalid input syntax') || code === '22P02') {
    return 'فرمت یکی از مقادیر واردشده درست نیست. لطفاً تاریخ، عدد یا شناسه انتخاب‌شده را بررسی کنید.';
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'زمان پاسخ‌گویی سرور طولانی شد. چند لحظه بعد دوباره تلاش کنید.';
  }

  if (lower.includes('certificate') || lower.includes('ssl')) {
    return 'مشکل گواهی امنیتی یا SSL وجود دارد. دامنه و SSL هاست باید بررسی شود.';
  }

  return raw.length > 180 ? fallback : raw;
}

export function getTechnicalErrorMessage(error) {
  return String(error?.message || error?.error_description || error || '').trim();
}
