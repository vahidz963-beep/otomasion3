import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const COPY = {
  fa: {
    checking: 'در حال بررسی دسترسی...',
    denied: 'شما به این بخش دسترسی ندارید.',
    inactiveOrMissing: 'حساب شما فعال نیست یا یافت نشد.',
  },
  en: {
    checking: 'Checking access...',
    denied: 'You do not have access to this section.',
    inactiveOrMissing: 'Your account is inactive or not found.',
  },
};

/**
 * RouteGuard - لایه‌ی محافظ عمومی سمت frontend.
 * جایگزین RLS نیست؛ RLS خط دفاعی واقعی در دیتابیس است. این کامپوننت فقط
 * تجربه‌ی کاربری رو بهتر می‌کنه (پیام تمیز به‌جای صفحه‌ی خراب/خالی).
 *
 * استفاده در هر چت/بخش دیگر:
 *   <RouteGuard allowedRoles={['admin', 'production']} lang="fa">
 *     <ProductionPage />
 *   </RouteGuard>
 *
 * allowedRoles اگر خالی/undefined باشد، یعنی هر کاربر فعال مجاز است
 * (فقط چک is_active انجام می‌شود، بدون محدودیت نقش).
 */
export default function RouteGuard({ allowedRoles, lang = 'fa', onDenied, children }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'allowed' | 'denied'
  const t = COPY[lang];

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) setStatus('denied');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single();

      if (cancelled) return;

      if (error || !profile || !profile.is_active) {
        setStatus('denied');
        return;
      }

      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
        setStatus('denied');
        return;
      }

      setStatus('allowed');
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [allowedRoles]);

  if (status === 'checking') {
    return <p style={{ padding: 24, fontFamily: 'Vazirmatn, Inter, sans-serif' }}>{t.checking}</p>;
  }

  if (status === 'denied') {
    if (onDenied) return onDenied();
    return (
      <p style={{ padding: 24, fontFamily: 'Vazirmatn, Inter, sans-serif', color: '#c1503f' }}>
        {t.denied}
      </p>
    );
  }

  return children;
}
