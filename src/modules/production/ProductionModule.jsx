import { useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileText,
  FlaskConical,
  ListChecks,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Wrench,
  X,
} from 'lucide-react';
import JalaliDateInput from '../../components/JalaliDateInput';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import { formatJalaliDate, formatJalaliDateTime, formatNumber, formatToman } from '../../lib/formatters';
import { useProductionData } from '../../hooks/useProductionData';
import {
  acceptProductionOrder,
  createProductionDocument,
  createProductionQc,
  createProductionStep,
  createProductionTemplate,
  downloadProductionExcel,
  openProductionPrintable,
  productionSafe,
  saveProductionBom,
  saveProductionPlan,
  sendBomCostToFinance,
  setProductionStage,
  updateProductionStep,
  updateProductionTemplate,
  voidProductionDocument,
} from '../../lib/productionApi';
import './ProductionModule.css';

const STATUS_LABELS = {
  draft: 'پیش‌نویس', planned: 'برنامه‌ریزی‌شده', in_progress: 'در حال تولید', qc_pending: 'در انتظار QC', qc_rejected: 'رد QC', completed: 'تکمیل‌شده', delivered_to_warehouse: 'تحویل انبار', cancelled: 'لغوشده',
};
const DELIVERY_LABELS = { cancelled: 'لغوشده', completed: 'تکمیل', late: 'عقب‌افتاده', due_soon: 'نزدیک تحویل', on_track: 'طبق برنامه' };
const STAGE_STATUS_LABELS = { pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'انجام‌شده', on_hold: 'متوقف', rejected: 'رد شده' };
const QC_LABELS = { passed: 'قبول', failed: 'رد', rework: 'نیاز به اصلاح' };
const PRODUCT_TYPE_LABELS = { power_switching: 'پاور سوئیچینگ', pcb_board: 'برد', full_product: 'محصول کامل', custom: 'سفارشی' };
const COST_TYPE_LABELS = { material: 'متریال', labor: 'نیروی انسانی', overhead: 'سربار', service: 'خدمات' };

