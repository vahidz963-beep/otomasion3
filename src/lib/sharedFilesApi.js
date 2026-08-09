import { supabase } from './supabaseClient';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function fetchSharedFiles({ module, relatedOrderId, relatedRecordId } = {}) {
  let query = supabase
    .from('shared_files')
    .select('id, file_number, title_fa, file_name, mime_type, file_size, data_url, source_module, related_order_id, related_record_id, visibility, description_fa, uploaded_by, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(100);
  // Shared hub: show all shared files. Filters can be added later if needed.
  const res = await query;
  assertNoError(res, 'خطا در دریافت فایل‌های اشتراکی');
  return res.data || [];
}

export async function uploadSharedFile({ file, sourceModule = 'manual', relatedOrderId = null, relatedRecordId = null, title, description }) {
  if (!file) throw new Error('فایل انتخاب نشده است.');
  const userId = await currentUserId();
  const dataUrl = await fileToDataUrl(file);
  const res = await supabase.from('shared_files').insert({
    file_number: null,
    title_fa: title || file.name,
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    file_size: file.size || 0,
    data_url: dataUrl,
    source_module: sourceModule || 'manual',
    related_order_id: relatedOrderId || null,
    related_record_id: relatedRecordId || null,
    visibility: 'all',
    description_fa: description || null,
    uploaded_by: userId,
  }).select('id').single();
  assertNoError(res, 'خطا در آپلود فایل اشتراکی');
  return res.data;
}

export function downloadSharedFile(row) {
  if (!row?.data_url) throw new Error('فایل قابل دانلود نیست.');
  const a = document.createElement('a');
  a.href = row.data_url;
  a.download = row.file_name || 'shared-file';
  a.click();
}
