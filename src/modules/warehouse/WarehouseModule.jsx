import { Fragment, useEffect, useMemo, useState } from 'react';
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
  Search,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { useWarehouseData, useWarehouseDocumentLines, useWarehouseKardex } from '../../hooks/useWarehouseData';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import JalaliDateInput from '../../components/JalaliDateInput';
import { formatJalaliDate, formatNumber, toEnglishDigits } from '../../lib/formatters';
import {
  cancelDraftWarehouseDocument,
  cancelWarehouseDocument,
  createWarehouseItem,
  createWarehouseReferral,
  createWarehouseSnapshot,
  createWarehouseShipment,
  updateWarehouseShipment,
  archiveWarehouseShipment,
  reverseWarehouseShipment,
  getWarehouseExchangeRates,
  refreshWarehouseExchangeRates,
  setWarehouseItemCurrencyPrice,
  convertAllWarehouseItemCurrency,
  deactivateWarehouseItem,
  downloadCsv,
  downloadExcelHtml,
  downloadWordHtml,
  fetchWarehouseDocumentLines,
  finalizeWarehouseDocument,
  openPrintable,
  parseCsvText,
  recordStockMovement,
  reactivateWarehouseItem,
  removeWarehouseDocumentLine,
  updateWarehouseDocumentLine,
  updateWarehouseDocumentMeta,
  updateWarehouseItem,
} from '../../lib/warehouseApi';
import { createWarehouseCategory, updateWarehouseCategory, archiveWarehouseCategory } from '../../lib/warehouseCategoryApi';
import { ItemKardexSection as AccountingItemKardexSection } from '../accounting/AccountingModule';
import './WarehouseModule.css';
import { getFriendlyErrorMessage, getTechnicalErrorMessage } from '../../lib/errorMessages';
import { shipmentLineText, shipmentLines, shipmentSearchText, shipmentSourceLabel, shipmentStats, shipmentStatusLabel, normalizeShipmentStatus } from '../../lib/shipmentModel';
import { supabase } from '../../lib/supabaseClient';

const REASONS = {
  manual_in: 'ورود دستی', manual_out: 'خروج دستی', production_start: 'شروع تولید', production_output: 'خروجی تولید', order_delivery: 'تحویل سفارش', count_correction: 'اصلاح شمارش', opening_balance: 'موجودی اول دوره', other: 'سایر'
};
const TYPE_LABEL = { in: 'ورود', out: 'خروج' };
const STATUS_LABEL = { draft: 'موقت', final: 'نهایی', cancelled: 'لغوشده' };

function warehouseDocumentLabel(document) {
  if (document?.document_kind === 'opening_balance') return 'اصلاحی موجودی اول دوره';
  if (document?.document_kind === 'adjustment') return 'اصلاح موجودی';
  return TYPE_LABEL[document?.type] || document?.type || 'انبار';
}

function isProtectedOpeningDocument(document) {
  return document?.document_kind === 'opening_balance' || Boolean(document?.source_snapshot_id);
}

