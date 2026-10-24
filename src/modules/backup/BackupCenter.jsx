import { useEffect, useState } from 'react';
import {
  ArchiveRestore,
  CheckCircle2,
  FolderCheck,
  HardDrive,
  HardDriveUpload,
  KeyRound,
  Laptop,
  LoaderCircle,
  RefreshCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import {
  chooseLocalBackupDirectory,
  completeLocalBackup,
  createBackupNow,
  getBackupCenterStatus,
  listBackupPermissions,
  runValidatedRestore,
  savePreparedBackupToDirectory,
  updateBackupPermission,
  uploadBackupForRestore,
} from '../../lib/backupApi';
import { useAuth } from '../../auth/AuthProvider';
import { getFriendlyErrorMessage } from '../../lib/errorMessages';
import './BackupCenter.css';

const HISTORY_PREFIX = 'aryaman-local-backup-history';
const SOURCE_LABEL = { manual: 'بکاپ کامل محلی', pre_restore: 'بکاپ ایمنی پیش از بازیابی' };

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return '۰ بایت';
  const units = ['بایت', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(size / (1024 ** index))} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return String(value); }
}

function historyKey(userId) {
  return `${HISTORY_PREFIX}:${userId || 'anonymous'}`;
}

function readHistory(userId) {
  try {
    const rows = JSON.parse(localStorage.getItem(historyKey(userId)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function isPickerCancellation(error) {
  return error?.name === 'AbortError' || /cancel|لغو/i.test(String(error?.message || ''));
}

export default function BackupCenter() {
  const { hasRole, user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', permission: {}, runtime: {}, isAdmin: false });
  const [history, setHistory] = useState(() => readHistory(user?.id));
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreValidation, setRestoreValidation] = useState(null);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [restoreMode, setRestoreMode] = useState('replace_business');
  const [permissions, setPermissions] = useState(null);
  const [clock, setClock] = useState(() => Date.now());

  const isAdmin = state.isAdmin || hasRole('admin');
  const policy = state.runtime.localPolicy || { localMaxVersions: 5, overdueHours: 48, transferTtlMinutes: 60 };
  const latestLocal = history[0] || null;
  const overdue = !latestLocal || clock - new Date(latestLocal.savedAt).getTime() > policy.overdueHours * 60 * 60 * 1000;
  const canCreateLocal = state.permission.can_create && state.permission.can_download;
  const runtimeReady = state.runtime.databaseConfigured && state.runtime.encryptionConfigured;

  useEffect(() => { setHistory(readHistory(user?.id)); }, [user?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function load({ silent = false } = {}) {
    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await getBackupCenterStatus();
      setState({ loading: false, error: '', permission: result.permission || {}, runtime: result.runtime || {}, isAdmin: !!result.isAdmin });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: getFriendlyErrorMessage(error, 'دریافت وضعیت بکاپ ناموفق بود.') }));
    }
  }

  useEffect(() => { load(); }, []);

  function recordLocalBackup(entry) {
    const max = Math.max(1, Number(policy.localMaxVersions || 5));
    const current = readHistory(user?.id);
    const next = [entry, ...current.filter((row) => row.jobId !== entry.jobId)].slice(0, max);
    localStorage.setItem(historyKey(user?.id), JSON.stringify(next));
    setHistory(next);
    setClock(Date.now());
  }

  async function buildAndSaveLocalBackup(directory, source = 'manual', { protectedNames = [] } = {}) {
    const prepared = await createBackupNow(source);
    const saved = await savePreparedBackupToDirectory(prepared.jobId, directory, { keepVersions: policy.localMaxVersions || 5, protectedNames });
    let transferCleanupPending = false;
    try {
      await completeLocalBackup(prepared.jobId, saved);
    } catch (error) {
      transferCleanupPending = true;
      console.warn('local backup saved; transfer cleanup deferred:', error);
    }
    const entry = {
      jobId: prepared.jobId,
      source,
      filename: saved.filename,
      directoryName: saved.directoryName,
      sizeBytes: saved.sizeBytes,
      savedAt: saved.savedAt,
      tableCount: prepared.tableCount,
      rowCount: prepared.rowCount,
      fileCount: prepared.fileCount,
    };
    recordLocalBackup(entry);
    return { ...entry, deletedCount: saved.deletedCount, transferCleanupPending };
  }

  async function createLocalBackup() {
    setNotice('');
    let directory;
    try {
      directory = await chooseLocalBackupDirectory();
    } catch (error) {
      if (!isPickerCancellation(error)) setNotice(getFriendlyErrorMessage(error, 'انتخاب پوشه ناموفق بود.'));
      return;
    }
    setBusy('create');
    try {
      const result = await buildAndSaveLocalBackup(directory, 'manual');
      const rotation = result.deletedCount ? ` ${new Intl.NumberFormat('fa-IR').format(result.deletedCount)} نسخه قدیمی همان پوشه نیز حذف شد.` : '';
      const cleanup = result.transferCleanupPending ? ' فایل انتقالی باقی‌مانده پس از پایان مهلت، با پاک‌ساز ساعتی حذف می‌شود.' : ' هیچ نسخه دائمی روی سرور باقی نماند.';
      setNotice(`بکاپ کامل «${result.filename}» در پوشه «${result.directoryName}» ذخیره و اعتبارسنجی شد.${rotation}${cleanup}`);
      await load({ silent: true });
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'ساخت یا ذخیره بکاپ محلی ناموفق بود.'));
    } finally {
      setBusy('');
    }
  }

  async function uploadAndValidate() {
    if (!restoreFile) return;
    setBusy('validate');
    setNotice('');
    setRestoreValidation(null);
    try {
      const result = await uploadBackupForRestore(restoreFile);
      setRestoreValidation(result);
      setNotice('فایل رمزگشایی و صحت‌سنجی شد. پیش از Restore یک بکاپ ایمنی جدید در پوشه انتخابی شما ذخیره خواهد شد.');
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'اعتبارسنجی فایل بکاپ ناموفق بود.'));
    } finally {
      setBusy('');
    }
  }

  async function restore() {
    if (!restoreValidation) return;
    setNotice('');
    let directory;
    try {
      directory = await chooseLocalBackupDirectory();
    } catch (error) {
      if (!isPickerCancellation(error)) setNotice(getFriendlyErrorMessage(error, 'پوشه بکاپ ایمنی انتخاب نشد.'));
      return;
    }
    setBusy('restore');
    try {
      const safety = await buildAndSaveLocalBackup(directory, 'pre_restore', { protectedNames: [restoreFile?.name] });
      await runValidatedRestore({
        sessionId: restoreValidation.sessionId,
        confirmationToken: restoreValidation.confirmationToken,
        confirmationPhrase: restorePhrase,
        safetyJobId: safety.jobId,
        mode: restoreMode,
      });
      setNotice(`بازیابی تکمیل شد. بکاپ ایمنی «${safety.filename}» قبل از تغییر اطلاعات در سیستم شما ذخیره شد. صفحه را یک بار تازه‌سازی کنید.`);
      setRestoreFile(null);
      setRestoreValidation(null);
      setRestorePhrase('');
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'بازیابی کنترل‌شده ناموفق بود.'));
    } finally {
      setBusy('');
    }
  }

  async function openPermissions() {
    setBusy('permissions');
    setNotice('');
    try {
      const result = await listBackupPermissions();
      const byUser = Object.fromEntries((result.permissions || []).map((item) => [item.user_id, item]));
      setPermissions((result.users || []).map((profile) => ({
        ...profile,
        canCreate: !!byUser[profile.id]?.can_create,
        canDownload: !!byUser[profile.id]?.can_download,
        canRestore: !!byUser[profile.id]?.can_restore,
      })));
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'دریافت مجوزها ناموفق بود.'));
    } finally { setBusy(''); }
  }

  async function savePermission(profile) {
    setBusy(`permission-${profile.id}`);
    try {
      await updateBackupPermission({
        userId: profile.id,
        canCreate: profile.canCreate,
        canDownload: profile.canDownload,
        canRestore: profile.canRestore,
      });
      setNotice(`مجوزهای ${profile.full_name || profile.email} ذخیره شد.`);
      await openPermissions();
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'ذخیره مجوزها ناموفق بود.'));
      setBusy('');
    }
  }

  function patchPermission(userId, patch) {
    setPermissions((rows) => rows.map((row) => row.id === userId ? { ...row, ...patch } : row));
  }

  if (state.loading) return <div className="backup-loading"><LoaderCircle className="spin" /> در حال بارگذاری مرکز بکاپ...</div>;
  if (state.error) return <section className="backup-access-error"><ShieldCheck size={34} /><h2>مرکز بکاپ</h2><p>{state.error}</p><button onClick={() => load()}><RefreshCcw size={16} /> تلاش دوباره</button></section>;

  return <div className="backup-page" dir="rtl">
    <header className="backup-hero">
      <div><span className="backup-eyebrow">Local only · Encrypted · Full</span><h1>بکاپ کامل در سیستم</h1><p>هر زمان دکمه را بزنید، اطلاعات کامل به‌صورت رمزگذاری‌شده در پوشه انتخابی ذخیره می‌شود؛ هیچ آرشیو دائمی روی سرور نگهداری نمی‌شود.</p></div>
      <div className="backup-hero-actions">
        <button className="primary" disabled={busy || !canCreateLocal || !runtimeReady} onClick={createLocalBackup}>
          {busy === 'create' ? <LoaderCircle className="spin" size={18} /> : <FolderCheck size={18} />} انتخاب پوشه و بکاپ کامل
        </button>
        <button disabled={busy} onClick={() => load()}><RefreshCcw size={17} /> به‌روزرسانی</button>
      </div>
    </header>

    {notice && <div className={`backup-notice ${/ناموفق|خطا/.test(notice) ? 'danger' : ''}`}>{notice}</div>}
    {!runtimeReady && <div className="backup-config-warning"><TriangleAlert size={20} /><div><b>تنظیم سرور کامل نیست.</b><span>{!state.runtime.databaseConfigured ? ' SUPABASE_DB_URL' : ''}{!state.runtime.encryptionConfigured ? ' BACKUP_ENCRYPTION_KEY' : ''} باید در Environment Variables نتلیفای ثبت شود؛ رازها هرگز به مرورگر فرستاده نمی‌شوند.</span></div></div>}
    {overdue && <div className="backup-config-warning overdue"><TriangleAlert size={20} /><div><b>{latestLocal ? 'زمان بکاپ محلی جدید رسیده است.' : 'هنوز در این مرورگر بکاپ محلی موفقی ثبت نشده است.'}</b><span>برای کاهش ریسک، حداقل هر {new Intl.NumberFormat('fa-IR').format(policy.overdueHours)} ساعت یک بکاپ در هارد دوم یا پوشه همگام‌شده ابری ذخیره کنید.</span></div></div>}

    <section className="backup-kpis">
      <article><Laptop /><div><span>محل نگهداری</span><b>فقط سیستم شما</b><small>بدون آرشیو دائمی سرور</small></div></article>
      <article><KeyRound /><div><span>حفاظت فایل</span><b>رمزگذاری سمت سرور</b><small>کلید محرمانه وارد مرورگر نمی‌شود</small></div></article>
      <article><Save /><div><span>چرخش محلی</span><b>{new Intl.NumberFormat('fa-IR').format(policy.localMaxVersions)} نسخه آخر</b><small>هنگام بکاپ در همان پوشه</small></div></article>
      <article><CheckCircle2 /><div><span>آخرین بکاپ این مرورگر</span><b>{latestLocal ? formatDateTime(latestLocal.savedAt) : 'هنوز ثبت نشده'}</b><small>{latestLocal ? formatBytes(latestLocal.sizeBytes) : '—'}</small></div></article>
    </section>

    <div className="backup-grid">
      <section className="backup-card backup-list-card local-backup-card">
        <div className="backup-card-head"><div><HardDrive /><span><b>نسخه‌های ذخیره‌شده در سیستم</b><small>فهرست زیر سابقه همین مرورگر است؛ خود فایل‌ها در پوشه انتخابی شما هستند.</small></span></div><span className="backup-count">{new Intl.NumberFormat('fa-IR').format(history.length)}</span></div>
        <div className="local-backup-flow">
          <span><b>۱</b> پوشه هارد، فلش یا Cloud Sync را انتخاب کنید.</span>
          <span><b>۲</b> آرشیو کامل ساخته، رمزگذاری و مستقیم نوشته می‌شود.</span>
          <span><b>۳</b> اندازه و ساختار فایل کنترل و نسخه‌های بیش از سقف حذف می‌شوند.</span>
        </div>
        {history.length === 0 ? <div className="backup-empty">هنوز سابقه بکاپ محلی در این مرورگر وجود ندارد.</div> : <div className="backup-job-list">{history.map((item) => <article key={item.jobId} className="backup-job local-history-row">
          <div className="backup-job-main"><span className="backup-status success">ذخیره‌شده</span><div><b>{SOURCE_LABEL[item.source] || 'بکاپ محلی'}</b><small>{formatDateTime(item.savedAt)} · {formatBytes(item.sizeBytes)} · پوشه {item.directoryName}</small><small>{item.filename}</small><small>{new Intl.NumberFormat('fa-IR').format(item.tableCount || 0)} جدول · {new Intl.NumberFormat('fa-IR').format(item.rowCount || 0)} ردیف · {new Intl.NumberFormat('fa-IR').format(item.fileCount || 0)} فایل</small></div></div>
        </article>)}</div>}
        <div className="backup-browser-note"><TriangleAlert size={17} /><span>برای مدیریت خودکار پنج نسخه، Chrome یا Edge لازم است. چرخش فقط فایل‌های بکاپ آریامن را در همان پوشه انتخابی لمس می‌کند. بهتر است پوشه روی هارد دوم یا OneDrive/Google Drive باشد.</span></div>
        <div className="backup-no-server-note"><ShieldCheck size={18}/><span>فایل فقط برای انتقال امن، {new Intl.NumberFormat('fa-IR').format(policy.transferTtlMinutes)} دقیقه اعتبار دارد و پس از ذخیره موفق فوراً حذف می‌شود. انتقال نیمه‌کاره در نخستین پاک‌سازی ساعتی پس از انقضا حذف خواهد شد.</span></div>
      </section>

      <section className="backup-card restore-card">
        <div className="backup-card-head"><div><ArchiveRestore /><span><b>بازیابی امن از فایل سیستم</b><small>اعتبارسنجی و بکاپ ایمنی محلی اجباری قبل از Restore</small></span></div></div>
        {!state.permission.can_restore ? <div className="backup-empty"><ShieldCheck size={26} />مجوز بازیابی برای حساب شما فعال نیست.</div> : <>
          <label className="backup-file-picker"><HardDriveUpload size={28} /><span><b>{restoreFile?.name || 'انتخاب فایل .arybackup از سیستم'}</b><small>فایل ابتدا رمزگشایی و فقط بررسی می‌شود؛ هنوز داده‌ای تغییر نمی‌کند.</small></span><input type="file" accept=".arybackup,application/octet-stream" onChange={(event) => { setRestoreFile(event.target.files?.[0] || null); setRestoreValidation(null); }} /></label>
          <button className="wide" disabled={!restoreFile || busy} onClick={uploadAndValidate}>{busy === 'validate' ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} بررسی و اعتبارسنجی فایل</button>
          {restoreValidation && <div className="restore-validation"><h3>فایل معتبر است</h3><div className="restore-summary"><span>تاریخ بکاپ<b>{formatDateTime(restoreValidation.summary.createdAt)}</b></span><span>جداول<b>{new Intl.NumberFormat('fa-IR').format(restoreValidation.summary.tableCount)}</b></span><span>ردیف‌ها<b>{new Intl.NumberFormat('fa-IR').format(restoreValidation.summary.rowCount)}</b></span><span>فایل‌ها<b>{new Intl.NumberFormat('fa-IR').format(restoreValidation.summary.fileCount)}</b></span></div>
            <label><span>روش بازیابی</span><select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value)}><option value="replace_business">جایگزینی کامل داده‌های کسب‌وکار (پیشنهادی)</option><option value="merge_safe">ادغام امن با داده‌های موجود</option></select></label>
            <div className="restore-danger"><TriangleAlert size={20} /><p>با زدن دکمه Restore، ابتدا انتخاب پوشه باز می‌شود و یک بکاپ ایمنی کامل در سیستم شما ذخیره و تأیید می‌گردد. بدون موفقیت این مرحله، هیچ داده‌ای تغییر نمی‌کند.</p></div>
            {!canCreateLocal && <div className="backup-empty">برای Restore، مجوز «آماده‌سازی» و «دریافت محلی» نیز لازم است.</div>}
            <label><span>برای تأیید دقیقاً بنویسید: <b>بازیابی کامل</b></span><input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} autoComplete="off" /></label>
            <button className="restore-button" disabled={busy || !canCreateLocal || restorePhrase !== 'بازیابی کامل'} onClick={restore}>{busy === 'restore' ? <LoaderCircle className="spin" size={17} /> : <ArchiveRestore size={17} />} بکاپ ایمنی محلی و اجرای بازیابی</button>
          </div>}
        </>}
      </section>
    </div>

    {isAdmin && <section className="backup-card permissions-card">
      <div className="backup-card-head"><div><UsersRound /><span><b>مجوزهای مرکز بکاپ</b><small>برای گرفتن فایل محلی، هر دو مجوز آماده‌سازی و دریافت لازم است؛ بازیابی را فقط به افراد مورد اعتماد بدهید.</small></span></div><button disabled={busy} onClick={openPermissions}>{busy === 'permissions' ? <LoaderCircle className="spin" size={16} /> : <UsersRound size={16} />} مدیریت مجوزها</button></div>
      {permissions && <div className="backup-permission-table"><table><thead><tr><th>کاربر</th><th>نقش</th><th>آماده‌سازی</th><th>دریافت محلی</th><th>بازیابی</th><th></th></tr></thead><tbody>{permissions.map((profile) => {
        const userAdmin = [profile.role, ...(profile.additional_roles || [])].includes('admin');
        return <tr key={profile.id}><td><b>{profile.full_name || 'بدون نام'}</b><small>{profile.email}</small></td><td>{userAdmin ? 'مدیر' : profile.role}</td><td><input type="checkbox" checked={userAdmin || profile.canCreate} disabled={userAdmin} onChange={(event) => patchPermission(profile.id, { canCreate: event.target.checked })} /></td><td><input type="checkbox" checked={userAdmin || profile.canDownload} disabled={userAdmin} onChange={(event) => patchPermission(profile.id, { canDownload: event.target.checked })} /></td><td><input type="checkbox" checked={userAdmin || profile.canRestore} disabled={userAdmin} onChange={(event) => patchPermission(profile.id, { canRestore: event.target.checked })} /></td><td><button disabled={userAdmin || busy} onClick={() => savePermission(profile)}><Save size={15} /> ذخیره</button></td></tr>;
      })}</tbody></table></div>}
    </section>}
  </div>;
}
