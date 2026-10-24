import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAGIC = Buffer.from('ARYBKP02');
const ARCHIVE_VERSION = 2;
const BACKUP_BUCKET = 'system-backups';
const SYSTEM_TABLE_EXCLUSIONS = new Set([
  'system_backup_jobs',
  'system_restore_sessions',
]);
const RESTORE_PUBLIC_EXCLUSIONS = new Set([
  'profiles',
  'system_backup_jobs',
  'system_restore_sessions',
  'system_backup_permissions',
]);

function requiredEnv(name, fallbackName = null) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : '');
  if (!value) throw new Error(`تنظیم سروری ${name} انجام نشده است.`);
  return value;
}

function adminClient() {
  return createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function databaseClient() {
  const connectionString = requiredEnv('SUPABASE_DB_URL', 'DATABASE_URL');
  const local = /localhost|127\.0\.0\.1/.test(connectionString);
  return new Client({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    application_name: 'aryaman-professional-backup',
    statement_timeout: Number(process.env.BACKUP_DB_STATEMENT_TIMEOUT_MS || 120000),
  });
}

function encryptionSecret() {
  const secret = requiredEnv('BACKUP_ENCRYPTION_KEY');
  if (secret.length < 24) throw new Error('BACKUP_ENCRYPTION_KEY باید حداقل ۲۴ نویسه تصادفی داشته باشد.');
  return secret;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function archivePath(source, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const kind = source === 'pre_restore' ? 'safety' : 'full';
  return `transfer-outbox/${date}/${kind}-${stamp}-${randomBytes(4).toString('hex')}.arybackup`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function backupLocalPolicy() {
  return {
    localMaxVersions: positiveInteger(process.env.BACKUP_LOCAL_MAX_VERSIONS, 5),
    overdueHours: positiveInteger(process.env.BACKUP_LOCAL_OVERDUE_HOURS, 48),
    transferTtlMinutes: positiveInteger(process.env.BACKUP_TRANSFER_TTL_MINUTES, 60),
  };
}

function deriveKey(secret, salt) {
  return scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
}

export async function encryptBackupPayload(payload) {
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(encryptionSecret(), salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

export async function decryptBackupArchive(input) {
  const archive = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const minimum = MAGIC.length + 16 + 12 + 16 + 1;
  if (archive.length < minimum || !archive.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('فایل انتخاب‌شده بکاپ معتبر آریامن نیست.');
  }
  let offset = MAGIC.length;
  const salt = archive.subarray(offset, offset += 16);
  const iv = archive.subarray(offset, offset += 12);
  const tag = archive.subarray(offset, offset += 16);
  const encrypted = archive.subarray(offset);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(encryptionSecret(), salt), iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const clear = await gunzipAsync(compressed);
    const payload = JSON.parse(clear.toString('utf8'));
    if (payload?.format !== 'aryaman-system-backup' || payload?.archiveVersion !== ARCHIVE_VERSION) {
      throw new Error('نسخه ساختاری فایل بکاپ پشتیبانی نمی‌شود.');
    }
    return payload;
  } catch (error) {
    if (String(error?.message || '').includes('نسخه ساختاری')) throw error;
    throw new Error('رمزگشایی یا صحت‌سنجی فایل بکاپ ناموفق بود؛ فایل یا کلید رمزگذاری همسان نیست.');
  }
}

async function listDatabaseTables(client) {
  const { rows } = await client.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_type='BASE TABLE'
      and table_schema in ('public','auth')
    order by case table_schema when 'auth' then 0 else 1 end, table_name
  `);
  return rows.filter((row) => !(row.table_schema === 'public' && SYSTEM_TABLE_EXCLUSIONS.has(row.table_name)));
}

async function exportDatabase(client) {
  const tables = await listDatabaseTables(client);
  const exported = [];
  let rowCount = 0;
  const pageSize = Math.max(100, Number(process.env.BACKUP_DB_PAGE_SIZE || 2000));

  for (const table of tables) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const sql = `select to_jsonb(t) as row_data from ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)} t limit $1 offset $2`;
      const page = await client.query(sql, [pageSize, offset]);
      rows.push(...page.rows.map((row) => row.row_data));
      if (page.rowCount < pageSize) break;
    }
    rowCount += rows.length;
    exported.push({ schema: table.table_schema, name: table.table_name, rowCount: rows.length, rows });
  }

  const sequenceResult = await client.query(`
    select schemaname as schema, sequencename as name, last_value
    from pg_sequences
    where schemaname in ('public','auth')
    order by schemaname,sequencename
  `);
  return { tables: exported, sequences: sequenceResult.rows, tableCount: exported.length, rowCount };
}

async function exportStorageFiles(client, supabase) {
  const files = [];
  const skipped = [];
  const buckets = [];
  let totalBytes = 0;
  const maxTotal = Number(process.env.BACKUP_MAX_STORAGE_BYTES || 256 * 1024 * 1024);
  const maxSingle = Number(process.env.BACKUP_MAX_SINGLE_FILE_BYTES || 64 * 1024 * 1024);
  let objects = [];
  try {
    const bucketResult = await client.query(`
      select id,name,public,file_size_limit,allowed_mime_types
      from storage.buckets where id<>$1 order by id
    `,[BACKUP_BUCKET]);
    buckets.push(...bucketResult.rows);
    const result = await client.query(`
      select bucket_id, name, metadata, coalesce((metadata->>'size')::bigint,0) as size
      from storage.objects
      where bucket_id<>$1
      order by bucket_id,name
    `, [BACKUP_BUCKET]);
    objects = result.rows;
  } catch (error) {
    skipped.push({ reason: 'storage_catalog_unavailable', message: String(error?.message || error) });
    return { buckets, files, skipped, totalBytes };
  }

  for (const object of objects) {
    const declaredSize = Number(object.size || 0);
    if (declaredSize > maxSingle || totalBytes + declaredSize > maxTotal) {
      skipped.push({ bucket: object.bucket_id, path: object.name, size: declaredSize, reason: 'configured_size_limit' });
      continue;
    }
    const { data, error } = await supabase.storage.from(object.bucket_id).download(object.name);
    if (error || !data) {
      skipped.push({ bucket: object.bucket_id, path: object.name, size: declaredSize, reason: String(error?.message || 'download_failed') });
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > maxSingle || totalBytes + buffer.length > maxTotal) {
      skipped.push({ bucket: object.bucket_id, path: object.name, size: buffer.length, reason: 'configured_size_limit' });
      continue;
    }
    files.push({
      bucket: object.bucket_id,
      path: object.name,
      size: buffer.length,
      contentType: object.metadata?.mimetype || object.metadata?.contentType || 'application/octet-stream',
      cacheControl: object.metadata?.cacheControl || '3600',
      data: buffer.toString('base64'),
    });
    totalBytes += buffer.length;
  }
  return { buckets, files, skipped, totalBytes };
}

async function updateBackupJob(supabase, jobId, patch, { required = false } = {}) {
  const { error } = await supabase.from('system_backup_jobs').update(patch).eq('id', jobId);
  if (error) {
    if (required) throw error;
    console.error('backup job update failed:', error.message);
  }
}

export async function cleanupExpiredBackupTransfers(supabase = adminClient()) {
  const nowIso = new Date().toISOString();
  let removedTransfers = 0;
  let removedRestoreUploads = 0;

  const { data: jobs, error: jobsError } = await supabase
    .from('system_backup_jobs')
    .select('id,storage_path')
    .in('status', ['running', 'completed'])
    .is('deleted_at', null)
    .lt('retention_expires_at', nowIso)
    .limit(200);
  if (jobsError) console.error('expired backup transfer lookup failed:', jobsError.message);
  for (let offset = 0; offset < (jobs || []).length; offset += 100) {
    const batch = jobs.slice(offset, offset + 100);
    const paths = batch.map((job) => job.storage_path).filter(Boolean);
    const { error: removeError } = paths.length
      ? await supabase.storage.from(BACKUP_BUCKET).remove(paths)
      : { error: null };
    if (removeError) {
      console.error('expired backup transfer removal failed:', removeError.message);
      continue;
    }
    const { error: markError } = await supabase.from('system_backup_jobs')
      .update({ status: 'deleted', deleted_at: nowIso, storage_path: null })
      .in('id', batch.map((job) => job.id));
    if (markError) console.error('expired backup transfer metadata update failed:', markError.message);
    else removedTransfers += batch.length;
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from('system_restore_sessions')
    .select('id,upload_path')
    .in('status', ['uploading', 'validated', 'failed'])
    .lt('expires_at', nowIso)
    .limit(200);
  if (sessionsError) console.error('expired restore upload lookup failed:', sessionsError.message);
  for (let offset = 0; offset < (sessions || []).length; offset += 100) {
    const batch = sessions.slice(offset, offset + 100);
    const paths = batch.map((session) => session.upload_path).filter(Boolean);
    const { error: removeError } = paths.length
      ? await supabase.storage.from(BACKUP_BUCKET).remove(paths)
      : { error: null };
    if (removeError) {
      console.error('expired restore upload removal failed:', removeError.message);
      continue;
    }
    const { error: markError } = await supabase.from('system_restore_sessions')
      .update({ status: 'expired' })
      .in('id', batch.map((session) => session.id));
    if (markError) console.error('expired restore session update failed:', markError.message);
    else removedRestoreUploads += batch.length;
  }
  return { removedTransfers, removedRestoreUploads };
}

export async function createLocalTransferBackup({ source = 'manual', actorId = null } = {}) {
  if (!['manual', 'pre_restore'].includes(source)) throw new Error('نوع بکاپ محلی معتبر نیست.');
  const supabase = adminClient();
  const localPolicy = backupLocalPolicy();
  const startedAt = new Date();
  const { data: job, error: jobError } = await supabase.from('system_backup_jobs').insert({
    trigger_source: source,
    status: 'running',
    started_by: actorId,
    started_at: startedAt.toISOString(),
    retention_expires_at: new Date(startedAt.getTime() + localPolicy.transferTtlMinutes * 60000).toISOString(),
    metadata: { transfer_only: true, persistent_server_copy: false },
  }).select('id').single();
  if (jobError) throw new Error(jobError.message || 'ثبت فرآیند بکاپ ناموفق بود.');

  const db = databaseClient();
  let uploadedPath = null;
  try {
    await db.connect();
    await db.query('begin isolation level repeatable read read only');
    await db.query(`set local statement_timeout='10min'`);
    const database = await exportDatabase(db);
    const storage = await exportStorageFiles(db, supabase);
    if (storage.skipped.length > 0) {
      throw new Error(`بکاپ کامل ساخته نشد؛ ${storage.skipped.length} فایل Storage قابل دریافت یا داخل محدودیت حجم نبود. محدودیت‌های BACKUP_MAX_STORAGE_BYTES و BACKUP_MAX_SINGLE_FILE_BYTES و دسترسی فایل‌ها را بررسی کنید.`);
    }
    await db.query('commit');
    const payload = {
      format: 'aryaman-system-backup',
      archiveVersion: ARCHIVE_VERSION,
      applicationVersion: process.env.APP_VERSION || null,
      createdAt: startedAt.toISOString(),
      source,
      manifest: {
        tableCount: database.tableCount,
        rowCount: database.rowCount,
        fileCount: storage.files.length,
        storageBytes: storage.totalBytes,
        skippedFiles: storage.skipped,
      },
      database: { tables: database.tables, sequences: database.sequences },
      storage: { buckets: storage.buckets, files: storage.files },
    };
    const archive = await encryptBackupPayload(payload);
    const verifiedPayload = await decryptBackupArchive(archive);
    if (verifiedPayload?.manifest?.rowCount !== payload.manifest.rowCount) {
      throw new Error('اعتبارسنجی داخلی آرشیو کامل نشد.');
    }
    const path = archivePath(source, startedAt);
    await updateBackupJob(supabase, job.id, { storage_path: path }, { required: true });
    const { error: uploadError } = await supabase.storage.from(BACKUP_BUCKET).upload(path, archive, {
      contentType: 'application/octet-stream',
      cacheControl: '0',
      upsert: false,
    });
    if (uploadError) throw uploadError;
    uploadedPath = path;
    const readyAt = new Date();

    await updateBackupJob(supabase, job.id, {
      status: 'completed',
      storage_path: path,
      size_bytes: archive.length,
      table_count: database.tableCount,
      row_count: database.rowCount,
      file_count: storage.files.length,
      completed_at: readyAt.toISOString(),
      retention_expires_at: new Date(readyAt.getTime() + localPolicy.transferTtlMinutes * 60000).toISOString(),
      metadata: {
        transfer_only: true,
        persistent_server_copy: false,
        archive_validated: true,
        skipped_files: storage.skipped.length,
        storage_bytes: storage.totalBytes,
        local_max_versions: localPolicy.localMaxVersions,
      },
    }, { required: true });
    await cleanupExpiredBackupTransfers(supabase);
    return {
      jobId: job.id,
      sizeBytes: archive.length,
      tableCount: database.tableCount,
      rowCount: database.rowCount,
      fileCount: storage.files.length,
      skippedFileCount: storage.skipped.length,
      transferExpiresAt: new Date(readyAt.getTime() + localPolicy.transferTtlMinutes * 60000).toISOString(),
      createdAt: startedAt.toISOString(),
      source,
    };
  } catch (error) {
    await db.query('rollback').catch(() => {});
    if (uploadedPath) await supabase.storage.from(BACKUP_BUCKET).remove([uploadedPath]).catch(() => {});
    await updateBackupJob(supabase, job.id, {
      status: 'failed',
      storage_path: null,
      error_message: String(error?.message || error).slice(0, 2000),
      completed_at: new Date().toISOString(),
    });
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
}

export function backupSummary(payload) {
  return {
    archiveVersion: payload.archiveVersion,
    applicationVersion: payload.applicationVersion,
    createdAt: payload.createdAt,
    source: payload.source,
    tableCount: Number(payload.manifest?.tableCount || payload.database?.tables?.length || 0),
    rowCount: Number(payload.manifest?.rowCount || 0),
    fileCount: Number(payload.manifest?.fileCount || payload.storage?.files?.length || 0),
    storageBytes: Number(payload.manifest?.storageBytes || 0),
    skippedFileCount: Array.isArray(payload.manifest?.skippedFiles) ? payload.manifest.skippedFiles.length : 0,
  };
}

async function currentTableMetadata(client, schema, table) {
  const [columns, primary] = await Promise.all([
    client.query(`
      select column_name,is_generated,is_identity
      from information_schema.columns
      where table_schema=$1 and table_name=$2
      order by ordinal_position
    `, [schema, table]),
    client.query(`
      select a.attname as column_name
      from pg_index i
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indrelid=($1||'.'||$2)::regclass and i.indisprimary
      order by array_position(i.indkey,a.attnum)
    `, [schema, table]),
  ]);
  return {
    columns: columns.rows.filter((row) => row.is_generated === 'NEVER').map((row) => row.column_name),
    primary: primary.rows.map((row) => row.column_name),
  };
}

function normalizePgValue(value) {
  if (value === undefined) return null;
  return value;
}

async function insertRows(client, schema, table, rows, mode) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const meta = await currentTableMetadata(client, schema, table);
  if (!meta.columns.length) return 0;
  const available = new Set(meta.columns);
  const columns = meta.columns.filter((column) => rows.some((row) => Object.prototype.hasOwnProperty.call(row, column)));
  if (!columns.length) return 0;
  const batchSize = Math.max(1, Math.min(250, Number(process.env.RESTORE_INSERT_BATCH_SIZE || 100)));
  let inserted = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params = [];
    const valueSql = batch.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(normalizePgValue(row[column]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(',')})`;
    }).join(',');
    let conflict = '';
    if (meta.primary.length && meta.primary.every((key) => available.has(key))) {
      const nonKeys = columns.filter((column) => !meta.primary.includes(column));
      if (mode === 'merge_safe' && nonKeys.length) {
        conflict = ` on conflict (${meta.primary.map(quoteIdent).join(',')}) do update set ${nonKeys.map((column) => `${quoteIdent(column)}=excluded.${quoteIdent(column)}`).join(',')}`;
      } else {
        conflict = ` on conflict (${meta.primary.map(quoteIdent).join(',')}) do nothing`;
      }
    }
    const sql = `insert into ${quoteIdent(schema)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(',')}) overriding system value values ${valueSql}${conflict}`;
    const result = await client.query(sql, params);
    inserted += Number(result.rowCount || 0);
  }
  return inserted;
}

