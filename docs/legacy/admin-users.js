// netlify/functions/admin-users.js
//
// این تابع سرور-ساید با service_role key کار می‌کند (که هرگز نباید در کد
// کلاینت/Netlify frontend قرار بگیرد). فقط باید در Netlify Environment
// Variables تعریف شود: SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY
//
// درخواست باید Authorization: Bearer <access_token کاربر لاگین‌کرده> داشته باشد؛
// این تابع اول با انکلاینت anon، هویت و نقش فرستنده را تایید می‌کند که واقعاً
// «مدیر کل» و فعال است، سپس با کلاینت service_role عملیات را انجام می‌دهد.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'توکن احراز هویت ارسال نشده' }) };
  }
  const accessToken = authHeader.replace('Bearer ', '');

  // ۱) تایید هویت و نقش فرستنده‌ی درخواست با anon client + توکن کاربر
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'توکن نامعتبر است' }) };
  }

  const { data: profile, error: profileErr } = await authClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (profileErr || !profile || profile.role !== 'admin' || !profile.is_active) {
    return { statusCode: 403, body: JSON.stringify({ error: 'فقط مدیر کل مجاز به این عملیات است' }) };
  }

  // ۲) عملیات واقعی با service_role (این کلاینت RLS را دور می‌زند - فقط اینجا استفاده شود)
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'بدنه‌ی درخواست نامعتبر است' }) };
  }

  const { action } = body;

  const actorId = userData.user.id; // مدیر کل تاییدشده در بالا - برای audit_log استفاده می‌شود

  async function writeAudit({ target_user_id, action: logAction, old_value, new_value }) {
    await adminClient.from('audit_log').insert({
      actor_id: actorId,
      target_user_id,
      action: logAction,
      old_value: old_value ?? null,
      new_value: new_value ?? null,
    });
  }

  try {
    if (action === 'create') {
      const { email, password, full_name, role, preferred_language } = body;
      if (!email || !password || !full_name || !role) {
        return { statusCode: 400, body: JSON.stringify({ error: 'فیلدهای الزامی ناقص است' }) };
      }

      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) throw createErr;

      const { error: insertErr } = await adminClient.from('profiles').insert({
        id: created.user.id,
        full_name,
        role,
        preferred_language: preferred_language || 'fa',
        is_active: true,
      });
      if (insertErr) throw insertErr;

      await writeAudit({ target_user_id: created.user.id, action: 'created', new_value: role });

      return { statusCode: 200, body: JSON.stringify({ ok: true, user_id: created.user.id }) };
    }

    if (action === 'set_role') {
      const { user_id, role } = body;

      const { data: before } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', user_id)
        .single();

      const { error } = await adminClient.from('profiles').update({ role }).eq('id', user_id);
      if (error) throw error;

      await writeAudit({
        target_user_id: user_id,
        action: 'role_changed',
        old_value: before?.role,
        new_value: role,
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'set_active') {
      const { user_id, is_active } = body;

      const { data: before } = await adminClient
        .from('profiles')
        .select('is_active')
        .eq('id', user_id)
        .single();

      const { error } = await adminClient.from('profiles').update({ is_active }).eq('id', user_id);
      if (error) throw error;

      await writeAudit({
        target_user_id: user_id,
        action: is_active ? 'activated' : 'deactivated',
        old_value: String(before?.is_active),
        new_value: String(is_active),
      });

      // وقتی غیرفعال می‌شود، نشست‌های فعلی کاربر هم باطل شود
      if (!is_active) {
        await adminClient.auth.admin.signOut(user_id).catch(() => {});
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete') {
      const { user_id } = body;

      const { data: before } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', user_id)
        .single();

      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;

      await writeAudit({ target_user_id: user_id, action: 'deleted', old_value: before?.role });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'reset_password') {
      const { user_id, new_password } = body;
      if (!new_password || new_password.length < 8) {
        return { statusCode: 400, body: JSON.stringify({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' }) };
      }

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        password: new_password,
      });
      if (error) throw error;

      await writeAudit({ target_user_id: user_id, action: 'password_reset_by_admin' });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action نامعتبر است' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'خطای داخلی' }) };
  }
};
