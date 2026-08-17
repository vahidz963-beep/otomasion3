import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const allowedRoles = new Set(['admin', 'sales', 'sales_manager', 'rnd', 'production', 'warehouse', 'accountant', 'office_admin']);
const PROFILE_BASE_COLUMNS = 'id, email, full_name, role, is_active, created_at, preferred_language';
const PROFILE_WITH_ROLES_COLUMNS = `${PROFILE_BASE_COLUMNS}, additional_roles`;

function parsePgArrayString(value) {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRoles(role, roles) {
  const incoming = Array.isArray(roles) ? roles : parsePgArrayString(roles);
  const list = incoming.filter((r) => allowedRoles.has(r));
  if (role && allowedRoles.has(role) && !list.includes(role)) list.unshift(role);
  return [...new Set(list)].slice(0, 3);
}

function normalizeProfile(profile) {
  if (!profile) return null;
  const roles = normalizeRoles(profile.role, profile.additional_roles);
  return { ...profile, additional_roles: roles.length ? roles : (profile.role ? [profile.role] : []) };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function errorText(error) {
  return `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.code || ''}`.toLowerCase();
}

function isMissingColumn(error, columnName) {
  const text = errorText(error);
  const col = columnName.toLowerCase();
  return text.includes(col) && (
    text.includes('does not exist')
    || text.includes('could not find')
    || text.includes('schema cache')
    || text.includes('42703')
    || text.includes('pgrst204')
  );
}

function userFacingDbError(error) {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();

  if (isMissingColumn(error, 'additional_roles')) {
    return 'ساختار جدول کاربران کامل نیست و ستون additional_roles در profiles وجود ندارد. لطفاً SQL 047_ADMIN_USERS_PANEL_STABILITY را در Supabase اجرا کنید و بعد دوباره تست کنید.';
  }

  if (lower.includes('invalid input value') && lower.includes('user_role') && lower.includes('sales_manager')) {
    return 'نقش «مدیر فروش» هنوز در دیتابیس فعال نشده است. لطفاً SQL 047_ADMIN_USERS_PANEL_STABILITY را در Supabase اجرا کنید.';
  }

  if ((lower.includes('relation') && lower.includes('profiles') && lower.includes('does not exist')) || lower.includes('could not find the table')) {
    return 'جدول profiles در دیتابیس پیدا نشد. ابتدا SQLهای پایه Supabase مخصوص Auth/Profile باید اجرا شوند.';
  }

  if (lower.includes('permission denied') || lower.includes('row-level security')) {
    return 'دسترسی دیتابیس برای مدیریت کاربران کافی نیست. مقدار SUPABASE_SERVICE_ROLE_KEY در Netlify و SQL دسترسی کاربران باید بررسی شود.';
  }

  return raw || 'خطای داخلی مدیریت کاربران';
}

async function getProfileById(adminClient, userId) {
  let { data, error } = await adminClient
    .from('profiles')
    .select(PROFILE_WITH_ROLES_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error && isMissingColumn(error, 'additional_roles')) {
    const fallback = await adminClient
      .from('profiles')
      .select(PROFILE_BASE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return normalizeProfile(data);
}

async function listProfiles(adminClient) {
  let { data, error } = await adminClient
    .from('profiles')
    .select(PROFILE_WITH_ROLES_COLUMNS)
    .order('created_at', { ascending: false });

  if (error && isMissingColumn(error, 'additional_roles')) {
    const fallback = await adminClient
      .from('profiles')
      .select(PROFILE_BASE_COLUMNS)
      .order('created_at', { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data || []).map(normalizeProfile);
}

async function upsertProfile(adminClient, payload) {
  let { error } = await adminClient.from('profiles').upsert(payload);

  if (error && isMissingColumn(error, 'additional_roles')) {
    const { additional_roles: _additionalRoles, ...basePayload } = payload;
    const retry = await adminClient.from('profiles').upsert(basePayload);
    error = retry.error;
  }

  if (error) throw error;
}

async function updateProfile(adminClient, userId, payload) {
  let { error } = await adminClient.from('profiles').update(payload).eq('id', userId);

  if (error && isMissingColumn(error, 'additional_roles')) {
    const { additional_roles: _additionalRoles, ...basePayload } = payload;
    const retry = await adminClient.from('profiles').update(basePayload).eq('id', userId);
    error = retry.error;
  }

  if (error) throw error;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json(500, { error: 'متغیرهای سروری Supabase در Netlify کامل نیستند. SUPABASE_URL، SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY را بررسی کنید.' });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'توکن احراز هویت ارسال نشده است. یک بار خارج شوید و دوباره وارد شوید.' });
  const accessToken = authHeader.replace('Bearer ', '').trim();

  const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: userData, error: userErr } = await authClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) return json(401, { error: 'نشست کاربری معتبر نیست یا منقضی شده است. لطفاً یک بار خارج شوید و دوباره وارد شوید.' });

  const actorId = userData.user.id;

  let profile;
  try {
    profile = await getProfileById(adminClient, actorId);
  } catch (e) {
    return json(500, { error: userFacingDbError(e) });
  }

  const actorRoles = profile?.additional_roles?.length ? profile.additional_roles : [profile?.role].filter(Boolean);
  if (!profile) {
    return json(403, { error: 'پروفایل این حساب در جدول کاربران پیدا نشد. رکورد همین ایمیل باید در جدول profiles با نقش admin و وضعیت فعال ثبت شود.' });
  }
  if (!profile.is_active) {
    return json(403, { error: 'این حساب کاربری غیرفعال است و اجازه مدیریت کاربران ندارد.' });
  }
  if (!actorRoles.includes('admin')) {
    return json(403, { error: 'این حساب در دیتابیس نقش «مدیر کل» ندارد. نقش کاربر را در جدول profiles روی admin بگذارید یا SQL 047 را اجرا کنید.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'بدنه‌ی درخواست نامعتبر است' });
  }

  async function writeAudit({ target_user_id, action, old_value, new_value }) {
    try {
      const { error } = await adminClient.from('audit_log').insert({
        actor_id: actorId,
        target_user_id,
        action,
        old_value: old_value ?? null,
        new_value: new_value ?? null,
      });
      if (error) console.warn('admin-users audit write failed:', error.message);
    } catch (e) {
      console.warn('admin-users audit write failed:', e.message);
    }
  }

  try {
    const { action } = body;

    if (action === 'list') {
      const users = await listProfiles(adminClient);
      return json(200, { ok: true, users });
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
      const { email, password, full_name } = body;
      const preferred_language = ['fa', 'en'].includes(body.preferred_language) ? body.preferred_language : 'fa';
      const roles = normalizeRoles(body.role, body.roles).filter((role) => role !== 'admin');
      const primaryRole = roles[0];
      if (!email || !password || !full_name || !primaryRole) return json(400, { error: 'فیلدهای الزامی ناقص است' });
      if (!allowedRoles.has(primaryRole) || primaryRole === 'admin') return json(400, { error: 'نقش نامعتبر است' });
      if (password.length < 8) return json(400, { error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });

      let createdUserId = null;
      try {
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, role: primaryRole, roles, preferred_language },
        });
        if (createErr) throw createErr;
        createdUserId = created.user.id;

        await upsertProfile(adminClient, {
          id: createdUserId,
          email,
          full_name,
          role: primaryRole,
          additional_roles: roles,
          preferred_language,
          is_active: true,
        });
      } catch (e) {
        if (createdUserId) {
          try { await adminClient.auth.admin.deleteUser(createdUserId); } catch { /* best-effort cleanup */ }
        }
        throw e;
      }

      await writeAudit({ target_user_id: createdUserId, action: 'created', new_value: roles.join(',') });
      return json(200, { ok: true, user_id: createdUserId });
    }

    if (action === 'set_role') {
      const { user_id, role } = body;
      const roles = normalizeRoles(role, body.roles);
      const primaryRole = roles[0] || role;
      if (!user_id || !allowedRoles.has(primaryRole)) return json(400, { error: 'نقش یا کاربر نامعتبر است' });
      const before = await getProfileById(adminClient, user_id);
      await updateProfile(adminClient, user_id, { role: primaryRole, additional_roles: roles });
      await writeAudit({ target_user_id: user_id, action: 'role_changed', old_value: before?.additional_roles?.join(',') || before?.role, new_value: roles.join(',') });
      return json(200, { ok: true });
    }

    if (action === 'set_active') {
      const { user_id, is_active } = body;
      if (!user_id || typeof is_active !== 'boolean') return json(400, { error: 'اطلاعات وضعیت کاربر نامعتبر است' });
      if (user_id === actorId && !is_active) return json(400, { error: 'مدیر نمی‌تواند حساب خودش را غیرفعال کند' });
      const before = await getProfileById(adminClient, user_id);
      await updateProfile(adminClient, user_id, { is_active });
      await writeAudit({ target_user_id: user_id, action: is_active ? 'activated' : 'deactivated', old_value: String(before?.is_active), new_value: String(is_active) });
      return json(200, { ok: true });
    }

    if (action === 'delete') {
      const { user_id } = body;
      if (!user_id) return json(400, { error: 'کاربر نامعتبر است' });
      if (user_id === actorId) return json(400, { error: 'مدیر نمی‌تواند حساب خودش را حذف کند' });
      const before = await getProfileById(adminClient, user_id);
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
    return json(500, { error: userFacingDbError(e) });
  }
};