export default function ProductionModule({ lang = 'fa' }) {
  const data = useProductionData();
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [selectedProductionId, setSelectedProductionId] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const selectedOrder = useMemo(() => data.productionOrders.find((o) => o.id === selectedProductionId), [data.productionOrders, selectedProductionId]);
  const selectedStages = useMemo(() => data.stages.filter((s) => s.production_order_id === selectedProductionId).sort((a, b) => Number(a.order_index) - Number(b.order_index)), [data.stages, selectedProductionId]);
  const selectedPlan = useMemo(() => data.plans.find((p) => p.production_order_id === selectedProductionId), [data.plans, selectedProductionId]);
  const selectedQc = useMemo(() => data.qc.filter((q) => q.production_order_id === selectedProductionId), [data.qc, selectedProductionId]);
  const selectedDocs = useMemo(() => data.documents.filter((d) => d.production_order_id === selectedProductionId), [data.documents, selectedProductionId]);

  const filteredOrders = useMemo(() => data.productionOrders.filter((o) => {
    const text = `${o.code || ''} ${o.order_code || ''} ${o.source_order_code || ''} ${o.customer_name || ''} ${o.product_name_fa || ''} ${o.current_stage_name_fa || ''}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  }), [data.productionOrders, query]);

  const kpis = useMemo(() => ({
    incoming: data.incomingOrders.length,
    active: data.productionOrders.filter((o) => !['completed', 'delivered_to_warehouse', 'cancelled'].includes(o.status)).length,
    late: data.productionOrders.filter((o) => o.delivery_status === 'late').length,
    dueSoon: data.productionOrders.filter((o) => o.delivery_status === 'due_soon').length,
    qc: data.qc.filter((q) => q.result === 'failed' || q.result === 'rework').length,
    bom: data.boms.length,
    docs: data.documents.length,
    cost: data.boms.reduce((sum, b) => sum + Number(b.total_estimated_cost || 0), 0),
  }), [data]);

  async function runAction(fn, ok) {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      setModal(null);
      await data.refetch();
    } catch (e) {
      setNotice(e.message || 'خطا در عملیات تولید');
    } finally {
      setBusy(false);
    }
  }

  function exportOrders() {
    const headers = ['کد تولید', 'سفارش', 'مشتری', 'محصول', 'وضعیت', 'مرحله', 'پیشرفت', 'تعداد', 'شروع', 'پایان', 'روز مانده', 'نفرساعت'];
    const rows = filteredOrders.map((o) => [o.code, o.order_code || o.source_order_code, o.customer_name, o.product_name_fa, STATUS_LABELS[o.status] || o.status, o.current_stage_name_fa, `${o.progress_percent || 0}%`, o.quantity_planned, formatDate(o.planned_start), formatDate(o.planned_end), daysText(o.days_to_delivery, o.delivery_status), o.total_man_hours || '—']);
    downloadProductionExcel('production-orders.xls', headers, rows, 'گزارش سفارش‌های تولید');
  }

  function printOrders() {
    const rows = filteredOrders.map((o) => `<tr><td>${safe(o.code)}</td><td>${safe(o.order_code || o.source_order_code || '—')}</td><td>${safe(o.customer_name || '—')}</td><td>${safe(o.product_name_fa)}</td><td>${STATUS_LABELS[o.status] || o.status}</td><td>${safe(o.current_stage_name_fa || '—')}</td><td>${formatNumber(o.progress_percent)}٪</td><td>${daysText(o.days_to_delivery, o.delivery_status)}</td></tr>`).join('');
    openProductionPrintable('گزارش سفارش‌های تولید', `<h1>گزارش سفارش‌های تولید</h1><table><thead><tr><th>کد تولید</th><th>سفارش</th><th>مشتری</th><th>محصول</th><th>وضعیت</th><th>مرحله</th><th>پیشرفت</th><th>موعد</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  return <div className="production-page" dir="rtl" lang={lang}>
    <header className="production-hero">
      <div>
        <div className="eyebrow">Production · Workflow · BOM · QC</div>
        <h1>تولید</h1>
        <p>تأیید سفارش‌های ارسالی از فروش، برنامه‌ریزی تولید، فرمول ساخت، کنترل کیفیت، اسناد تولید و اطلاع‌رسانی به سفارش/مالی/انبار.</p>
      </div>
      <div className="production-actions">
        <button className="primary" onClick={() => setTab('incoming')}><CheckCircle2 size={16}/> تأیید سفارش</button>
        <button onClick={() => setTab('flow')}><ListChecks size={16}/> مراحل تولید</button>
        <button onClick={data.refetch}><RefreshCw size={16}/> به‌روزرسانی</button>
      </div>
    </header>

    {notice && <div className="production-message">{notice}</div>}
    {data.loading && <div className="production-message">در حال دریافت اطلاعات تولید...</div>}
    {data.error && <div className="production-message error">{data.error.message}</div>}

    <nav className="production-tabs">
      {[
        ['overview', 'نمای کلی'], ['flow', 'مراحل تولید'], ['incoming', 'لیست سفارش‌ها'], ['planning', 'برنامه‌ریزی تولید'], ['bom', 'فرمول تولید کالا'], ['qc', 'کنترل کیفیت'], ['docs', 'اسناد تولید'], ['refs', 'ارجاع'], ['settings', 'تنظیم مراحل']
      ].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {!data.loading && tab === 'overview' && <Overview kpis={kpis} orders={data.productionOrders} incoming={data.incomingOrders} setTab={setTab} onSelect={setSelectedProductionId} />}
    {!data.loading && tab === 'incoming' && <IncomingOrders orders={data.incomingOrders} templates={data.templates} busy={busy} onAccept={(order) => setModal({ type: 'accept', order })} />}
    {!data.loading && tab === 'flow' && <FlowSection orders={filteredOrders} stages={data.stages} selectedOrder={selectedOrder} selectedStages={selectedStages} selectedPlan={selectedPlan} selectedQc={selectedQc} selectedDocs={selectedDocs} query={query} setQuery={setQuery} busy={busy} onSelect={setSelectedProductionId} onClose={() => setSelectedProductionId(null)} onSetStage={(stage, status) => runAction(() => setProductionStage(stage.id, status, `تغییر مرحله ${stageName(stage)}`), 'مرحله تولید تغییر کرد.')} onPlan={(order) => setModal({ type: 'plan', order })} onQc={(order) => setModal({ type: 'qc', order })} onDocument={(order) => setModal({ type: 'doc', order })} onExport={exportOrders} onPrint={printOrders} />}
    {!data.loading && tab === 'planning' && <PlanningSection orders={filteredOrders} plans={data.plans} onPlan={(order) => setModal({ type: 'plan', order })} />}
    {!data.loading && tab === 'bom' && <BomSection boms={data.boms} bomItems={data.bomItems} stock={data.stock} busy={busy} onNew={() => setModal({ type: 'bom' })} onEdit={(bom) => setModal({ type: 'bom', bom })} onSendFinance={(bom) => runAction(() => sendBomCostToFinance(bom.id), 'هزینه تولید به مالی ارجاع شد.')} />}
    {!data.loading && tab === 'qc' && <QcSection qc={data.qc} orders={data.productionOrders} stages={data.stages} onNew={() => setModal({ type: 'qc' })} />}
    {!data.loading && tab === 'docs' && <DocumentsSection docs={data.documents} orders={data.productionOrders} onNew={() => setModal({ type: 'doc' })} onVoid={(doc) => runAction(() => voidProductionDocument(doc.id), 'سند تولید باطل شد.')} />}
    {!data.loading && tab === 'refs' && <div className="production-grid"><ReferralPanel sourceModule="production" title="ارجاعات تولید" defaultTarget="warehouse" /></div>}
    {!data.loading && tab === 'settings' && <SettingsSection templates={data.templates} steps={data.templateSteps} busy={busy} onCreateTemplate={(payload) => runAction(() => createProductionTemplate(payload), 'قالب تولید ساخته شد.')} onUpdateTemplate={(id, patch) => runAction(() => updateProductionTemplate(id, patch), 'قالب تولید ذخیره شد.')} onCreateStep={(payload) => runAction(() => createProductionStep(payload), 'مرحله تولید اضافه شد.')} onUpdateStep={(id, patch) => runAction(() => updateProductionStep(id, patch), 'مرحله تولید ذخیره شد.')} />}

    {modal?.type === 'accept' && <AcceptOrderModal order={modal.order} templates={data.templates} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => acceptProductionOrder(payload), 'سفارش وارد تولید شد.')} />}
    {modal?.type === 'plan' && <PlanModal order={modal.order || selectedOrder} plan={data.plans.find((p) => p.production_order_id === (modal.order?.id || selectedOrder?.id))} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => saveProductionPlan(payload), 'برنامه‌ریزی تولید ذخیره و به سفارش اطلاع داده شد.')} />}
    {modal?.type === 'bom' && <BomModal bom={modal.bom} stock={data.stock} existingItems={data.bomItems.filter((i) => i.bom_id === modal.bom?.id)} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => saveProductionBom(payload), 'فرمول تولید ذخیره شد.')} />}
    {modal?.type === 'qc' && <QcModal order={modal.order || selectedOrder} orders={data.productionOrders} stages={data.stages} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createProductionQc(payload), 'کنترل کیفیت ثبت شد.')} />}
    {modal?.type === 'doc' && <DocumentModal order={modal.order || selectedOrder} orders={data.productionOrders} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createProductionDocument(payload), 'سند تولید ثبت شد.')} />}
  </div>;
}

