import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  BACKUP_BUCKET,
  backupRuntimeStatus,
  backupSummary,
  cleanupExpiredBackupTransfers,
  createLocalTransferBackup,
  decryptBackupArchive,
  restoreSystemBackup,
} from '../backupService.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch { throw new Error('بدنه درخواست معتبر نیست.'); }
}

function rolesOf(profile) {
  return [...new Set([profile?.role, ...(profile?.additional_roles || [])].filter(Boolean))];
}

async function authenticate(event, authClient, adminClient) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) throw Object.assign(new Error('نشست کاربری ارسال نشده است.'), { statusCode: 401 });
  const token = authHeader.slice(7).trim();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('نشست کاربری معتبر نیست؛ دوباره وارد شوید.'), { statusCode: 401 });
  const { data: profile, error: profileError } = await adminClient.from('profiles').select('id,email,full_name,role,additional_roles,is_active').eq('id', data.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active) throw Object.assign(new Error('حساب کاربری فعال نیست.'), { statusCode: 403 });
  const isAdmin = rolesOf(profile).includes('admin');
  const { data: permission, error: permissionError } = await adminClient.from('system_backup_permissions').select('can_create,can_download,can_restore').eq('user_id', profile.id).maybeSingle();
  if (permissionError) throw permissionError;
  return {
    user: data.user,
    profile,
    isAdmin,
    permission: {
      can_create: isAdmin || Boolean(permission?.can_create),
      can_download: isAdmin || Boolean(permission?.can_download),
      can_restore: isAdmin || Boolean(permission?.can_restore),
    },
  };
}

function assertPermission(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { statusCode: 403 });
}

