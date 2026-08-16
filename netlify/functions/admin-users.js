import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const allowedRoles = new Set(['admin', 'sales', 'sales_manager', 'rnd', 'production', 'warehouse', 'accountant', 'office_admin']);

function normalizeRoles(role, roles) {
  const list = Array.isArray(roles) ? roles.filter((r) => allowedRoles.has(r)) : [];
  if (role && allowedRoles.has(role) && !list.includes(role)) list.unshift(role);
  return [...new Set(list)].slice(0, 3);
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) return json(500, { error: 'Supabase server env vars are missing' });

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'توکن احراز هویت ارسال نشده' });
  const accessToken = authHeader.replace('Bearer ', '').trim();

  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await authClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) return json(401, { error: 'توکن نامعتبر است' });

  const actorId = userData.user.id;

  // Use service role to read profile so admin panel doesn't fail if table grants/RLS are incomplete.
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('role, additional_roles, is_active')
    .eq('id', actorId)
    .maybeSingle();

  const actorRoles = [profile?.role, ...(profile?.additional_roles || [])].filter(Boolean);
  if (profileErr || !profile || !profile.is_active || !actorRoles.includes('admin')) {
    return json(403, { error: 'فقط مدیر کل مجاز به این عملیات است' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'بدنه‌ی درخواست نامعتبر است' }); }

  async function writeAudit({ target_user_id, action, old_value, new_value }) {
    await adminClient.from('audit_log').insert({
      actor_id: actorId,
      target_user_id,
      action,
      old_value: old_value ?? null,
      new_value: new_value ?? null,
    });
  }

  try {
    const { action } = body;

    if (action === 'list') {
      const { data, error } = await adminClient
        .from('profiles')
        .select('id, email, full_name, role, additional_roles, is_active, created_at, preferred_language')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { ok: true, users: data || [] });
    }

    if (action === 'audit') {
      const { data: logs, error: logsErr } = await adminClient
        .from('audit_log')
        .select('id, actor_id, target_user_id, action, old_value, new_value, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (logsErr) throw logsErr;

      const ids = [...new Set((logs || []).flatMap((r) => [r.actor_id, r.target_user_id]).filter(Boolean))];
      let profiles = [];
      if (ids.length) {
        const { data, error } = await adminClient.from('profiles').select('id, full_name, email').in('id', ids);
        if (error) throw error;
        profiles = data || [];
      }
      return json(200, { ok: true, logs: logs || [], profiles });
    }

    if (action === 'create') {
      const { email, password, full_name, role } = body;
      const preferred_language = ['fa', 'en'].includes(body.preferred_language) ? body.preferred_language : 'fa';
      const roles = normalizeRoles(role, body.roles);
      const primaryRole = roles[0] || role;
      if (!email || !password || !full_name || !primaryRole) return json(400, { error: 'فیلدهای الزامی ناقص است' });
      if (!allowedRoles.has(primaryRole) || primaryRole === 'admin') return json(400, { error: 'نقش نامعتبر است' });
      if (password.length < 8) return json(400, { error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });

      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role: primaryRole, roles, preferred_language },
      });
      if (createErr) throw createErr;

      const { error: upsertErr } = await adminClient.from('profiles').upsert({
        id: created.user.id,
        email,
        full_name,
        role: primaryRole,
        additional_roles: roles,
        preferred_language,
        is_active: true,
      });
      if (upsertErr) throw upsertErr;

      await writeAudit({ target_user_id: created.user.id, action: 'created', new_value: roles.join(',') });
      return json(200, { ok: true, user_id: created.user.id });
    }

    if (action === 'set_role') {
      const { user_id, role } = body;
      const roles = normalizeRoles(role, body.roles);
      const primaryRole = roles[0] || role;
      if (!user_id || !allowedRoles.has(primaryRole)) return json(400, { error: 'نقش یا کاربر نامعتبر است' });
      const { data: before } = await adminClient.from('profiles').select('role, additional_roles').eq('id', user_id).maybeSingle();
      const { error } = await adminClient.from('profiles').update({ role: primaryRole, additional_roles: roles }).eq('id', user_id);
      if (error) throw error;
      await writeAudit({ target_user_id: user_id, action: 'role_changed', old_value: before?.additional_roles?.join(',') || before?.role, new_value: roles.join(',') });
      return json(200, { ok: true });
    }

    if (action === 'set_active') {
      const { user_id, is_active } = body;
      if (!user_id || typeof is_active !== 'boolean') return json(400, { error: 'اطلاعات وضعیت کاربر نامعتبر است' });
      if (user_id === actorId && !is_active) return json(400, { error: 'مدیر نمی‌تواند حساب خودش را غیرفعال کند' });
      const { data: before } = await adminClient.from('profiles').select('is_active').eq('id', user_id).maybeSingle();
      const { error } = await adminClient.from('profiles').update({ is_active }).eq('id', user_id);
      if (error) throw error;
      await writeAudit({ target_user_id: user_id, action: is_active ? 'activated' : 'deactivated', old_value: String(before?.is_active), new_value: String(is_active) });
      return json(200, { ok: true });
    }

    if (action === 'delete') {
      const { user_id } = body;
      if (!user_id) return json(400, { error: 'کاربر نامعتبر است' });
      if (user_id === actorId) return json(400, { error: 'مدیر نمی‌تواند حساب خودش را حذف کند' });
      const { data: before } = await adminClient.from('profiles').select('role, additional_roles').eq('id', user_id).maybeSingle();
      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;
      await adminClient.from('profiles').delete().eq('id', user_id);
      await writeAudit({ target_user_id: user_id, action: 'deleted', old_value: before?.additional_roles?.join(',') || before?.role });
      return json(200, { ok: true });
    }

    if (action === 'reset_password') {
      const { user_id, new_password } = body;
      if (!user_id || !new_password || new_password.length < 8) return json(400, { error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });
      const { error } = await adminClient.auth.admin.updateUserById(user_id, { password: new_password });
      if (error) throw error;
      await writeAudit({ target_user_id: user_id, action: 'password_reset_by_admin' });
      return json(200, { ok: true });
    }

    return json(400, { error: 'action نامعتبر است' });
  } catch (e) {
    return json(500, { error: e.message || 'خطای داخلی' });
  }
};