async function ensureStorageBuckets(supabase, buckets) {
  for (const bucket of buckets || []) {
    if (!bucket?.id || bucket.id === BACKUP_BUCKET) continue;
    const { data } = await supabase.storage.getBucket(bucket.id);
    if (data) continue;
    const { error } = await supabase.storage.createBucket(bucket.id, {
      public: Boolean(bucket.public),
      fileSizeLimit: bucket.file_size_limit || undefined,
      allowedMimeTypes: bucket.allowed_mime_types || undefined,
    });
    if (error && !/already|exists|وجود/i.test(String(error.message || error))) {
      throw new Error(`ساخت مخزن فایل ${bucket.id} ناموفق بود: ${error.message}`);
    }
  }
}

async function restoreStorageFiles(supabase, files) {
  let restored = 0;
  const errors = [];
  for (const file of files || []) {
    if (!file?.bucket || !file?.path || !file?.data || file.bucket === BACKUP_BUCKET) continue;
    const buffer = Buffer.from(file.data, 'base64');
    const { error } = await supabase.storage.from(file.bucket).upload(file.path, buffer, {
      upsert: true,
      contentType: file.contentType || 'application/octet-stream',
      cacheControl: String(file.cacheControl || '3600'),
    });
    if (error) errors.push({ bucket: file.bucket, path: file.path, message: error.message });
    else restored += 1;
  }
  return { restored, errors };
}

