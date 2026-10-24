import { supabase } from './supabaseClient';

const LOCAL_BACKUP_PATTERN = /^aryaman-(full|safety)-.+\.arybackup$/i;
const ARCHIVE_MAGIC = 'ARYBKP02';

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('نشست کاربری معتبر نیست؛ دوباره وارد شوید.');
  return data.session.access_token;
}

async function request(action, payload = {}) {
  const response = await fetch('/.netlify/functions/system-backups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'عملیات مرکز بکاپ ناموفق بود.');
  return result;
}

export function getBackupCenterStatus() {
  return request('status');
}

export function createBackupNow(source = 'manual') {
  return request('create', { source }).then((response) => response.result);
}

export async function chooseLocalBackupDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error('ذخیره و مدیریت نسخه‌های محلی به Chrome یا Edge به‌روز نیاز دارد.');
  }
  const directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'aryaman-local-backups' });
  const currentPermission = await directory.queryPermission?.({ mode: 'readwrite' });
  const permission = currentPermission === 'granted'
    ? currentPermission
    : await directory.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('مجوز نوشتن در پوشه انتخاب‌شده داده نشد.');
  return directory;
}

async function getBackupDownload(jobId) {
  return request('download-url', { jobId });
}

async function rotateLocalBackups(directory, keepVersions, protectedNames = []) {
  const candidates = [];
  const protectedSet = new Set(protectedNames.filter(Boolean));
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !LOCAL_BACKUP_PATTERN.test(name)) continue;
    try {
      const file = await handle.getFile();
      candidates.push({ name, modifiedAt: file.lastModified });
    } catch {
      // A file changed while enumerating; leave it untouched.
    }
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
  let deletedCount = 0;
  const targetDeleteCount = Math.max(0, candidates.length - Math.max(1, Number(keepVersions || 5)));
  for (const oldFile of [...candidates].reverse()) {
    if (deletedCount >= targetDeleteCount) break;
    if (protectedSet.has(oldFile.name)) continue;
    await directory.removeEntry(oldFile.name);
    deletedCount += 1;
  }
  return deletedCount;
}

export async function savePreparedBackupToDirectory(jobId, directory, { keepVersions = 5, protectedNames = [] } = {}) {
  if (!directory) throw new Error('پوشه ذخیره بکاپ انتخاب نشده است.');
  const transfer = await getBackupDownload(jobId);
  const response = await fetch(transfer.url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('دریافت فایل رمزگذاری‌شده ناموفق بود.');

  const fileHandle = await directory.getFileHandle(transfer.filename, { create: true });
  const writable = await fileHandle.createWritable();
  let writtenBytes = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writtenBytes += value.byteLength;
      await writable.write(value);
    }
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* already closed/aborted */ }
    try { await directory.removeEntry(transfer.filename); } catch { /* best effort */ }
    throw error;
  }

  const localFile = await fileHandle.getFile();
  const expectedSize = Number(transfer.sizeBytes || 0);
  const magic = new TextDecoder().decode(await localFile.slice(0, 8).arrayBuffer());
  if (localFile.size !== writtenBytes || (expectedSize > 0 && localFile.size !== expectedSize) || magic !== ARCHIVE_MAGIC) {
    await directory.removeEntry(transfer.filename).catch(() => {});
    throw new Error('فایل ذخیره‌شده کامل یا معتبر نیست و برای ایمنی حذف شد.');
  }

  const deletedCount = await rotateLocalBackups(directory, keepVersions, protectedNames);
  return {
    filename: transfer.filename,
    directoryName: directory.name,
    sizeBytes: localFile.size,
    savedAt: new Date().toISOString(),
    deletedCount,
  };
}

export function completeLocalBackup(jobId, localFile) {
  return request('complete-local-save', {
    jobId,
    filename: localFile.filename,
    sizeBytes: localFile.sizeBytes,
  });
}

export async function uploadBackupForRestore(file) {
  if (!file) throw new Error('فایل بکاپ انتخاب نشده است.');
  const upload = await request('restore-upload-url');
  const { error } = await supabase.storage.from('system-backups').uploadToSignedUrl(upload.path, upload.token, file, {
    contentType: 'application/octet-stream',
  });
  if (error) throw new Error(error.message || 'بارگذاری فایل بکاپ ناموفق بود.');
  return request('validate-restore', { path: upload.path, uploadSessionId: upload.uploadSessionId });
}

export function runValidatedRestore({ sessionId, confirmationToken, confirmationPhrase, safetyJobId, mode = 'replace_business' }) {
  return request('restore', { sessionId, confirmationToken, confirmationPhrase, safetyJobId, mode });
}

export function listBackupPermissions() {
  return request('permissions');
}

export function updateBackupPermission({ userId, canCreate, canDownload, canRestore }) {
  return request('update-permission', { userId, canCreate, canDownload, canRestore });
}
