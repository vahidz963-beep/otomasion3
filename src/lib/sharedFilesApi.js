import { supabase } from './supabaseClient';

const SHARED_BUCKET = 'automation-shared-files';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}

function safeName(name = 'file') {
  return String(name)
    .replace(/[\\/:*?"<>|#%{}^~`\[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function moduleFolder(module = 'manual') {
  return {
    orders: 'orders', sales: 'sales', rnd: 'rnd', production: 'production', warehouse: 'warehouse', accounting: 'accounting', admin: 'admin', office: 'office', manual: 'manual'
  }[module] || 'manual';
}

export async function fetchSharedFiles({ module, relatedOrderId, relatedRecordId } = {}) {
  let query = supabase
    .from('shared_files')
    .select('*')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(200);

  // This is a shared hub, so all modules can see all folders. Search/filter is done in UI.
  const res = await query;
  assertNoError(res, 'خطا در دریافت فایل‌های اشتراکی');
  return res.data || [];
}

export async function uploadSharedFile({ file, sourceModule = 'manual', relatedOrderId = null, relatedRecordId = null, title, description }) {
  if (!file) throw new Error('فایل انتخاب نشده است.');
  const userId = await currentUserId();
  const folder = moduleFolder(sourceModule);
  const today = new Date().toISOString().slice(0, 10);
  const path = `${folder}/${today}/${Date.now()}-${safeName(file.name)}`;

  const uploadRes = await supabase.storage
    .from(SHARED_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  assertNoError(uploadRes, 'خطا در ذخیره فایل در Storage');

  const metaRes = await supabase.from('shared_files').insert({
    file_number: null,
    title_fa: title || file.name,
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    file_size: file.size || 0,
    data_url: null,
    storage_bucket: SHARED_BUCKET,
    storage_path: path,
    public_url: null,
    source_module: sourceModule || 'manual',
    related_order_id: relatedOrderId || null,
    related_record_id: relatedRecordId || null,
    visibility: 'all',
    description_fa: description || null,
    uploaded_by: userId,
  }).select('id').single();
  assertNoError(metaRes, 'خطا در ثبت مشخصات فایل اشتراکی');
  return metaRes.data;
}

export async function downloadSharedFile(row) {
  if (row?.data_url) {
    const a = document.createElement('a');
    a.href = row.data_url;
    a.download = row.file_name || 'shared-file';
    a.click();
    return;
  }
  if (!row?.storage_path) throw new Error('فایل قابل دانلود نیست.');
  const bucket = row.storage_bucket || SHARED_BUCKET;
  const signed = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 60);
  assertNoError(signed, 'خطا در دریافت لینک دانلود فایل');
  const a = document.createElement('a');
  a.href = signed.data.signedUrl;
  a.download = row.file_name || 'shared-file';
  a.target = '_blank';
  a.click();
}

export async function deleteSharedFile(row, currentModule = 'manual') {
  if (!row?.id) throw new Error('فایل نامعتبر است.');
  const userId = await currentUserId();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  const roles = [profile?.role, ...(profile?.additional_roles || [])].filter(Boolean);
  const canDelete = roles.includes('admin') || row.source_module === currentModule;
  if (!canDelete) throw new Error('شما فقط فایل‌های بخش خودتان را می‌توانید حذف کنید.');

  if (row.storage_path) {
    const bucket = row.storage_bucket || SHARED_BUCKET;
    const removeRes = await supabase.storage.from(bucket).remove([row.storage_path]);
    assertNoError(removeRes, 'خطا در حذف فایل از Storage');
  }

  const res = await supabase.from('shared_files').update({ deleted_at: new Date().toISOString() }).eq('id', row.id).select('id').single();
  assertNoError(res, 'خطا در حذف رکورد فایل');
  return true;
}