function Overview({ kpis, orders, incoming, setTab, onSelect }) {
  const active = orders.filter((o) => !['completed', 'delivered_to_warehouse', 'cancelled'].includes(o.status)).slice(0, 6);
  return <>
    <section className="production-kpis">
      <Kpi icon="📥" label="در انتظار تأیید" value={kpis.incoming} warning />
      <Kpi icon="🏭" label="فعال" value={kpis.active} />
      <Kpi icon="⚠️" label="عقب‌افتاده" value={kpis.late} danger />
      <Kpi icon="⏳" label="تحویل نزدیک" value={kpis.dueSoon} warning />
      <Kpi icon="🧪" label="QC نیازمند توجه" value={kpis.qc} danger />
      <Kpi icon="🧾" label="فرمول تولید" value={kpis.bom} />
      <Kpi icon="📄" label="اسناد" value={kpis.docs} />
      <Kpi icon="💰" label="هزینه فرمول‌ها" value={formatMoney(kpis.cost)} success />
    </section>
    <div className="production-grid two">
      <section className="production-card"><CardTitle icon={CheckCircle2} title="سفارش‌های آماده تأیید" action={<button onClick={() => setTab('incoming')}>تأیید سفارش</button>} />{incoming.length ? <div className="production-timeline">{incoming.slice(0, 7).map((o) => <article key={o.order_id}><strong>{o.order_code} · {o.customer_name}</strong><small>{o.title_fa} · موعد {formatDate(o.expected_delivery_date)}</small></article>)}</div> : <Empty text="سفارش تولیدی جدیدی از فروش نرسیده است." />}</section>
      <section className="production-card"><CardTitle icon={Factory} title="تولیدهای فعال" action={<button onClick={() => setTab('flow')}>مراحل تولید</button>} />{active.length ? <div className="production-timeline">{active.map((o) => <button key={o.id} className="active-production" onClick={() => onSelect(o.id)}><span><b>{o.code}</b><small>{o.product_name_fa} · {o.current_stage_name_fa || '—'}</small></span><Status status={o.delivery_status} /></button>)}</div> : <Empty />}</section>
    </div>
  </>;
}

function IncomingOrders({ orders, templates, busy, onAccept }) {
  return <section className="production-card"><CardTitle icon={CheckCircle2} title="تأیید سفارش‌های رسیده از سفارش‌ها" />{orders.length === 0 ? <Empty text="سفارش جدیدی برای تولید وجود ندارد." /> : <div className="production-table-wrap"><table><thead><tr><th>کد سفارش</th><th>مشتری</th><th>عنوان</th><th>موعد</th><th>اقلام</th><th>اولویت</th><th>عملیات</th></tr></thead><tbody>{orders.map((o) => <tr key={o.order_id}><td dir="ltr">{o.order_code}</td><td>{o.customer_name}</td><td>{o.title_fa}</td><td>{formatDate(o.expected_delivery_date)}</td><td>{formatNumber(o.item_count)} قلم / {formatNumber(o.total_quantity)}</td><td>{priorityText(o.priority)}</td><td><button disabled={busy} onClick={() => onAccept(o)}>تأیید و ورود به تولید</button></td></tr>)}</tbody></table></div>}</section>;
}

