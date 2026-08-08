import { Fragment, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Edit3,
  FileText,
  MoreVertical,
  Package,
  Printer,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { useWarehouseData, useWarehouseDocumentLines, useWarehouseKardex } from '../../hooks/useWarehouseData';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import { formatJalaliDate } from '../../lib/formatters';
import {
  cancelDraftWarehouseDocument,
  createWarehouseItem,
  createWarehouseReferral,
  createWarehouseSnapshot,
  deactivateWarehouseItem,
  downloadCsv,
  downloadExcelHtml,
  downloadWordHtml,
  finalizeWarehouseDocument,
  openPrintable,
  parseCsvText,
  recordStockMovement,
  removeWarehouseDocumentLine,
  updateWarehouseDocumentLine,
  updateWarehouseDocumentMeta,
  updateWarehouseItem,
} from '../../lib/warehouseApi';
import './WarehouseModule.css';

const GROUPS = ['Bobbin', 'Core', 'Wire', 'PCB', 'Finished', 'Packaging', 'Toroidal Core', 'core'];
const REASONS = {
  manual_in: 'ورود دستی', manual_out: 'خروج دستی', production_start: 'شروع تولید', production_output: 'خروجی تولید', order_delivery: 'تحویل سفارش', count_correction: 'اصلاح شمارش', other: 'سایر'
};
const TYPE_LABEL = { in: 'ورود', out: 'خروج' };
const STATUS_LABEL = { draft: 'موقت', final: 'نهایی', cancelled: 'لغوشده' };

export default function WarehouseModule() {
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState('low');

  const data = useWarehouseData();
  const kardex = useWarehouseKardex(selectedItemId);
  const documentLines = useWarehouseDocumentLines(selectedDocumentId);
  const selectedDocument = data.documents.find((d) => d.id === selectedDocumentId);
  const draft = data.draftDocument;
  const draftDocuments = data.draftDocuments || [];

  const filteredStock = useMemo(() => data.stock.filter((i) => {
    const text = `${i.item_code} ${i.item_name_fa} ${i.item_group || i.category || ''} ${i.location || ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (groupFilter === 'all' || (i.item_group || i.category) === groupFilter)
      && (statusFilter === 'all' || (statusFilter === 'low' && i.is_low_stock) || (statusFilter === 'available' && Number(i.current_qty) > 0));
  }), [data.stock, query, groupFilter, statusFilter]);

  const kpis = useMemo(() => ({
    items: data.stock.length,
    low: data.stock.filter((i) => i.is_low_stock).length,
    draft: data.draftLines.length,
    docs: data.documents.filter((d) => d.status === 'final').length,
    inDocs: data.documents.filter((d) => d.type === 'in').length,
    outDocs: data.documents.filter((d) => d.type === 'out').length,
    refs: data.referrals.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length,
    value: data.stock.reduce((s, i) => s + Number(i.stock_value_estimate || 0), 0),
  }), [data]);

  async function runAction(fn, ok) {
    setBusy(true); setNotice('');
    try {
      await fn();
      setNotice(ok);
      setModal(null);
      await data.refetch();
      await kardex.refetch?.();
      await documentLines.refetch?.();
    } catch (e) {
      setNotice(e.message || 'خطا در عملیات انبار');
    } finally {
      setBusy(false);
    }
  }

  function handleDraftClick(doc = draft) {
    if (!doc) return;
    setSelectedDocumentId(doc.id);
    setTab('docs');
  }

  function exportStock(kind = 'csv') {
    const headers = ['کد', 'نام', 'گروه', 'واحد', 'مکان', 'قیمت مرجع', 'جمع ورود', 'جمع خروج', 'موجودی', 'نقطه سفارش', 'ارزش', 'وضعیت'];
    const rows = filteredStock.map((i) => [i.item_code, i.item_name_fa, i.item_group || i.category, i.unit, i.location, i.unit_price_estimate, i.total_in, i.total_out, i.current_qty, i.reorder_point || i.min_stock_threshold, i.stock_value_estimate, i.is_low_stock ? 'کم موجود' : 'موجود']);
    if (kind === 'excel') downloadExcelHtml('warehouse-stock.xls', headers, rows, 'گزارش موجودی انبار');
    else downloadCsv('warehouse-stock.csv', [headers, ...rows]);
  }

  function printStock() {
    const rows = filteredStock.map((i) => `<tr><td>${safe(i.item_code)}</td><td>${safe(i.item_name_fa)}</td><td>${safe(i.unit)}</td><td>${i.current_qty}</td><td>${i.reorder_point || i.min_stock_threshold}</td><td>${i.is_low_stock ? 'کم موجود' : 'موجود'}</td></tr>`).join('');
    openPrintable('موجودی انبار', `<h1>موجودی انبار</h1><table><thead><tr><th>کد</th><th>نام</th><th>واحد</th><th>موجودی</th><th>نقطه سفارش</th><th>وضعیت</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function printDocument(doc, rows = []) {
    const bodyRows = rows.map((l, idx) => `<tr><td>${idx + 1}</td><td>${safe(l.warehouse_items?.item_code || '—')}</td><td>${safe(l.warehouse_items?.item_name_fa || '—')}</td><td>${l.quantity}</td><td>${safe(REASONS[l.reason] || l.reason || '—')}</td><td>${safe(l.note || '—')}</td></tr>`).join('');
    openPrintable(`سند ${TYPE_LABEL[doc.type] || doc.type}`, `<h1>سند ${TYPE_LABEL[doc.type] || doc.type} ${doc.doc_number || 'موقت'}</h1><div class="meta"><div><b>وضعیت:</b> ${STATUS_LABEL[doc.status] || doc.status}</div><div><b>تاریخ:</b> ${formatDate(doc.created_at)}</div><div><b>تعداد ردیف:</b> ${doc.line_count || rows.length}</div><div><b>جمع مقدار:</b> ${doc.total_quantity || '—'}</div></div><table><thead><tr><th>ردیف</th><th>کد</th><th>کالا</th><th>تعداد</th><th>دلیل</th><th>یادداشت</th></tr></thead><tbody>${bodyRows}</tbody></table>`);
  }

  function exportWarehouseReport(type, format = 'excel') {
    let title = 'گزارش انبار';
    let headers = [];
    let rows = [];
    if (type === 'low') {
      title = 'گزارش کم‌موجودی';
      headers = ['کد', 'کالا', 'موجودی', 'نقطه سفارش', 'مکان'];
      rows = data.stock.filter((i) => i.is_low_stock).map((i) => [i.item_code, i.item_name_fa, i.current_qty, i.reorder_point || i.min_stock_threshold, i.location || '—']);
    } else if (type === 'docs') {
      title = 'گزارش اسناد انبار';
      headers = ['شماره', 'نوع', 'وضعیت', 'مشتری', 'شرح', 'تاریخ', 'ردیف', 'جمع مقدار'];
      rows = data.documents.map((d) => [d.doc_number || 'موقت', TYPE_LABEL[d.type] || d.type, STATUS_LABEL[d.status] || d.status, d.customer_name || '—', d.note || '—', formatDate(d.created_at), d.line_count, d.total_quantity]);
    } else {
      title = 'گزارش ارزش موجودی';
      headers = ['کد', 'کالا', 'موجودی', 'قیمت مرجع', 'ارزش'];
      rows = data.stock.map((i) => [i.item_code, i.item_name_fa, i.current_qty, i.unit_price_estimate, i.stock_value_estimate]);
    }
    if (format === 'word') {
      const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td>${safe(c)}</td>`).join('')}</tr>`).join('');
      downloadWordHtml(`${type}-warehouse-report.doc`, title, `<h1>${title}</h1><table><thead><tr>${headers.map((h) => `<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`);
    } else {
      downloadExcelHtml(`${type}-warehouse-report.xls`, headers, rows, title);
    }
  }

  function quickStocktake(item) {
    const real = window.prompt(`موجودی واقعی شمارش‌شده برای ${item.item_name_fa}`, String(item.current_qty || 0));
    if (real === null) return;
    const diff = Number(real) - Number(item.current_qty || 0);
    if (!diff) return setNotice('موجودی با شمارش برابر است.');
    runAction(() => recordStockMovement({ itemId: item.item_id, direction: diff > 0 ? 'in' : 'out', quantity: Math.abs(diff), reason: 'count_correction', note: 'انبارگردانی سریع' }), 'انبارگردانی سریع در سند موقت ثبت شد.');
  }

  return <div className="warehouse-page" dir="rtl">
    <header className="warehouse-hero">
      <div>
        <div className="eyebrow">Warehouse · Kardex · Documents</div>
        <h1>انبارداری</h1>
        <p>موجودی، اسناد ورود/خروج، کاردکس کالا، سند موقت ورود/خروج، همگام‌سازی انبارا و گزارش‌های قابل خروجی.</p>
      </div>
      <div className="warehouse-actions">
        <button onClick={data.refetch}><RefreshCw size={16}/> به‌روزرسانی</button>
        <button className="primary" onClick={() => setModal({ type: 'item' })}>＋ کالای جدید</button>
        <button onClick={() => setModal({ type: 'import' })}><Upload size={16}/> ورود از اکسل</button>
      </div>
    </header>

    {draftDocuments.some((d) => (data.draftLinesByDocument?.[d.id] || []).length > 0) && <div className="warehouse-draft-top-wrap">
      {draftDocuments.filter((d) => (data.draftLinesByDocument?.[d.id] || []).length > 0).map((doc) => <button key={doc.id} className={`warehouse-draft-top ${doc.type}`} onClick={() => handleDraftClick(doc)}>
        <span>سند موقت {TYPE_LABEL[doc.type] || doc.type}</span>
        <b>{(data.draftLinesByDocument?.[doc.id] || []).length} ردیف</b>
        <small>{doc.customer_name || 'بدون مشتری'} · برای مشاهده، ویرایش، تأیید یا لغو کلیک کنید</small>
      </button>)}
    </div>}

    {notice && <div className="warehouse-message">{notice}</div>}
    {data.loading && <div className="warehouse-message">در حال دریافت اطلاعات انبار...</div>}
    {data.error && <div className="warehouse-message error">{data.error.message}</div>}

    {modal?.type === 'item' && <ItemModal initial={modal.item} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => modal.item ? updateWarehouseItem(modal.item.item_id, payload) : createWarehouseItem(payload), modal.item ? 'کالا ویرایش شد.' : 'کالا ثبت شد.')} />}
    {modal?.type === 'movement' && <MovementModal item={modal.item} direction={modal.direction} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => recordStockMovement(payload), modal.direction === 'in' ? 'به سند موقت ورود اضافه شد.' : 'به سند موقت خروج اضافه شد.')} />}
    {modal?.type === 'import' && <ImportModal busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createWarehouseSnapshot(payload), 'Snapshot اکسل ثبت شد.')} />}
    {modal?.type === 'referral' && <ReferralModal busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createWarehouseReferral(payload), 'ارجاع انبار ثبت شد.')} />}

    <nav className="warehouse-tabs">{[['overview','نمای کلی'],['stock','موجودی'],['docs','اسناد'],['kardex','کاردکس'],['sync','همگام‌سازی انبارا'],['refs','ارجاعات'],['reports','گزارش‌ها'],['settings','تنظیمات']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</nav>

    {!data.loading && tab === 'overview' && <Overview kpis={kpis} stock={data.stock} docs={data.documents} refs={data.referrals} setTab={setTab} />}
    {!data.loading && tab === 'stock' && <StockSection stock={filteredStock} query={query} setQuery={setQuery} groupFilter={groupFilter} setGroupFilter={setGroupFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} selectedItemId={selectedItemId} kardexRows={kardex.rows} busy={busy} onIn={(item)=>setModal({type:'movement',item,direction:'in'})} onOut={(item)=>setModal({type:'movement',item,direction:'out'})} onOpenKardex={(item)=>{setSelectedItemId(item.item_id);setTab('kardex')}} onEdit={(item)=>setModal({type:'item',item})} onStocktake={(item)=>quickStocktake(item)} onDeactivate={(item)=>runAction(()=>deactivateWarehouseItem(item.item_id),'کالا غیرفعال شد.')} exportStock={exportStock} printStock={printStock}/>} 
    {!data.loading && tab === 'docs' && <DocumentsSection docs={data.documents} draftDocuments={draftDocuments} draftLinesByDocument={data.draftLinesByDocument || {}} selectedDocument={selectedDocument} lines={selectedDocument && data.draftLinesByDocument?.[selectedDocument.id] ? data.draftLinesByDocument[selectedDocument.id] : documentLines.rows} busy={busy} onSelect={setSelectedDocumentId} onFinalize={(id)=>runAction(()=>finalizeWarehouseDocument(id),'سند ثبت نهایی شد.')} onCancel={(id)=>runAction(()=>cancelDraftWarehouseDocument(id),'سند موقت لغو شد.')} onUpdateMeta={(id, meta)=>runAction(()=>updateWarehouseDocumentMeta(id, meta),'اطلاعات سند ذخیره شد.')} onUpdateLine={(id,q)=>runAction(()=>updateWarehouseDocumentLine(id,q),'ردیف سند اصلاح شد.')} onRemoveLine={(id)=>runAction(()=>removeWarehouseDocumentLine(id),'ردیف سند حذف/اصلاح شد.')} onPrint={printDocument} setTab={setTab} />}
    {!data.loading && tab === 'kardex' && <KardexSection stock={data.stock} selectedItemId={selectedItemId} setSelectedItemId={setSelectedItemId} rows={kardex.rows} />}
    {!data.loading && tab === 'sync' && <SyncSection snapshots={data.snapshots} matched={data.matched} unmatched={data.unmatched} inactiveItems={data.inactiveItems} onImport={()=>setModal({type:'import'})} />}
    {!data.loading && tab === 'refs' && <div className="warehouse-grid"><ReferralPanel sourceModule="warehouse" title="ارجاعات انبار" defaultTarget="accounting" /></div>}
    {!data.loading && tab === 'reports' && <ReportsSection report={report} setReport={setReport} stock={data.stock} docs={data.documents} onExport={exportWarehouseReport} />}
    {!data.loading && tab === 'settings' && <SettingsSection />}
  </div>;
}

function Overview({ kpis, stock, docs, refs, setTab }) {
  const recentDocs = docs.slice(0, 4);
  return <>
    <section className="warehouse-kpis tuned">
      <Kpi icon="📦" label="تعداد کالا" value={kpis.items}/>
      <Kpi icon="📉" label="کم‌موجود" value={kpis.low} danger/>
      <Kpi icon="🧾" label="ردیف سند موقت" value={kpis.draft} warning/>
      <Kpi icon="📥" label="اسناد ورود" value={kpis.inDocs}/>
      <Kpi icon="📤" label="اسناد خروج" value={kpis.outDocs}/>
      <Kpi icon="💰" label="ارزش موجودی" value={formatMoney(kpis.value)} success/>
    </section>
    <div className="warehouse-grid three overview-cards">
      <section className="warehouse-card"><CardTitle icon={AlertTriangle} title="کم‌موجودی و سفارش مجدد" action={<button onClick={()=>setTab('stock')}>موجودی</button>} />{stock.filter(i=>i.is_low_stock).length? <div className="warehouse-timeline compact">{stock.filter(i=>i.is_low_stock).slice(0,6).map(i=><article key={i.item_id}><strong>{i.item_name_fa}</strong><small>{i.item_code} · موجودی {i.current_qty} · نقطه سفارش {i.reorder_point||i.min_stock_threshold}</small></article>)}</div>:<Empty/>}</section>
      <section className="warehouse-card"><CardTitle icon={FileText} title="آخرین اسناد" action={<button onClick={()=>setTab('docs')}>اسناد</button>} />{recentDocs.length?<div className="doc-mini-list">{recentDocs.map(d=><button key={d.id} onClick={()=>setTab('docs')}><b>{d.doc_number || 'سند موقت'}</b><span>{TYPE_LABEL[d.type]} · {STATUS_LABEL[d.status]} · {formatDate(d.created_at)}</span></button>)}</div>:<Empty/>}</section>
      <section className="warehouse-card"><CardTitle icon={ClipboardList} title="ارجاعات باز" action={<button onClick={()=>setTab('refs')}>همه</button>} />{refs.length?<div className="warehouse-timeline compact">{refs.slice(0,6).map(r=><article key={r.id}><strong>{r.title_fa}</strong><small>{r.referral_number} · {r.source_module} ← {r.target_module}</small></article>)}</div>:<Empty/>}</section>
    </div>
  </>;
}
function Kpi({icon,label,value,danger,warning,success}){return <div className={`warehouse-kpi ${danger?'danger':warning?'warning':success?'success':''}`}><i>{icon}</i><span>{label}</span><b>{value}</b></div>}

function StockSection({ stock, query, setQuery, groupFilter, setGroupFilter, statusFilter, setStatusFilter, busy, onIn, onOut, onOpenKardex, onEdit, onStocktake, onDeactivate, exportStock, printStock }) {
  const [menuId, setMenuId] = useState(null);
  return <section className="warehouse-card stock-card-anbara">
    <div className="section-head"><CardTitle icon={Package} title="موجودی کالاها"/><div><button onClick={()=>exportStock('excel')}>خروجی موجودی</button><button onClick={printStock}>چاپ برچسب/موجودی</button></div></div>
    <div className="filters anbara-toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجوی کد کالا، نام کالا، مکان..."/><select value={groupFilter} onChange={e=>setGroupFilter(e.target.value)}><option value="all">همه گروه‌ها</option>{GROUPS.map(g=><option key={g}>{g}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option><option value="low">کم‌موجود</option><option value="available">موجود</option></select></div>
    <div className="warehouse-table-wrap stock-scroll"><table className="compact-stock-table"><thead><tr><th>کد کالا</th><th>نام کالا</th><th>گروه</th><th>واحد</th><th>مکان</th><th>موجودی</th><th>نقطه سفارش</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{stock.map(i=><tr key={i.item_id}><td dir="ltr"><span className="code-pill">{i.item_code}</span></td><td className="item-name-cell">{i.item_name_fa}</td><td>{i.item_group||i.category||'—'}</td><td>{i.unit}</td><td>{i.location||'—'}</td><td className={i.is_low_stock?'negative':'positive'}><b>{i.current_qty}</b></td><td>{i.reorder_point||i.min_stock_threshold}</td><td>{i.is_low_stock?<span className="low-badge">کم موجود</span>:<span className="ok-badge">موجود</span>}</td><td className="stock-actions-cell"><button className="plus" disabled={busy} onClick={()=>onIn(i)}>＋</button><button className="minus" disabled={busy} onClick={()=>onOut(i)}>−</button><span className="stock-menu-wrap"><button className="more" onClick={()=>setMenuId(menuId===i.item_id?null:i.item_id)}><MoreVertical size={16}/></button>{menuId===i.item_id&&<div className="stock-popover"><button onClick={()=>{onOpenKardex(i);setMenuId(null)}}>مشاهده کاردکس</button><button onClick={()=>{onStocktake(i);setMenuId(null)}}>انبارگردانی سریع</button><button onClick={()=>{onEdit(i);setMenuId(null)}}>ویرایش</button><button className="danger" onClick={()=>{onDeactivate(i);setMenuId(null)}}>حذف/غیرفعال</button></div>}</span></td></tr>)}</tbody></table></div>
  </section>;
}

function KardexSection({stock,selectedItemId,setSelectedItemId,rows}){
  const [search,setSearch]=useState('');
  const filtered=useMemo(()=>stock.filter(i=>`${i.item_code||''} ${i.item_name_fa||''}`.toLowerCase().includes(search.toLowerCase())),[stock,search]);
  const selected=stock.find(i=>i.item_id===selectedItemId);
  return <section className="warehouse-card kardex-page-card"><CardTitle icon={ClipboardList} title="کاردکس کالا"/><div className="filters kardex-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="جست‌وجوی کد یا نام کالا..."/><select value={selectedItemId||''} onChange={e=>setSelectedItemId(e.target.value)}><option value="">انتخاب کالا برای کاردکس</option>{filtered.map(i=><option key={i.item_id} value={i.item_id}>{i.item_code} · {i.item_name_fa}</option>)}</select></div>{selected&&<div className="selected-kardex-head"><b>{selected.item_code} · {selected.item_name_fa}</b><span>موجودی فعلی: {selected.current_qty} {selected.unit}</span></div>}{rows.length?<div className="warehouse-table-wrap kardex-table"><table><thead><tr><th>تاریخ</th><th>سند</th><th>نوع</th><th>مقدار</th><th>مانده</th><th>یادداشت</th></tr></thead><tbody>{rows.slice().reverse().map(r=><tr key={r.tx_id}><td>{formatDate(r.created_at)}</td><td dir="ltr">{r.doc_number||'موقت'}</td><td><span className={`doc-type ${r.direction}`}>{r.direction==='out'?'خروج':'ورود'}</span></td><td>{r.quantity}</td><td>{r.running_balance}</td><td>{r.note||'—'}</td></tr>)}</tbody></table></div>:<Empty text={selected?'کاردکسی برای این کالا ثبت نشده است.':'ابتدا کالا را جست‌وجو و انتخاب کنید.'}/>}</section>
}

function DocumentsSection({ docs, draftDocuments, draftLinesByDocument, selectedDocument, lines, busy, onSelect, onFinalize, onCancel, onUpdateMeta, onUpdateLine, onRemoveLine, onPrint, setTab }) {
  const draftsWithLines = draftDocuments.filter((d)=>(draftLinesByDocument[d.id]||[]).length>0);
  return <div className="warehouse-grid docs-layout">
    {draftsWithLines.length>0 && <section className="drafts-board">{draftsWithLines.map((doc)=><article key={doc.id} className={`warehouse-card draft-document-card ${doc.type}`}><div className="draft-card-head"><div><span>سند موقت {TYPE_LABEL[doc.type]}</span><h2>{(draftLinesByDocument[doc.id]||[]).length} ردیف آماده ثبت</h2><p>ردیف‌ها قابل کم/زیاد شدن، ویرایش و حذف هستند.</p></div><div className="draft-actions"><button disabled={busy} onClick={()=>onFinalize(doc.id)}>ثبت نهایی سند {TYPE_LABEL[doc.type]}</button><button disabled={busy} onClick={()=>onCancel(doc.id)}>انصراف از سند موقت</button><button onClick={()=>setTab('stock')}>＋ افزودن ردیف از موجودی</button></div></div><DocumentMetaForm doc={doc} busy={busy} onSave={onUpdateMeta}/><DocumentLines rows={draftLinesByDocument[doc.id]||[]} busy={busy} onUpdate={onUpdateLine} onRemove={onRemoveLine}/></article>)}</section>}
    <section className="warehouse-card docs-table-card"><CardTitle icon={FileText} title="لیست اسناد ورود/خروج" />{docs.length?<div className="warehouse-table-wrap"><table><thead><tr><th>شماره سند</th><th>نوع سند</th><th>وضعیت</th><th>مشتری</th><th>تاریخ</th><th>شرح</th><th>عملیات</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}><td dir="ltr"><span className="doc-number-pill">{d.doc_number||'موقت'}</span></td><td><span className={`doc-type ${d.type}`}>{TYPE_LABEL[d.type]||d.type}</span></td><td>{STATUS_LABEL[d.status]||d.status}</td><td>{d.customer_name||'—'}</td><td>{formatDate(d.created_at)}</td><td>{d.note||'—'}</td><td className="doc-actions"><button title="جزئیات/ویرایش" onClick={()=>onSelect(d.id)}><FileText size={15}/></button><button title="چاپ" onClick={()=>onPrint(d, selectedDocument?.id===d.id?lines:[])}><Printer size={15}/></button><button className="danger" title={d.status==='draft'?'حذف سند موقت':'حذف اصلاحی از جزئیات'} onClick={()=>d.status==='draft'?onCancel(d.id):onSelect(d.id)}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>:<Empty/>}</section>
    {selectedDocument && <section className="warehouse-card selected-doc-card"><CardTitle icon={ClipboardList} title={`جزئیات ${selectedDocument.doc_number || 'سند موقت'}`} action={<button onClick={()=>onPrint(selectedDocument, lines)}>چاپ سند</button>} /><DocumentMetaForm doc={selectedDocument} busy={busy} onSave={onUpdateMeta}/><DocumentLines rows={lines} busy={busy} onUpdate={onUpdateLine} onRemove={onRemoveLine}/></section>}
  </div>;
}

function DocumentMetaForm({ doc, busy, onSave }) {
  const [customerName,setCustomerName]=useState(doc.customer_name||'');
  const [note,setNote]=useState(doc.note||'');
  return <div className="document-meta-form"><label><span>نام مشتری / تحویل‌گیرنده</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="نام مشتری یا واحد مقصد"/></label><label><span>شرح کلی سند</span><input value={note} onChange={e=>setNote(e.target.value)} placeholder="شرح کلی برای این سند"/></label><button disabled={busy} onClick={()=>onSave(doc.id,{customerName,note})}>ذخیره اطلاعات سند</button></div>
}

function DocumentLines({title, rows, busy, onUpdate, onRemove}){return <div className="doc-lines">{title&&<h3>{title}</h3>}<div className="warehouse-table-wrap"><table><thead><tr><th>ردیف</th><th>کد</th><th>کالا</th><th>تعداد</th><th>دلیل</th><th>یادداشت</th><th>عملیات</th></tr></thead><tbody>{rows.map((l,idx)=><tr key={l.id}><td>{idx+1}</td><td dir="ltr">{l.warehouse_items?.item_code||'—'}</td><td>{l.warehouse_items?.item_name_fa||'—'}</td><td>{l.quantity} {l.warehouse_items?.unit||''}</td><td>{REASONS[l.reason]||l.reason}</td><td>{l.note||'—'}</td><td><button disabled={busy} onClick={()=>{const q=prompt('مقدار جدید',l.quantity); if(q) onUpdate(l.id,q)}}>ویرایش</button><button disabled={busy} onClick={()=>onRemove(l.id)}>حذف</button></td></tr>)}</tbody></table></div></div>}
function SyncSection({snapshots,matched,unmatched,inactiveItems,onImport}){
  const [open,setOpen]=useState('matched');
  return <div className="warehouse-grid sync-grid"><section className="warehouse-card"><CardTitle icon={Upload} title="همگام‌سازی با انبارا" action={<button onClick={onImport}>ورود از اکسل</button>}/>{snapshots.length?<div className="warehouse-table-wrap"><table><thead><tr><th>فایل</th><th>تاریخ</th><th>ردیف</th><th>یادداشت</th></tr></thead><tbody>{snapshots.map(s=><tr key={s.id}><td>{s.file_name}</td><td>{formatDate(s.imported_at)}</td><td>{s.row_count}</td><td>{s.notes||'—'}</td></tr>)}</tbody></table></div>:<Empty/>}</section><section className="warehouse-card sync-status-card"><CardTitle icon={AlertTriangle} title="بررسی وضعیت همگام‌سازی"/><div className="sync-status-buttons"><button className={open==='matched'?'active':''} onClick={()=>setOpen(open==='matched'?'': 'matched')}>کالاهای هماهنگ‌شده <b>{matched.length}</b></button><button className={open==='unmatched'?'active':''} onClick={()=>setOpen(open==='unmatched'?'': 'unmatched')}>کالاهای مچ‌نشده <b>{unmatched.length}</b></button><button className={open==='inactive'?'active':''} onClick={()=>setOpen(open==='inactive'?'': 'inactive')}>غیرفعال/حذف‌شده <b>{inactiveItems.length}</b></button></div>{open==='matched'&&<SimpleSyncTable rows={matched} empty="کالای هماهنگ‌شده‌ای در آخرین فایل‌ها نیست."/>}{open==='unmatched'&&<SimpleSyncTable rows={unmatched} empty="کالای مچ‌نشده نداریم."/>}{open==='inactive'&&<InactiveItems rows={inactiveItems}/>}</section></div>
}
function SimpleSyncTable({rows,empty}){return rows.length?<div className="warehouse-table-wrap sync-detail-table"><table><thead><tr><th>کد</th><th>تعداد</th><th>واحد</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td dir="ltr">{u.item_code}</td><td>{u.quantity}</td><td>{u.unit}</td></tr>)}</tbody></table></div>:<Empty text={empty}/>}
function InactiveItems({rows}){return rows.length?<div className="warehouse-table-wrap sync-detail-table"><table><thead><tr><th>کد</th><th>کالا</th><th>گروه</th><th>واحد</th><th>مکان</th></tr></thead><tbody>{rows.map(i=><tr key={i.id}><td dir="ltr">{i.item_code}</td><td>{i.item_name_fa}</td><td>{i.category||'—'}</td><td>{i.unit}</td><td>{i.location||'—'}</td></tr>)}</tbody></table></div>:<Empty text="کالای غیرفعال/حذف‌شده‌ای ثبت نشده است."/>}

function ReportsSection({report,setReport,stock,docs,onExport}){
  const [format,setFormat]=useState('excel');
  const low=stock.filter(i=>i.is_low_stock), value=stock.reduce((sum,i)=>sum+Number(i.stock_value_estimate||0),0);
  return <section className="warehouse-card reports-full"><div className="reports-head"><CardTitle icon={BarChart3} title="گزارش‌های انبار"/><div className="report-format"><span>نوع خروجی</span><select value={format} onChange={e=>setFormat(e.target.value)}><option value="excel">Excel</option><option value="word">Word</option></select></div></div><div className="report-cards"><button className={report==='low'?'active':''} onClick={()=>setReport('low')}><b>کم‌موجودی</b><span>{low.length} کالا زیر نقطه سفارش</span></button><button className={report==='value'?'active':''} onClick={()=>setReport('value')}><b>ارزش موجودی</b><span>{formatMoney(value)}</span></button><button className={report==='docs'?'active':''} onClick={()=>setReport('docs')}><b>اسناد</b><span>{docs.length} سند ورود/خروج</span></button></div><div className="report-output clean"><h3>{report==='low'?'گزارش کم‌موجودی':report==='docs'?'گزارش اسناد':'گزارش ارزش موجودی'}</h3>{report==='low'&&<p>{low.length} کالای کم‌موجود داریم.</p>}{report==='value'&&<p>ارزش برآوردی موجودی: {formatMoney(value)}</p>}{report==='docs'&&<p>تعداد اسناد: {docs.length}</p>}<button onClick={()=>onExport(report,format)}>دریافت خروجی {format==='excel'?'Excel':'Word'}</button></div></section>
}

function SettingsSection(){return <section className="warehouse-card"><CardTitle icon={Settings} title="تنظیمات انبار"/><div className="settings-grid"><Info title="سند موقت ورود/خروج" text="ورود و خروج هر دو ابتدا در سند موقت ثبت می‌شوند."/><Info title="شماره‌گذاری" text="WH-IN و WH-OUT با شماره خودکار هنگام ثبت نهایی ساخته می‌شود."/><Info title="حذف نرم کالا" text="کالا غیرفعال می‌شود و تاریخچه حفظ می‌شود."/><Info title="اتصال ماژول‌ها" text="سفارش و تولید از توابع سیستمی حرکت انبار استفاده می‌کنند."/></div></section>}
function ItemModal({initial,busy,onClose,onSubmit}){const [form,setForm]=useState({item_code:initial?.item_code||'',item_name_fa:initial?.item_name_fa||'',item_group:initial?.item_group||initial?.category||'Bobbin',unit:initial?.unit||'عدد',location:initial?.location||'',reorder_point:initial?.reorder_point||initial?.min_stock_threshold||0,unit_price_estimate:initial?.unit_price_estimate||0,stock_quantity:initial?.current_qty ?? 0,current_qty_snapshot:initial?.current_qty ?? 0});return <Modal title={initial?'ویرایش کالا':'کالای جدید'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(form)}}><div className="form-grid"><label><span>کد کالا</span><input disabled={!!initial} value={form.item_code} onChange={e=>setForm({...form,item_code:e.target.value})} required/></label><label><span>نام کالا</span><input value={form.item_name_fa} onChange={e=>setForm({...form,item_name_fa:e.target.value})} required/></label><label><span>گروه</span><select value={form.item_group} onChange={e=>setForm({...form,item_group:e.target.value})}>{GROUPS.map(g=><option key={g}>{g}</option>)}</select></label><label><span>واحد</span><input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}/></label><label><span>مکان</span><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label><label><span>تعداد موجودی</span><input type="number" value={form.stock_quantity} onChange={e=>setForm({...form,stock_quantity:e.target.value})}/></label><label><span>نقطه سفارش</span><input type="number" value={form.reorder_point} onChange={e=>setForm({...form,reorder_point:e.target.value})}/></label><label><span>قیمت مرجع ریال</span><input type="number" value={form.unit_price_estimate} onChange={e=>setForm({...form,unit_price_estimate:e.target.value})}/></label></div><div className="note">تغییر تعداد موجودی به صورت ردیف اصلاحی در سند موقت ثبت می‌شود و بعد از تأیید سند نهایی خواهد شد.</div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت</button></div></form></Modal>}

function MovementModal({item,direction,busy,onClose,onSubmit}){const [quantity,setQuantity]=useState(1),[reason,setReason]=useState(direction==='in'?'manual_in':'manual_out'),[note,setNote]=useState('');return <Modal title={`${direction==='in'?'ورود':'خروج'} سریع ${item.item_name_fa}`} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit({itemId:item.item_id,direction,quantity,reason,note})}}><div className="form-grid"><label><span>مقدار</span><input type="number" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label><label><span>دلیل</span><select value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(REASONS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="full"><span>یادداشت</span><textarea value={note} onChange={e=>setNote(e.target.value)}/></label></div><div className="note">بعد از ثبت، این ردیف در سند موقت {direction==='in'?'ورود':'خروج'} قرار می‌گیرد و از بالای صفحه قابل مشاهده و تأیید است.</div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">افزودن به سند موقت</button></div></form></Modal>}
function ImportModal({busy,onClose,onSubmit}){
  const [fileName,setFileName]=useState('');
  const [rows,setRows]=useState([]);
  const [text,setText]=useState('item_code,item_name_fa,item_group,unit,location,quantity,reorder_point,unit_price_estimate\nTR-220-12,ترانس سفارشی,Finished,عدد,A1,5,2,740000000\nPCB-CTRL,برد کنترلر,PCB,عدد,B2,10,3,110000000');
  function loadRowsFromText(value){setText(value);setRows(parseCsvText(value));setFileName('manual-import.csv')}
  function handleFile(e){const file=e.target.files?.[0];if(!file)return;setFileName(file.name);const reader=new FileReader();reader.onload=(ev)=>{const data=ev.target.result;let parsed=[];if(file.name.toLowerCase().endsWith('.csv')){const txt=new TextDecoder('utf-8').decode(new Uint8Array(data));setText(txt);parsed=parseCsvText(txt)}else{const wb=XLSX.read(data,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];parsed=XLSX.utils.sheet_to_json(ws,{defval:''});setText('')};setRows(parsed)};reader.readAsArrayBuffer(file)}
  const preview=rows.slice(0,8);
  return <Modal title="ورود از اکسل/CSV انبارا" onClose={onClose}><div className="note">قالب استاندارد: item_code, item_name_fa, item_group, unit, location, quantity, reorder_point, unit_price_estimate. فایل Excel/CSV با همین ستون‌ها وارد شود؛ کالاها بر اساس کد کالا به‌روزرسانی و Snapshot موجودی ثبت می‌شود.</div><div className="import-tools"><a className="template-link" href="/templates/warehouse_import_template.xlsx" download>دانلود قالب Excel نمونه</a><button type="button" onClick={()=>downloadCsv('warehouse_import_template.csv',[['item_code','item_name_fa','item_group','unit','location','quantity','reorder_point','unit_price_estimate'],['TR-220-12','ترانس سفارشی','Finished','عدد','A1','5','2','740000000']])}>دانلود CSV نمونه</button><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}/></div><textarea className="import-text" value={text} onChange={e=>loadRowsFromText(e.target.value)} placeholder="یا محتوای CSV را اینجا paste کنید"/>{preview.length>0&&<div className="warehouse-table-wrap import-preview"><table><thead><tr><th>کد</th><th>نام</th><th>گروه</th><th>واحد</th><th>مکان</th><th>تعداد</th><th>نقطه سفارش</th><th>قیمت</th></tr></thead><tbody>{preview.map((r,i)=><tr key={i}><td dir="ltr">{r.item_code}</td><td>{r.item_name_fa}</td><td>{r.item_group}</td><td>{r.unit}</td><td>{r.location}</td><td>{r.quantity}</td><td>{r.reorder_point}</td><td>{r.unit_price_estimate}</td></tr>)}</tbody></table></div>}<div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy||rows.length===0} onClick={()=>onSubmit({fileName:fileName||'manual-import.csv',rows,notes:'Warehouse Excel/CSV import'})}>ثبت Snapshot ({rows.length})</button></div></Modal>}
function ReferralModal({busy,onClose,onSubmit}){const [title,setTitle]=useState('درخواست بررسی/خرید انبار'),[target,setTarget]=useState('accounting'),[role,setRole]=useState('accountant');return <Modal title="ارجاع انبار" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit({title,targetModule:target,targetRole:role})}}><div className="form-grid"><label><span>مقصد</span><select value={target} onChange={e=>{setTarget(e.target.value);setRole(e.target.value==='accounting'?'accountant':e.target.value==='orders'?'sales':e.target.value==='production'?'production':'admin')}}><option value="accounting">مالی</option><option value="orders">سفارش‌ها</option><option value="production">تولید</option><option value="admin">مدیر کل</option></select></label><label className="full"><span>عنوان</span><input value={title} onChange={e=>setTitle(e.target.value)} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت ارجاع</button></div></form></Modal>}
function Modal({title,onClose,children}){return <div className="warehouse-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="warehouse-modal"><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>}
function CardTitle({icon:Icon,title,action}){return <div className="warehouse-card-title"><span><Icon size={18}/><b>{title}</b></span>{action}</div>}function Info({title,text}){return <div className="warehouse-info"><span>{title}</span><b>{text??'—'}</b></div>}function Empty({text='داده‌ای برای نمایش نیست.'}){return <div className="warehouse-empty">{text}</div>}function formatDate(v){return formatJalaliDate(v)}function formatMoney(v){return `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(v||0)/10))} تومان`}function safe(value){return String(value ?? '').replace(/[&<>"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
