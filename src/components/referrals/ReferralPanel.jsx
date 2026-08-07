import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { createReferral, fetchModuleReferrals, MODULE_LABELS_FA, updateReferralStatus } from '../../lib/referralApi';
import { formatJalaliDate } from '../../lib/formatters';
import './ReferralPanel.css';

const STATUS_LABELS = {
  open: 'باز',
  in_progress: 'در حال انجام',
  answered: 'پاسخ داده‌شده',
  done: 'انجام شده',
  cancelled: 'لغو شده',
};

const PRIORITY_LABELS = { 1: 'فوری', 2: 'عادی', 3: 'کم‌اهمیت' };

export default function ReferralPanel({
  sourceModule,
  title = 'ارجاعات',
  relatedOrderId,
  relatedDocumentId,
  sourceRecordId,
  defaultTarget = 'accounting',
  compact = false,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    targetModule: defaultTarget,
    title: '',
    description: '',
    priority: 2,
    dueDate: '',
  });

  const activeCount = useMemo(() => rows.filter((r) => ['open', 'in_progress', 'answered'].includes(r.status)).length, [rows]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchModuleReferrals({ module: sourceModule, relatedOrderId, relatedDocumentId, status: statusFilter });
      setRows(data);
    } catch (e) {
      setError(e.message || 'خطا در دریافت ارجاعات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sourceModule, relatedOrderId, relatedDocumentId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createReferral({
        sourceModule,
        targetModule: form.targetModule,
        title: form.title,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate,
        relatedOrderId,
        relatedDocumentId,
        sourceRecordId,
      });
      setShowForm(false);
      setForm({ targetModule: defaultTarget, title: '', description: '', priority: 2, dueDate: '' });
      await load();
    } catch (e) {
      setError(e.message || 'خطا در ثبت ارجاع');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(row, status) {
    const response = status === 'answered' ? window.prompt('پاسخ ارجاع را وارد کنید:', row.response_fa || '') : undefined;
    setBusy(true);
    try {
      await updateReferralStatus(row.id, status, response);
      await load();
    } catch (e) {
      setError(e.message || 'خطا در تغییر وضعیت');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={compact ? 'referral-panel compact' : 'referral-panel'}>
      <header className="referral-panel-header">
        <div>
          <h2><Link2 size={18} /> {title}</h2>
          <p>{activeCount} ارجاع فعال</p>
        </div>
        <div className="referral-actions">
          <button type="button" onClick={load}><RefreshCw size={14} /> به‌روزرسانی</button>
          <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>＋ ارجاع جدید</button>
        </div>
      </header>

      <div className="referral-toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">فعال‌ها</option>
          <option value="all">همه</option>
          <option value="done">انجام‌شده</option>
          <option value="cancelled">لغوشده</option>
        </select>
      </div>

      {showForm && (
        <form className="referral-form" onSubmit={submit}>
          <label><span>مقصد</span><select value={form.targetModule} onChange={(e) => setForm({ ...form, targetModule: e.target.value })}>{Object.entries(MODULE_LABELS_FA).filter(([k]) => k !== sourceModule).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span>اولویت</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}><option value={1}>فوری</option><option value={2}>عادی</option><option value={3}>کم‌اهمیت</option></select></label>
          <label><span>موعد</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /><small className="date-hint">شمسی: {formatJalaliDate(form.dueDate)}</small></label>
          <label className="wide"><span>عنوان</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label className="wide"><span>شرح</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="wide referral-submit"><button disabled={busy} type="submit">ثبت ارجاع</button></div>
        </form>
      )}

      {error && <div className="referral-error">{error}</div>}
      {loading ? <div className="referral-empty">در حال دریافت...</div> : rows.length === 0 ? <div className="referral-empty">ارجاعی برای نمایش وجود ندارد.</div> : (
        <div className="referral-list">
          {rows.map((row) => (
            <article key={row.id} className={`referral-item p${row.priority}`}>
              <div>
                <strong>{row.title_fa}</strong>
                <small>
                  {row.referral_number || '—'} · {MODULE_LABELS_FA[row.source_module] || row.source_module} ← {MODULE_LABELS_FA[row.target_module] || row.target_module} · {PRIORITY_LABELS[row.priority] || row.priority}
                  {row.due_date ? ` · موعد ${formatJalaliDate(row.due_date)}` : ''}
                </small>
                {row.response_fa && <p>{row.response_fa}</p>}
              </div>
              <div className="referral-status-box">
                <span className={`referral-status ${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span>
                <select disabled={busy} value={row.status} onChange={(e) => changeStatus(row, e.target.value)}>
                  <option value="open">باز</option>
                  <option value="in_progress">در حال انجام</option>
                  <option value="answered">پاسخ داده‌شده</option>
                  <option value="done">انجام شده</option>
                  <option value="cancelled">لغو شده</option>
                </select>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