function FlowSection({ orders, stages, selectedOrder, selectedStages, selectedPlan, selectedQc, selectedDocs, query, setQuery, busy, onSelect, onClose, onSetStage, onPlan, onQc, onDocument, onExport, onPrint }) {
  return <section className="production-card production-flow-workspace">
    <div className="flow-section-head"><div><CardTitle icon={ListChecks} title="مراحل تولید" /><p className="muted">نمای خطی تولید مثل سفارش‌ها؛ مرحله فعلی، درصد پیشرفت و زمان باقی‌مانده.</p></div><div className="filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی کد تولید، مشتری، محصول..." /><button onClick={onExport}>Excel</button><button onClick={onPrint}>PDF</button></div></div>
    {orders.length === 0 ? <Empty /> : <div className="production-flow-list">{orders.map((o) => {
      const orderStages = stages.filter((s) => s.production_order_id === o.id).sort((a, b) => Number(a.order_index) - Number(b.order_index));
      return <article key={o.id} className="production-flow-card">
        <div className="flow-card-top"><div><h3>{o.code} · {o.product_name_fa}</h3><small>{o.customer_name || '—'} · سفارش {o.order_code || o.source_order_code || '—'} · مرحله فعلی: {o.current_stage_name_fa || '—'}</small></div><div className="flow-badges"><Status status={o.delivery_status} /><span>{STATUS_LABELS[o.status] || o.status}</span></div></div>
        <div className="advanced-progress"><span style={{ width: `${Number(o.progress_percent || 0)}%` }} /></div>
        <div className="flow-progress-note">پیشرفت: {formatNumber(o.progress_percent)}٪ · نفرساعت: {o.total_man_hours || '—'} · روز کاری: {o.work_days || '—'}</div>
        <div className="stage-stepper production-stepper">{orderStages.map((s, i) => <div key={s.id} className={`stage-step ${s.status}`}><div className="stage-dot">{s.status === 'completed' ? '✓' : i + 1}</div><small>{stageName(s)}</small></div>)}</div>
        <div className="production-flow-footer"><div className="dueBox"><span>{daysText(o.days_to_delivery, o.delivery_status)}</span><b>تا تحویل نهایی</b><small>{formatDate(o.planned_end)}</small></div><button onClick={() => onSelect(o.id)}>جزئیات و عملیات</button></div>
      </article>;
    })}</div>}
    {selectedOrder && <div className="production-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="production-detail-drawer"><ProductionDetail order={selectedOrder} stages={selectedStages} plan={selectedPlan} qc={selectedQc} docs={selectedDocs} busy={busy} onClose={onClose} onSetStage={onSetStage} onPlan={onPlan} onQc={onQc} onDocument={onDocument} /></aside></div>}
  </section>;
}

function ProductionDetail({ order, stages, plan, qc, docs, busy, onClose, onSetStage, onPlan, onQc, onDocument }) {
  return <section className="production-card detail-card"><CardTitle icon={FileText} title={`جزئیات ${order.code}`} action={<button onClick={onClose}>بستن ×</button>} />
    <div className="detail-mini-grid"><Info label="مشتری" value={order.customer_name} /><Info label="محصول" value={order.product_name_fa} /><Info label="وضعیت" value={STATUS_LABELS[order.status] || order.status} /><Info label="مرحله" value={order.current_stage_name_fa} /><Info label="پیشرفت" value={`${formatNumber(order.progress_percent)}٪`} /><Info label="موعد" value={daysText(order.days_to_delivery, order.delivery_status)} /><Info label="روز کاری" value={order.work_days} /><Info label="نفرساعت" value={order.total_man_hours} /><Info label="هزینه" value={formatMoney(order.estimated_total_cost)} /></div>
    <div className="detail-actions"><button onClick={() => onPlan(order)}>برنامه‌ریزی</button><button onClick={() => onQc(order)}>ثبت QC</button><button onClick={() => onDocument(order)}>سند تولید</button></div>
    <section className="detail-block"><h3>مراحل تولید</h3><div className="stage-buttons">{stages.map((s) => <button key={s.id} disabled={busy} className={s.status} onClick={() => onSetStage(s, s.status === 'completed' ? 'in_progress' : 'completed')}>{s.order_index}. {stageName(s)} · {STAGE_STATUS_LABELS[s.status] || s.status}</button>)}</div></section>
    <section className="detail-block"><h3>برنامه تولید</h3>{plan ? <div className="detail-mini-grid"><Info label="شروع" value={formatDate(plan.planned_start)} /><Info label="پایان" value={formatDate(plan.planned_end)} /><Info label="روز کاری" value={plan.work_days} /><Info label="نیرو" value={plan.labor_people} /><Info label="ساعت نفر" value={plan.total_man_hours} /><Info label="شرح" value={plan.delivery_note} /></div> : <p className="muted">هنوز برنامه‌ریزی ثبت نشده است.</p>}</section>
    <section className="detail-block"><h3>QC و اسناد</h3><div className="production-timeline compact">{qc.map((q) => <article key={q.id}><strong>{QC_LABELS[q.result] || q.result}</strong><small>{formatDateTime(q.checked_at)} · رد: {q.quantity_rejected || 0} · {q.rejection_reason || ''}</small></article>)}{docs.map((d) => <article key={d.id}><strong>{d.doc_number || '—'} · {d.title_fa}</strong><small>{d.document_type} · {formatDate(d.created_at)}</small></article>)}</div></section>
  </section>;
}

function PlanningSection({ orders, plans, onPlan }) {
  return <section className="production-card"><CardTitle icon={BarChart3} title="برنامه‌ریزی تولید" />{orders.length === 0 ? <Empty /> : <div className="planning-grid">{orders.map((o) => { const p = plans.find((x) => x.production_order_id === o.id); return <article key={o.id} className="planning-card"><header><h3>{o.code}</h3><Status status={o.delivery_status} /></header><p>{o.product_name_fa} · {o.customer_name || '—'}</p><div className="detail-mini-grid"><Info label="شروع" value={formatDate(p?.planned_start || o.planned_start)} /><Info label="پایان" value={formatDate(p?.planned_end || o.planned_end)} /><Info label="روز کاری" value={p?.work_days || o.work_days} /><Info label="نفرساعت" value={p?.total_man_hours || o.total_man_hours} /></div><button onClick={() => onPlan(o)}>ثبت/ویرایش برنامه</button></article>; })}</div>}</section>;
}

function BomSection({ boms, bomItems, stock, busy, onNew, onEdit, onSendFinance }) {
  return <section className="production-card"><div className="section-head"><CardTitle icon={FlaskConical} title="فرمول تولید کالا و هزینه‌ها" /><button onClick={onNew}>＋ فرمول جدید</button></div>{boms.length === 0 ? <Empty text="فرمول تولیدی ثبت نشده است." /> : <div className="bom-grid">{boms.map((b) => <article key={b.id} className="bom-card"><header><div><h3>{b.product_name_fa}</h3><p>{b.warehouse_item_code || 'کالای جدید/بدون کد'} · {b.version_no}</p></div><span>{b.status}</span></header><div className="bom-costs"><Info label="متریال" value={formatMoney(b.total_material_cost)} /><Info label="نیرو/خدمات" value={formatMoney(b.total_labor_cost)} /><Info label="سربار" value={formatMoney(b.total_overhead_cost)} /><Info label="جمع" value={formatMoney(b.total_estimated_cost)} /></div><small>{formatNumber(b.item_count)} ردیف هزینه</small><div className="row-actions"><button onClick={() => onEdit(b)}>ویرایش</button><button disabled={busy} onClick={() => onSendFinance(b)}>ارجاع هزینه به مالی</button></div></article>)}</div>}</section>;
}

function QcSection({ qc, orders, stages, onNew }) {
  const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
  return <section className="production-card"><div className="section-head"><CardTitle icon={PackageCheck} title="کنترل کیفیت تولید" /><button onClick={onNew}>＋ ثبت QC</button></div>{qc.length === 0 ? <Empty /> : <div className="production-table-wrap"><table><thead><tr><th>تولید</th><th>نتیجه</th><th>تعداد بررسی</th><th>قبول</th><th>رد</th><th>دلیل</th><th>تاریخ</th></tr></thead><tbody>{qc.map((q) => <tr key={q.id}><td>{orderById[q.production_order_id]?.code || '—'}</td><td>{QC_LABELS[q.result] || q.result}</td><td>{q.quantity_checked || '—'}</td><td>{q.quantity_passed || '—'}</td><td>{q.quantity_rejected || '—'}</td><td>{q.rejection_reason || '—'}</td><td>{formatDateTime(q.checked_at)}</td></tr>)}</tbody></table></div>}</section>;
}

function DocumentsSection({ docs, orders, onNew, onVoid }) {
  const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
  return <section className="production-card"><div className="section-head"><CardTitle icon={FileText} title="اسناد تولید" /><button onClick={onNew}>＋ سند تولید</button></div>{docs.length === 0 ? <Empty /> : <div className="production-table-wrap"><table><thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>تولید</th><th>وضعیت</th><th>تاریخ</th><th>عملیات</th></tr></thead><tbody>{docs.map((d) => <tr key={d.id}><td dir="ltr">{d.doc_number}</td><td>{d.document_type}</td><td>{d.title_fa}</td><td>{orderById[d.production_order_id]?.code || '—'}</td><td>{d.status}</td><td>{formatDate(d.created_at)}</td><td><button disabled={d.status === 'void'} onClick={() => onVoid(d)}>ابطال</button></td></tr>)}</tbody></table></div>}</section>;
}

function SettingsSection({ templates, steps, busy, onCreateTemplate, onUpdateTemplate, onCreateStep, onUpdateStep }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || '');
  const [newTemplate, setNewTemplate] = useState({ nameFa: '', productType: 'custom', stageCount: 6 });
  const [newStep, setNewStep] = useState({ stage_key: '', stage_name_fa: '', stage_order: 1, responsible_role: 'production' });
  const selected = templates.find((t) => t.id === selectedId) || templates[0];
  const selectedSteps = steps.filter((s) => s.template_id === selected?.id).sort((a, b) => Number(a.stage_order) - Number(b.stage_order));

  function submitTemplate(e) { e.preventDefault(); if (newTemplate.nameFa.trim()) onCreateTemplate(newTemplate); setNewTemplate({ nameFa: '', productType: 'custom', stageCount: 6 }); }
  function submitStep(e) { e.preventDefault(); if (!selected || !newStep.stage_key || !newStep.stage_name_fa) return; onCreateStep({ template_id: selected.id, stage_key: newStep.stage_key, stage_order: Number(newStep.stage_order || selectedSteps.length + 1), stage_name_fa: newStep.stage_name_fa, stage_name_en: newStep.stage_key, responsible_role: newStep.responsible_role || null, is_active: true }); setNewStep({ stage_key: '', stage_name_fa: '', stage_order: selectedSteps.length + 2, responsible_role: 'production' }); }

  return <section className="production-card configurable-stages"><CardTitle icon={Settings} title="تنظیم قالب‌ها و مراحل تولید" /><p className="muted">قالب‌های تولید مثل پاور سوئیچینگ، برد، محصول کامل و قالب‌های جدید با ۴ تا ۱۵ مرحله قابل ساخت و ویرایش هستند.</p>
    <form className="new-template-form" onSubmit={submitTemplate}><input value={newTemplate.nameFa} onChange={(e) => setNewTemplate({ ...newTemplate, nameFa: e.target.value })} placeholder="نام قالب جدید تولید" /><select value={newTemplate.productType} onChange={(e) => setNewTemplate({ ...newTemplate, productType: e.target.value })}>{Object.entries(PRODUCT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><select value={newTemplate.stageCount} onChange={(e) => setNewTemplate({ ...newTemplate, stageCount: Number(e.target.value) })}>{Array.from({ length: 12 }).map((_, i) => <option key={i + 4} value={i + 4}>{i + 4} مرحله</option>)}</select><button disabled={busy} type="submit">＋ ساخت قالب</button></form>
    <div className="template-settings-grid"><aside className="template-list-panel"><h3>قالب‌های تولید</h3>{templates.map((t) => <button key={t.id} className={selected?.id === t.id ? 'active' : ''} onClick={() => setSelectedId(t.id)}><b>{t.name_fa}</b><span>{PRODUCT_TYPE_LABELS[t.product_type] || t.product_type} · {t.is_active ? 'فعال' : 'غیرفعال'} · {steps.filter((s) => s.template_id === t.id && s.is_active).length} مرحله</span></button>)}</aside><div className="template-editor-panel">{selected && <><div className="template-editor-head"><div><h3>{selected.name_fa}</h3><p>{PRODUCT_TYPE_LABELS[selected.product_type] || selected.product_type}</p></div><button onClick={() => onUpdateTemplate(selected.id, { is_active: !selected.is_active })}>{selected.is_active ? 'غیرفعال کردن' : 'فعال کردن'}</button></div><div className="stage-preview-line">{selectedSteps.filter((s) => s.is_active).map((s, i) => <span key={s.id}><i>{i + 1}</i>{s.stage_name_fa}</span>)}</div><div className="production-table-wrap"><table><thead><tr><th>ترتیب</th><th>کلید</th><th>نام مرحله</th><th>مسئول</th><th>مواد</th><th>QC</th><th>فعال</th><th>ذخیره</th></tr></thead><tbody>{selectedSteps.map((s) => <StepRow key={s.id} step={s} busy={busy} onSave={onUpdateStep} />)}</tbody></table></div><form className="add-stage-form" onSubmit={submitStep}><input dir="ltr" value={newStep.stage_key} onChange={(e) => setNewStep({ ...newStep, stage_key: e.target.value.replace(/\s+/g, '_') })} placeholder="stage_key" /><input value={newStep.stage_name_fa} onChange={(e) => setNewStep({ ...newStep, stage_name_fa: e.target.value })} placeholder="نام مرحله" /><input type="number" value={newStep.stage_order} onChange={(e) => setNewStep({ ...newStep, stage_order: e.target.value })} /><select value={newStep.responsible_role} onChange={(e) => setNewStep({ ...newStep, responsible_role: e.target.value })}><option value="production">تولید</option><option value="warehouse">انبار</option><option value="accountant">مالی</option><option value="admin">مدیر</option></select><button type="submit">افزودن مرحله</button></form></>}</div></div>
  </section>;
}

function StepRow({ step, busy, onSave }) {
  const [row, setRow] = useState({ ...step });
  return <tr><td><input type="number" value={row.stage_order} onChange={(e) => setRow({ ...row, stage_order: e.target.value })} /></td><td dir="ltr">{step.stage_key}</td><td><input value={row.stage_name_fa} onChange={(e) => setRow({ ...row, stage_name_fa: e.target.value })} /></td><td><select value={row.responsible_role || ''} onChange={(e) => setRow({ ...row, responsible_role: e.target.value || null })}><option value="">—</option><option value="production">تولید</option><option value="warehouse">انبار</option><option value="accountant">مالی</option><option value="admin">مدیر</option></select></td><td><input type="checkbox" checked={row.requires_material_issue} onChange={(e) => setRow({ ...row, requires_material_issue: e.target.checked })} /></td><td><input type="checkbox" checked={row.requires_qc} onChange={(e) => setRow({ ...row, requires_qc: e.target.checked })} /></td><td><input type="checkbox" checked={row.is_active} onChange={(e) => setRow({ ...row, is_active: e.target.checked })} /></td><td><button disabled={busy} onClick={() => onSave(step.id, { stage_order: Number(row.stage_order), stage_name_fa: row.stage_name_fa, responsible_role: row.responsible_role || null, requires_material_issue: row.requires_material_issue, requires_qc: row.requires_qc, is_active: row.is_active })}>ذخیره</button></td></tr>;
}

function AcceptOrderModal({ order, templates, busy, onClose, onSubmit }) {
  const activeTemplates = templates.filter((t) => t.is_active);
  const [form, setForm] = useState({ templateId: activeTemplates[0]?.id || '', productNameFa: order.title_fa || '', quantity: order.total_quantity || 1, notes: '' });
  return <Modal title="تأیید سفارش برای تولید" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit({ orderId: order.order_id, templateId: form.templateId, productNameFa: form.productNameFa, quantity: form.quantity, notes: form.notes }); }}><div className="form-grid"><label><span>سفارش</span><input readOnly value={`${order.order_code} · ${order.customer_name}`} /></label><label><span>قالب تولید</span><select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>{activeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name_fa}</option>)}</select></label><label><span>نام محصول تولیدی</span><input value={form.productNameFa} onChange={(e) => setForm({ ...form, productNameFa: e.target.value })} required /></label><label><span>تعداد برنامه‌ریزی</span><input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label><label className="full"><span>یادداشت</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">تأیید و ورود به تولید</button></div></form></Modal>;
}