function normalizeWarehouseSearch(value) {
  return toEnglishDigits(String(value ?? ''))
    .toLocaleLowerCase('fa')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200f\u202a-\u202e]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function warehouseDocumentMatchesSearch(document, query) {
  const normalized = normalizeWarehouseSearch(query);
  if (!normalized) return true;
  const haystack = normalizeWarehouseSearch([
    ...Object.values(document || {}),
    warehouseDocumentLabel(document),
    STATUS_LABEL[document?.status],
    formatJalaliDate(document?.created_at),
    formatJalaliDate(document?.finalized_at),
    document?.finance_sync_state === 'edited_registered' ? 'ویرایش شده ثبت شده اصلاح مالی' : '',
  ].join(' '));
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

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
  const [exchangeRates, setExchangeRates] = useState({ usd_toman: 0, cny_toman: 0, usd_rial: 0, cny_rial: 0 });

  const data = useWarehouseData();
  async function loadExchangeRates() {
    const row = await getWarehouseExchangeRates();
    if (row) setExchangeRates(row);
    return row;
  }
  useEffect(() => {
    let mounted = true;
    const refreshRates = async () => {
      try {
        const row = await getWarehouseExchangeRates();
        if (mounted && row) setExchangeRates(row);
      } catch {
        // The main warehouse error surface remains responsible for data errors.
      }
    };
    refreshRates();
    const channel = supabase
      .channel('warehouse-rate-cards-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_exchange_rates' }, refreshRates)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);
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
    inDocs: data.documents.filter((d) => d.type === 'in' && !['adjustment', 'opening_balance'].includes(d.document_kind)).length,
    outDocs: data.documents.filter((d) => d.type === 'out' && !['adjustment', 'opening_balance'].includes(d.document_kind)).length,
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
      return true;
    } catch (e) {
      setNotice(getFriendlyErrorMessage(e, 'خطا در عملیات انبار'));
      return false;
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
    const headers = ['کد', 'نام', 'گروه', 'واحد', 'مکان', 'ارز مبنا', 'بهای پایه', 'فروش پایه', 'بهای روز ریال', 'فروش روز ریال', 'جمع ورود', 'جمع خروج', 'موجودی', 'نقطه سفارش', 'ارزش موجودی', 'وضعیت'];
    const rows = filteredStock.map((i) => [i.item_code, i.item_name_fa, i.item_group || i.category, i.unit, i.location, i.has_currency_price ? i.price_currency : 'ثبت‌نشده', i.base_cost_price ?? '', i.base_sale_price ?? '', i.current_cost_rial ?? i.unit_price_estimate, i.current_sale_rial ?? i.unit_sale_price_estimate, i.total_in, i.total_out, i.current_qty, i.reorder_point || i.min_stock_threshold, i.stock_value_estimate, i.is_low_stock ? 'کم موجود' : 'موجود']);
    if (kind === 'excel') downloadExcelHtml('warehouse-stock.xls', headers, rows, 'گزارش موجودی انبار');
    else downloadCsv('warehouse-stock.csv', [headers, ...rows]);
  }

  function printStock() {
    const rows = filteredStock.map((i) => `<tr><td>${safe(i.item_code)}</td><td>${safe(i.item_name_fa)}</td><td>${safe(i.unit)}</td><td>${i.current_qty}</td><td>${i.reorder_point || i.min_stock_threshold}</td><td>${i.is_low_stock ? 'کم موجود' : 'موجود'}</td></tr>`).join('');
    openPrintable('موجودی انبار', `<h1>موجودی انبار</h1><table><thead><tr><th>کد</th><th>نام</th><th>واحد</th><th>موجودی</th><th>نقطه سفارش</th><th>وضعیت</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  async function printDocument(doc, rows = []) {
    try {
      const reportRows = rows.length || !doc?.id ? rows : await fetchWarehouseDocumentLines(doc.id);
      const bodyRows = reportRows.map((line, index) => `<tr><td>${index + 1}</td><td>${safe(line.warehouse_items?.item_code || '—')}</td><td>${safe(line.warehouse_items?.item_name_fa || '—')}</td><td>${line.quantity}</td><td>${safe(REASONS[line.reason] || line.reason || '—')}</td><td>${safe(line.note || '—')}</td></tr>`).join('');
      openPrintable(`سند ${warehouseDocumentLabel(doc)}`, `<h1>سند ${warehouseDocumentLabel(doc)} ${doc.doc_number || 'موقت'}</h1><div class="meta"><div><b>وضعیت:</b> ${STATUS_LABEL[doc.status] || doc.status}</div><div><b>تاریخ:</b> ${formatDate(doc.created_at)}</div><div><b>تعداد ردیف:</b> ${doc.line_count || reportRows.length}</div><div><b>جمع مقدار:</b> ${doc.total_quantity || '—'}</div></div><table><thead><tr><th>ردیف</th><th>کد</th><th>کالا</th><th>تعداد</th><th>دلیل</th><th>یادداشت</th></tr></thead><tbody>${bodyRows}</tbody></table>`);
    } catch (error) {
      setNotice(getFriendlyErrorMessage(error, 'دریافت ردیف‌های سند برای چاپ با خطا روبه‌رو شد.'));
    }
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
      rows = data.documents.map((d) => [d.doc_number || 'موقت', warehouseDocumentLabel(d), STATUS_LABEL[d.status] || d.status, d.customer_name || '—', d.note || '—', formatDate(d.created_at), d.line_count, d.total_quantity]);
    } else {
      title = 'گزارش ارزش موجودی';
      headers = ['کد', 'کالا', 'موجودی', 'ارز مبنا', 'بهای پایه', 'فروش پایه', 'بهای روز ریال', 'فروش روز ریال', 'ارزش موجودی'];
      rows = data.stock.map((i) => [i.item_code, i.item_name_fa, i.current_qty, i.has_currency_price ? i.price_currency : 'ثبت‌نشده', i.base_cost_price ?? '', i.base_sale_price ?? '', i.current_cost_rial ?? i.unit_price_estimate, i.current_sale_rial ?? i.unit_sale_price_estimate, i.stock_value_estimate]);
    }
    const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td>${safe(c)}</td>`).join('')}</tr>`).join('');
    const html = `<h1>${title}</h1><table><thead><tr>${headers.map((h) => `<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`;
    if (format === 'word') {
      downloadWordHtml(`${type}-warehouse-report.doc`, title, html);
    } else if (format === 'pdf') {
      openPrintable(title, html);
    } else {
      downloadExcelHtml(`${type}-warehouse-report.xls`, headers, rows, title);
    }
  }

  function openStocktake(item) {
    setModal({ type: 'stocktake', item });
  }

  return <div className="warehouse-page" dir="rtl">
    <header className="warehouse-hero">
      <div>
        <div className="eyebrow">Warehouse · Kardex · Documents</div>
        <h1>انبارداری</h1>
        <p>موجودی، اسناد ورود/خروج، کاردکس کالا، سند موقت ورود/خروج، همگام‌سازی انبارا و گزارش‌های قابل خروجی.</p>
      </div>
      <div className="warehouse-actions">
        <button className="primary" onClick={() => setModal({ type: 'item' })}>＋ کالای جدید</button>
        <button onClick={() => setModal({ type: 'import' })}><Upload size={16}/> ورود از اکسل</button>
        <button onClick={data.refetch}><RefreshCw size={16}/> به‌روزرسانی</button>
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
    {data.error && <div className="warehouse-message error">{getFriendlyErrorMessage(data.error, 'دریافت اطلاعات انبار با خطا روبه‌رو شد.')}<br /><small dir="ltr">{getTechnicalErrorMessage(data.error)}</small></div>}

    {modal?.type === 'item' && <ItemModal categories={data.categories || []} initial={modal.item} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => modal.item ? updateWarehouseItem(modal.item.item_id, payload) : createWarehouseItem(payload), modal.item ? 'کالا ویرایش شد.' : 'کالا ثبت شد.')} />}
    {modal?.type === 'movement' && <MovementModal item={modal.item} direction={modal.direction} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => recordStockMovement(payload), modal.direction === 'in' ? 'به سند موقت ورود اضافه شد.' : 'به سند موقت خروج اضافه شد.')} />}
    {modal?.type === 'shipment' && <ShipmentModal initial={modal.shipment} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => modal.shipment ? updateWarehouseShipment(modal.shipment.id, payload) : createWarehouseShipment(payload), modal.shipment ? 'اطلاعات حمل ارسال ویرایش شد.' : 'ثبت دستی متنی ذخیره شد.')} />}
    {modal?.type === 'archiveShipment' && <ConfirmModal title="بایگانی از فهرست ارسال‌ها" message={`محموله ${modal.shipment?.shipment_number || ''} فقط از فهرست فعال بایگانی می‌شود؛ سند، کاردکس و سابقه آن حذف نخواهند شد.`} confirmText="بایگانی شود" danger busy={busy} onClose={() => setModal(null)} onConfirm={() => runAction(() => archiveWarehouseShipment(modal.shipment.id), 'ارسال بدون حذف تاریخچه بایگانی شد.')} />}
    {modal?.type === 'reverseShipment' && <ReverseShipmentModal shipment={modal.shipment} busy={busy} onClose={() => setModal(null)} onSubmit={(reason) => runAction(() => reverseWarehouseShipment(modal.shipment.id, reason), 'ارسال برگشت داده شد، سند ورود اصلاحی ثبت و موجودی دوباره رزرو شد.')} />}
    {modal?.type === 'import' && <ImportModal busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createWarehouseSnapshot(payload), 'Snapshot اکسل ثبت شد.')} />}
    {modal?.type === 'referral' && <ReferralModal busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createWarehouseReferral(payload), 'ارجاع انبار ثبت شد.')} />}
    {modal?.type === 'confirmDocumentDelete' && <ConfirmModal title="حذف/لغو سند انبار" message={`آیا از حذف سند ${modal.doc?.doc_number || 'موقت'} مطمئن هستید؟ اثر سند نهایی با ردیف اصلاحی از موجودی برگشت داده می‌شود.`} confirmText="بله، حذف شود" danger busy={busy} onClose={() => setModal(null)} onConfirm={() => runAction(() => modal.doc?.status === 'draft' ? cancelDraftWarehouseDocument(modal.doc.id) : cancelWarehouseDocument(modal.doc.id, 'حذف توسط کاربر'), 'سند حذف/لغو شد و اثر موجودی اصلاح شد.')} />}
    {modal?.type === 'lineEdit' && <LineEditModal line={modal.line} busy={busy} onClose={() => setModal(null)} onSubmit={(quantity) => runAction(() => updateWarehouseDocumentLine(modal.line.id, quantity), 'ردیف سند اصلاح شد.')} />}
    {modal?.type === 'stocktake' && <StocktakeModal item={modal.item} busy={busy} onClose={() => setModal(null)} onSubmit={(realQty) => { const diff = Number(realQty) - Number(modal.item.current_qty || 0); if (!diff) { setNotice('موجودی با شمارش برابر است.'); setModal(null); return; } runAction(() => recordStockMovement({ itemId: modal.item.item_id, direction: diff > 0 ? 'in' : 'out', quantity: Math.abs(diff), reason: 'count_correction', note: 'انبارگردانی سریع' }), 'انبارگردانی در قالب سند اصلاحی نهایی ثبت شد.'); }} />}

    <nav className="warehouse-tabs">{[['overview','نمای کلی'],['stock','موجودی'],['docs','اسناد'],['kardex','کاردکس'],['sync','همگام‌سازی انبارا'],['shipments','مدیریت ارسال‌ها'],['refs','ارجاع و اسناد'],['reports','گزارش‌ها'],['settings','تنظیمات']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</nav>

    {!data.loading && tab === 'overview' && <Overview kpis={kpis} stock={data.stock} docs={data.documents} refs={data.referrals} setTab={setTab} />}
    {!data.loading && tab === 'stock' && <StockSection groups={(data.categories || []).map((c) => c.name_fa)} stock={filteredStock} query={query} setQuery={setQuery} groupFilter={groupFilter} setGroupFilter={setGroupFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} selectedItemId={selectedItemId} kardexRows={kardex.rows} busy={busy} onIn={(item)=>setModal({type:'movement',item,direction:'in'})} onOut={(item)=>setModal({type:'movement',item,direction:'out'})} onOpenKardex={(item)=>{setSelectedItemId(item.item_id);setTab('kardex')}} onEdit={(item)=>setModal({type:'item',item})} onStocktake={openStocktake} onDeactivate={(item)=>runAction(()=>deactivateWarehouseItem(item.item_id),'کالا غیرفعال شد.')} exportStock={exportStock} printStock={printStock}/>} 
    {!data.loading && tab === 'docs' && <DocumentsSection docs={data.documents} draftDocuments={draftDocuments} draftLinesByDocument={data.draftLinesByDocument || {}} shipmentDocumentIds={new Set((data.shipments || []).filter((shipment) => ['sent','delivered'].includes(shipment.status)).map((shipment) => shipment.warehouse_document_id).filter(Boolean))} selectedDocument={selectedDocument} lines={selectedDocument && data.draftLinesByDocument?.[selectedDocument.id] ? data.draftLinesByDocument[selectedDocument.id] : documentLines.rows} busy={busy} onSelect={setSelectedDocumentId} onFinalize={(id)=>runAction(()=>finalizeWarehouseDocument(id),'سند ثبت نهایی شد.')} onRequestCancel={(doc)=>setModal({ type: 'confirmDocumentDelete', doc })} onUpdateMeta={(id, meta)=>runAction(()=>updateWarehouseDocumentMeta(id, meta),'اطلاعات سند ذخیره شد.')} onEditLine={(line)=>setModal({ type: 'lineEdit', line })} onRemoveLine={(id)=>runAction(()=>removeWarehouseDocumentLine(id),'ردیف سند حذف/اصلاح شد.')} onPrint={printDocument} setTab={setTab} />}
    {!data.loading && tab === 'kardex' && <KardexSection stock={data.stock} selectedItemId={selectedItemId} setSelectedItemId={setSelectedItemId} rows={kardex.rows} />}
    {!data.loading && tab === 'sync' && <SyncSection snapshots={data.snapshots} matched={data.matched} unmatched={data.unmatched} inactiveItems={data.inactiveItems} stock={data.stock || []} exchangeRates={exchangeRates} busy={busy} onImport={()=>setModal({type:'import'})} onRestore={(item)=>runAction(()=>reactivateWarehouseItem(item.id),'کالا دوباره فعال شد.')} onRefreshRates={() => runAction(async () => { await refreshWarehouseExchangeRates(); await loadExchangeRates(); }, 'نرخ روز دلار و یوان دریافت شد و قیمت‌های جاری اتوماسیون به‌روزرسانی شدند.')} onSaveCurrencyPrice={(payload) => runAction(() => setWarehouseItemCurrencyPrice(payload), 'قیمت ارزی کالا ذخیره و معادل تومانی آن به‌روزرسانی شد.')} onConvertAllCurrency={(currency) => runAction(() => convertAllWarehouseItemCurrency(currency), `ارز مبنای کالاهای قیمت‌گذاری‌شده با حفظ ارزش تومانی به ${currency === 'USD' ? 'دلار' : 'یوان'} تبدیل شد.`)} />}
    {!data.loading && tab === 'shipments' && <ShipmentsSection shipments={data.shipments || []} onNew={() => setModal({ type: 'shipment' })} onEdit={(shipment) => setModal({ type: 'shipment', shipment })} onReverse={(shipment) => setModal({ type: 'reverseShipment', shipment })} onArchive={(shipment) => setModal({ type: 'archiveShipment', shipment })} />}
    {!data.loading && tab === 'refs' && <div className="warehouse-grid"><ReferralPanel sourceModule="warehouse" title="ارجاع و اسناد انبار" defaultTarget="accounting" /></div>}
    {!data.loading && tab === 'reports' && <ReportsSection report={report} setReport={setReport} stock={data.stock} categories={data.categories || []} docs={data.documents} onExport={exportWarehouseReport} />}
    {!data.loading && tab === 'settings' && <SettingsSection categories={data.categories || []} stock={data.stock || []} busy={busy} onCreate={(p) => runAction(() => createWarehouseCategory(p), 'دسته‌بندی ثبت شد.')} onUpdate={(id, p) => runAction(() => updateWarehouseCategory(id, p), 'دسته‌بندی ویرایش شد.')} onArchive={(id) => runAction(() => archiveWarehouseCategory(id), 'دسته‌بندی بایگانی شد.')} />}
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
      <section className="warehouse-card"><CardTitle icon={FileText} title="آخرین اسناد" action={<button onClick={()=>setTab('docs')}>اسناد</button>} />{recentDocs.length?<div className="doc-mini-list">{recentDocs.map(d=><button key={d.id} onClick={()=>setTab('docs')}><b>{d.doc_number || 'سند موقت'}</b><span>{warehouseDocumentLabel(d)} · {STATUS_LABEL[d.status]} · {formatDate(d.created_at)}</span></button>)}</div>:<Empty/>}</section>
      <section className="warehouse-card"><CardTitle icon={ClipboardList} title="ارجاعات باز" action={<button onClick={()=>setTab('refs')}>همه</button>} />{refs.length?<div className="warehouse-timeline compact">{refs.slice(0,6).map(r=><article key={r.id}><strong>{r.title_fa}</strong><small>{r.referral_number} · {r.source_module} ← {r.target_module}</small></article>)}</div>:<Empty/>}</section>
    </div>
  </>;
}
function Kpi({icon,label,value,danger,warning,success}){return <div className={`warehouse-kpi ${danger?'danger':warning?'warning':success?'success':''}`}><i>{icon}</i><span>{label}</span><b>{value}</b></div>}

function StockSection({ groups = [], stock, query, setQuery, groupFilter, setGroupFilter, statusFilter, setStatusFilter, busy, onIn, onOut, onOpenKardex, onEdit, onStocktake, onDeactivate, exportStock, printStock }) {
  const [menuId, setMenuId] = useState(null);
  const [sort, setSort] = useState({ key: 'item_code', dir: 'asc' });
  const sortedStock = useMemo(() => sortRows(stock, sort), [stock, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <section className="warehouse-card stock-card-anbara">
    <div className="section-head"><CardTitle icon={Package} title="موجودی کالاها"/><div><button onClick={()=>exportStock('excel')}>خروجی موجودی</button><button onClick={printStock}>چاپ برچسب/موجودی</button></div></div>
    <div className="filters anbara-toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجوی کد کالا، نام کالا، مکان..."/><select value={groupFilter} onChange={e=>setGroupFilter(e.target.value)}><option value="all">همه گروه‌ها</option>{groups.map(g=><option key={g}>{g}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">همه وضعیت‌ها</option><option value="low">کم‌موجود</option><option value="available">موجود</option></select></div>
    <div className="warehouse-table-wrap stock-scroll"><table className="compact-stock-table"><thead><tr>{th('item_code','کد کالا')}{th('item_name_fa','نام کالا')}{th('category','گروه')}{th('unit','واحد')}{th('location','مکان')}{th('current_qty','موجودی')}{th('min_stock_threshold','نقطه سفارش')}{th('is_low_stock','وضعیت')}<th>عملیات</th></tr></thead><tbody>{sortedStock.map(i=><tr key={i.item_id}><td dir="ltr"><span className="code-pill">{i.item_code}</span></td><td className="item-name-cell">{i.item_name_fa}</td><td>{i.item_group||i.category||'—'}</td><td>{i.unit}</td><td>{i.location||'—'}</td><td className={i.is_low_stock?'negative':'positive'}><b>{formatNumber(i.current_qty)}</b></td><td>{formatNumber(i.reorder_point||i.min_stock_threshold)}</td><td>{i.is_low_stock?<span className="low-badge">کم موجود</span>:<span className="ok-badge">موجود</span>}</td><td className="stock-actions-cell"><button className="plus" disabled={busy} onClick={()=>onIn(i)}>＋</button><button className="minus" disabled={busy} onClick={()=>onOut(i)}>−</button><span className="stock-menu-wrap"><button className="more" onClick={()=>setMenuId(menuId===i.item_id?null:i.item_id)}><MoreVertical size={16}/></button>{menuId===i.item_id&&<div className="stock-popover"><button onClick={()=>{onOpenKardex(i);setMenuId(null)}}>مشاهده کاردکس</button><button onClick={()=>{onStocktake(i);setMenuId(null)}}>انبارگردانی سریع</button><button onClick={()=>{onEdit(i);setMenuId(null)}}>ویرایش</button><button className="danger" onClick={()=>{onDeactivate(i);setMenuId(null)}}>حذف/غیرفعال</button></div>}</span></td></tr>)}</tbody></table></div>
  </section>;
}

function KardexSection({ stock = [], rows = [], selectedItemId, setSelectedItemId }) { return <AccountingItemKardexSection stock={stock} rows={rows} lastSales={[]} lang="fa" selectedItemId={selectedItemId} onSelectItem={setSelectedItemId} />; }

function DocumentsSection({ docs, draftDocuments, draftLinesByDocument, shipmentDocumentIds = new Set(), selectedDocument, lines, busy, onSelect, onFinalize, onRequestCancel, onUpdateMeta, onEditLine, onRemoveLine, onPrint, setTab }) {
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [documentQuery, setDocumentQuery] = useState('');
  const draftsWithLines = draftDocuments.filter((document) => (draftLinesByDocument[document.id] || []).length > 0);
  const sortedDocs = useMemo(
    () => sortRows((docs || []).filter((document) => warehouseDocumentMatchesSearch(document, documentQuery)), sort),
    [docs, documentQuery, sort],
  );
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  const selectedIsProtected = isProtectedOpeningDocument(selectedDocument);

  return <div className="warehouse-grid docs-layout wide-docs-layout">
    {draftsWithLines.length > 0 && <section className="drafts-board">{draftsWithLines.map((document) => <article key={document.id} className={`warehouse-card draft-document-card ${document.type}`}>
      <div className="draft-card-head"><div><span>سند موقت {TYPE_LABEL[document.type]}</span><h2>{(draftLinesByDocument[document.id] || []).length} ردیف آماده ثبت</h2><p>تاریخ سند: {formatDate(document.created_at)} · ردیف‌ها قابل کم/زیاد شدن، ویرایش و حذف هستند.</p></div><div className="draft-actions"><button disabled={busy} onClick={() => onFinalize(document.id)}>ثبت نهایی سند {TYPE_LABEL[document.type]}</button><button disabled={busy} onClick={() => onRequestCancel(document)}>انصراف از سند موقت</button><button onClick={() => setTab('stock')}>＋ افزودن ردیف از موجودی</button></div></div>
      <DocumentMetaForm doc={document} busy={busy} onSave={onUpdateMeta} />
      <DocumentLines rows={draftLinesByDocument[document.id] || []} busy={busy} onEditLine={onEditLine} onRemove={onRemoveLine} />
    </article>)}</section>}

    <section className="warehouse-card docs-table-card full-width">
      <CardTitle icon={FileText} title="لیست اسناد انبار" />
      <div className="warehouse-document-search">
        <Search size={18} aria-hidden="true" />
        <input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} autoComplete="off" placeholder="جست‌وجوی شماره/نوع سند، وضعیت، مشتری، شهر، تاریخ، سفارش، محموله، کالا، تعداد یا شرح..." aria-label="جست‌وجو در اسناد انبار" />
        <span>{formatNumber(sortedDocs.length)} از {formatNumber((docs || []).length)}</span>
        {documentQuery && <button type="button" onClick={() => setDocumentQuery('')} aria-label="پاک‌کردن جست‌وجو">×</button>}
      </div>
      {sortedDocs.length ? <div className="warehouse-table-wrap"><table><thead><tr>{th('doc_number', 'شماره سند')}{th('document_kind', 'نوع سند')}{th('status', 'وضعیت')}{th('customer_name', 'مشتری')}{th('customer_city', 'شهر')}{th('created_at', 'تاریخ')}{th('note', 'شرح')}<th>عملیات</th></tr></thead><tbody>{sortedDocs.map((document) => {
        const protectedOpening = isProtectedOpeningDocument(document);
        const shipmentOwned = shipmentDocumentIds.has(document.id);
        const activeFinanceOwned = Boolean(document.finance_document_id) && !['void', 'cancelled'].includes(document.finance_document_status);
        const cancellationLocked = shipmentOwned || activeFinanceOwned;
        const typeClass = ['adjustment', 'opening_balance'].includes(document.document_kind) ? document.document_kind : document.type;
        return <tr key={document.id} className={protectedOpening ? 'opening-document-row' : ''}>
          <td dir="ltr"><span className="doc-number-pill">{document.doc_number || 'موقت'}</span></td>
          <td><span className={`doc-type ${typeClass}`}>{warehouseDocumentLabel(document)}</span></td>
          <td><span>{STATUS_LABEL[document.status] || document.status}</span>{document.finance_sync_state === 'edited_registered' && <small className="warehouse-sync-state">ویرایش‌شده / ثبت‌شده</small>}</td>
          <td>{document.customer_name || (protectedOpening ? 'سیستمی' : '—')}</td>
          <td>{document.customer_city || '—'}</td>
          <td>{formatDate(document.created_at)}</td>
          <td>{document.note || '—'}</td>
          <td className="doc-actions"><button title={protectedOpening ? 'مشاهده سند سیستمی' : 'جزئیات/ویرایش'} onClick={() => onSelect(document.id)}><FileText size={15} /></button><button title="چاپ" onClick={() => onPrint(document, selectedDocument?.id === document.id ? lines : [])}><Printer size={15} /></button>{!protectedOpening && <button className="danger" disabled={cancellationLocked} title={shipmentOwned ? 'این سند متعلق به محموله است؛ برگشت را از مدیریت ارسال‌ها انجام دهید' : activeFinanceOwned ? 'لغو فقط پس از ابطال کامل سند مالی مرتبط مجاز است' : 'حذف/لغو سند'} onClick={() => !cancellationLocked && onRequestCancel(document)}><Trash2 size={15} /></button>}</td>
        </tr>;
      })}</tbody></table></div> : <Empty text={documentQuery ? 'سندی مطابق عبارت جست‌وجو پیدا نشد.' : 'سند انباری ثبت نشده است.'} />}
    </section>

    {selectedDocument && <section className={`warehouse-card selected-doc-card full-width ${selectedIsProtected ? 'protected-opening-document' : ''}`}>
      <CardTitle icon={ClipboardList} title={`جزئیات ${warehouseDocumentLabel(selectedDocument)} ${selectedDocument.doc_number || 'سند موقت'}`} action={<button onClick={() => onPrint(selectedDocument, lines)}>چاپ سند</button>} />
      {selectedIsProtected && <div className="protected-document-note">این سند، سابقه سیستمی موجودی اول دوره است. برای حفظ صحت موجودی قابل ویرایش یا حذف نیست؛ تغییر موجودی باید با سند اصلاحی جدید ثبت شود.</div>}
      <DocumentMetaForm doc={selectedDocument} busy={busy} onSave={onUpdateMeta} readOnly={selectedIsProtected} />
      <DocumentLines rows={lines} busy={busy} onEditLine={onEditLine} onRemove={onRemoveLine} readOnly={selectedIsProtected} />
    </section>}
  </div>;
}

function DocumentMetaForm({ doc, busy, onSave, readOnly = false }) {
  const [customerName, setCustomerName] = useState(doc.customer_name || '');
  const [customerCity, setCustomerCity] = useState(doc.customer_city || '');
  const [note, setNote] = useState(doc.note || '');

  useEffect(() => {
    setCustomerName(doc.customer_name || '');
    setCustomerCity(doc.customer_city || '');
    setNote(doc.note || '');
  }, [doc.id, doc.customer_name, doc.customer_city, doc.note]);

  function save() {
    if (busy || readOnly) return;
    if ((customerName || '') !== (doc.customer_name || '') || (customerCity || '') !== (doc.customer_city || '') || (note || '') !== (doc.note || '')) {
      onSave(doc.id, { customerName, customerCity, note });
    }
  }

  return <div className="document-meta-form autosave"><label><span>تاریخ سند</span><input readOnly value={formatDate(doc.created_at)} /></label><label><span>نام مشتری / تحویل‌گیرنده</span><input disabled={readOnly} value={customerName} onChange={(event) => setCustomerName(event.target.value)} onBlur={save} placeholder={readOnly ? 'سیستمی' : 'نام مشتری یا واحد مقصد'} /></label><label><span>شهر</span><input disabled={readOnly} value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} onBlur={save} placeholder="شهر" /></label><label><span>شرح کلی سند</span><input disabled={readOnly} value={note} onChange={(event) => setNote(event.target.value)} onBlur={save} placeholder="شرح کلی برای این سند" /></label><small>{readOnly ? 'سند موجودی اول دوره محافظت‌شده و فقط خواندنی است.' : 'اطلاعات بعد از خروج از کادر به‌صورت خودکار ذخیره می‌شود.'}</small></div>;
}

function DocumentLines({ title, rows, busy, onEditLine, onRemove, readOnly = false }) {
  return <div className="doc-lines">{title && <h3>{title}</h3>}<div className="warehouse-table-wrap"><table className="has-row-numbers"><thead><tr><th>ردیف</th><th>کد</th><th>کالا</th><th>تعداد</th><th>دلیل</th><th>یادداشت</th>{!readOnly && <th>عملیات</th>}</tr></thead><tbody>{rows.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td dir="ltr">{line.warehouse_items?.item_code || '—'}</td><td>{line.warehouse_items?.item_name_fa || '—'}</td><td>{formatNumber(line.quantity)} {line.warehouse_items?.unit || ''}</td><td>{REASONS[line.reason] || line.reason}</td><td>{line.note || '—'}</td>{!readOnly && <td><button disabled={busy} onClick={() => onEditLine(line)}>ویرایش</button><button disabled={busy} onClick={() => onRemove(line.id)}>حذف</button></td>}</tr>)}</tbody></table></div></div>;
}

function SyncSection({ snapshots, matched, unmatched, inactiveItems, stock = [], exchangeRates = {}, busy, onImport, onRestore, onRefreshRates, onSaveCurrencyPrice, onConvertAllCurrency }) {
  const [open, setOpen] = useState('matched');
  return <div className="sync-page-stack">
    <CurrencyPricingSection stock={stock} rates={exchangeRates} busy={busy} onRefreshRates={onRefreshRates} onSave={onSaveCurrencyPrice} onConvertAll={onConvertAllCurrency} />
    <div className="warehouse-grid sync-grid">
      <section className="warehouse-card sync-file-card"><CardTitle icon={Upload} title="همگام‌سازی با انبارا" action={<button onClick={onImport}>ورود از اکسل</button>}/>{snapshots.length?<div className="warehouse-table-wrap sync-files-table"><table><thead><tr><th>فایل</th><th>تاریخ</th><th>ردیف</th><th>یادداشت</th></tr></thead><tbody>{snapshots.map(s=><tr key={s.id}><td>{s.file_name}</td><td>{formatDate(s.imported_at)}</td><td>{s.row_count}</td><td>{s.notes||'—'}</td></tr>)}</tbody></table></div>:<Empty/>}</section>
      <section className="warehouse-card sync-status-card"><CardTitle icon={AlertTriangle} title="بررسی وضعیت همگام‌سازی"/><div className="sync-status-buttons"><button className={open==='matched'?'active':''} onClick={()=>setOpen(open==='matched'?'': 'matched')}>کالاهای هماهنگ‌شده <b>{matched.length}</b></button><button className={open==='unmatched'?'active':''} onClick={()=>setOpen(open==='unmatched'?'': 'unmatched')}>کالاهای مچ‌نشده <b>{unmatched.length}</b></button><button className={open==='inactive'?'active':''} onClick={()=>setOpen(open==='inactive'?'': 'inactive')}>غیرفعال/حذف‌شده <b>{inactiveItems.length}</b></button></div>{open==='matched'&&<SimpleSyncTable rows={matched} empty="کالای هماهنگ‌شده‌ای در فایل‌های بارگذاری‌شده نیست."/>}{open==='unmatched'&&<SimpleSyncTable rows={unmatched} empty="کالای مچ‌نشده نداریم."/>}{open==='inactive'&&<InactiveItems rows={inactiveItems} onRestore={onRestore}/>}</section>
    </div>
  </div>;
}

function SimpleSyncTable({rows,empty}){return rows.length?<div className="warehouse-table-wrap sync-detail-table"><table><thead><tr><th>کد</th><th>تعداد</th><th>واحد</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td dir="ltr">{u.item_code}</td><td>{u.quantity}</td><td>{u.unit}</td></tr>)}</tbody></table></div>:<Empty text={empty}/>}
function InactiveItems({rows,onRestore}){return rows.length?<div className="warehouse-table-wrap sync-detail-table"><table><thead><tr><th>کد</th><th>کالا</th><th>گروه</th><th>واحد</th><th>مکان</th><th>عملیات</th></tr></thead><tbody>{rows.map(i=><tr key={i.id}><td dir="ltr">{i.item_code}</td><td>{i.item_name_fa}</td><td>{i.category||'—'}</td><td>{i.unit}</td><td>{i.location||'—'}</td><td><button onClick={()=>onRestore(i)}>بازگردانی</button></td></tr>)}</tbody></table></div>:<Empty text="کالای غیرفعال/حذف‌شده‌ای ثبت نشده است."/>}

