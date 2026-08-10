import { useEffect, useMemo, useState } from 'react';
import { Download, FileUp, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { deleteSharedFile, downloadSharedFile, fetchSharedFiles, uploadSharedFile } from '../../lib/sharedFilesApi';
import { formatJalaliDateTime, formatNumber } from '../../lib/formatters';
import './SharedFilesPanel.css';

const MODULE_LABEL = {
  orders: 'سفارش‌ها', sales: 'فروش', rnd: 'R&D', production: 'تولید', warehouse: 'انبار', accounting: 'مالی', admin: 'اداری/مدیریت', office: 'اداری', manual: 'دستی'
};
const MODULE_ORDER = ['orders', 'production', 'rnd', 'warehouse', 'accounting', 'admin', 'office', 'manual'];

export default function SharedFilesPanel({ sourceModule = 'manual', relatedOrderId = null, relatedRecordId = null, compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', file: null });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');

  const folders = useMemo(() => {
    const counts = rows.reduce((acc, r) => {
      const key = r.source_module || 'manual';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return MODULE_ORDER.filter((m) => counts[m]).map((m) => ({ key: m, label: MODULE_LABEL[m] || m, count: counts[m] }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    const text = `${r.file_name || ''} ${r.title_fa || ''} ${r.description_fa || ''} ${r.source_module || ''} ${r.storage_path || ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (folder === 'all' || (r.source_module || 'manual') === folder);
  }), [rows, query, folder]);

  async function load() {
    setLoading(true); setError('');
    try { setRows(await fetchSharedFiles({ sourceModule, relatedOrderId, relatedRecordId })); }
    catch (e) { setError(e.message || 'خطا در دریافت فایل‌ها'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps


  async function handleDelete(row) {
    setError('');
    setBusy(true);
    try {
      await deleteSharedFile(row, sourceModule);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e.message || 'خطا در حذف فایل');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(row) {
    setError('');
    try { await downloadSharedFile(row); }
    catch (e) { setError(e.message || 'خطا در دانلود فایل'); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await uploadSharedFile({ file: form.file, sourceModule, relatedOrderId, relatedRecordId, title: form.title, description: form.description });
      setForm({ title: '', description: '', file: null });
      setShowForm(false);
      setFolder(sourceModule || 'manual');
      await load();
    } catch (e) {
      setError(e.message || 'خطا در ثبت فایل');
    } finally { setBusy(false); }
  }

  return <section className={compact ? 'shared-files-panel compact' : 'shared-files-panel'}>
    <header>
      <div><h2><Share2 size={18}/> فایل‌های اشتراک‌گذاشته‌شده</h2><p>فایل‌ها در Storage سرور و داخل فولدر هر ماژول ذخیره می‌شوند و برای همه واحدها قابل مشاهده و دانلود هستند.</p></div>
      <div className="shared-actions"><button onClick={load}><RefreshCw size={14}/> به‌روزرسانی</button><button className="primary" onClick={() => setShowForm((v) => !v)}><FileUp size={14}/> ارسال فایل</button></div>
    </header>
    <div className="shared-folders"><button className={folder === 'all' ? 'active' : ''} onClick={() => setFolder('all')}>همه فایل‌ها <b>{rows.length}</b></button>{folders.map((f) => <button key={f.key} className={folder === f.key ? 'active' : ''} onClick={() => setFolder(f.key)}>فولدر {f.label}<b>{f.count}</b></button>)}</div>
    <div className="shared-toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی فایل، فولدر، توضیح..." /></div>
    {showForm && <form className="shared-form" onSubmit={submit}>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان فایل" />
      <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="شرح کوتاه" />
      <input type="file" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} required />
      <button disabled={busy || !form.file} type="submit">{busy ? 'در حال ارسال...' : `ثبت در فولدر ${MODULE_LABEL[sourceModule] || sourceModule}`}</button>
    </form>}
    {error && <div className="shared-error">{error}</div>}
    {loading ? <div className="shared-empty">در حال دریافت...</div> : filtered.length === 0 ? <div className="shared-empty">فایل اشتراکی وجود ندارد.</div> : <div className="shared-list">{filtered.map((r) => <article key={r.id}>
      <div><strong>{r.title_fa || r.file_name}</strong><small>{r.file_number || '—'} · فولدر {MODULE_LABEL[r.source_module] || r.source_module} · {formatJalaliDateTime(r.uploaded_at)} · {formatSize(r.file_size)}</small><small className="shared-path">{r.storage_path || 'فایل قدیمی/داخلی'}</small>{r.description_fa && <p>{r.description_fa}</p>}</div>
      <div className="shared-file-actions"><button onClick={() => handleDownload(r)}><Download size={14}/> دانلود</button><button className="danger" onClick={() => setConfirmDelete(r)}><Trash2 size={14}/> حذف</button></div>
    </article>)}</div>}
    {confirmDelete && <div className="shared-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}><div className="shared-modal"><h3>حذف فایل اشتراکی</h3><p>آیا از حذف فایل «{confirmDelete.file_name}» مطمئن هستید؟ فایل از Storage سرور حذف می‌شود.</p><div><button onClick={() => setConfirmDelete(null)}>خیر</button><button className="danger" disabled={busy} onClick={() => handleDelete(confirmDelete)}>بله، حذف شود</button></div></div></div>}
  </section>;
}

function formatSize(size) {
  const n = Number(size || 0);
  if (n < 1024) return `${formatNumber(n)} بایت`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024)} KB`;
  return `${formatNumber(n / 1024 / 1024)} MB`;
}