async function listJobs(adminClient) {
  const { data, error } = await adminClient
    .from('system_backup_jobs')
    .select('id,trigger_source,status,storage_path,archive_version,size_bytes,table_count,row_count,file_count,retention_expires_at,error_message,started_by,started_at,completed_at,deleted_at,metadata')
    .neq('status', 'deleted')
    .order('started_at', { ascending: false })
    .limit(120);
  if (error) throw error;
  return data || [];
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json(500, { error: 'متغیرهای SUPABASE_URL، SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY در Netlify کامل نیستند.' });
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await authenticate(event, authClient, adminClient);
    await cleanupExpiredBackupTransfers(adminClient);
    const body = parseBody(event);
    const action = body.action || 'status';

    if (action === 'status' || action === 'list') {
      const anyAccess = actor.permission.can_create || actor.permission.can_download || actor.permission.can_restore;
      assertPermission(anyAccess, 'برای مرکز بکاپ دسترسی ندارید؛ مدیر سیستم می‌تواند مجوز بدهد.');
      return json(200, {
        ok: true,
        permission: actor.permission,
        isAdmin: actor.isAdmin,
        runtime: backupRuntimeStatus(),
        jobs: await listJobs(adminClient),
      });
    }

    if (action === 'create') {
      assertPermission(actor.permission.can_create && actor.permission.can_download, 'مجوز ساخت و ذخیره بکاپ محلی را ندارید.');
      const source = body.source === 'pre_restore' ? 'pre_restore' : 'manual';
      const result = await createLocalTransferBackup({ source, actorId: actor.profile.id });
      return json(200, { ok: true, result });
    }

    if (action === 'download-url') {
      assertPermission(actor.permission.can_download, 'مجوز دریافت فایل بکاپ را ندارید.');
      const { data: job, error } = await adminClient.from('system_backup_jobs')
        .select('id,status,storage_path,size_bytes,trigger_source,started_by,started_at,retention_expires_at')
        .eq('id', body.jobId).maybeSingle();
      if (error) throw error;
      if (!job || job.status !== 'completed' || !job.storage_path) return json(404, { error: 'فایل انتقالی بکاپ آماده پیدا نشد یا قبلاً پاک شده است.' });
      if (!actor.isAdmin && job.started_by !== actor.profile.id) return json(403, { error: 'این بکاپ محلی متعلق به نشست شما نیست.' });
      if (job.retention_expires_at && new Date(job.retention_expires_at).getTime() <= Date.now()) return json(410, { error: 'مهلت دریافت فایل تمام شده است؛ دوباره بکاپ بگیرید.' });
      const stamp = new Date(job.started_at).toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
      const kind = job.trigger_source === 'pre_restore' ? 'safety' : 'full';
      const filename = `aryaman-${kind}-${stamp}-${job.id.slice(0, 8)}.arybackup`;
      const { data, error: signError } = await adminClient.storage.from(BACKUP_BUCKET).createSignedUrl(job.storage_path, 300, { download: filename });
      if (signError) throw signError;
      return json(200, { ok: true, url: data.signedUrl, filename, sizeBytes: Number(job.size_bytes || 0), expiresIn: 300 });
    }

    if (action === 'complete-local-save') {
      assertPermission(actor.permission.can_download, 'مجوز تکمیل بکاپ محلی را ندارید.');
      const { data: job, error } = await adminClient.from('system_backup_jobs')
        .select('id,status,storage_path,size_bytes,trigger_source,started_by,metadata')
        .eq('id', body.jobId).maybeSingle();
      if (error) throw error;
      if (!job) return json(404, { error: 'فرآیند بکاپ محلی یافت نشد.' });
      if (!actor.isAdmin && job.started_by !== actor.profile.id) return json(403, { error: 'این بکاپ محلی متعلق به حساب شما نیست.' });
      if (job.status === 'deleted' && job.metadata?.local_saved) return json(200, { ok: true, alreadyCompleted: true });
      if (job.status !== 'completed') return json(409, { error: 'فایل بکاپ هنوز آماده نیست.' });
      const filename = String(body.filename || '').replaceAll('\\', '/').split('/').pop();
      const localSize = Number(body.sizeBytes || 0);
      if (!/^aryaman-(full|safety)-[A-Za-z0-9_.-]+\.arybackup$/.test(filename)) return json(400, { error: 'نام فایل محلی معتبر نیست.' });
      if (!localSize || localSize !== Number(job.size_bytes || 0)) return json(400, { error: 'اندازه فایل محلی با آرشیو معتبر یکسان نیست.' });
      if (job.storage_path) {
        const { error: removeError } = await adminClient.storage.from(BACKUP_BUCKET).remove([job.storage_path]);
        if (removeError) throw removeError;
      }
      const completedAt = new Date().toISOString();
      const { error: updateError } = await adminClient.from('system_backup_jobs').update({
        status: 'deleted',
        storage_path: null,
        deleted_at: completedAt,
        metadata: { ...(job.metadata || {}), local_saved: true, local_saved_at: completedAt, local_filename: filename, local_size_bytes: localSize },
      }).eq('id', job.id);
      if (updateError) throw updateError;
      return json(200, { ok: true, jobId: job.id, source: job.trigger_source, localSavedAt: completedAt });
    }

    if (action === 'delete') {
      assertPermission(actor.isAdmin, 'فقط مدیر می‌تواند فایل انتقالی باقی‌مانده را حذف کند.');
      const { data: job, error } = await adminClient.from('system_backup_jobs').select('id,status,storage_path').eq('id', body.jobId).maybeSingle();
      if (error) throw error;
      if (!job) return json(404, { error: 'بکاپ یافت نشد.' });
      if (job.storage_path) await adminClient.storage.from(BACKUP_BUCKET).remove([job.storage_path]);
      const { error: updateError } = await adminClient.from('system_backup_jobs').update({ status: 'deleted', storage_path: null, deleted_at: new Date().toISOString() }).eq('id', job.id);
      if (updateError) throw updateError;
      return json(200, { ok: true, jobs: await listJobs(adminClient) });
    }

    if (action === 'restore-upload-url') {
      assertPermission(actor.permission.can_restore, 'مجوز بارگذاری و بازیابی بکاپ را ندارید.');
      const path = `restore-inbox/${actor.profile.id}/${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(5).toString('hex')}.arybackup`;
      const { data: uploadSession, error: sessionError } = await adminClient.from('system_restore_sessions').insert({
        upload_path: path,
        confirmation_token: randomBytes(24).toString('hex'),
        archive_summary: {},
        status: 'uploading',
        requested_by: actor.profile.id,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }).select('id').single();
      if (sessionError) throw sessionError;
      const { data, error } = await adminClient.storage.from(BACKUP_BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return json(200, { ok: true, path, token: data.token, uploadSessionId: uploadSession.id });
    }

    if (action === 'validate-restore') {
      assertPermission(actor.permission.can_restore, 'مجوز بررسی فایل بازیابی را ندارید.');
      const uploadPath = String(body.path || '');
      if (!uploadPath.startsWith(`restore-inbox/${actor.profile.id}/`)) return json(400, { error: 'مسیر فایل بازیابی معتبر نیست.' });
      const { data: pendingSession, error: lookupError } = await adminClient.from('system_restore_sessions')
        .select('id,expires_at')
        .eq('id', body.uploadSessionId)
        .eq('upload_path', uploadPath)
        .eq('requested_by', actor.profile.id)
        .eq('status', 'uploading')
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!pendingSession || new Date(pendingSession.expires_at).getTime() <= Date.now()) return json(400, { error: 'مجوز بارگذاری فایل منقضی یا نامعتبر است.' });
      const { data: file, error } = await adminClient.storage.from(BACKUP_BUCKET).download(uploadPath);
      if (error || !file) throw error || new Error('فایل بارگذاری‌شده خوانده نشد.');
      const payload = await decryptBackupArchive(Buffer.from(await file.arrayBuffer()));
      const summary = backupSummary(payload);
      const confirmationToken = randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { error: sessionError } = await adminClient.from('system_restore_sessions').update({
        confirmation_token: confirmationToken,
        archive_summary: summary,
        status: 'validated',
        expires_at: expiresAt,
        error_message: null,
      }).eq('id', pendingSession.id);
      if (sessionError) throw sessionError;
      return json(200, { ok: true, sessionId: pendingSession.id, confirmationToken, expiresAt, summary });
    }

    if (action === 'restore') {
      assertPermission(actor.permission.can_restore, 'مجوز بازیابی بکاپ را ندارید.');
      if (body.confirmationPhrase !== 'بازیابی کامل') return json(400, { error: 'عبارت تأیید بازیابی صحیح نیست.' });
      const { data: restoreSession, error } = await adminClient
        .from('system_restore_sessions')
        .select('*')
        .eq('id', body.sessionId)
        .eq('confirmation_token', body.confirmationToken)
        .eq('requested_by', actor.profile.id)
        .eq('status', 'validated')
        .maybeSingle();
      if (error) throw error;
      if (!restoreSession || new Date(restoreSession.expires_at).getTime() < Date.now()) return json(400, { error: 'مجوز یک‌بارمصرف بازیابی منقضی یا استفاده شده است.' });

      const { data: safetyBackup, error: safetyError } = await adminClient.from('system_backup_jobs')
        .select('id,trigger_source,status,started_by,metadata,deleted_at')
        .eq('id', body.safetyJobId).maybeSingle();
      if (safetyError) throw safetyError;
      const safetySavedAt = safetyBackup?.metadata?.local_saved_at ? new Date(safetyBackup.metadata.local_saved_at).getTime() : 0;
      if (!safetyBackup
          || safetyBackup.trigger_source !== 'pre_restore'
          || safetyBackup.status !== 'deleted'
          || safetyBackup.started_by !== actor.profile.id
          || !safetyBackup.metadata?.local_saved
          || Date.now() - safetySavedAt > 60 * 60 * 1000) {
        return json(400, { error: 'پیش از بازیابی باید یک بکاپ ایمنی جدید و معتبر در پوشه سیستم ذخیره شود.' });
      }

      await adminClient.from('system_restore_sessions').update({ status: 'restoring' }).eq('id', restoreSession.id);
      try {
        const { data: file, error: fileError } = await adminClient.storage.from(BACKUP_BUCKET).download(restoreSession.upload_path);
        if (fileError || !file) throw fileError || new Error('فایل بازیابی خوانده نشد.');
        const payload = await decryptBackupArchive(Buffer.from(await file.arrayBuffer()));
        const result = await restoreSystemBackup(payload, { mode: body.mode === 'merge_safe' ? 'merge_safe' : 'replace_business' });
        await adminClient.from('system_restore_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', restoreSession.id);
        await adminClient.storage.from(BACKUP_BUCKET).remove([restoreSession.upload_path]);
        return json(200, { ok: true, result, safetyBackup: { jobId: safetyBackup.id, filename: safetyBackup.metadata?.local_filename } });
      } catch (restoreError) {
        await adminClient.from('system_restore_sessions').update({ status: 'failed', error_message: String(restoreError?.message || restoreError).slice(0, 2000) }).eq('id', restoreSession.id);
        throw restoreError;
      }
    }

    if (action === 'permissions') {
      assertPermission(actor.isAdmin, 'فقط مدیر به مدیریت مجوزهای بکاپ دسترسی دارد.');
      const [{ data: users, error: usersError }, { data: permissions, error: permissionsError }] = await Promise.all([
        adminClient.from('profiles').select('id,email,full_name,role,additional_roles,is_active').order('full_name'),
        adminClient.from('system_backup_permissions').select('user_id,can_create,can_download,can_restore,granted_by,granted_at,updated_at'),
      ]);
      if (usersError) throw usersError;
      if (permissionsError) throw permissionsError;
      return json(200, { ok: true, users: users || [], permissions: permissions || [] });
    }

    if (action === 'update-permission') {
      assertPermission(actor.isAdmin, 'فقط مدیر می‌تواند مجوز بکاپ بدهد.');
      if (!body.userId) return json(400, { error: 'کاربر انتخاب نشده است.' });
      const payload = {
        user_id: body.userId,
        can_create: Boolean(body.canCreate),
        can_download: Boolean(body.canDownload),
        can_restore: Boolean(body.canRestore),
        granted_by: actor.profile.id,
        granted_at: new Date().toISOString(),
      };
      const { error } = await adminClient.from('system_backup_permissions').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(400, { error: 'عملیات ناشناخته است.' });
  } catch (error) {
    console.error('system-backups error:', error);
    return json(error?.statusCode || 500, { error: String(error?.message || error || 'خطای داخلی مرکز بکاپ') });
  }
}