function rateFreshnessLabel(value) {
  if (!value) return 'هنوز دریافت نشده';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
function rateStateLabel(status, sourceCount) {
  if (status === 'updated_single_source') return `به‌روز با یک منبع`;
  if (status === 'updated') return `به‌روز با ${formatNumber(sourceCount || 0)} منبع`;
  if (status === 'no_data') return 'منابع پاسخ ندادند؛ نرخ قبلی حفظ شد';
  if (status === 'manual') return 'نرخ اولیه / دستی';
  return status || 'نامشخص';
}
function fxNumber(value, max = 4) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: max }).format(Number(value || 0));
}
function currencyTitle(currency) { return currency === 'CNY' ? 'یوان' : 'دلار'; }
function currencySymbol(currency) { return currency === 'CNY' ? '¥' : '$'; }

function ExchangeRateCard({ currency, rate, status, sourceCount, fetchedAt, sources = [] }) {
  const sourceRows = Array.isArray(sources) ? sources : [];
  const sourceNames = { tgju: 'TGJU', alanchand: 'الان‌چند', 'priceto.day': 'PriceToDay' };
  return <article className={`exchange-rate-card ${currency.toLowerCase()} ${status === 'no_data' ? 'stale' : status === 'manual' ? 'manual' : ''}`}>
    <div className="exchange-rate-symbol">{currencySymbol(currency)}</div>
    <span>نرخ روز {currencyTitle(currency)}</span>
    <strong>{Number(rate || 0) > 0 ? fxNumber(rate, 0) : '—'} <small>تومان</small></strong>
    <div className="exchange-rate-meta"><b>{rateStateLabel(status, sourceCount)}</b><small>آخرین نرخ معتبر: {rateFreshnessLabel(fetchedAt)}</small></div>
    <div className="rate-source-status" aria-label="وضعیت منابع نرخ">
      {sourceRows.length ? sourceRows.map((source) => <span key={source.source} className={source.ok ? 'ok' : 'error'} title={source.ok ? `${fxNumber(Number(source.rial || 0) / 10, 0)} تومان` : (source.error || 'خطای منبع')}><i />{sourceNames[source.source] || source.source}</span>) : <small>وضعیت سه منبع پس از اولین دریافت نمایش داده می‌شود.</small>}
    </div>
  </article>;
}

