import assert from 'node:assert/strict';

process.env.BACKUP_ENCRYPTION_KEY = 'test-only-backup-key-with-at-least-32-characters-2026';
delete process.env.BACKUP_LOCAL_MAX_VERSIONS;
delete process.env.BACKUP_LOCAL_OVERDUE_HOURS;
delete process.env.BACKUP_TRANSFER_TTL_MINUTES;

const {
  encryptBackupPayload,
  decryptBackupArchive,
  backupSummary,
  backupRuntimeStatus,
  backupLocalPolicy,
  BACKUP_BUCKET,
} = await import('../netlify/backupService.js');

const payload = {
  format: 'aryaman-system-backup',
  archiveVersion: 2,
  createdAt: '2026-10-22T01:30:00.000Z',
  source: 'test',
  manifest: { tableCount: 2, rowCount: 2, fileCount: 1, storageBytes: 4, skippedFiles: [] },
  database: {
    tables: [
      { schema: 'public', name: 'orders', rows: [{ id: '1', title_fa: 'سفارش تست' }] },
      { schema: 'public', name: 'order_items', rows: [{ id: '2', order_id: '1', quantity: 100 }] },
    ],
    sequences: [],
  },
  storage: { files: [{ bucket: 'documents', name: 'test.txt', data: 'dGVzdA==' }] },
};

const archive = await encryptBackupPayload(payload);
assert.ok(Buffer.isBuffer(archive));
assert.equal(archive.subarray(0, 8).toString('utf8'), 'ARYBKP02');
assert.equal(archive.includes(Buffer.from('سفارش تست')), false, 'archive must not expose plaintext payload');
assert.deepEqual(await decryptBackupArchive(archive), payload);

const tampered = Buffer.from(archive);
tampered[tampered.length - 1] ^= 0xff;
await assert.rejects(() => decryptBackupArchive(tampered), /authenticate|نامعتبر|ناموفق|بایگانی|invalid/i);

const summary = backupSummary(payload);
assert.equal(summary.tableCount, 2);
assert.equal(summary.rowCount, 2);
assert.equal(summary.fileCount, 1);
const runtime = backupRuntimeStatus();
assert.equal(runtime.encryptionConfigured, true);
assert.equal(runtime.storageMode, 'local_only');
assert.equal(runtime.persistentServerCopies, false);
assert.deepEqual(backupLocalPolicy(), { localMaxVersions: 5, overdueHours: 48, transferTtlMinutes: 60 });
assert.deepEqual(runtime.localPolicy, backupLocalPolicy());
assert.equal(BACKUP_BUCKET, 'system-backups');

console.log('BACKUP_CENTER_ENCRYPTION_RESTORE_CONTRACT_OK');