function PlanModal({ order, plan, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ plannedStart: plan?.planned_start || order?.planned_start || '', plannedEnd: plan?.planned_end || order?.planned_end || '', workDays: plan?.work_days || order?.work_days || 5, laborPeople: plan?.labor_people || order?.labor_people || 1, hoursPerPerson: plan?.hours_per_person || 8, totalManHours: plan?.total_man_hours || order?.total_man_hours || 40, deliveryNote: plan?.delivery_note || '' });
  if (!order) return null;
  return <Modal title={`برنامه‌ریزی تولید ${order.code}`} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit({ productionOrderId: order.id, ...form }); }}><div className="form-grid"><label><span>شروع شمسی</span><JalaliDateInput value={form.plannedStart} onChange={(v) => setForm({ ...form, plannedStart: v })} /></label><label><span>پایان شمسی</span><JalaliDateInput value={form.plannedEnd} onChange={(v) => setForm({ ...form, plannedEnd: v })} /></label><label><span>روز کاری</span><input type="number" value={form.workDays} onChange={(e) => setForm({ ...form, workDays: e.target.value })} /></label><label><span>نیرو انسانی</span><input type="number" value={form.laborPeople} onChange={(e) => setForm({ ...form, laborPeople: e.target.value })} /></label><label><span>ساعت هر نفر</span><input type="number" value={form.hoursPerPerson} onChange={(e) => setForm({ ...form, hoursPerPerson: e.target.value, totalManHours: Number(e.target.value || 0) * Number(form.laborPeople || 0) * Number(form.workDays || 0) })} /></label><label><span>نفرساعت کل</span><input type="number" value={form.totalManHours} onChange={(e) => setForm({ ...form, totalManHours: e.target.value })} /></label><label className="full"><span>شرح اطلاع‌رسانی به سفارش</span><textarea value={form.deliveryNote} onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ذخیره برنامه</button></div></form></Modal>;
}

