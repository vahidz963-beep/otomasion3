import { useEffect, useMemo, useState } from 'react';
import { Download, FileUp, RefreshCw, Share2 } from 'lucide-react';
import { downloadSharedFile, fetchSharedFiles, uploadSharedFile } from '../../lib/sharedFilesApi';
import { formatJalaliDateTime, formatNumber } from '../../lib/formatters';
import './SharedFilesPanel.css';

const MODULE_LABEL = {
  orders: 'سفارش‌ها', sales: 'فروش', rnd: 'R&D', production: 'تولید', warehouse: 'انبار', accounting: 'مالی', admin: 'اداری/مدیریت', office: 'اداری', manual: 'دستی'
};

export default function SharedFilesPanel({ sourceModule = 'manual', relatedOrderId = null, relatedRecordId = null, compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', file: null });
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => rows.filter((r) => {
    const text = `${r.file_name || ''} ${r.title_fa || ''} ${r.description_fa || ''} ${r.source_module || ''}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  }), [rows, query]);

  async function load() {
    setLoading(true); setError('');
    try { setRows(await fetchSharedFiles({ sourceModule, relatedOrderId, relatedRecordId })); }
    catch (e) { setError(e.message || 'خطا در دریافت فایل‌ها'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      await load();
    } catch (e) {
      setError(e.message || 'خطا در ثبت فایل');
    } finally { setBusy(false); }
  }

  return <section className={compact ? 'shared-files-panel compact' : 'shared-files-panel'}>
    <header>
      <div><h2><Share2 size={18}/> فایل‌های اشتراک‌گذاشته‌شده</h2><p>فایل‌هایی که سفارش، تولید، R&D، مالی، اداری و انبار برای هم به اشتراک می‌گذارند.</p></div>
      <div className="shared-actions"><button onClick={load}><RefreshCw size={14}/> به‌روزرسانی</button><button className="primary" onClick={() => setShowForm((v) => !v)}><FileUp size={14}/> ارسال فایل</button></div>
    </header>
    <div className="shared-toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی فایل..." /></div>
    {showForm && <form className="shared-form" onSubmit={submit}>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان فایل" />
      <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="شرح کوتاه" />
      <input type="file" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} required />
      <button disabled={busy || !form.file} type="submit">{busy ? 'در حال ارسال...' : 'ثبت فایل'}</button>
    </form>}
    {error && <div className="shared-error">{error}</div>}
    {loading ? <div className="shared-empty">در حال دریافت...</div> : filtered.length === 0 ? <div className="shared-empty">فایل اشتراکی وجود ندارد.</div> : <div className="shared-list">{filtered.map((r) => <article key={r.id}>
      <div><strong>{r.title_fa || r.file_name}</strong><small>{r.file_number || '—'} · فولدر {MODULE_LABEL[r.source_module] || r.source_module} · {formatJalaliDateTime(r.uploaded_at)} · {formatSize(r.file_size)}</small><small className="shared-path">{r.storage_path || 'فایل قدیمی/داخلی'}</small>{r.description_fa && <p>{r.description_fa}</p>}</div>
      <button onClick={() => handleDownload(r)}><Download size={14}/> دانلود</button>
    </article>)}</div>}
  </section>;
}

function formatSize(size) {
  const n = Number(size || 0);
  if (n < 1024) return `${formatNumber(n)} بایت`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024)} KB`;
  return `${formatNumber(n / 1024 / 1024)} MB`;
}
