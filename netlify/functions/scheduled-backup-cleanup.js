import { createClient } from '@supabase/supabase-js';
import { cleanupExpiredBackupTransfers } from '../backupService.js';

export async function handler() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Local-backup transfer cleanup skipped: Supabase server variables are incomplete.');
    return { statusCode: 500, body: 'cleanup configuration incomplete' };
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await cleanupExpiredBackupTransfers(supabase);
    console.log('LOCAL_BACKUP_TRANSFER_CLEANUP_OK', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('Local-backup transfer cleanup failed:', error);
    return { statusCode: 500, body: String(error?.message || error) };
  }
}