function displayedPrice(item, kind, displayMode) {
  const baseKey = kind === 'cost' ? 'base_cost_price' : 'base_sale_price';
  const rialKey = kind === 'cost' ? 'current_cost_rial' : 'current_sale_rial';
  const usdKey = kind === 'cost' ? 'cost_usd' : 'sale_usd';
  const cnyKey = kind === 'cost' ? 'cost_cny' : 'sale_cny';
  if (displayMode === 'USD') return item[usdKey] == null ? '—' : `${currencySymbol('USD')}${fxNumber(item[usdKey])}`;
  if (displayMode === 'CNY') return item[cnyKey] == null ? '—' : `${currencySymbol('CNY')}${fxNumber(item[cnyKey])}`;
  if (displayMode === 'BASE') return ['USD','CNY'].includes(item.price_currency) && item[baseKey] != null ? `${currencySymbol(item.price_currency)}${fxNumber(item[baseKey])}` : 'ثبت نشده';
  return formatMoney(Number(item[rialKey] ?? item.unit_price_estimate ?? 0));
}

function CurrencyPricingSection({ stock = [], rates = {}, busy, onRefreshRates, onSave, onConvertAll }) {
  const [query, setQuery] = useState('');
  const [pricingFilter, setPricingFilter] = useState('all');
  const [displayMode, setDisplayMode] = useState('TOMAN');
  const [editing, setEditing] = useState(null);
  const [conversion, setConversion] = useState(null);
  const filtered = useMemo(() => stock.filter((item) => {
    const text = `${item.item_code || ''} ${item.item_name_fa || ''} ${item.item_group || item.category || ''}`.toLowerCase();
    const matchesText = !query || text.includes(query.toLowerCase());
    const hasPrice = Boolean(item.has_currency_price);
    const matchesFilter = pricingFilter === 'all' || (pricingFilter === 'priced' && hasPrice) || (pricingFilter === 'missing' && !hasPrice) || item.price_currency === pricingFilter;
    return matchesText && matchesFilter;
  }), [stock, query, pricingFilter]);
  const pricedCount = stock.filter((item) => item.has_currency_price).length;
  const missingCount = stock.length - pricedCount;

  function convertAll(currency) {
    const eligible = stock.filter((item) => item.has_currency_price && item.price_currency !== currency).length;
    if (!eligible) return;
    setConversion({ currency, eligible });
  }

  return <section className="warehouse-card currency-pricing-card">
    {editing && <CurrencyPriceModal item={editing} rates={rates} busy={busy} onClose={() => setEditing(null)} onSubmit={async (payload) => { const saved = await onSave?.(payload); if (saved !== false) setEditing(null); }} />}
    {conversion && <ConfirmModal title="تبدیل گروهی ارز مبنا" message={`ارز مبنای ${formatNumber(conversion.eligible)} کالا به ${currencyTitle(conversion.currency)} تبدیل شود؟ ارزش تومانی فعلی دقیقاً حفظ و فقط ارز و مبلغ پایه با نرخ امروز تبدیل می‌شود.`} confirmText={`تبدیل به ${currencyTitle(conversion.currency)}`} busy={busy} onClose={() => setConversion(null)} onConfirm={async () => { const saved = await onConvertAll?.(conversion.currency); if (saved !== false) setConversion(null); }} />}
    <div className="currency-pricing-head">
      <div><div className="eyebrow">Daily FX Pricing</div><h2>قیمت‌گذاری دلاری و یوانی کالاها</h2><p>قیمت پایه را یک‌بار ثبت کنید؛ معادل تومانی انبار، فروش، حسابداری، تولید و R&amp;D با نرخ روز محاسبه می‌شود. قیمت اسناد ثبت‌شده ثابت می‌ماند.</p></div>
      <button className="refresh-rates-btn" disabled={busy} onClick={onRefreshRates}><RefreshCw size={17}/>{busy ? 'در حال دریافت...' : 'به‌روزرسانی نرخ‌ها الآن'}</button>
    </div>
    <div className="exchange-rate-cards">
      <ExchangeRateCard currency="USD" rate={rates.usd_toman} status={rates.usd_status} sourceCount={rates.usd_source_count} fetchedAt={rates.usd_fetched_at} sources={rates.usd_sources} />
      <ExchangeRateCard currency="CNY" rate={rates.cny_toman} status={rates.cny_status} sourceCount={rates.cny_source_count} fetchedAt={rates.cny_fetched_at} sources={rates.cny_sources} />
    </div>
    <div className="currency-pricing-summary"><span><b>{formatNumber(pricedCount)}</b> کالای قیمت‌گذاری‌شده</span><span className={missingCount ? 'warning' : ''}><b>{formatNumber(missingCount)}</b> کالای بدون قیمت ارزی</span><small>آخرین بررسی: {rateFreshnessLabel(rates.last_checked_at)} · بررسی خودکار روزانه؛ حتی یک منبع معتبر کافی است.</small></div>
    <div className="currency-pricing-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی کد، نام یا گروه کالا..." />
      <select value={pricingFilter} onChange={(event) => setPricingFilter(event.target.value)}><option value="all">همه کالاها</option><option value="priced">قیمت‌گذاری‌شده</option><option value="missing">فاقد قیمت ارزی</option><option value="USD">مبنای دلار</option><option value="CNY">مبنای یوان</option></select>
      <div className="currency-display-switch"><span>نمایش:</span>{[['TOMAN','تومان'],['USD','دلار'],['CNY','یوان'],['BASE','ارز مبنا']].map(([value,label])=><button key={value} className={displayMode===value?'active':''} onClick={()=>setDisplayMode(value)}>{label}</button>)}</div>
      <div className="currency-bulk-actions"><button disabled={busy} onClick={()=>convertAll('USD')}>همه به دلار</button><button disabled={busy} onClick={()=>convertAll('CNY')}>همه به یوان</button></div>
    </div>
    <div className="warehouse-table-wrap currency-price-table-wrap"><table className="currency-price-table"><thead><tr><th>ردیف</th><th>کد و کالا</th><th>گروه</th><th>ارز مبنا</th><th>بهای خرید</th><th>قیمت فروش</th><th>سود</th><th>قیمت نمایشی خرید</th><th>قیمت نمایشی فروش</th><th>آخرین تغییر</th><th>عملیات</th></tr></thead><tbody>{filtered.map((item,index)=><tr key={item.item_id} className={!item.has_currency_price?'missing-price-row':''}><td>{formatNumber(index+1)}</td><td><b dir="ltr">{item.item_code}</b><small>{item.item_name_fa}</small></td><td>{item.item_group||item.category||'—'}{item.is_produced_item&&<small className="pricing-mode-badge">BOM + سود</small>}</td><td>{item.has_currency_price?<span className={`currency-badge ${String(item.price_currency).toLowerCase()}`}>{currencySymbol(item.price_currency)} {currencyTitle(item.price_currency)}</span>:<span className="currency-badge missing">ثبت نشده</span>}</td><td>{item.has_currency_price?`${currencySymbol(item.price_currency)}${fxNumber(item.base_cost_price)}`:'—'}</td><td>{item.has_currency_price?`${currencySymbol(item.price_currency)}${fxNumber(item.base_sale_price)}`:'—'}</td><td className={Number(item.margin_pct||0)<0?'negative':'positive'}>{item.has_currency_price?`${fxNumber(item.margin_pct,2)}٪`:'—'}</td><td>{displayedPrice(item,'cost',displayMode)}</td><td><b>{displayedPrice(item,'sale',displayMode)}</b></td><td>{item.pricing_updated_at?formatDate(item.pricing_updated_at):'—'}</td><td><button className="currency-edit-btn" disabled={busy} onClick={()=>setEditing(item)}>{item.has_currency_price?'ویرایش قیمت':'ثبت قیمت'}</button></td></tr>)}</tbody></table></div>
    {filtered.length===0&&<Empty text="کالایی مطابق فیلتر قیمت‌گذاری پیدا نشد."/>}
  </section>;
}

