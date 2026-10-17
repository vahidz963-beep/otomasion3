import { createClient } from '@supabase/supabase-js';
import { runExchangeRateSync } from '../exchangeRatesService.js';

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function parseRoles(profile) {
  const extra = Array.isArray(profile?.additional_roles)
    ? profile.additional_roles
    : String(profile?.additional_roles || '').replace(/[{}\s"]/g, '').split(',').filter(Boolean);
  return [...new Set([profile?.role, ...extra].filter(Boolean))];
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return response(500, { error: 'تنظیمات Supabase در Netlify کامل نیست.' });

    const token = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return response(401, { error: 'ورود کاربر تأیید نشد.' });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userResult = await admin.auth.getUser(token);
    if (userResult.error || !userResult.data?.user) return response(401, { error: 'نشست کاربر معتبر نیست.' });

    let profileResult = await admin
      .from('profiles')
      .select('role, additional_roles, is_active')
      .eq('id', userResult.data.user.id)
      .single();
    if (profileResult.error && String(profileResult.error.message || '').includes('additional_roles')) {
      profileResult = await admin.from('profiles').select('role, is_active').eq('id', userResult.data.user.id).single();
    }
    if (profileResult.error || profileResult.data?.is_active === false) return response(403, { error: 'کاربر فعال نیست.' });

    const roles = parseRoles(profileResult.data);
    if (!roles.some((role) => role === 'admin' || role === 'warehouse')) {
      return response(403, { error: 'فقط کاربران دارای دسترسی انبار می‌توانند نرخ‌ها را به‌روزرسانی کنند.' });
    }

    const result = await runExchangeRateSync({ triggerSource: 'manual' });
    return response(200, { ok: true, ...result });
  } catch (error) {
    return response(500, { error: String(error?.message || error) });
  }
}
