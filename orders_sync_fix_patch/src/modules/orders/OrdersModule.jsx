import { useMemo, useState } from 'react';
import { CalendarClock, FileText, Link2, PackageCheck, RefreshCcw, Search, Settings, Users } from 'lucide-react';
import { useOrdersData, useOrderDetails } from '../../hooks/useOrdersData';
import {
  createOrderReferral,
  createOrderWithItems,
  createSalesInvoiceFromOrder,
  createSalesProformaFromOrder,
  downloadCsv,
  downloadExcelHtml,
  logCrmInteraction,
  openPrintable,
  reserveOrderInventory,
  setOrderStage,
} from '../../lib/orderApi';
import './OrdersModule.css';

const PATH_LABELS = { trading: 'بازرگانی', rnd: 'R&D', production: 'تولید مستقیم' };
const DELIVERY_LABELS = { cancelled: 'لغو شده', closed: 'بسته‌شده', late: 'عقب‌افتاده', due_soon: 'نزدیک تحویل', on_track: 'طبق برنامه' };
const STOCK_LABELS = { available: 'کافی', short: 'کمبود', unknown: 'نامشخص' };
const FINANCE_LABELS = { none: 'بدون فاکتور', proforma: 'پیش‌فاکتور', invoiced: 'فاکتور شده', partial: 'بخشی تسویه', paid: 'تسویه کامل' };
const CHANNEL_LABELS = { phone: 'تلفن', website: 'سایت', whatsapp: 'واتساپ', telegram: 'تلگرام', instagram: 'اینستاگرام', in_person: 'حضوری', email: 'ایمیل', other: 'سایر' };