function BomModal({ bom, stock, existingItems = [], busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ id: bom?.id || null, warehouse_item_id: bom?.warehouse_item_id || '', product_name_fa: bom?.product_name_fa || '', product_name_en: bom?.product_name_en || '', version_no: bom?.version_no || 'v1', status: bom?.status || 'draft', unit: bom?.unit || 'عدد', notes: bom?.notes || '' });
  const [items, setItems] = useState(existingItems.length ? existingItems.map((i) => ({ cost_type: i.cost_type, warehouse_item_id: i.warehouse_item_id || '', item_name_fa: i.item_name_fa, quantity: i.quantity, unit: i.unit, unit_cost: i.unit_cost, notes: i.notes || '' })) : [{ cost_type: 'material', warehouse_item_id: '', item_name_fa: 'متریال تولید', quantity: 1, unit: 'عدد', unit_cost: 0, notes: '' }]);
  const total = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0);
  function updateItem(index, patch) { setItems((rows) => rows.map((r, i) => i === index ? { ...r, ...patch } : r)); }
  function selectStock(index, itemId) { const item = stock.find((s) => s.item_id === itemId); updateItem(index, { warehouse_item_id: itemId, item_name_fa: item?.item_name_fa || items[index].item_name_fa, unit: item?.unit || items[index].unit, unit_cost: item?.unit_price_estimate || items[index].unit_cost }); }
  return <Modal title={bom ? 'ویرایش فرمول تولید' : 'فرمول تولید جدید'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit({ bom: form, items }); }}><div className="form-grid"><label><span>کالای خروجی انبار</span><select value={form.warehouse_item_id} onChange={(e) => { const item = stock.find((s) => s.item_id === e.target.value); setForm({ ...form, warehouse_item_id: e.target.value, product_name_fa: item?.item_name_fa || form.product_name_fa, unit: item?.unit || form.unit }); }}><option value="">کالای جدید/بدون کد</option>{stock.map((s) => <option key={s.item_id} value={s.item_id}>{s.item_code} · {s.item_name_fa}</option>)}</select></label><label><span>نام محصول</span><input value={form.product_name_fa} onChange={(e) => setForm({ ...form, product_name_fa: e.target.value })} required /></label><label><span>نسخه</span><input value={form.version_no} onChange={(e) => setForm({ ...form, version_no: e.target.value })} /></label><label><span>وضعیت</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">پیش‌نویس</option><option value="active">فعال</option><option value="archived">آرشیو</option></select></label><label className="full"><span>شرح</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div><div className="line-editor"><table><thead><tr><th>نوع هزینه</th><th>کد انبار</th><th>شرح</th><th>تعداد</th><th>واحد</th><th>قیمت واحد ریال</th><th>جمع</th><th></th></tr></thead><tbody>{items.map((item, index) => <tr key={index}><td><select value={item.cost_type} onChange={(e) => updateItem(index, { cost_type: e.target.value })}>{Object.entries(COST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td><td><select value={item.warehouse_item_id} onChange={(e) => selectStock(index, e.target.value)}><option value="">بدون کالا</option>{stock.map((s) => <option key={s.item_id} value={s.item_id}>{s.item_code} · {s.item_name_fa}</option>)}</select></td><td><input value={item.item_name_fa} onChange={(e) => updateItem(index, { item_name_fa: e.target.value })} /></td><td><input type="number" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} /></td><td><input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} /></td><td><input type="number" value={item.unit_cost} onChange={(e) => updateItem(index, { unit_cost: e.target.value })} /></td><td>{formatMoney(Number(item.quantity || 0) * Number(item.unit_cost || 0))}</td><td><button type="button" onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}>×</button></td></tr>)}</tbody></table></div><button type="button" className="mini-btn" onClick={() => setItems((rows) => [...rows, { cost_type: 'material', warehouse_item_id: '', item_name_fa: 'ردیف جدید', quantity: 1, unit: 'عدد', unit_cost: 0 }])}>＋ افزودن ردیف</button><div className="form-summary"><b>جمع کل برآوردی: {formatMoney(total)}</b></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ذخیره فرمول</button></div></form></Modal>;
}

