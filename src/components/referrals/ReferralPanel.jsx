import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw, X } from 'lucide-react';
import { addReferralMessage, createReferral, fetchModuleReferrals, fetchReferralMessages, MODULE_LABELS_FA, updateReferralStatus } from '../../lib/referralApi';
import { formatJalaliDate } from '../../lib/formatters';
import JalaliDateInput from '../JalaliDateInput';
import SharedFilesPanel from '../shared/SharedFilesPanel';
import './ReferralPanel.css';

const STATUS_LABELS = { open: 'باز', in_progress: 'در حال انجام', answered: 'پاسخ داده‌شده', done: 'انجام شده', cancelled: 'لغو شده' };
const PRIORITY_LABELS = { 1: 'فوری', 2: 'عادی', 3: 'کم‌اهمیت' };

export default function ReferralPanel({ sourceModule, title = 'ارجاعات', relatedOrderId, relatedDocumentId, sourceRecordId, defaultTarget = 'accounting', compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [responseModal, setResponseModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailMessages, setDetailMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [form, setForm] = useState({ targetModule: defaultTarget, title: '', description: '', priority: 2, dueDate: '' });

  const activeCount = useMemo(() => rows.filter((r) => ['open', 'in_progress', 'answered'].includes(r.status)).length, [rows]);

  async function load() {
    setLoading(true); setError('');
    try { setRows(await fetchModuleReferrals({ module: sourceModule, relatedOrderId, relatedDocumentId, status: statusFilter })); }
    catch (e) { setError(e.message || 'خطا در دریافت ارجاعات'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [sourceModule, relatedOrderId, relatedDocumentId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(row) {
    setDetail(row);
    setMessageText('');
    try { setDetailMessages(await fetchReferralMessages(row.id)); }
    catch { setDetailMessages([]); }
  }

  async function sendDetailMessage() {
    if (!detail || !messageText.trim()) return;
    setBusy(true); setError('');
    try {
      await addReferralMessage(detail.id, messageText.trim(), 'reply');
      setMessageText('');
      setDetailMessages(await fetchReferralMessages(detail.id));
      await load();
    } catch (e) { setError(e.message || 'خطا در ثبت پاسخ'); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await createReferral({ sourceModule, targetModule: form.targetModule, title: form.title, description: form.description, priority: form.priority, dueDate: form.dueDate, relatedOrderId, relatedDocumentId, sourceRecordId });
      setShowForm(false);
      setForm({ targetModule: defaultTarget, title: '', description: '', priority: 2, dueDate: '' });
      await load();
    } catch (e) { setError(e.message || 'خطا در ثبت ارجاع'); }
    finally { setBusy(false); }
  }

  async function changeStatus(row, status) {
    if (status === 'answered') {
      setResponseModal({ row, status, response: row.response_fa || '' });
      return;
    }
    setBusy(true);
    try { await updateReferralStatus(row.id, status); await load(); }
    catch (e) { setError(e.message || 'خطا در تغییر وضعیت'); }
    finally { setBusy(false); }
  }

  async function submitResponse() {
    if (!responseModal) return;
    setBusy(true);
    try {
      await updateReferralStatus(responseModal.row.id, responseModal.status, responseModal.response);
      setResponseModal(null);
      await load();
    } catch (e) { setError(e.message || 'خطا در ثبت پاسخ ارجاع'); }
    finally { setBusy(false); }
  }

  const referralSection = <section className={compact ? 'referral-panel compact' : 'referral-panel'}>
    <header className="referral-panel-header"><div><h2><Link2 size={18} /> {title}</h2><p>{activeCount} ارجاع فعال</p></div><div className="referral-actions"><button type="button" onClick={load}><RefreshCw size={14} /> به‌روزرسانی</button><button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>＋ ارجاع جدید</button></div></header>
    <div className="referral-toolbar"><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="active">فعال‌ها</option><option value="all">همه</option><option value="done">انجام‌شده</option><option value="cancelled">لغوشده</option></select></div>
    {showForm && <form className="referral-form" onSubmit={submit}><label><span>مقصد</span><select value={form.targetModule} onChange={(e) => setForm({ ...form, targetModule: e.target.value })}>{Object.entries(MODULE_LABELS_FA).filter(([k]) => k !== sourceModule).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>اولویت</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}><option value={1}>فوری</option><option value={2}>عادی</option><option value={3}>کم‌اهمیت</option></select></label><label><span>موعد شمسی</span><JalaliDateInput value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /></label><label className="wide"><span>عنوان</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label className="wide"><span>شرح</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><div className="wide referral-submit"><button disabled={busy} type="submit">ثبت ارجاع</button></div></form>}
    {error && <div className="referral-error">{error}</div>}
    {loading ? <div className="referral-empty">در حال دریافت...</div> : rows.length === 0 ? <div className="referral-empty">ارجاعی برای نمایش وجود ندارد.</div> : <div className="referral-list">{rows.map((row) => <article key={row.id} className={`referral-item p${row.priority}`}><div onClick={() => openDetail(row)} className="referral-click-zone"><strong>{row.title_fa}</strong><small>{row.referral_number || '—'} · {MODULE_LABELS_FA[row.source_module] || row.source_module} ← {MODULE_LABELS_FA[row.target_module] || row.target_module} · {PRIORITY_LABELS[row.priority] || row.priority}{row.due_date ? ` · موعد ${formatJalaliDate(row.due_date)}` : ''}</small>{row.description_fa && <p>{row.description_fa}</p>}{row.response_fa && <p>{row.response_fa}</p>}</div><div className="referral-status-box"><button type="button" onClick={() => openDetail(row)}>جزئیات</button><span className={`referral-status ${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span><select disabled={busy} value={row.status} onChange={(e) => changeStatus(row, e.target.value)}><option value="open">باز</option><option value="in_progress">در حال انجام</option><option value="answered">پاسخ داده‌شده</option><option value="done">انجام شده</option><option value="cancelled">لغو شده</option></select></div></article>)}</div>}
    {detail && <div className="referral-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}><div className="referral-detail-modal"><header><h3>جزئیات ارجاع {detail.referral_number || ''}</h3><button onClick={() => setDetail(null)}><X size={16}/></button></header><section><div className="referral-detail-grid"><div><span>عنوان</span><b>{detail.title_fa}</b></div><div><span>مبدأ و مقصد</span><b>{MODULE_LABELS_FA[detail.source_module] || detail.source_module} ← {MODULE_LABELS_FA[detail.target_module] || detail.target_module}</b></div><div><span>وضعیت</span><b>{STATUS_LABELS[detail.status] || detail.status}</b></div><div><span>موعد</span><b>{formatJalaliDate(detail.due_date)}</b></div></div><div className="referral-description-box"><span>شرح کامل</span><p>{detail.description_fa || 'شرحی ثبت نشده است.'}</p></div><div className="referral-thread"><h4>گفتگوی ارجاع</h4>{detailMessages.length === 0 ? <div className="referral-empty">هنوز پاسخی ثبت نشده است.</div> : detailMessages.map((m) => <article key={m.id}><strong>{m.profiles?.full_name || 'کاربر'}</strong><p>{m.message_fa}</p><small>{new Date(m.created_at).toLocaleString('fa-IR')}</small></article>)}</div><div className="referral-reply-box"><textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="پاسخ یا توضیح جدید را بنویسید..."/><button disabled={busy || !messageText.trim()} onClick={sendDetailMessage}>ثبت پاسخ و ادامه ارجاع</button></div></section></div></div>}
    {responseModal && <div className="referral-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setResponseModal(null)}><div className="referral-modal"><header><h3>ثبت پاسخ ارجاع</h3><button onClick={() => setResponseModal(null)}><X size={16}/></button></header><textarea value={responseModal.response} onChange={(e) => setResponseModal({ ...responseModal, response: e.target.value })} placeholder="پاسخ ارجاع را وارد کنید..." /><div><button onClick={() => setResponseModal(null)}>انصراف</button><button disabled={busy} onClick={submitResponse}>ثبت پاسخ</button></div></div></div>}
  </section>;

  return <div className={compact ? 'referral-files-stack compact' : 'referral-files-stack'}>{referralSection}<SharedFilesPanel sourceModule={sourceModule} relatedOrderId={relatedOrderId} relatedRecordId={sourceRecordId || relatedDocumentId} /></div>;
}