function roundPricingRial(value) {
  return Math.round(Number(value || 0) / 10000) * 10000;
}

function CurrencyPriceModal({ item, rates = {}, busy, onClose, onSubmit }) {
  const isProduced = Boolean(item?.is_produced_item || item?.pricing_mode === 'bom_plus_profit' || item?.item_group === 'Finished' || item?.category === 'Finished');
  const initialCurrency = ['USD','CNY'].includes(item?.price_currency) ? item.price_currency : 'USD';
  const inferredMargin = Number(item?.base_cost_price || 0) > 0
    ? (Number(item?.base_sale_price || 0) / Number(item.base_cost_price) - 1) * 100
    : 25;
  const [currency, setCurrency] = useState(initialCurrency);
  const [baseCost, setBaseCost] = useState(item?.has_currency_price ? item.base_cost_price : '');
  const [baseSale, setBaseSale] = useState(item?.has_currency_price ? item.base_sale_price : '');
  const [profitMargin, setProfitMargin] = useState(item?.pricing_margin_pct != null ? item.pricing_margin_pct : inferredMargin);
  const rateRial = currency === 'USD'
    ? Number(rates.usd_rial || Number(rates.usd_toman || 0) * 10)
    : Number(rates.cny_rial || Number(rates.cny_toman || 0) * 10);
  const bomCostRial = Number(item?.bom_cost_rial || 0);
  const roundedBomCostRial = roundPricingRial(bomCostRial);
  const producedBaseCost = rateRial > 0 ? roundedBomCostRial / rateRial : 0;
  const producedBaseSale = producedBaseCost * (1 + Number(profitMargin || 0) / 100);
  const producedSaleRial = roundPricingRial(roundedBomCostRial * (1 + Number(profitMargin || 0) / 100));
  const effectiveBaseCost = isProduced ? producedBaseCost : Number(baseCost || 0);
  const effectiveBaseSale = isProduced ? producedBaseSale : Number(baseSale || 0);
  const regularMargin = Number(baseCost || 0) > 0 ? (Number(baseSale || 0) / Number(baseCost) - 1) * 100 : 0;
  const costRial = isProduced ? roundedBomCostRial : roundPricingRial(effectiveBaseCost * rateRial);
  const saleRial = isProduced ? producedSaleRial : roundPricingRial(effectiveBaseSale * rateRial);
  const canSaveProduced = bomCostRial > 0 && Number.isFinite(Number(profitMargin)) && Number(profitMargin) >= 0;
  const canSaveRegular = baseCost !== '' && baseSale !== '' && Number(baseCost) >= 0 && Number(baseSale) >= 0;

  function changeCurrency(next) {
    if (next === currency) return;
    if (!isProduced) {
      const oldRate = currency === 'USD' ? Number(rates.usd_rial || Number(rates.usd_toman || 0) * 10) : Number(rates.cny_rial || Number(rates.cny_toman || 0) * 10);
      const nextRate = next === 'USD' ? Number(rates.usd_rial || Number(rates.usd_toman || 0) * 10) : Number(rates.cny_rial || Number(rates.cny_toman || 0) * 10);
      if (oldRate > 0 && nextRate > 0) {
        if (baseCost !== '') setBaseCost(Number(baseCost || 0) * oldRate / nextRate);
        if (baseSale !== '') setBaseSale(Number(baseSale || 0) * oldRate / nextRate);
      }
    }
    setCurrency(next);
  }

  function useLegacyPrice() {
    if (!rateRial) return;
    setBaseCost(Number(item?.unit_price_estimate || 0) / rateRial);
    setBaseSale(Number(item?.current_sale_rial || item?.unit_price_estimate || 0) / rateRial);
  }

  return <Modal title={`قیمت ارزی ${item?.item_name_fa || ''}`} onClose={onClose}><div className="currency-price-modal">
    <div className="currency-item-identity"><b dir="ltr">{item?.item_code}</b><span>{item?.item_name_fa}</span><small>{item?.item_group||item?.category||'بدون گروه'}{isProduced ? ' · محصول تولیدی (BOM + سود)' : ''}</small></div>
    <div className="currency-choice"><button type="button" className={currency==='USD'?'active usd':''} onClick={()=>changeCurrency('USD')}>$ دلار</button><button type="button" className={currency==='CNY'?'active cny':''} onClick={()=>changeCurrency('CNY')}>¥ یوان</button></div>
    {isProduced ? <>
      <div className="produced-price-rule"><b>بهای ساخت از BOM</b><strong>{bomCostRial > 0 ? formatMoney(bomCostRial) : 'BOM معتبر یافت نشد'}</strong><small>بهای خرید این محصول قابل ورود دستی نیست و با انتشار BOM به‌روز می‌شود.</small></div>
      <div className="form-grid produced-pricing-fields"><label><span>بهای ساخت پایه ({currency})</span><input readOnly value={bomCostRial > 0 ? fxNumber(producedBaseCost, 6) : ''}/></label><label><span>درصد سود روی BOM</span><input type="number" min="0" step="0.01" value={profitMargin} onChange={event=>setProfitMargin(event.target.value)} autoFocus/></label><label><span>قیمت فروش پایه ({currency})</span><input readOnly value={bomCostRial > 0 ? fxNumber(producedBaseSale, 6) : ''}/></label><label><span>نرخ جاری</span><input readOnly value={`${fxNumber(rateRial/10,0)} تومان`} /></label></div>
      {bomCostRial <= 0 && <div className="custom-warning-box"><b>قیمت‌گذاری متوقف است</b><p>ابتدا در بخش تولید، BOM دارای هزینه را به انبار منتشر کنید.</p></div>}
    </> : <div className="form-grid"><label><span>بهای خرید پایه ({currency})</span><input type="number" min="0" step="0.0001" value={baseCost} onChange={event=>setBaseCost(event.target.value)} autoFocus/></label><label><span>قیمت فروش پایه ({currency})</span><input type="number" min="0" step="0.0001" value={baseSale} onChange={event=>setBaseSale(event.target.value)}/></label><label><span>درصد سود</span><input type="number" step="0.01" value={Number.isFinite(regularMargin)?Number(regularMargin.toFixed(2)):0} onChange={event=>{const pct=Number(event.target.value||0);setBaseSale(Number(baseCost||0)*(1+pct/100));}}/></label><label><span>نرخ جاری</span><input readOnly value={`${fxNumber(rateRial/10,0)} تومان`} /></label></div>}
    {!isProduced&&!item?.has_currency_price&&Number(item?.unit_price_estimate||0)>0&&<button type="button" className="legacy-price-suggest" onClick={useLegacyPrice}>تبدیل قیمت ریالی فعلی به {currencyTitle(currency)}</button>}
    <div className="currency-live-preview"><div><span>{isProduced ? 'بهای ساخت امروز' : 'بهای خرید امروز'}</span><b>{formatMoney(costRial)}</b></div><div><span>قیمت فروش امروز</span><b>{formatMoney(saleRial)}</b></div></div>
    <div className="note">{isProduced ? 'محصول تولیدی همیشه از هزینه BOM به‌علاوه درصد سود بالا قیمت‌گذاری می‌شود.' : 'قیمت پایه خرید و فروش این کالا با نرخ روز به تومان تبدیل می‌شود.'} قیمت سفارش‌ها، پیش‌فاکتورها و فاکتورهای ثبت‌شده تغییر نمی‌کند.</div>
    <div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="button" disabled={busy||!rateRial||(isProduced?!canSaveProduced:!canSaveRegular)} onClick={()=>onSubmit({itemId:item.item_id,currency,baseCostPrice:effectiveBaseCost,baseSalePrice:effectiveBaseSale})}>ذخیره و به‌روزرسانی قیمت‌ها</button></div>
  </div></Modal>;
}

