import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase env vars are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env or Netlify.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const ROLES = [
  { value: 'admin', labelFa: 'مدیر کل', labelEn: 'Admin' },
  { value: 'sales', labelFa: 'فروش', labelEn: 'Sales' },
  { value: 'rnd', labelFa: 'R&D', labelEn: 'R&D' },
  { value: 'production', labelFa: 'تولید', labelEn: 'Production' },
  { value: 'warehouse', labelFa: 'انبار', labelEn: 'Warehouse' },
  { value: 'accountant', labelFa: 'حسابداری', labelEn: 'Accountant' },
  { value: 'office_admin', labelFa: 'اداری', labelEn: 'Office Admin' },
];

export function roleLabel(role, lang = 'fa') {
  const item = ROLES.find((r) => r.value === role);
  if (!item) return role || '—';
  return lang === 'fa' ? item.labelFa : item.labelEn;
}

export async function callAdminUsersFunction(action, payload = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error('نشست کاربر معتبر نیست. دوباره وارد شوید.');
  }

  const res = await fetch('/.netlify/functions/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok || body.error) {
    throw new Error(body.error || 'خطا در اجرای عملیات مدیریتی');
  }

  return body;
}
