import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const COPY = {
  fa: { checking: 'در حال بررسی دسترسی...', denied: 'شما به این بخش دسترسی ندارید.' },
  en: { checking: 'Checking access...', denied: 'You do not have access to this section.' },
};

export default function RouteGuard({ allowedRoles, lang = 'fa', onDenied, children }) {
  const [status, setStatus] = useState('checking');
  const t = COPY[lang];

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setStatus('denied');
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error || !profile || !profile.is_active) return setStatus('denied');
      if (allowedRoles?.length && !allowedRoles.includes(profile.role)) return setStatus('denied');
      setStatus('allowed');
    }

    check();
    return () => { cancelled = true; };
  }, [allowedRoles]);

  if (status === 'checking') return <p style={{ padding: 24 }}>{t.checking}</p>;
  if (status === 'denied') return onDenied ? onDenied() : <p style={{ padding: 24, color: '#a5453f' }}>{t.denied}</p>;
  return children;
}