function QcModal({ order, orders, stages, busy, onClose, onSubmit }) {
  const initialOrderId = order?.id || orders[0]?.id || '';
  const [form, setForm] = useState({ production_order_id: initialOrderId, stage_id: '', result: 'passed', quantity_checked: '', quantity_passed: '', quantity_rejected: '', rejection_reason: '' });
  const orderStages = stages.filter((s) => s.production_order_id === form.production_order_id);
  return <Modal title="ثبت کنترل کیفیت" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}><div className="form-grid"><label><span>سفارش تولید</span><select value={form.production_order_id} onChange={(e) => setForm({ ...form, production_order_id: e.target.value, stage_id: '' })}>{orders.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.product_name_fa}</option>)}</select></label><label><span>مرحله</span><select value={form.stage_id} onChange={(e) => setForm({ ...form, stage_id: e.target.value })}><option value="">بدون مرحله</option>{orderStages.map((s) => <option key={s.id} value={s.id}>{s.order_index}. {stageName(s)}</option>)}</select></label><label><span>نتیجه</span><select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>{Object.entries(QC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>تعداد بررسی</span><input type="number" value={form.quantity_checked} onChange={(e) => setForm({ ...form, quantity_checked: e.target.value })} /></label><label><span>قبول</span><input type="number" value={form.quantity_passed} onChange={(e) => setForm({ ...form, quantity_passed: e.target.value })} /></label><label><span>رد</span><input type="number" value={form.quantity_rejected} onChange={(e) => setForm({ ...form, quantity_rejected: e.target.value })} /></label><label className="full"><span>دلیل رد/اصلاح</span><textarea value={form.rejection_reason} onChange={(e) => setForm({ ...form, rejection_reason: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت QC</button></div></form></Modal>;
}

function DocumentModal({ order, orders, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ production_order_id: order?.id || orders[0]?.id || '', document_type: 'instruction', title_fa: '', description_fa: '' });
  return <Modal title="ثبت سند تولید" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}><div className="form-grid"><label><span>سفارش تولید</span><select value={form.production_order_id} onChange={(e) => setForm({ ...form, production_order_id: e.target.value })}><option value="">بدون سفارش</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.product_name_fa}</option>)}</select></label><label><span>نوع سند</span><select value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })}><option value="instruction">دستور تولید</option><option value="material_issue">مصرف مواد</option><option value="qc_report">گزارش QC</option><option value="output">خروجی تولید</option><option value="cost">هزینه</option><option value="other">سایر</option></select></label><label className="full"><span>عنوان</span><input value={form.title_fa} onChange={(e) => setForm({ ...form, title_fa: e.target.value })} required /></label><label className="full"><span>شرح</span><textarea value={form.description_fa} onChange={(e) => setForm({ ...form, description_fa: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} type="submit">ثبت سند</button></div></form></Modal>;
}

function Modal({ title, onClose, children }) { return <div className="production-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="production-modal"><header><h3>{title}</h3><button onClick={onClose}><X size={18}/></button></header><div>{children}</div></div></div>; }
function CardTitle({ icon: Icon, title, action }) { return <div className="production-card-title"><span><Icon size={18} /> <b>{title}</b></span>{action}</div>; }
function Kpi({ icon, label, value, danger, warning, success }) { return <div className={`production-kpi ${danger ? 'danger' : warning ? 'warning' : success ? 'success' : ''}`}><i>{icon}</i><span>{label}</span><b>{value}</b></div>; }
function Empty({ text = 'داده‌ای برای نمایش نیست.' }) { return <div className="production-empty">{text}</div>; }
function Info({ label, value }) { return <div className="info"><span>{label}</span><b>{value || '—'}</b></div>; }
function Status({ status }) { return <span className={`status-pill ${status}`}>{DELIVERY_LABELS[status] || status || '—'}</span>; }
function formatDate(value) { return formatJalaliDate(value); }
function formatDateTime(value) { return formatJalaliDateTime(value); }
function formatMoney(value) { return formatToman(value, 'fa'); }
function safe(value) { return productionSafe(value); }
function stageName(stage) { return stage.custom_name_fa || stage.stage_name_fa || stage.custom_stage_type || 'مرحله'; }
function daysText(days, status) { if (status === 'completed') return 'تکمیل'; if (status === 'cancelled') return 'لغوشده'; if (days == null) return '—'; if (days < 0) return `${formatNumber(Math.abs(days))} روز تأخیر`; if (days === 0) return 'امروز'; return `${formatNumber(days)} روز مانده`; }
function priorityText(value) { return Number(value) === 1 ? 'فوری' : Number(value) === 3 ? 'کم‌اهمیت' : 'عادی'; }