function ReportsSection({report,setReport,stock,categories=[],docs,onExport}){
  const [format,setFormat]=useState('excel');
  const [filters,setFilters]=useState({ group:'all', location:'', lowOnly:false, docType:'all', docStatus:'all', customer:'', dateFrom:'', dateTo:'' });
  const locations=useMemo(()=>[...new Set(stock.map(i=>i.location).filter(Boolean))], [stock]);
  const groups=useMemo(()=>categories.map((c) => c.name_fa), [categories]);
  const filteredStock=useMemo(()=>stock.filter(i=>(filters.group==='all'||(i.item_group||i.category)===filters.group)&&(!filters.location||String(i.location||'').includes(filters.location))&&(!filters.lowOnly||i.is_low_stock)),[stock,filters]);
  const filteredDocs=useMemo(()=>docs.filter(d=>{const kind=d.document_kind||'movement';const typeMatches=filters.docType==='all'||(filters.docType==='adjustment'?kind==='adjustment':filters.docType==='opening_balance'?kind==='opening_balance':kind==='movement'&&d.type===filters.docType);return typeMatches&&(filters.docStatus==='all'||d.status===filters.docStatus)&&(!filters.customer||`${d.customer_name||''} ${d.customer_city||''}`.includes(filters.customer))&&(!filters.dateFrom||String(d.created_at||'').slice(0,10)>=filters.dateFrom)&&(!filters.dateTo||String(d.created_at||'').slice(0,10)<=filters.dateTo)}),[docs,filters]);
  const low=filteredStock.filter(i=>i.is_low_stock), value=filteredStock.reduce((sum,i)=>sum+Number(i.stock_value_estimate||0),0);
  const preview = report==='docs'
    ? { title:'گزارش اسناد انبار', headers:['شماره','نوع','وضعیت','مشتری','شهر','تاریخ','ردیف','جمع مقدار'], rows: filteredDocs.map(d=>[d.doc_number||'موقت',warehouseDocumentLabel(d),STATUS_LABEL[d.status]||d.status,d.customer_name||'—',d.customer_city||'—',formatDate(d.created_at),d.line_count,d.total_quantity]) }
    : report==='value'
      ? { title:'گزارش ارزش موجودی', headers:['کد','کالا','گروه','مکان','موجودی','ارز','بهای پایه','فروش پایه','بهای روز','فروش روز','ارزش'], rows: filteredStock.map(i=>[i.item_code,i.item_name_fa,i.item_group||i.category||'—',i.location||'—',i.current_qty,i.has_currency_price?i.price_currency:'ثبت‌نشده',i.base_cost_price??'',i.base_sale_price??'',i.current_cost_rial||i.unit_price_estimate,i.current_sale_rial||i.unit_sale_price_estimate,i.stock_value_estimate]) }
      : { title:'گزارش کم‌موجودی', headers:['کد','کالا','گروه','مکان','موجودی','نقطه سفارش'], rows: low.map(i=>[i.item_code,i.item_name_fa,i.item_group||i.category||'—',i.location||'—',i.current_qty,i.reorder_point||i.min_stock_threshold]) };
  function output() {
    const tableRows=preview.rows.map(r=>`<tr>${r.map(c=>`<td>${safe(c)}</td>`).join('')}</tr>`).join('');
    const html=`<h1>${preview.title}</h1><table><thead><tr>${preview.headers.map(h=>`<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>`;
    if(format==='pdf') openPrintable(preview.title, html);
    else if(format==='word') downloadWordHtml(`${report}-warehouse-report.doc`, preview.title, html);
    else downloadExcelHtml(`${report}-warehouse-report.xls`, preview.headers, preview.rows, preview.title);
  }
  return <section className="warehouse-card reports-full"><div className="reports-head"><CardTitle icon={BarChart3} title="گزارش‌های انبار"/><div className="report-format"><span>نوع خروجی</span><select value={format} onChange={e=>setFormat(e.target.value)}><option value="excel">Excel</option><option value="pdf">PDF</option><option value="word">Word</option></select></div></div><div className="report-cards"><button className={report==='low'?'active':''} onClick={()=>setReport('low')}><b>کم‌موجودی</b><span>{low.length} کالا زیر نقطه سفارش</span></button><button className={report==='value'?'active':''} onClick={()=>setReport('value')}><b>ارزش موجودی</b><span>{formatMoney(value)}</span></button><button className={report==='docs'?'active':''} onClick={()=>setReport('docs')}><b>اسناد</b><span>{filteredDocs.length} سند انبار</span></button></div><div className="report-filter-panel">{report==='docs'?<><select value={filters.docType} onChange={e=>setFilters({...filters,docType:e.target.value})}><option value="all">همه نوع سند</option><option value="in">ورود</option><option value="out">خروج</option><option value="adjustment">اصلاح موجودی</option><option value="opening_balance">موجودی اول دوره</option></select><select value={filters.docStatus} onChange={e=>setFilters({...filters,docStatus:e.target.value})}><option value="all">همه وضعیت‌ها</option><option value="draft">موقت</option><option value="final">نهایی</option><option value="cancelled">لغوشده</option></select><input value={filters.customer} onChange={e=>setFilters({...filters,customer:e.target.value})} placeholder="مشتری/شهر"/><JalaliDateInput value={filters.dateFrom} onChange={v=>setFilters({...filters,dateFrom:v})}/><JalaliDateInput value={filters.dateTo} onChange={v=>setFilters({...filters,dateTo:v})}/></>:<><select value={filters.group} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="all">همه گروه‌ها</option>{groups.map(g=><option key={g}>{g}</option>)}</select><select value={filters.location} onChange={e=>setFilters({...filters,location:e.target.value})}><option value="">همه مکان‌ها</option>{locations.map(l=><option key={l} value={l}>{l}</option>)}</select><label className="check-filter"><input type="checkbox" checked={filters.lowOnly} onChange={e=>setFilters({...filters,lowOnly:e.target.checked})}/><span>فقط کم‌موجود</span></label></>}</div><div className="report-output clean"><h3>{preview.title}</h3><p>تعداد ردیف گزارش: {formatNumber(preview.rows.length)}</p><div className="warehouse-table-wrap report-preview"><table><thead><tr>{preview.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.slice(0,30).map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div><button onClick={output}>دریافت خروجی {format==='excel'?'Excel':format==='pdf'?'PDF':'Word'}</button></div></section>
}

function ShipmentsSection({ shipments = [], onNew, onEdit, onReverse, onArchive }) {
  const [filters, setFilters] = useState({ q: '', status: 'sent', kind: 'all', from: '', to: '' });
  const [sort, setSort] = useState({ key: 'shipment_date', dir: 'desc' });
  const stats = useMemo(() => shipmentStats(shipments), [shipments]);
  const filtered = useMemo(() => sortRows(shipments.filter((shipment) => {
    const normalizedStatus = normalizeShipmentStatus(shipment.status);
    const isManual = shipment.is_manual_record || (shipment.source_type === 'manual' && !shipment.related_order_id);
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'sent' && ['sent', 'delivered'].includes(shipment.status))
      || normalizedStatus === filters.status;
    return (!filters.q || shipmentSearchText(shipment).includes(filters.q.toLocaleLowerCase('fa')))
      && matchesStatus
      && (filters.kind === 'all' || (filters.kind === 'manual' ? isManual : !isManual))
      && (!filters.from || shipment.shipment_date >= filters.from)
      && (!filters.to || shipment.shipment_date <= filters.to);
  }), sort), [shipments, filters, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;

  function exportExcel() {
    const headers = ['شماره محموله','تاریخ','نوع ثبت','شماره سفارش','مشتری','کد مشتری','اقلام دقیق','تعداد کل','کارتون','حامل','کد رهگیری','تحویل‌گیرنده','سند خروج','فاکتور','وضعیت','یادداشت'];
    const rows = filtered.map((shipment) => [shipment.shipment_number, formatDate(shipment.shipment_date), shipmentSourceLabel(shipment), shipment.order_code || '—', shipment.customer_name || shipment.party_name || '—', shipment.customer_code || '—', shipmentLineText(shipment, ' | '), shipment.total_quantity, shipment.carton_count, shipment.carrier_name || '—', shipment.tracking_code || '—', shipment.receiver_name || '—', shipment.warehouse_doc_number || '—', shipment.finance_doc_number || '—', shipmentStatusLabel(shipment.status), shipment.notes || '—']);
    downloadExcelHtml('warehouse-shipments.xls', headers, rows, 'گزارش شفاف محموله‌های مشتری');
  }

  function printPdf() {
    const bodyRows = filtered.map((shipment, index) => `<tr><td>${index + 1}</td><td dir="ltr">${safe(shipment.shipment_number || '—')}</td><td>${formatDate(shipment.shipment_date)}</td><td>${safe(shipment.order_code || 'ثبت دستی')}</td><td>${safe(shipment.customer_name || shipment.party_name || '—')}</td><td>${safe(shipmentLineText(shipment, '؛ '))}</td><td>${safe([shipment.carrier_name, shipment.tracking_code].filter(Boolean).join(' · ') || '—')}</td><td>${safe(shipmentStatusLabel(shipment.status))}</td></tr>`).join('');
    openPrintable('گزارش محموله‌های مشتری', `<h1>گزارش محموله‌های مشتری</h1><p>هر ردیف یک محموله مستقل است؛ تعداد هر قلم داخل همان ردیف درج شده است.</p><table><thead><tr><th>ردیف</th><th>شماره</th><th>تاریخ</th><th>سفارش</th><th>مشتری</th><th>اقلام و تعداد</th><th>حمل</th><th>وضعیت</th></tr></thead><tbody>${bodyRows}</tbody></table>`);
  }

  return <section className="warehouse-card shipments-card shipment-management-card">
    <div className="section-head shipment-section-head"><div><CardTitle icon={FileText} title="مدیریت ارسال‌های مشتری"/><p>ارسال‌های سفارش به تفکیک هر محموله و هر قلم نمایش داده می‌شوند. ثبت دستی متنی، گردش موجودی ایجاد نمی‌کند.</p></div><div className="report-buttons"><button onClick={onNew}>＋ ثبت دستی متنی</button><button onClick={exportExcel}>Excel</button><button onClick={printPdf}>PDF</button></div></div>
    <div className="shipment-stat-tabs"><button className={filters.status === 'sent' ? 'active' : ''} onClick={() => setFilters({ ...filters, status: 'sent' })}><span>ارسال قطعی</span><b>{formatNumber(stats.sent)}</b></button><button className={filters.status === 'ready' ? 'active' : ''} onClick={() => setFilters({ ...filters, status: 'ready' })}><span>ثبت دستی آماده</span><b>{formatNumber(stats.ready)}</b></button><button className={filters.status === 'cancelled' ? 'active' : ''} onClick={() => setFilters({ ...filters, status: 'cancelled' })}><span>برگشت / لغو</span><b>{formatNumber(stats.cancelled)}</b></button><button className={filters.status === 'all' ? 'active' : ''} onClick={() => setFilters({ ...filters, status: 'all' })}><span>همه فعال</span><b>{formatNumber(stats.total)}</b></button></div>
    <div className="report-filter-panel shipment-filters-clean"><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="جست‌وجوی شماره سفارش، مشتری، کد کالا یا رهگیری..."/><select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}><option value="all">همه انواع ثبت</option><option value="structured">خروج ساختاریافته سفارش</option><option value="manual">ثبت دستی متنی</option></select><JalaliDateInput value={filters.from} onChange={(value) => setFilters({ ...filters, from: value })}/><JalaliDateInput value={filters.to} onChange={(value) => setFilters({ ...filters, to: value })}/><button type="button" onClick={() => setFilters({ q: '', status: 'sent', kind: 'all', from: '', to: '' })}>پاک‌کردن فیلتر</button></div>
    <div className="shipment-result-note"><b>{formatNumber(filtered.length)} محموله</b><span>هر شماره محموله مستقل است؛ چند ارسال یک سفارش عمداً در چند ردیف دیده می‌شود.</span></div>
    {filtered.length === 0 ? <Empty text="محموله‌ای مطابق این فیلتر وجود ندارد."/> : <div className="warehouse-table-wrap shipment-table-wrap"><table className="shipment-table"><thead><tr>{th('shipment_date','محموله / تاریخ')}<th>سفارش و مشتری</th><th>اقلام دقیق ارسال‌شده</th>{th('total_quantity','جمع تعداد')}<th>اطلاعات حمل</th>{th('status','وضعیت')}<th>عملیات</th></tr></thead><tbody>{filtered.map((shipment) => { const lines = shipmentLines(shipment); const isManual = shipment.is_manual_record || (shipment.source_type === 'manual' && !shipment.related_order_id); const canReverse = !isManual && ['sent','delivered'].includes(shipment.status) && !shipment.reversal_warehouse_document_id; return <tr key={shipment.id} className={shipment.status === 'cancelled' ? 'shipment-cancelled-row' : ''}>
      <td className="shipment-identity"><b dir="ltr">{shipment.shipment_number || '—'}</b><span>{formatDate(shipment.shipment_date)}</span><em className={isManual ? 'manual' : 'structured'}>{shipmentSourceLabel(shipment)}</em></td>
      <td className="shipment-order-customer"><b dir="ltr">{shipment.order_code || 'بدون سفارش'}</b><strong>{shipment.customer_name || shipment.party_name || '—'}</strong><small>{shipment.customer_code || '—'}{shipment.customer_city ? ` · ${shipment.customer_city}` : ''}</small></td>
      <td className="shipment-lines-cell">{lines.length > 0 ? <div className="shipment-line-list">{lines.map((line) => <div key={line.id || `${line.line_no}-${line.item_code}`}><span><b>{line.item_name}</b><small dir="ltr">{line.item_code || '—'}</small></span><strong>{formatNumber(line.quantity)} <small>{line.unit}</small></strong></div>)}</div> : <div className="manual-shipment-summary"><span>شرح متنی</span><p>{shipment.item_summary || '—'}</p></div>}</td>
      <td className="shipment-total-cell"><b>{formatNumber(shipment.total_quantity)}</b><small>{lines.length > 0 ? `${formatNumber(lines.length)} قلم` : 'ثبت متنی'}</small></td>
      <td className="shipment-logistics-cell"><span>{shipment.carrier_name || 'حامل ثبت نشده'}</span><b dir="ltr">{shipment.tracking_code || 'بدون کد رهگیری'}</b><small>تحویل‌گیرنده: {shipment.receiver_name || '—'} · {formatNumber(shipment.carton_count || 0)} بسته</small><small dir="ltr">{shipment.warehouse_doc_number || ''}</small></td>
      <td><span className={`shipment-status-badge ${normalizeShipmentStatus(shipment.status)}`}>{shipmentStatusLabel(shipment.status)}</span>{shipment.cancellation_reason && <small className="shipment-cancel-reason">{shipment.cancellation_reason}</small>}</td>
      <td><div className="shipment-row-actions"><button className="icon-action-btn" title={isManual ? 'ویرایش ثبت دستی' : 'ویرایش اطلاعات حمل'} aria-label="ویرایش اطلاعات ارسال" onClick={() => onEdit(shipment)}><Edit3 size={15}/></button>{canReverse && <button className="icon-action-btn reverse" title="برگشت ارسال و موجودی" aria-label="برگشت ارسال و موجودی" onClick={() => onReverse(shipment)}><RefreshCw size={15}/></button>}<button className="icon-action-btn danger" title="بایگانی از فهرست" aria-label="بایگانی ارسال" onClick={() => onArchive(shipment)}><Trash2 size={15}/></button></div></td>
    </tr>})}</tbody></table></div>}
  </section>;
}

function ShipmentModal({ initial, busy, onClose, onSubmit }) {
  const isStructured = Boolean(initial && (initial.is_structured || initial.related_order_id || initial.warehouse_document_id || (!initial.is_manual_record && initial.source_type !== 'manual')));
  const [form, setForm] = useState({ customer_name: initial?.customer_name || '', customer_city: initial?.customer_city || '', shipment_date: initial?.shipment_date || new Date().toISOString().slice(0,10), item_summary: initial?.item_summary || '', total_quantity: initial?.total_quantity || 0, carton_count: initial?.carton_count || 0, total_value: initial?.total_value || 0, carrier_name: initial?.carrier_name || '', tracking_code: initial?.tracking_code || '', receiver_name: initial?.receiver_name || '', status: normalizeShipmentStatus(initial?.status) || 'ready', notes: initial?.notes || '', source_type: initial?.source_type || 'manual', related_order_id: initial?.related_order_id || null, warehouse_document_id: initial?.warehouse_document_id || null, finance_document_id: initial?.finance_document_id || null, is_manual_record: initial?.is_manual_record ?? !isStructured, model_version: initial?.model_version || 2 });
  function submit(e) {
    e.preventDefault();
    onSubmit(form);
  }
  return <Modal title={initial ? (isStructured ? 'ویرایش اطلاعات حمل محموله' : 'ویرایش ثبت دستی متنی') : 'ثبت دستی متنی ارسال'} onClose={onClose}><form onSubmit={submit}>
    {isStructured ? <div className="structured-shipment-identity"><b>{initial.order_code || 'سفارش'}</b><span>{initial.customer_name || '—'}</span><small dir="ltr">{initial.shipment_number} · {initial.warehouse_doc_number || '—'}</small></div> : <div className="note manual-shipment-note"><b>ثبت دستی مستقل از موجودی</b><br/>این فرم برای یادداشت آزاد ارسال‌های خارج از گردش ساختاریافته است و هیچ سند خروج یا تغییر موجودی ایجاد نمی‌کند. خروج واقعی کالای سفارش فقط از دکمه «ثبت ارسال جدید» داخل همان سفارش انجام می‌شود.</div>}
    <div className="form-grid">{!isStructured && <><label><span>مشتری / مقصد *</span><input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required/></label><label><span>شهر</span><input value={form.customer_city} onChange={(e) => setForm({ ...form, customer_city: e.target.value })}/></label><label><span>تاریخ ارسال</span><JalaliDateInput value={form.shipment_date} onChange={(value) => setForm({ ...form, shipment_date: value })}/></label><label><span>تعداد کل *</span><input type="number" min="0.000001" step="any" value={form.total_quantity} onChange={(e) => setForm({ ...form, total_quantity: e.target.value })} required/></label><label><span>ارزش ریال</span><input type="number" min="0" value={form.total_value} onChange={(e) => setForm({ ...form, total_value: e.target.value })}/></label><label><span>وضعیت یادداشت</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ready">آماده / در انتظار</option><option value="sent">ارسال‌شده (بدون اثر موجودی)</option><option value="cancelled">لغو یادداشت</option></select></label><label className="full"><span>شرح آزاد کالاها و تعداد *</span><textarea value={form.item_summary} onChange={(e) => setForm({ ...form, item_summary: e.target.value })} required placeholder="مثال: ترانس مدل X، ۲۵۰ عدد؛ برد کنترل، ۱۰ عدد"/></label></>}
      <label><span>تعداد کارتن/بسته</span><input type="number" min="0" step="any" value={form.carton_count} onChange={(e) => setForm({ ...form, carton_count: e.target.value })}/></label><label><span>حامل / باربری</span><input value={form.carrier_name} onChange={(e) => setForm({ ...form, carrier_name: e.target.value })}/></label><label><span>کد رهگیری</span><input dir="ltr" value={form.tracking_code} onChange={(e) => setForm({ ...form, tracking_code: e.target.value })}/></label><label><span>تحویل‌گیرنده</span><input value={form.receiver_name} onChange={(e) => setForm({ ...form, receiver_name: e.target.value })}/></label><label className="full"><span>یادداشت</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label></div>
    <div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ذخیره</button></div>
  </form></Modal>;
}

function ReverseShipmentModal({ shipment, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return <Modal title="برگشت ارسال و اصلاح موجودی" onClose={onClose}><div className="confirm-box danger"><p>برای محموله <b dir="ltr">{shipment?.shipment_number}</b> یک سند ورود اصلاحی ساخته می‌شود، موجودی تمام اقلام همین محموله برمی‌گردد و مانده سفارش دوباره قابل ارسال خواهد شد. تاریخچه قبلی حذف نمی‌شود.</p><label className="shipment-reversal-reason"><span>دلیل برگشت *</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="علت اشتباه یا برگشت محموله را دقیق بنویسید."/></label><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy || !reason.trim()} className="danger-btn" onClick={() => onSubmit(reason)}>ثبت برگشت و سند ورود</button></div></div></Modal>;
}

function SettingsSection({ categories = [], stock = [], busy, onCreate, onUpdate, onArchive }) { const categoryCounts = useMemo(() => stock.reduce((acc, item) => { const key = item.item_group || item.category || ''; if (key) acc[key] = (acc[key] || 0) + 1; return acc; }, {}), [stock]); const [editing, setEditing] = useState(null); const [form, setForm] = useState({ name_fa: '', name_en: '', code: '', sort_order: 0 }); function save(e) { e.preventDefault(); if (!form.name_fa.trim()) return; const action = editing ? onUpdate(editing.id, { ...form, old_name: editing.name_fa }) : onCreate(form); Promise.resolve(action).then(() => { setEditing(null); setForm({ name_fa: '', name_en: '', code: '', sort_order: 0 }); }); } return <section className="warehouse-card"><CardTitle icon={Settings} title="تنظیمات انبار"/><div className="settings-grid"><Info title="سند موقت ورود/خروج" text="ورود و خروج ابتدا در سند موقت ثبت و بعد نهایی می‌شوند."/><Info title="شماره‌گذاری" text="شماره سندهای ورود و خروج به‌صورت خودکار ساخته می‌شود."/><Info title="حذف نرم کالا" text="کالا غیرفعال می‌شود و تاریخچه آن حفظ خواهد شد."/><Info title="اتصال ماژول‌ها" text="سفارش، فاکتور و تولید با گردش انبار هماهنگ هستند."/></div><div className="warehouse-category-settings"><div className="section-head"><CardTitle icon={Package} title="مدیریت دسته‌بندی کالاها"/><span className="note">دسته‌بندی‌های بایگانی‌شده در فهرست کالاهای جدید نمایش داده نمی‌شوند.</span></div><form className="category-form" onSubmit={save}><input value={form.name_fa} onChange={(e)=>setForm({...form,name_fa:e.target.value})} placeholder="نام دسته‌بندی فارسی" required/><input value={form.name_en} onChange={(e)=>setForm({...form,name_en:e.target.value})} placeholder="نام انگلیسی"/><input value={form.code} onChange={(e)=>setForm({...form,code:e.target.value})} placeholder="کد اختیاری"/><input type="number" value={form.sort_order} onChange={(e)=>setForm({...form,sort_order:e.target.value})} placeholder="ترتیب"/><button disabled={busy} type="submit">{editing ? 'ذخیره ویرایش' : '＋ افزودن دسته'}</button>{editing && <button type="button" onClick={()=>{setEditing(null);setForm({name_fa:'',name_en:'',code:'',sort_order:0})}}>انصراف</button>}</form><div className="category-list">{categories.map((c)=><div className="category-row" key={c.id}><b>{c.name_fa}</b><small>{c.code || c.name_en || 'بدون کد'}</small><em>{formatNumber(categoryCounts[c.name_fa] || 0)} کالا</em><span><button type="button" onClick={()=>{setEditing(c);setForm({name_fa:c.name_fa||'',name_en:c.name_en||'',code:c.code||'',sort_order:c.sort_order||0})}}>ویرایش</button><button type="button" className="danger" onClick={()=>onArchive(c.id)}>بایگانی</button></span></div>)}</div></div></section>}
function ItemModal({initial,categories=[],busy,onClose,onSubmit}){const [form,setForm]=useState({item_code:initial?.item_code||'',item_name_fa:initial?.item_name_fa||'',item_group:initial?.item_group||initial?.category||'بدون دسته‌بندی',unit:initial?.unit||'عدد',location:initial?.location||'',reorder_point:initial?.reorder_point||initial?.min_stock_threshold||0,stock_quantity:initial?.current_qty ?? 0,current_qty_snapshot:initial?.current_qty ?? 0});return <Modal title={initial?'ویرایش کالا':'کالای جدید'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit(form)}}><div className="form-grid"><label><span>کد کالا</span><input disabled={!!initial} value={form.item_code} onChange={e=>setForm({...form,item_code:e.target.value})} required/></label><label><span>نام کالا</span><input value={form.item_name_fa} onChange={e=>setForm({...form,item_name_fa:e.target.value})} required/></label><label><span>گروه</span><select value={form.item_group} onChange={e=>setForm({...form,item_group:e.target.value})}>{(categories.length ? categories.map((c) => c.name_fa) : ['بدون دسته‌بندی']).map(g=><option key={g}>{g}</option>)}</select></label><label><span>واحد</span><input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}/></label><label><span>مکان</span><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label><label><span>تعداد موجودی</span><input type="number" value={form.stock_quantity} onChange={e=>setForm({...form,stock_quantity:e.target.value})}/></label><label><span>نقطه سفارش</span><input type="number" value={form.reorder_point} onChange={e=>setForm({...form,reorder_point:e.target.value})}/></label></div><div className="note">موجودی اولیه به‌عنوان «سند اصلاحی موجودی اول دوره» و تغییرات بعدی تعداد به‌عنوان «سند اصلاح موجودی» ثبت می‌شوند. قیمت خرید و فروش در تب «همگام‌سازی انبارا ← قیمت‌گذاری ارزی» مدیریت می‌شود.</div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت</button></div></form></Modal>}

function MovementModal({item,direction,busy,onClose,onSubmit}){
  const [quantity,setQuantity]=useState(1),[reason,setReason]=useState(direction==='in'?'manual_in':'manual_out'),[note,setNote]=useState(''),[confirmNegative,setConfirmNegative]=useState(false);
  const willNegative = direction==='out' && Number(quantity||0) > Number(item.current_qty||0);
  function submit(e){e.preventDefault(); if(willNegative && !confirmNegative){setConfirmNegative(true); return;} onSubmit({itemId:item.item_id,direction,quantity,reason,note});}
  return <Modal title={`${direction==='in'?'ورود':'خروج'} سریع ${item.item_name_fa}`} onClose={onClose}><form onSubmit={submit}><div className="form-grid"><label><span>مقدار</span><input type="number" value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmNegative(false)}} required/></label><label><span>دلیل</span><select value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(REASONS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="full"><span>یادداشت</span><textarea value={note} onChange={e=>setNote(e.target.value)}/></label></div>{willNegative&&<div className="custom-warning-box"><b>هشدار موجودی منفی</b><p>موجودی فعلی این کالا {formatNumber(item.current_qty)} است. با خروج {formatNumber(quantity)}، موجودی منفی می‌شود. آیا مطمئن هستید؟</p>{confirmNegative&&<span>تأیید شد؛ دوباره روی «افزودن به سند موقت» بزنید.</span>}</div>}<div className="note">بعد از ثبت، این ردیف در سند موقت {direction==='in'?'ورود':'خروج'} قرار می‌گیرد و از بالای صفحه قابل مشاهده و تأیید است.</div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">{willNegative&&!confirmNegative?'بررسی و تأیید خروج':'افزودن به سند موقت'}</button></div></form></Modal>}
function ImportModal({busy,onClose,onSubmit}){
  const [fileName,setFileName]=useState('');
  const [rows,setRows]=useState([]);
  const [text,setText]=useState('item_code,item_name_fa,item_group,unit,location,quantity,reorder_point\nTR-220-12,ترانس سفارشی,Finished,عدد,A1,5,2\nPCB-CTRL,برد کنترلر,PCB,عدد,B2,10,3');
  function loadRowsFromText(value){setText(value);setRows(parseCsvText(value));setFileName('manual-import.csv')}
  function handleFile(e){const file=e.target.files?.[0];if(!file)return;setFileName(file.name);const reader=new FileReader();reader.onload=(ev)=>{const data=ev.target.result;let parsed=[];if(file.name.toLowerCase().endsWith('.csv')){const txt=new TextDecoder('utf-8').decode(new Uint8Array(data));setText(txt);parsed=parseCsvText(txt)}else{const wb=XLSX.read(data,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];parsed=XLSX.utils.sheet_to_json(ws,{defval:''});setText('')};setRows(parsed)};reader.readAsArrayBuffer(file)}
  const preview=rows.slice(0,8);
  return <Modal title="ورود از اکسل/CSV انبارا" onClose={onClose}><div className="note">قالب استاندارد: item_code, item_name_fa, item_group, unit, location, quantity, reorder_point. فایل Excel/CSV فقط مشخصات و موجودی را همگام می‌کند و قیمت‌های دلاری/یوانی را تغییر نمی‌دهد.</div><div className="import-tools"><a className="template-link" href="/templates/warehouse_import_template.xlsx" download>دانلود قالب Excel نمونه</a><button type="button" onClick={()=>downloadCsv('warehouse_import_template.csv',[['item_code','item_name_fa','item_group','unit','location','quantity','reorder_point'],['TR-220-12','ترانس سفارشی','Finished','عدد','A1','5','2']])}>دانلود CSV نمونه</button><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}/></div><textarea className="import-text" value={text} onChange={e=>loadRowsFromText(e.target.value)} placeholder="یا محتوای CSV را اینجا paste کنید"/>{preview.length>0&&<div className="warehouse-table-wrap import-preview"><table><thead><tr><th>کد</th><th>نام</th><th>گروه</th><th>واحد</th><th>مکان</th><th>تعداد</th><th>نقطه سفارش</th></tr></thead><tbody>{preview.map((r,i)=><tr key={i}><td dir="ltr">{r.item_code}</td><td>{r.item_name_fa}</td><td>{r.item_group}</td><td>{r.unit}</td><td>{r.location}</td><td>{r.quantity}</td><td>{r.reorder_point}</td></tr>)}</tbody></table></div>}<div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy||rows.length===0} onClick={()=>onSubmit({fileName:fileName||'manual-import.csv',rows,notes:'Warehouse Excel/CSV import'})}>ثبت Snapshot ({rows.length})</button></div></Modal>}
function ReferralModal({busy,onClose,onSubmit}){const [title,setTitle]=useState('درخواست بررسی/خرید انبار'),[target,setTarget]=useState('accounting'),[role,setRole]=useState('accountant');return <Modal title="ارجاع انبار" onClose={onClose}><form onSubmit={e=>{e.preventDefault();onSubmit({title,targetModule:target,targetRole:role})}}><div className="form-grid"><label><span>مقصد</span><select value={target} onChange={e=>{setTarget(e.target.value);setRole(e.target.value==='accounting'?'accountant':e.target.value==='orders'?'sales':e.target.value==='production'?'production':'admin')}}><option value="accounting">مالی</option><option value="orders">سفارش‌ها</option><option value="production">تولید</option><option value="admin">مدیر کل</option></select></label><label className="full"><span>عنوان</span><input value={title} onChange={e=>setTitle(e.target.value)} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت ارجاع</button></div></form></Modal>}
function ConfirmModal({ title, message, confirmText = 'تأیید', danger, busy, onClose, onConfirm }) {
  return <Modal title={title} onClose={onClose}><div className={danger?'confirm-box danger':'confirm-box'}><p>{message}</p><div className="modal-actions"><button type="button" onClick={onClose}>خیر، انصراف</button><button disabled={busy} className={danger?'danger-btn':''} onClick={onConfirm}>{confirmText}</button></div></div></Modal>
}
function LineEditModal({ line, busy, onClose, onSubmit }) {
  const [quantity,setQuantity]=useState(line?.quantity||1);
  return <Modal title="ویرایش ردیف سند" onClose={onClose}><div className="form-grid"><label><span>کالا</span><input readOnly value={`${line?.warehouse_items?.item_code||'—'} · ${line?.warehouse_items?.item_name_fa||'—'}`}/></label><label><span>مقدار جدید</span><input type="number" value={quantity} onChange={e=>setQuantity(e.target.value)} autoFocus/></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy || Number(quantity)<=0} onClick={()=>onSubmit(quantity)}>ذخیره مقدار</button></div></Modal>
}
function StocktakeModal({ item, busy, onClose, onSubmit }) {
  const [realQty,setRealQty]=useState(item?.current_qty||0);
  return <Modal title="انبارگردانی سریع" onClose={onClose}><div className="form-grid"><label><span>کالا</span><input readOnly value={`${item?.item_code||'—'} · ${item?.item_name_fa||'—'}`}/></label><label><span>موجودی فعلی سیستم</span><input readOnly value={item?.current_qty||0}/></label><label><span>موجودی واقعی شمارش‌شده</span><input type="number" value={realQty} onChange={e=>setRealQty(e.target.value)} autoFocus/></label></div><div className="note">اختلاف شمارش به‌صورت یک سند اصلاح موجودی نهایی ثبت می‌شود و فقط در کاردکس اختصاصی همین کالا نمایش داده خواهد شد.</div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} onClick={()=>onSubmit(realQty)}>ثبت انبارگردانی</button></div></Modal>
}
function Modal({title,onClose,children}){return <div className="warehouse-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="warehouse-modal"><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>}
function nextSort(current, key) {
  return { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
}
function sortRows(rows, sort) {
  const key = sort?.key;
  const dir = sort?.dir === 'desc' ? -1 : 1;
  if (!key) return rows;
  return [...rows].sort((a,b)=>{
    const av = a?.[key] ?? '';
    const bv = b?.[key] ?? '';
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') return (an-bn)*dir;
    return String(av).localeCompare(String(bv), 'fa') * dir;
  });
}
function CardTitle({icon:Icon,title,action}){return <div className="warehouse-card-title"><span><Icon size={18}/><b>{title}</b></span>{action}</div>}function Info({title,text}){return <div className="warehouse-info"><span>{title}</span><b>{text??'—'}</b></div>}function Empty({text='داده‌ای برای نمایش نیست.'}){return <div className="warehouse-empty">{text}</div>}function formatDate(v){return formatJalaliDate(v)}function formatMoney(v){return `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(v||0)/10))} تومان`}function safe(value){return String(value ?? '').replace(/[&<>"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