export async function restoreSystemBackup(payload, { mode = 'replace_business' } = {}) {
  if (!['replace_business', 'merge_safe'].includes(mode)) throw new Error('حالت بازیابی نامعتبر است.');
  const supabase = adminClient();
  const db = databaseClient();
  const tables = (payload.database?.tables || []).filter((table) =>
    table?.schema === 'public' && !RESTORE_PUBLIC_EXCLUSIONS.has(table.name),
  );
  let restoredRows = 0;
  await db.connect();
  try {
    await db.query('begin');
    await db.query(`set local lock_timeout='15s'`);
    await db.query(`set local statement_timeout='10min'`);
    try {
      // The archive already contains the final, internally consistent rows.
      // Replay without business triggers so cyclic foreign keys (for example
      // order ↔ production/R&D links) can be restored in one transaction.
      await db.query(`set local session_replication_role='replica'`);
    } catch (error) {
      throw new Error(`نقش دیتابیس بکاپ مجوز بازیابی کنترل‌شده را ندارد (session_replication_role): ${error.message}`);
    }

    const existing = await listDatabaseTables(db);
    const existingKeys = new Set(existing.map((table) => `${table.table_schema}.${table.table_name}`));
    const applicable = tables.filter((table) => existingKeys.has(`public.${table.name}`));

    if (mode === 'replace_business' && applicable.length) {
      const names = applicable.map((table) => `${quoteIdent('public')}.${quoteIdent(table.name)}`);
      await db.query(`truncate table ${names.join(',')} restart identity cascade`);
    }

    for (const table of applicable) {
      restoredRows += await insertRows(db, 'public', table.name, table.rows || [], mode);
    }

    for (const sequence of payload.database?.sequences || []) {
      if (sequence.schema !== 'public' || !sequence.name || sequence.last_value === null) continue;
      try {
        await db.query('select setval(($1||\'.\'||$2)::regclass,$3,true)', [sequence.schema, sequence.name, sequence.last_value]);
      } catch (error) {
        console.warn(`sequence restore skipped ${sequence.schema}.${sequence.name}:`, error.message);
      }
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }

  await ensureStorageBuckets(supabase, payload.storage?.buckets || []);
  const storage = await restoreStorageFiles(supabase, payload.storage?.files || []);
  return { mode, restoredTables: tables.length, restoredRows, restoredFiles: storage.restored, fileErrors: storage.errors };
}

export function backupRuntimeStatus() {
  return {
    databaseConfigured: Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL),
    encryptionConfigured: Boolean(process.env.BACKUP_ENCRYPTION_KEY),
    storageMode: 'local_only',
    persistentServerCopies: false,
    localPolicy: backupLocalPolicy(),
    archiveVersion: ARCHIVE_VERSION,
  };
}

export { BACKUP_BUCKET };