export default function OrdersModule({ lang = 'fa' }) {
  const [tab, setTab] = useState('overview');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [pathFilter, setPathFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const data = useOrdersData();
  const details = useOrderDetails(selectedOrderId);
  const selectedOrder = useMemo(() => data.orders.find((o) => o.id === selectedOrderId), [data.orders, selectedOrderId]);

  const filteredOrders = useMemo(() => data.orders.filter((o) => {
    const text = `${o.order_code} ${o.customer_name} ${o.current_stage_name_fa} ${o.contact_phone || ''} ${o.customer_city || ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (pathFilter === 'all' || o.sales_path === pathFilter)
      && (deliveryFilter === 'all' || o.delivery_status === deliveryFilter);
  }), [data.orders, query, pathFilter, deliveryFilter]);

  const kpis = useMemo(() => ({
    active: data.orders.filter((o) => o.current_stage !== 'closed' && !o.is_cancelled).length,
    late: data.orders.filter((o) => o.delivery_status === 'late').length,
    dueSoon: data.orders.filter((o) => o.delivery_status === 'due_soon').length,
    finance: data.orders.filter((o) => ['none', 'proforma'].includes(o.financial_status)).length,
    stock: data.orders.filter((o) => o.stock_status !== 'available').length,
    production: data.orders.filter((o) => o.sales_path === 'production' && o.current_stage !== 'closed').length,
    rnd: data.orders.filter((o) => o.sales_path === 'rnd' && o.current_stage !== 'closed').length,
    paid: data.orders.filter((o) => o.financial_status === 'paid').length,
  }), [data.orders]);

  async function runAction(fn, ok) {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      setModal(null);
      await data.refetch();
      await details.refetch?.();
    } catch (e) {
      setNotice(e.message || 'خطا در اجرای عملیات');
    } finally {
      setBusy(false);
    }
  }

  function exportOrders(kind = 'csv') {
    const headers = ['کد', 'مشتری', 'تلفن', 'شهر', 'روش ارتباط', 'مسیر', 'مرحله', 'پیشرفت', 'روز مانده', 'وضعیت مالی', 'وضعیت انبار', 'مبلغ فاکتور', 'پرداخت', 'مانده'];
    const rows = filteredOrders.map((o) => [o.order_code, o.customer_name, o.contact_phone, o.customer_city, CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel, PATH_LABELS[o.sales_path], o.current_stage_name_fa, o.progress_percent, o.days_to_delivery, FINANCE_LABELS[o.financial_status] || o.financial_status, STOCK_LABELS[o.stock_status] || o.stock_status, o.invoiced_amount, o.paid_amount, o.balance_amount]);
    if (kind === 'excel') downloadExcelHtml('orders.xls', headers, rows);
    else downloadCsv('orders.csv', [headers, ...rows]);
  }

  function printOrders() {
    const rows = filteredOrders.map((o) => `<tr><td>${o.order_code}</td><td>${o.customer_name}</td><td>${o.contact_phone || '—'}</td><td>${PATH_LABELS[o.sales_path]}</td><td>${o.current_stage_name_fa}</td><td>${o.progress_percent}%</td><td>${o.days_to_delivery ?? '—'}</td><td>${FINANCE_LABELS[o.financial_status] || o.financial_status}</td></tr>`).join('');
    openPrintable('لیست سفارش‌ها', `<h1>لیست سفارش‌ها</h1><table><thead><tr><th>کد</th><th>مشتری</th><th>تلفن</th><th>مسیر</th><th>مرحله</th><th>پیشرفت</th><th>روز مانده</th><th>مالی</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  return (
    <div className="orders-page" dir="rtl" lang={lang}>
      <header className="orders-hero">
        <div>
          <div className="eyebrow">Order Lifecycle</div>
          <h1>سفارش‌ها و CRM فروش</h1>
          <p>پیگیری سفارش از ثبت تا تحویل و تسویه، همراه با مراحل خطی، موجودی انبار، وضعیت مالی و پیگیری مشتری.</p>
        </div>
        <div className="orders-actions">
          <button onClick={data.refetch}><RefreshCcw size={16} /> به‌روزرسانی</button>
          <button onClick={() => setModal('order')} className="primary">＋ سفارش جدید</button>
          <button onClick={() => setModal('followup')}>＋ پیگیری CRM</button>
          <button onClick={() => exportOrders('excel')}>خروجی Excel</button>
          <button onClick={printOrders}>چاپ/PDF</button>
        </div>
      </header>

      {notice && <div className="orders-message">{notice}</div>}
      {data.loading && <div className="orders-message">در حال دریافت اطلاعات سفارش‌ها...</div>}
      {data.error && <div className="orders-message error">{data.error.message}</div>}

      {modal === 'order' && <OrderModal templates={data.templates} customers={data.customers} stock={data.stock} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createOrderWithItems(payload), 'سفارش جدید ثبت شد.')} />}
      {modal === 'followup' && <FollowupModal customers={data.customers} orders={data.orders} busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => logCrmInteraction(payload), 'پیگیری CRM ثبت شد.')} />}

      <nav className="orders-tabs">
        {[
          ['overview', 'نمای کلی'], ['crm', 'CRM مشتریان'], ['flow', 'مراحل سفارش'], ['list', 'لیست سفارش‌ها'], ['stock', 'موجودی انبار'], ['settings', 'تنظیم مراحل']
        ].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} followups={data.dueFollowups} orders={data.orders} onOpenOrder={setSelectedOrderId} setTab={setTab} />}
      {!data.loading && tab === 'crm' && <CrmSection customers={data.customers} followups={data.dueFollowups} onNewFollowup={() => setModal('followup')} />}
      {!data.loading && tab === 'flow' && <FlowSection orders={filteredOrders} details={details} selectedOrder={selectedOrder} busy={busy} onSelect={setSelectedOrderId} onSetStage={(stage) => selectedOrder && runAction(() => setOrderStage(selectedOrder.id, stage, 'تغییر مرحله از ماژول سفارش'), 'مرحله سفارش تغییر کرد.')} onProforma={(id) => runAction(() => createSalesProformaFromOrder(id), 'پیش‌فاکتور سفارش ساخته شد.')} onInvoice={(id) => runAction(() => createSalesInvoiceFromOrder(id), 'فاکتور سفارش ساخته شد.')} onReserve={(id) => runAction(() => reserveOrderInventory(id), 'موجودی سفارش رزرو شد.')} onReferral={(id, targetModule, targetRole, label) => runAction(() => createOrderReferral({ orderId: id, targetModule, targetRole, title: `ارجاع سفارش به ${label}`, priority: 2 }), `ارجاع به ${label} ثبت شد.`)} />}
      {!data.loading && tab === 'list' && <ListSection orders={filteredOrders} query={query} setQuery={setQuery} pathFilter={pathFilter} setPathFilter={setPathFilter} deliveryFilter={deliveryFilter} setDeliveryFilter={setDeliveryFilter} onSelect={setSelectedOrderId} onExcel={() => exportOrders('excel')} onPrint={printOrders} />}
      {!data.loading && tab === 'stock' && <StockSection stock={data.stock} />}
      {!data.loading && tab === 'settings' && <TemplateSection templates={data.templates} steps={data.templateSteps} />}
    </div>
  );
}

function Overview({ kpis, followups, orders, onOpenOrder, setTab }) {
  const near = [...orders].filter((o) => o.current_stage !== 'closed').sort((a, b) => Number(a.days_to_delivery ?? 999) - Number(b.days_to_delivery ?? 999)).slice(0, 6);
  return <>
    <section className="orders-kpis">
      <Kpi icon="📦" label="باز" value={kpis.active} />
      <Kpi icon="⚠️" label="عقب‌افتاده" value={kpis.late} danger />
      <Kpi icon="⏳" label="نزدیک تحویل" value={kpis.dueSoon} warning />
      <Kpi icon="🧾" label="نیاز مالی" value={kpis.finance} warning />
      <Kpi icon="📦" label="نیاز انبار" value={kpis.stock} warning />
      <Kpi icon="🏭" label="تولید" value={kpis.production} />
      <Kpi icon="🔬" label="R&D" value={kpis.rnd} />
      <Kpi icon="💰" label="تسویه" value={kpis.paid} success />
    </section>
    <div className="orders-grid two">
      <section className="orders-card"><CardTitle icon={CalendarClock} title="پیگیری‌های مهم CRM" action={<button onClick={() => setTab('crm')}>CRM</button>} />{followups.length === 0 ? <Empty /> : <div className="orders-timeline">{followups.slice(0, 8).map((f) => <article key={f.id}><strong>{f.company_name}</strong><small>{f.title} · {formatDate(f.due_at)} · {f.assigned_to_name || '—'}</small></article>)}</div>}</section>
      <section className="orders-card"><CardTitle icon={PackageCheck} title="نزدیک‌ترین تحویل‌ها" action={<button onClick={() => setTab('flow')}>مراحل</button>} />{near.map((o) => <button key={o.id} className="near-order" onClick={() => onOpenOrder(o.id)}><span><b>{o.order_code}</b><small>{o.customer_name} · {o.current_stage_name_fa}</small></span><Status status={o.delivery_status} /></button>)}</section>
    </div>
  </>;
}
function Kpi({ icon, label, value, danger, warning, success }) { return <div className={`orders-kpi ${danger ? 'danger' : warning ? 'warning' : success ? 'success' : ''}`}><i>{icon}</i><span>{label}</span><b>{new Intl.NumberFormat('fa-IR').format(value || 0)}</b></div>; }

function CrmSection({ customers, followups, onNewFollowup }) {
  return <div className="orders-grid two"><section className="orders-card"><CardTitle icon={Users} title="مشتریان و سرنخ‌ها" action={<button onClick={onNewFollowup}>＋ پیگیری</button>} /><div className="orders-table-wrap"><table><thead><tr><th>مشتری</th><th>تلفن</th><th>شهر</th><th>روش ارتباط</th><th>منبع جذب</th><th>مسئول</th><th>امتیاز</th><th>پیگیری بعدی</th></tr></thead><tbody>{customers.map((c) => <tr key={c.id}><td>{c.company_name}</td><td dir="ltr">{c.contact_phone || '—'}</td><td>{c.city || '—'}</td><td>{CHANNEL_LABELS[c.preferred_contact_channel] || c.preferred_contact_channel || '—'}</td><td>{c.acquisition_source || '—'}</td><td>{c.assigned_sales_name || '—'}</td><td>{c.lead_score}</td><td>{formatDate(c.next_follow_up_at)}</td></tr>)}</tbody></table></div></section><section className="orders-card"><CardTitle icon={CalendarClock} title="پیگیری‌های باز" />{followups.length === 0 ? <Empty /> : <div className="orders-timeline">{followups.map((f) => <article key={f.id}><strong>{f.title}</strong><small>{f.company_name} · {formatDate(f.due_at)} · {f.is_overdue ? 'عقب‌افتاده' : 'در برنامه'}</small></article>)}</div>}</section></div>;
}

function FlowSection({ orders, selectedOrder, details, busy, onSelect, onSetStage, onProforma, onInvoice, onReserve, onReferral }) {
  return <div className="orders-grid two order-flow-workspace"><section className="orders-card"><CardTitle icon={ListIcon} title="مراحل خطی سفارش‌ها" />{orders.length === 0 ? <Empty /> : <div className="flow-list">{orders.map((o) => <article key={o.id} className="flow-card"><header><div><h3>{o.order_code} · {o.customer_name}</h3><small>{PATH_LABELS[o.sales_path]} · {o.current_stage_name_fa}</small></div><Status status={o.delivery_status} /></header><div className="progress"><span style={{ width: `${Number(o.progress_percent || 0)}%` }} /></div><div className="flow-meta"><b>{Number(o.progress_percent || 0)}٪</b><span>{daysText(o.days_to_delivery, o.delivery_status)}</span><span>{STOCK_LABELS[o.stock_status] || o.stock_status}</span><span>{FINANCE_LABELS[o.financial_status] || o.financial_status}</span></div><button onClick={() => onSelect(o.id)}>جزئیات و عملیات</button></article>)}</div>}</section><OrderDetailPanel order={selectedOrder} details={details} busy={busy} onSetStage={onSetStage} onProforma={onProforma} onInvoice={onInvoice} onReserve={onReserve} onReferral={onReferral} /></div>;
}

function OrderDetailPanel({ order, details, busy, onSetStage, onProforma, onInvoice, onReserve, onReferral }) {
  if (!order) return <section className="orders-card"><div className="orders-empty">یک سفارش را انتخاب کنید.</div></section>;
  return <section className="orders-card detail-card"><CardTitle icon={FileText} title={`جزئیات ${order.order_code}`} /><div className="detail-mini-grid"><Info label="مشتری" value={order.customer_name} /><Info label="مرحله" value={order.current_stage_name_fa} /><Info label="پیشرفت" value={`${order.progress_percent || 0}٪`} /><Info label="تحویل" value={daysText(order.days_to_delivery, order.delivery_status)} /><Info label="مالی" value={FINANCE_LABELS[order.financial_status] || order.financial_status} /><Info label="انبار" value={STOCK_LABELS[order.stock_status] || order.stock_status} /></div><div className="detail-actions"><button disabled={busy} onClick={() => onProforma(order.id)}>پیش‌فاکتور</button><button disabled={busy} onClick={() => onInvoice(order.id)}>فاکتور</button><button disabled={busy} onClick={() => onReserve(order.id)}>رزرو انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'accounting', 'accountant', 'مالی')}>ارجاع مالی</button><button disabled={busy} onClick={() => onReferral(order.id, 'warehouse', 'warehouse', 'انبار')}>ارجاع انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'admin', 'admin', 'مدیر کل')}>ارجاع مدیر کل</button></div><section className="detail-block"><h3>تغییر مرحله</h3>{details.stages.length === 0 ? <p className="muted">مرحله‌ای ثبت نشده است.</p> : <div className="stage-buttons">{details.stages.map((s) => <button key={s.id} disabled={busy || s.status === 'current'} className={s.status} onClick={() => onSetStage(s.stage_key)}>{s.stage_order}. {s.stage_name_fa}</button>)}</div>}</section><section className="detail-block"><h3>وضعیت موجودی اقلام</h3>{details.stock.length === 0 ? <p className="muted">قلم انباری ندارد.</p> : <div className="orders-table-wrap"><table><thead><tr><th>قلم</th><th>کد</th><th>درخواست</th><th>قابل فروش</th><th>وضعیت</th></tr></thead><tbody>{details.stock.map((s) => <tr key={s.order_item_id}><td>{s.item_name_fa}</td><td dir="ltr">{s.warehouse_item_code || '—'}</td><td>{s.requested_qty}</td><td>{s.available_for_sale_qty}</td><td>{s.stock_status}</td></tr>)}</tbody></table></div>}</section><section className="detail-block"><h3>تاریخچه</h3>{details.events.length === 0 ? <p className="muted">رویدادی ثبت نشده است.</p> : <div className="orders-timeline">{details.events.map((e) => <article key={e.id}><strong>{e.title}</strong><small>{formatDate(e.created_at)} · {e.description || ''}</small></article>)}</div>}</section></section>;
}

function ListSection({ orders, query, setQuery, pathFilter, setPathFilter, deliveryFilter, setDeliveryFilter, onSelect, onExcel, onPrint }) {
  return <section className="orders-card"><div className="section-head"><CardTitle icon={Search} title="لیست سفارش‌ها" /><div><button onClick={onExcel}>Excel</button><button onClick={onPrint}>PDF</button></div></div><div className="filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو..." /><select value={pathFilter} onChange={(e) => setPathFilter(e.target.value)}><option value="all">همه مسیرها</option><option value="trading">بازرگانی</option><option value="rnd">R&D</option><option value="production">تولید</option></select><select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value)}><option value="all">همه وضعیت تحویل</option><option value="late">عقب‌افتاده</option><option value="due_soon">تحویل نزدیک</option><option value="on_track">طبق برنامه</option><option value="closed">بسته‌شده</option></select></div><div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>مشتری</th><th>تلفن</th><th>شهر</th><th>روش ارتباط</th><th>مسیر</th><th>مرحله</th><th>پیشرفت</th><th>روز مانده</th><th>مالی</th><th>انبار</th><th>عملیات</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}><td dir="ltr">{o.order_code}</td><td>{o.customer_name}</td><td dir="ltr">{o.contact_phone || '—'}</td><td>{o.customer_city || '—'}</td><td>{CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel || '—'}</td><td>{PATH_LABELS[o.sales_path]}</td><td>{o.current_stage_name_fa}</td><td>{o.progress_percent || 0}٪</td><td>{daysText(o.days_to_delivery, o.delivery_status)}</td><td>{FINANCE_LABELS[o.financial_status] || o.financial_status}</td><td>{STOCK_LABELS[o.stock_status] || o.stock_status}</td><td><button onClick={() => onSelect(o.id)}>جزئیات</button></td></tr>)}</tbody></table></div></section>;
}

function StockSection({ stock }) {
  return <section className="orders-card"><CardTitle icon={PackageCheck} title="موجودی قابل مشاهده برای فروش" />{stock.length === 0 ? <Empty /> : <div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>کالا</th><th>موجودی</th><th>رزروشده</th><th>قابل فروش</th><th>حداقل</th><th>وضعیت</th></tr></thead><tbody>{stock.map((s) => <tr key={s.item_id}><td dir="ltr">{s.item_code}</td><td>{s.item_name_fa}</td><td>{s.current_qty} {s.unit}</td><td>{s.reserved_qty}</td><td>{s.available_for_sale_qty}</td><td>{s.min_stock_threshold}</td><td>{s.is_low_stock ? 'کمبود' : 'قابل فروش'}</td></tr>)}</tbody></table></div>}</section>;
}

function TemplateSection({ templates, steps }) {
  return <section className="orders-card"><CardTitle icon={Settings} title="قالب‌های مراحل سفارش" />{templates.length === 0 ? <Empty /> : <div className="template-grid">{templates.map((t) => <article key={t.id} className="template-card"><h3>{t.name_fa}</h3><p>{t.sales_path ? PATH_LABELS[t.sales_path] : 'عمومی'} · {t.is_default ? 'پیش‌فرض' : 'قالب'}</p><ol>{steps.filter((s) => s.template_id === t.id).map((s) => <li key={s.id}>{s.stage_order}. {s.stage_name_fa}</li>)}</ol></article>)}</div>}</section>;
}

function OrderModal({ templates, customers, stock, busy, onClose, onSubmit }) {
  const [customerMode, setCustomerMode] = useState('existing');
  const [form, setForm] = useState({
    customer_id: customers[0]?.id || '',
    company_name: '',
    contact_phone: '',
    city: '',
    preferred_contact_channel: 'phone',
    sales_path: 'trading',
    workflow_template_id: '',
    registered_at: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    title_fa: '',
    description_fa: '',
    priority: 2,
  });
  const [options, setOptions] = useState({ createProforma: true, refFinance: true, refWarehouse: false, refPath: true });
  const availableTemplates = templates.filter((t) => t.is_active && (!t.sales_path || t.sales_path === form.sales_path));
  const selectedTemplate = availableTemplates.find((t) => t.id === form.workflow_template_id) || availableTemplates[0];
  const [items, setItems] = useState([{ item_name_fa: 'قلم سفارش', warehouse_item_code: '', quantity: 1, unit: 'عدد', unit_price: 0 }]);

  function submit(e) {
    e.preventDefault();
    const customer = customerMode === 'new'
      ? {
          company_name: form.company_name,
          contact_phone: form.contact_phone,
          city: form.city,
          preferred_contact_channel: form.preferred_contact_channel,
          crm_status: 'lead',
          acquisition_source: 'ثبت سفارش',
        }
      : null;

    onSubmit({
      order: {
        ...form,
        workflow_template_id: form.workflow_template_id || selectedTemplate?.id || '',
        customer_id: customerMode === 'existing' ? form.customer_id : null,
        customer,
        customer_phone_snapshot: form.contact_phone,
        customer_city_snapshot: form.city,
        contact_channel: form.preferred_contact_channel,
      },
      items,
      options,
    });
  }

  return <Modal title="ثبت سفارش جدید" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label><span>نوع مشتری</span><select value={customerMode} onChange={(e) => setCustomerMode(e.target.value)}><option value="existing">مشتری موجود</option><option value="new">مشتری/سرنخ جدید</option></select></label>
        {customerMode === 'existing'
          ? <label><span>مشتری</span><select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          : <label><span>نام مشتری</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label>}
        <label><span>تلفن</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label>
        <label><span>شهر</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label><span>روش ارتباط</span><select value={form.preferred_contact_channel} onChange={(e) => setForm({ ...form, preferred_contact_channel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>مسیر</span><select value={form.sales_path} onChange={(e) => setForm({ ...form, sales_path: e.target.value, workflow_template_id: '' })}>{Object.entries(PATH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>قالب مراحل</span><select value={form.workflow_template_id} onChange={(e) => setForm({ ...form, workflow_template_id: e.target.value })}><option value="">پیش‌فرض مسیر</option>{availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name_fa}</option>)}</select></label>
        <label><span>تاریخ ثبت</span><input type="date" value={form.registered_at} onChange={(e) => setForm({ ...form, registered_at: e.target.value })} /></label>
        <label><span>موعد تحویل</span><input type="date" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} /></label>
        <label><span>اولویت</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}><option value={1}>فوری</option><option value={2}>عادی</option><option value={3}>کم‌اهمیت</option></select></label>
        <label className="full"><span>عنوان</span><input value={form.title_fa} onChange={(e) => setForm({ ...form, title_fa: e.target.value })} required /></label>
        <label className="full"><span>شرح</span><textarea value={form.description_fa} onChange={(e) => setForm({ ...form, description_fa: e.target.value })} /></label>
      </div>

      <div className="order-options">
        <label><input type="checkbox" checked={options.createProforma} onChange={(e) => setOptions({ ...options, createProforma: e.target.checked })} /> ساخت پیش‌فاکتور بعد از ثبت</label>
        <label><input type="checkbox" checked={options.refFinance} onChange={(e) => setOptions({ ...options, refFinance: e.target.checked })} /> ارجاع به مالی</label>
        <label><input type="checkbox" checked={options.refWarehouse} onChange={(e) => setOptions({ ...options, refWarehouse: e.target.checked })} /> ارجاع به انبار</label>
        <label><input type="checkbox" checked={options.refPath} onChange={(e) => setOptions({ ...options, refPath: e.target.checked })} /> ارجاع به تولید/R&D بر اساس مسیر</label>
      </div>

      <ItemEditor items={items} setItems={setItems} stock={stock} />
      <div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ثبت...' : 'ثبت سفارش'}</button></div>
    </form>
  </Modal>;
}

function ItemEditor({ items, setItems, stock }) {
  function update(i, patch) { setItems((rows) => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)); }
  return <div className="item-editor"><table><thead><tr><th>شرح</th><th>کد انبار</th><th>تعداد</th><th>واحد</th><th>فی ریال</th><th></th></tr></thead><tbody>{items.map((item, i) => <tr key={i}><td><input value={item.item_name_fa} onChange={(e) => update(i, { item_name_fa: e.target.value })} /></td><td><select value={item.warehouse_item_code} onChange={(e) => { const st = stock.find((s) => s.item_code === e.target.value); update(i, { warehouse_item_code: e.target.value, item_name_fa: st?.item_name_fa || item.item_name_fa, unit: st?.unit || item.unit }); }}><option value="">بدون کد</option>{stock.map((s) => <option key={s.item_id} value={s.item_code}>{s.item_code} · {s.item_name_fa} · قابل فروش {s.available_for_sale_qty}</option>)}</select></td><td><input type="number" value={item.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td><td><input value={item.unit} onChange={(e) => update(i, { unit: e.target.value })} /></td><td><input type="number" value={item.unit_price} onChange={(e) => update(i, { unit_price: e.target.value })} /></td><td><button type="button" onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>×</button></td></tr>)}</tbody></table><button type="button" onClick={() => setItems((rows) => [...rows, { item_name_fa: 'ردیف جدید', warehouse_item_code: '', quantity: 1, unit: 'عدد', unit_price: 0 }])}>＋ افزودن قلم</button></div>;
}

function FollowupModal({ customers, orders, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ customerId: customers[0]?.id || '', orderId: '', title: '', description: '', activityType: 'follow_up', contactChannel: 'phone' });
  return <Modal title="ثبت پیگیری CRM" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSubmit({ customerId: form.customerId, orderId: form.orderId || null, title: form.title, description: form.description, activityType: form.activityType, contactChannel: form.contactChannel }); }}><div className="form-grid"><label><span>مشتری</span><select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><label><span>سفارش مرتبط</span><select value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}><option value="">بدون سفارش</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name}</option>)}</select></label><label><span>روش ارتباط</span><select value={form.contactChannel} onChange={(e) => setForm({ ...form, contactChannel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="full"><span>عنوان</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label className="full"><span>شرح</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy}>ثبت</button></div></form></Modal>;
}

function Modal({ title, onClose, children }) { return <div className="orders-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="orders-modal"><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>; }
function CardTitle({ icon: Icon, title, action }) { return <div className="card-title-row"><span><Icon size={18} /> <b>{title}</b></span>{action}</div>; }
function Info({ label, value }) { return <div className="info"><span>{label}</span><b>{value || '—'}</b></div>; }
function Empty() { return <div className="orders-empty">داده‌ای برای نمایش نیست.</div>; }
function Status({ status }) { return <span className={`status-pill ${status}`}>{DELIVERY_LABELS[status] || status}</span>; }
function daysText(days, status) { if (status === 'closed') return 'بسته‌شده'; if (days == null) return '—'; if (days < 0) return `${Math.abs(days)} روز تأخیر`; if (days === 0) return 'امروز'; return `${days} روز مانده`; }
function formatDate(value) { if (!value) return '—'; return new Date(value).toLocaleDateString('fa-IR'); }
function formatMoney(value) { return `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(value || 0) / 10))} تومان`; }
