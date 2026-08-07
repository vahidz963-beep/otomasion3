import { useMemo, useState } from 'react';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  ListChecks,
  PackageCheck,
  PhoneCall,
  RefreshCcw,
  Search,
  Settings,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';
import { useOrdersData, useOrderDetails } from '../../hooks/useOrdersData';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import { formatJalaliDate, formatJalaliDateTime, formatNumber, formatToman } from '../../lib/formatters';
import {
  cancelOrder,
  createCrmFollowup,
  createOrderReferral,
  createOrderWithItems,
  createOrUpdateCustomer,
  createSalesInvoiceFromOrder,
  createSalesProformaFromOrder,
  deactivateCustomer,
  downloadCsv,
  downloadExcelHtml,
  markCrmFollowupDone,
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
const CRM_STATUS_LABELS = { lead: 'سرنخ', active_customer: 'مشتری فعال', vip: 'VIP', at_risk: 'در معرض ریزش', inactive: 'غیرفعال' };
const ACTIVITY_LABELS = { call: 'تماس', message: 'پیام', email: 'ایمیل', meeting: 'جلسه', visit: 'بازدید', note: 'یادداشت', follow_up: 'پیگیری', complaint: 'شکایت', other: 'سایر' };
const OPPORTUNITY_STAGE_LABELS = { new: 'جدید', follow_up: 'پیگیری', proposal: 'پیشنهاد', negotiation: 'مذاکره', won: 'برد', lost: 'باخت' };

export default function OrdersModule({ lang = 'fa' }) {
  const [tab, setTab] = useState('overview');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [pathFilter, setPathFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [followupPrefill, setFollowupPrefill] = useState({});
  const [orderPrefill, setOrderPrefill] = useState({});
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
    active: data.orders.filter((o) => o.current_stage !== 'closed' && o.delivery_status !== 'cancelled').length,
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

  function openFollowup(prefill = {}) {
    setFollowupPrefill(prefill || {});
    setModal('followup');
  }

  function openOrderModal(prefill = {}) {
    setOrderPrefill(prefill || {});
    setModal('order');
  }

  function exportOrders(kind = 'csv') {
    const headers = ['کد', 'تاریخ ثبت', 'مشتری', 'تلفن', 'شهر', 'روش ارتباط', 'مسیر', 'مرحله', 'پیشرفت', 'روز مانده', 'وضعیت مالی', 'وضعیت انبار', 'مبلغ فاکتور', 'پرداخت', 'مانده'];
    const rows = filteredOrders.map((o) => [o.order_code, formatDate(o.registered_at), o.customer_name, o.contact_phone, o.customer_city, CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel, PATH_LABELS[o.sales_path], o.current_stage_name_fa, `${o.progress_percent || 0}%`, daysText(o.days_to_delivery, o.delivery_status), FINANCE_LABELS[o.financial_status] || o.financial_status, STOCK_LABELS[o.stock_status] || o.stock_status, formatMoney(o.invoiced_amount), formatMoney(o.paid_amount), formatMoney(o.balance_amount)]);
    if (kind === 'excel') downloadExcelHtml('orders.xls', headers, rows);
    else downloadCsv('orders.csv', [headers, ...rows]);
  }

  function printOrders() {
    const rows = filteredOrders.map((o) => `<tr><td>${safe(o.order_code)}</td><td>${formatDate(o.registered_at)}</td><td>${safe(o.customer_name)}</td><td>${safe(o.contact_phone || '—')}</td><td>${PATH_LABELS[o.sales_path] || '—'}</td><td>${safe(o.current_stage_name_fa)}</td><td>${formatNumber(o.progress_percent)}٪</td><td>${daysText(o.days_to_delivery, o.delivery_status)}</td><td>${FINANCE_LABELS[o.financial_status] || o.financial_status}</td></tr>`).join('');
    openPrintable('لیست سفارش‌ها', `<h1>لیست سفارش‌ها</h1><table><thead><tr><th>کد</th><th>تاریخ</th><th>مشتری</th><th>تلفن</th><th>مسیر</th><th>مرحله</th><th>پیشرفت</th><th>موعد</th><th>مالی</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function exportCrm(kind = 'excel') {
    const headers = ['نام', 'نوع', 'تلفن', 'ایمیل', 'شهر', 'روش ارتباط', 'روش جذب', 'مسئول', 'امتیاز', 'آخرین تماس', 'پیگیری بعدی', 'تعداد سفارش', 'فروش کل'];
    const rows = data.customers.map((c) => [c.company_name, CRM_STATUS_LABELS[c.crm_status] || c.crm_status, c.contact_phone, c.contact_email, c.city, CHANNEL_LABELS[c.preferred_contact_channel] || c.preferred_contact_channel, c.acquisition_source, c.assigned_sales_name, c.lead_score, formatDate(c.last_contacted_at), formatDate(c.next_follow_up_at), c.total_orders, formatMoney(c.total_sales_amount)]);
    if (kind === 'excel') downloadExcelHtml('crm-customers.xls', headers, rows);
    else downloadCsv('crm-customers.csv', [headers, ...rows]);
  }

  function printCrm() {
    const rows = data.customers.map((c) => `<tr><td>${safe(c.company_name)}</td><td>${CRM_STATUS_LABELS[c.crm_status] || c.crm_status || '—'}</td><td>${safe(c.contact_phone || '—')}</td><td>${safe(c.city || '—')}</td><td>${CHANNEL_LABELS[c.preferred_contact_channel] || c.preferred_contact_channel || '—'}</td><td>${safe(c.assigned_sales_name || '—')}</td><td>${formatNumber(c.lead_score)}</td><td>${formatDate(c.next_follow_up_at)}</td><td>${formatMoney(c.total_sales_amount)}</td></tr>`).join('');
    openPrintable('CRM مشتریان', `<h1>CRM مشتریان</h1><table><thead><tr><th>نام</th><th>نوع</th><th>تلفن</th><th>شهر</th><th>روش ارتباط</th><th>مسئول</th><th>امتیاز</th><th>پیگیری بعدی</th><th>فروش کل</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  return (
    <div className="orders-page" dir="rtl" lang={lang}>
      <header className="orders-hero">
        <div>
          <div className="eyebrow">Order Lifecycle · Aryaman CRM Sync</div>
          <h1>سفارش‌ها و CRM فروش</h1>
          <p>پیگیری سفارش از ثبت تا تحویل و تسویه، همراه با پرونده مشتری، پیگیری واقعی CRM، موجودی انبار و وضعیت مالی.</p>
        </div>
        <div className="orders-actions">
          <button onClick={data.refetch}><RefreshCcw size={16} /> به‌روزرسانی</button>
          <button onClick={() => openOrderModal()} className="primary">＋ سفارش جدید</button>
          <button onClick={() => openFollowup()}>＋ پیگیری CRM</button>
          <button onClick={() => setModal('customer')}>＋ مشتری/سرنخ</button>
          <button onClick={() => exportOrders('excel')}>خروجی Excel</button>
          <button onClick={printOrders}>چاپ/PDF</button>
        </div>
      </header>

      {notice && <div className={`orders-message ${notice.includes('خطا') ? 'error' : ''}`}>{notice}</div>}
      {data.loading && <div className="orders-message">در حال دریافت اطلاعات سفارش‌ها...</div>}
      {data.error && <div className="orders-message error">{data.error.message}</div>}

      {modal === 'order' && <OrderModal templates={data.templates} customers={data.customers} stock={data.stock} busy={busy} initialCustomerId={orderPrefill.customerId} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createOrderWithItems(payload), 'سفارش جدید ثبت شد.')} />}
      {modal === 'followup' && <FollowupModal customers={data.customers} orders={data.orders} busy={busy} initial={followupPrefill} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createCrmFollowup(payload), 'پیگیری CRM ثبت شد و در فهرست پیگیری‌های باز قرار گرفت.')} />}
      {modal === 'customer' && <CustomerModal busy={busy} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createOrUpdateCustomer(payload), 'مشتری/سرنخ ثبت شد.')} />}

      <nav className="orders-tabs">
        {[
          ['overview', 'نمای کلی'], ['crm', 'CRM مشتریان'], ['flow', 'مراحل سفارش'], ['list', 'لیست سفارش‌ها'], ['stock', 'موجودی انبار'], ['referrals', 'ارجاعات'], ['settings', 'تنظیم مراحل']
        ].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} followups={data.dueFollowups} orders={data.orders} onOpenOrder={setSelectedOrderId} onNewFollowup={openFollowup} setTab={setTab} />}
      {!data.loading && tab === 'crm' && <CrmSection customers={data.customers} followups={data.dueFollowups} interactions={data.crmInteractions} opportunities={data.crmOpportunities} orders={data.orders} busy={busy} onNewFollowup={openFollowup} onNewCustomer={() => setModal('customer')} onQuickOrder={(customer) => openOrderModal({ customerId: customer.id })} onDeactivateCustomer={(customer) => { if (window.confirm(`مشتری «${customer.company_name}» غیرفعال شود؟`)) runAction(() => deactivateCustomer(customer.id), 'مشتری غیرفعال شد.'); }} onMarkDone={(followup) => runAction(() => markCrmFollowupDone(followup.id), 'پیگیری انجام شد و از فهرست باز حذف شد.')} onExport={() => exportCrm('excel')} onPrint={printCrm} />}
      {!data.loading && tab === 'flow' && <FlowSection orders={filteredOrders} details={details} selectedOrder={selectedOrder} busy={busy} onSelect={setSelectedOrderId} onSetStage={(stage) => selectedOrder && runAction(() => setOrderStage(selectedOrder.id, stage, 'تغییر مرحله از ماژول سفارش'), 'مرحله سفارش تغییر کرد.')} onProforma={(id) => runAction(() => createSalesProformaFromOrder(id), 'پیش‌فاکتور سفارش ساخته شد.')} onInvoice={(id) => runAction(() => createSalesInvoiceFromOrder(id), 'فاکتور سفارش ساخته شد.')} onReserve={(id) => runAction(() => reserveOrderInventory(id), 'موجودی سفارش رزرو شد.')} onReferral={(id, targetModule, targetRole, label) => runAction(() => createOrderReferral({ orderId: id, targetModule, targetRole, title: `ارجاع سفارش به ${label}`, priority: 2 }), `ارجاع به ${label} ثبت شد.`)} onCancelOrder={(id) => { const reason = window.prompt('دلیل لغو سفارش را وارد کنید:', 'لغو/اصلاح سفارش'); if (reason) runAction(() => cancelOrder(id, reason), 'سفارش لغو شد.'); }} />}
      {!data.loading && tab === 'list' && <ListSection orders={filteredOrders} query={query} setQuery={setQuery} pathFilter={pathFilter} setPathFilter={setPathFilter} deliveryFilter={deliveryFilter} setDeliveryFilter={setDeliveryFilter} onSelect={(id) => { setSelectedOrderId(id); setTab('flow'); }} onCancel={(order) => { const reason = window.prompt(`دلیل لغو سفارش ${order.order_code}:`, 'لغو/اصلاح سفارش'); if (reason) runAction(() => cancelOrder(order.id, reason), 'سفارش لغو شد.'); }} onExcel={() => exportOrders('excel')} onPrint={printOrders} />}
      {!data.loading && tab === 'stock' && <StockSection stock={data.stock} />}
      {!data.loading && tab === 'referrals' && <div className="orders-grid"><ReferralPanel sourceModule="orders" title="ارجاعات سفارش‌ها" defaultTarget="accounting" /></div>}
      {!data.loading && tab === 'settings' && <TemplateSection templates={data.templates} steps={data.templateSteps} />}
    </div>
  );
}

function Overview({ kpis, followups, orders, onOpenOrder, onNewFollowup, setTab }) {
  const near = [...orders].filter((o) => o.current_stage !== 'closed' && o.delivery_status !== 'cancelled').sort((a, b) => Number(a.days_to_delivery ?? 999) - Number(b.days_to_delivery ?? 999)).slice(0, 6);
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
      <section className="orders-card"><CardTitle icon={CalendarClock} title="پیگیری‌های مهم CRM" action={<button onClick={() => setTab('crm')}>رفتن به CRM</button>} />{followups.length === 0 ? <Empty text="پیگیری بازی برای امروز ثبت نشده است." /> : <div className="orders-timeline">{followups.slice(0, 8).map((f) => <article key={f.id}><strong>{f.company_name}</strong><small>{f.title} · {formatDateTime(f.due_at)} · {f.assigned_to_name || '—'}</small><div className="timeline-actions"><button onClick={() => onNewFollowup({ customerId: f.customer_id, orderId: f.related_order_id || '', title: `پیگیری مجدد: ${f.title}` })}>پیگیری مجدد</button></div></article>)}</div>}</section>
      <section className="orders-card"><CardTitle icon={PackageCheck} title="نزدیک‌ترین تحویل‌ها" action={<button onClick={() => setTab('flow')}>مراحل</button>} />{near.map((o) => <button key={o.id} className="near-order" onClick={() => onOpenOrder(o.id)}><span><b>{o.order_code}</b><small>{o.customer_name} · {o.current_stage_name_fa}</small></span><Status status={o.delivery_status} /></button>)}</section>
    </div>
  </>;
}
function Kpi({ icon, label, value, danger, warning, success }) { return <div className={`orders-kpi ${danger ? 'danger' : warning ? 'warning' : success ? 'success' : ''}`}><i>{icon}</i><span>{label}</span><b>{formatNumber(value || 0)}</b></div>; }

function CrmSection({ customers, followups, interactions, opportunities, orders, busy, onNewFollowup, onNewCustomer, onQuickOrder, onDeactivateCustomer, onMarkDone, onExport, onPrint }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || null);

  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const filteredCustomers = useMemo(() => customers.filter((c) => {
    const text = `${c.company_name || ''} ${c.contact_person_name || ''} ${c.contact_phone || ''} ${c.city || ''} ${c.acquisition_source || ''}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase()))
      && (statusFilter === 'all' || c.crm_status === statusFilter)
      && (channelFilter === 'all' || c.preferred_contact_channel === channelFilter);
  }), [customers, search, statusFilter, channelFilter]);
  const selectedCustomer = customerById[selectedCustomerId] || filteredCustomers[0] || customers[0] || null;
  const selectedInteractions = selectedCustomer ? interactions.filter((i) => i.customer_id === selectedCustomer.id).slice(0, 8) : [];
  const selectedOrders = selectedCustomer ? orders.filter((o) => o.customer_id === selectedCustomer.id).slice(0, 8) : [];
  const selectedFollowups = selectedCustomer ? followups.filter((f) => f.customer_id === selectedCustomer.id) : [];
  const dueToday = followups.filter((f) => f.is_overdue || daysUntil(f.due_at) <= 3);

  return <>
    <section className="orders-grid crm-stats-grid">
      <div className="crm-stat"><span>کل مشتری/سرنخ</span><b>{formatNumber(customers.length)}</b><small>پرونده‌های فعال CRM</small></div>
      <div className="crm-stat warning"><span>پیگیری باز</span><b>{formatNumber(followups.length)}</b><small>ثبت‌شده در Supabase</small></div>
      <div className="crm-stat danger"><span>عقب‌افتاده</span><b>{formatNumber(followups.filter((f) => f.is_overdue).length)}</b><small>نیازمند اقدام فوری</small></div>
      <div className="crm-stat success"><span>تعامل ثبت‌شده</span><b>{formatNumber(interactions.length)}</b><small>تماس، پیام، جلسه و یادداشت</small></div>
    </section>

    <div className="orders-grid two crm-layout">
      <section className="orders-card crm-card-main">
        <div className="section-head crm-head">
          <CardTitle icon={Users} title="لیست مشتریان و سرنخ‌ها" />
          <div className="crm-head-actions">
            <button onClick={onExport}>خروجی اکسل</button>
            <button onClick={onPrint}>چاپ / PDF</button>
            <button className="primary-soft" onClick={onNewCustomer}><UserPlus size={15} /> مشتری/سرنخ</button>
          </div>
        </div>
        <p className="muted crm-help">CRM سفارش‌ها برای تیم فروش است: پرونده مشتری، پیگیری‌ها، سابقه تعامل، فرصت فروش و سفارش‌های مرتبط در یک صفحه.</p>
        <div className="filters crm-toolbar">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجوی مشتری، تماس، شهر..." />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">همه وضعیت‌ها</option>
            {Object.entries(CRM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="all">همه روش‌های ارتباط</option>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="orders-table-wrap crm-table-wrap"><table><thead><tr><th>نام</th><th>نوع</th><th>تلفن</th><th>شهر</th><th>روش ارتباط</th><th>روش جذب</th><th>مسئول</th><th>امتیاز</th><th>پیگیری بعدی</th><th>فروش کل</th><th>عملیات</th></tr></thead><tbody>{filteredCustomers.map((c) => <tr key={c.id} className={selectedCustomer?.id === c.id ? 'selected-row' : ''}><td><button className="link-button" onClick={() => setSelectedCustomerId(c.id)}>{c.company_name}</button></td><td><Badge>{CRM_STATUS_LABELS[c.crm_status] || c.crm_status || '—'}</Badge></td><td dir="ltr">{c.contact_phone || '—'}</td><td>{c.city || '—'}</td><td>{CHANNEL_LABELS[c.preferred_contact_channel] || c.preferred_contact_channel || '—'}</td><td>{c.acquisition_source || '—'}</td><td>{c.assigned_sales_name || '—'}</td><td>{formatNumber(c.lead_score)}</td><td>{formatDate(c.next_follow_up_at)}</td><td>{formatMoney(c.total_sales_amount)}</td><td><div className="row-actions"><button onClick={() => setSelectedCustomerId(c.id)}><Eye size={14} /> پرونده</button><button onClick={() => onNewFollowup({ customerId: c.id })}><PhoneCall size={14} /> پیگیری</button><button onClick={() => onQuickOrder(c)}>سفارش</button><button className="danger" onClick={() => onDeactivateCustomer(c)}><Ban size={14} /> غیرفعال</button></div></td></tr>)}</tbody></table></div>
        {filteredCustomers.length === 0 && <Empty text="مشتری یا سرنخی با این فیلتر پیدا نشد." />}
      </section>

      <section className="orders-card crm-followups-card">
        <CardTitle icon={CalendarClock} title="پیگیری‌های امروز و باز" action={<button onClick={() => onNewFollowup({ customerId: selectedCustomer?.id })}>＋ پیگیری</button>} />
        {dueToday.length === 0 ? <Empty text="پیگیری فوری نداریم. برای تست، یک پیگیری جدید با موعد امروز/فردا ثبت کن." /> : <div className="crm-followup-list">{dueToday.map((f) => <article key={f.id} className={f.is_overdue ? 'overdue' : ''}><div><strong>{f.title}</strong><small>{f.company_name} · {formatDateTime(f.due_at)} · {f.order_code || 'بدون سفارش'}</small></div><div className="row-actions"><button disabled={busy} onClick={() => onMarkDone(f)}><CheckCircle2 size={14} /> انجام شد</button><button onClick={() => onNewFollowup({ customerId: f.customer_id, orderId: f.related_order_id || '', title: `پیگیری مجدد: ${f.title}` })}>پیگیری مجدد</button></div></article>)}</div>}
      </section>
    </div>

    <div className="orders-grid two crm-layout">
      <section className="orders-card">
        <CardTitle icon={Target} title="قیف فروش ساده" />
        <Pipeline opportunities={opportunities} customers={customers} />
      </section>
      <section className="orders-card">
        <CardTitle icon={PhoneCall} title="آخرین تعاملات مشتریان" />
        {interactions.length === 0 ? <Empty text="هنوز تعاملی ثبت نشده است. با ثبت پیگیری، تعامل هم ذخیره می‌شود." /> : <div className="orders-timeline interaction-timeline">{interactions.slice(0, 10).map((i) => <article key={i.id}><strong>{ACTIVITY_LABELS[i.activity_type] || i.activity_type} · {i.title}</strong><small>{customerById[i.customer_id]?.company_name || '—'} · {CHANNEL_LABELS[i.contact_channel] || i.contact_channel || '—'} · {formatDateTime(i.activity_at || i.created_at)}</small>{i.description && <p>{i.description}</p>}</article>)}</div>}
      </section>
    </div>

    {selectedCustomer && <section className="orders-card orders-grid customer-dossier">
      <div className="dossier-header"><div><span className="eyebrow">Customer File</span><h2>{selectedCustomer.company_name}</h2><p>{CRM_STATUS_LABELS[selectedCustomer.crm_status] || 'پرونده CRM'} · {selectedCustomer.city || 'بدون شهر'} · مسئول: {selectedCustomer.assigned_sales_name || '—'}</p></div><div className="dossier-actions"><button onClick={() => onQuickOrder(selectedCustomer)}>ثبت سفارش</button><button onClick={() => onNewFollowup({ customerId: selectedCustomer.id })}>ثبت پیگیری</button><button className="danger" onClick={() => onDeactivateCustomer(selectedCustomer)}>غیرفعال‌سازی</button></div></div>
      <div className="detail-mini-grid"><Info label="تلفن" value={selectedCustomer.contact_phone} /><Info label="ایمیل" value={selectedCustomer.contact_email} /><Info label="روش ارتباط" value={CHANNEL_LABELS[selectedCustomer.preferred_contact_channel] || selectedCustomer.preferred_contact_channel} /><Info label="روش جذب" value={selectedCustomer.acquisition_source} /><Info label="امتیاز" value={formatNumber(selectedCustomer.lead_score)} /><Info label="پیگیری بعدی" value={formatDateTime(selectedCustomer.next_follow_up_at)} /><Info label="تعداد سفارش" value={formatNumber(selectedCustomer.total_orders)} /><Info label="فروش کل" value={formatMoney(selectedCustomer.total_sales_amount)} /><Info label="آخرین تماس" value={formatDateTime(selectedCustomer.last_contacted_at)} /></div>
      <div className="orders-grid two dossier-blocks"><section className="detail-block"><h3>سفارش‌های مرتبط</h3>{selectedOrders.length === 0 ? <p className="muted">هنوز سفارشی برای این مشتری ثبت نشده است.</p> : <div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>عنوان</th><th>مرحله</th><th>مالی</th></tr></thead><tbody>{selectedOrders.map((o) => <tr key={o.id}><td dir="ltr">{o.order_code}</td><td>{o.customer_name}</td><td>{o.current_stage_name_fa}</td><td>{FINANCE_LABELS[o.financial_status] || o.financial_status}</td></tr>)}</tbody></table></div>}</section><section className="detail-block"><h3>پیگیری‌های باز این مشتری</h3>{selectedFollowups.length === 0 ? <p className="muted">پیگیری بازی ندارد.</p> : <div className="crm-followup-list mini">{selectedFollowups.map((f) => <article key={f.id}><strong>{f.title}</strong><small>{formatDateTime(f.due_at)} · {f.order_code || 'بدون سفارش'}</small></article>)}</div>}</section></div>
      <section className="detail-block"><h3>آخرین تعاملات این مشتری</h3>{selectedInteractions.length === 0 ? <p className="muted">تعاملی برای این مشتری ثبت نشده.</p> : <div className="orders-timeline interaction-timeline">{selectedInteractions.map((i) => <article key={i.id}><strong>{ACTIVITY_LABELS[i.activity_type] || i.activity_type} · {i.title}</strong><small>{formatDateTime(i.activity_at || i.created_at)} · {CHANNEL_LABELS[i.contact_channel] || i.contact_channel || '—'}</small>{i.description && <p>{i.description}</p>}</article>)}</div>}</section>
    </section>}
  </>;
}

function Pipeline({ opportunities, customers }) {
  if (opportunities.length > 0) {
    const stages = Object.entries(OPPORTUNITY_STAGE_LABELS).map(([key, label]) => {
      const rows = opportunities.filter((o) => o.stage === key);
      const amount = rows.reduce((sum, o) => sum + Number(o.estimated_amount || 0), 0);
      return { key, label, count: rows.length, amount };
    });
    return <div className="crm-pipeline">{stages.map((s) => <div key={s.key} className="pipeline-stage"><span>{s.label}</span><b>{formatNumber(s.count)}</b><small>{formatMoney(s.amount)}</small></div>)}</div>;
  }
  const stages = Object.entries(CRM_STATUS_LABELS).map(([key, label]) => ({ key, label, count: customers.filter((c) => c.crm_status === key).length, amount: customers.filter((c) => c.crm_status === key).reduce((sum, c) => sum + Number(c.total_sales_amount || 0), 0) }));
  return <div className="crm-pipeline">{stages.map((s) => <div key={s.key} className="pipeline-stage"><span>{s.label}</span><b>{formatNumber(s.count)}</b><small>{formatMoney(s.amount)}</small></div>)}</div>;
}

function FlowSection({ orders, selectedOrder, details, busy, onSelect, onSetStage, onProforma, onInvoice, onReserve, onReferral, onCancelOrder }) {
  return <div className="orders-grid two order-flow-workspace"><section className="orders-card"><CardTitle icon={ListChecks} title="مراحل خطی سفارش‌ها" />{orders.length === 0 ? <Empty /> : <div className="flow-list">{orders.map((o) => <article key={o.id} className={`flow-card ${o.delivery_status === 'cancelled' ? 'is-cancelled' : ''}`}><header><div><h3>{o.order_code} · {o.customer_name}</h3><small>{formatDate(o.registered_at)} · {PATH_LABELS[o.sales_path]} · {o.current_stage_name_fa}</small></div><Status status={o.delivery_status} /></header><div className="progress"><span style={{ width: `${Number(o.progress_percent || 0)}%` }} /></div><div className="flow-meta"><b>{formatNumber(o.progress_percent || 0)}٪</b><span>{daysText(o.days_to_delivery, o.delivery_status)}</span><span>{STOCK_LABELS[o.stock_status] || o.stock_status}</span><span>{FINANCE_LABELS[o.financial_status] || o.financial_status}</span></div><button onClick={() => onSelect(o.id)}>جزئیات و عملیات</button></article>)}</div>}</section><OrderDetailPanel order={selectedOrder} details={details} busy={busy} onSetStage={onSetStage} onProforma={onProforma} onInvoice={onInvoice} onReserve={onReserve} onReferral={onReferral} onCancelOrder={onCancelOrder} /></div>;
}

function OrderDetailPanel({ order, details, busy, onSetStage, onProforma, onInvoice, onReserve, onReferral, onCancelOrder }) {
  if (!order) return <section className="orders-card"><div className="orders-empty">یک سفارش را انتخاب کنید.</div></section>;
  return <section className="orders-card detail-card"><CardTitle icon={FileText} title={`جزئیات ${order.order_code}`} /><div className="detail-mini-grid"><Info label="مشتری" value={order.customer_name} /><Info label="مرحله" value={order.current_stage_name_fa} /><Info label="تاریخ ثبت" value={formatDate(order.registered_at)} /><Info label="پیشرفت" value={`${formatNumber(order.progress_percent || 0)}٪`} /><Info label="تحویل" value={daysText(order.days_to_delivery, order.delivery_status)} /><Info label="مالی" value={FINANCE_LABELS[order.financial_status] || order.financial_status} /><Info label="انبار" value={STOCK_LABELS[order.stock_status] || order.stock_status} /><Info label="مانده" value={formatMoney(order.balance_amount)} /></div><div className="detail-actions"><button disabled={busy} onClick={() => onProforma(order.id)}>پیش‌فاکتور</button><button disabled={busy} onClick={() => onInvoice(order.id)}>فاکتور</button><button disabled={busy} onClick={() => onReserve(order.id)}>رزرو انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'accounting', 'accountant', 'مالی')}>ارجاع مالی</button><button disabled={busy} onClick={() => onReferral(order.id, 'warehouse', 'warehouse', 'انبار')}>ارجاع انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'admin', 'admin', 'مدیر کل')}>ارجاع مدیر کل</button><button className="danger" disabled={busy || order.delivery_status === 'cancelled'} onClick={() => onCancelOrder(order.id)}>لغو سفارش</button></div><section className="detail-block"><h3>تغییر مرحله</h3>{details.stages.length === 0 ? <p className="muted">مرحله‌ای ثبت نشده است.</p> : <div className="stage-buttons">{details.stages.map((s) => <button key={s.id} disabled={busy || s.status === 'current' || order.delivery_status === 'cancelled'} className={s.status} onClick={() => onSetStage(s.stage_key)}>{s.stage_order}. {s.stage_name_fa}</button>)}</div>}</section><section className="detail-block"><h3>وضعیت موجودی اقلام</h3>{details.stock.length === 0 ? <p className="muted">قلم انباری ندارد.</p> : <div className="orders-table-wrap"><table><thead><tr><th>قلم</th><th>کد</th><th>درخواست</th><th>قابل فروش</th><th>وضعیت</th></tr></thead><tbody>{details.stock.map((s) => <tr key={s.order_item_id}><td>{s.item_name_fa}</td><td dir="ltr">{s.warehouse_item_code || '—'}</td><td>{formatNumber(s.requested_qty)}</td><td>{formatNumber(s.available_for_sale_qty)}</td><td>{s.stock_status}</td></tr>)}</tbody></table></div>}</section><section className="detail-block"><h3>تاریخچه</h3>{details.events.length === 0 ? <p className="muted">رویدادی ثبت نشده است.</p> : <div className="orders-timeline">{details.events.map((e) => <article key={e.id}><strong>{e.title}</strong><small>{formatDateTime(e.created_at)} · {e.description || ''}</small></article>)}</div>}</section><ReferralPanel compact sourceModule="orders" relatedOrderId={order.id} title="ارجاعات همین سفارش" defaultTarget="accounting" /></section>;
}

function ListSection({ orders, query, setQuery, pathFilter, setPathFilter, deliveryFilter, setDeliveryFilter, onSelect, onCancel, onExcel, onPrint }) {
  return <section className="orders-card"><div className="section-head"><CardTitle icon={Search} title="لیست سفارش‌ها" /><div><button onClick={onExcel}>Excel</button><button onClick={onPrint}>PDF</button></div></div><div className="filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو..." /><select value={pathFilter} onChange={(e) => setPathFilter(e.target.value)}><option value="all">همه مسیرها</option><option value="trading">بازرگانی</option><option value="rnd">R&D</option><option value="production">تولید</option></select><select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value)}><option value="all">همه وضعیت تحویل</option><option value="late">عقب‌افتاده</option><option value="due_soon">تحویل نزدیک</option><option value="on_track">طبق برنامه</option><option value="closed">بسته‌شده</option><option value="cancelled">لغوشده</option></select></div><div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>تاریخ</th><th>مشتری</th><th>تلفن</th><th>شهر</th><th>روش ارتباط</th><th>مسیر</th><th>مرحله</th><th>پیشرفت</th><th>روز مانده</th><th>مالی</th><th>انبار</th><th>عملیات</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}><td dir="ltr">{o.order_code}</td><td>{formatDate(o.registered_at)}</td><td>{o.customer_name}</td><td dir="ltr">{o.contact_phone || '—'}</td><td>{o.customer_city || '—'}</td><td>{CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel || '—'}</td><td>{PATH_LABELS[o.sales_path]}</td><td>{o.current_stage_name_fa}</td><td>{formatNumber(o.progress_percent || 0)}٪</td><td>{daysText(o.days_to_delivery, o.delivery_status)}</td><td>{FINANCE_LABELS[o.financial_status] || o.financial_status}</td><td>{STOCK_LABELS[o.stock_status] || o.stock_status}</td><td><div className="row-actions"><button onClick={() => onSelect(o.id)}>جزئیات</button><button className="danger" disabled={o.delivery_status === 'cancelled'} onClick={() => onCancel(o)}>لغو</button></div></td></tr>)}</tbody></table></div></section>;
}

function StockSection({ stock }) {
  return <section className="orders-card"><CardTitle icon={PackageCheck} title="موجودی قابل مشاهده برای فروش" />{stock.length === 0 ? <Empty /> : <div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>کالا</th><th>موجودی</th><th>رزروشده</th><th>قابل فروش</th><th>حداقل</th><th>وضعیت</th></tr></thead><tbody>{stock.map((s) => <tr key={s.item_id}><td dir="ltr">{s.item_code}</td><td>{s.item_name_fa}</td><td>{formatNumber(s.current_qty)} {s.unit}</td><td>{formatNumber(s.reserved_qty)}</td><td>{formatNumber(s.available_for_sale_qty)}</td><td>{formatNumber(s.min_stock_threshold)}</td><td>{s.is_low_stock ? 'کمبود' : 'قابل فروش'}</td></tr>)}</tbody></table></div>}</section>;
}

function TemplateSection({ templates, steps }) {
  return <section className="orders-card"><CardTitle icon={Settings} title="قالب‌های مراحل سفارش" />{templates.length === 0 ? <Empty /> : <div className="template-grid">{templates.map((t) => <article key={t.id} className="template-card"><h3>{t.name_fa}</h3><p>{t.sales_path ? PATH_LABELS[t.sales_path] : 'عمومی'} · {t.is_default ? 'پیش‌فرض' : 'قالب'}</p><ol>{steps.filter((s) => s.template_id === t.id).map((s) => <li key={s.id}>{s.stage_order}. {s.stage_name_fa}</li>)}</ol></article>)}</div>}</section>;
}

function OrderModal({ templates, customers, stock, busy, initialCustomerId, onClose, onSubmit }) {
  const initialCustomer = customers.find((c) => c.id === initialCustomerId) || customers[0];
  const [customerMode, setCustomerMode] = useState(initialCustomer ? 'existing' : 'new');
  const [form, setForm] = useState({
    customer_id: initialCustomer?.id || '',
    company_name: '',
    contact_phone: initialCustomer?.contact_phone || '',
    city: initialCustomer?.city || '',
    preferred_contact_channel: initialCustomer?.preferred_contact_channel || 'phone',
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

  function chooseCustomer(id) {
    const customer = customers.find((c) => c.id === id);
    setForm({ ...form, customer_id: id, contact_phone: customer?.contact_phone || '', city: customer?.city || '', preferred_contact_channel: customer?.preferred_contact_channel || form.preferred_contact_channel });
  }

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
        <label><span>نوع مشتری</span><select value={customerMode} onChange={(e) => setCustomerMode(e.target.value)}><option value="existing" disabled={customers.length === 0}>مشتری موجود</option><option value="new">مشتری/سرنخ جدید</option></select></label>
        {customerMode === 'existing'
          ? <label><span>مشتری</span><select value={form.customer_id} onChange={(e) => chooseCustomer(e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          : <label><span>نام مشتری</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label>}
        <label><span>تلفن</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label>
        <label><span>شهر</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label><span>روش ارتباط</span><select value={form.preferred_contact_channel} onChange={(e) => setForm({ ...form, preferred_contact_channel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>مسیر</span><select value={form.sales_path} onChange={(e) => setForm({ ...form, sales_path: e.target.value, workflow_template_id: '' })}>{Object.entries(PATH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>قالب مراحل</span><select value={form.workflow_template_id} onChange={(e) => setForm({ ...form, workflow_template_id: e.target.value })}><option value="">پیش‌فرض مسیر</option>{availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name_fa}</option>)}</select></label>
        <label><span>تاریخ ثبت</span><input type="date" value={form.registered_at} onChange={(e) => setForm({ ...form, registered_at: e.target.value })} /><small className="date-hint">شمسی: {formatDate(form.registered_at)}</small></label>
        <label><span>موعد تحویل</span><input type="date" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} /><small className="date-hint">شمسی: {formatDate(form.expected_delivery_date)}</small></label>
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
  return <div className="item-editor"><table><thead><tr><th>شرح</th><th>کد انبار</th><th>تعداد</th><th>واحد</th><th>فی ریال</th><th></th></tr></thead><tbody>{items.map((item, i) => <tr key={i}><td><input value={item.item_name_fa} onChange={(e) => update(i, { item_name_fa: e.target.value })} /></td><td><select value={item.warehouse_item_code} onChange={(e) => { const st = stock.find((s) => s.item_code === e.target.value); update(i, { warehouse_item_code: e.target.value, item_name_fa: st?.item_name_fa || item.item_name_fa, unit: st?.unit || item.unit }); }}><option value="">بدون کد</option>{stock.map((s) => <option key={s.item_id} value={s.item_code}>{s.item_code} · {s.item_name_fa} · قابل فروش {formatNumber(s.available_for_sale_qty)}</option>)}</select></td><td><input type="number" value={item.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td><td><input value={item.unit} onChange={(e) => update(i, { unit: e.target.value })} /></td><td><input type="number" value={item.unit_price} onChange={(e) => update(i, { unit_price: e.target.value })} /></td><td><button type="button" onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>×</button></td></tr>)}</tbody></table><button type="button" onClick={() => setItems((rows) => [...rows, { item_name_fa: 'ردیف جدید', warehouse_item_code: '', quantity: 1, unit: 'عدد', unit_price: 0 }])}>＋ افزودن قلم</button></div>;
}

function FollowupModal({ customers, orders, busy, initial = {}, onClose, onSubmit }) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ customerId: initial.customerId || customers[0]?.id || '', orderId: initial.orderId || '', title: initial.title || '', description: '', activityType: 'follow_up', contactChannel: 'phone', dueDate: initial.dueDate || tomorrow, dueTime: initial.dueTime || '09:00' });
  const customerOrders = orders.filter((o) => !form.customerId || o.customer_id === form.customerId);
  const selectedCustomer = customers.find((c) => c.id === form.customerId);
  function submit(e) {
    e.preventDefault();
    if (!form.customerId) return;
    const dueAt = `${form.dueDate}T${form.dueTime || '09:00'}:00`;
    onSubmit({ customerId: form.customerId, orderId: form.orderId || null, title: form.title, dueAt, description: form.description, activityType: form.activityType, contactChannel: form.contactChannel });
  }
  return <Modal title="ثبت پیگیری CRM واقعی" onClose={onClose}><form onSubmit={submit}>{customers.length === 0 && <div className="orders-message error">برای ثبت پیگیری ابتدا باید مشتری/سرنخ ثبت شود.</div>}<div className="form-grid"><label><span>مشتری</span><select value={form.customerId} onChange={(e) => { const c = customers.find((x) => x.id === e.target.value); setForm({ ...form, customerId: e.target.value, orderId: '', contactChannel: c?.preferred_contact_channel || form.contactChannel }); }} required>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><label><span>سفارش مرتبط</span><select value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}><option value="">بدون سفارش</option>{customerOrders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name}</option>)}</select></label><label><span>نوع فعالیت</span><select value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}>{Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>روش ارتباط</span><select value={form.contactChannel} onChange={(e) => setForm({ ...form, contactChannel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>تاریخ پیگیری</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required /><small className="date-hint">شمسی: {formatDate(form.dueDate)}</small></label><label><span>ساعت</span><input type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} required /></label><label className="full"><span>عنوان پیگیری</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={selectedCustomer ? `تماس با ${selectedCustomer.company_name}` : 'مثلاً تماس برای پیگیری پیش‌فاکتور'} required /></label><label className="full"><span>شرح / نتیجه مورد انتظار</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="شرح تماس، موضوع پیگیری، قول مشتری یا اقدام بعدی..." /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy || customers.length === 0}>{busy ? 'در حال ثبت...' : 'ثبت پیگیری'}</button></div></form></Modal>;
}

function CustomerModal({ busy, onClose, onSubmit }) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ company_name: '', contact_person_name: '', contact_phone: '', contact_email: '', city: '', address: '', preferred_contact_channel: 'phone', acquisition_source: '', crm_status: 'lead', lead_score: 50, next_follow_up_at: tomorrow });
  function submit(e) { e.preventDefault(); onSubmit({ ...form, next_follow_up_at: form.next_follow_up_at ? `${form.next_follow_up_at}T09:00:00` : null }); }
  return <Modal title="ثبت مشتری / سرنخ CRM" onClose={onClose}><form onSubmit={submit}><div className="form-grid"><label><span>نام شرکت/مشتری</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label><label><span>نام شخص تماس</span><input value={form.contact_person_name} onChange={(e) => setForm({ ...form, contact_person_name: e.target.value })} /></label><label><span>تلفن</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label><label><span>ایمیل</span><input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></label><label><span>شهر</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label><label><span>روش ارتباط</span><select value={form.preferred_contact_channel} onChange={(e) => setForm({ ...form, preferred_contact_channel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>روش جذب</span><input value={form.acquisition_source} onChange={(e) => setForm({ ...form, acquisition_source: e.target.value })} placeholder="سایت، معرفی، نمایشگاه..." /></label><label><span>وضعیت CRM</span><select value={form.crm_status} onChange={(e) => setForm({ ...form, crm_status: e.target.value })}>{Object.entries(CRM_STATUS_LABELS).filter(([k]) => k !== 'inactive').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>امتیاز سرنخ</span><input type="number" min="0" max="100" value={form.lead_score} onChange={(e) => setForm({ ...form, lead_score: e.target.value })} /></label><label><span>پیگیری بعدی</span><input type="date" value={form.next_follow_up_at} onChange={(e) => setForm({ ...form, next_follow_up_at: e.target.value })} /><small className="date-hint">شمسی: {formatDate(form.next_follow_up_at)}</small></label><label className="full"><span>آدرس</span><textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ثبت...' : 'ثبت مشتری'}</button></div></form></Modal>;
}

function Modal({ title, onClose, children }) { return <div className="orders-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="orders-modal"><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>; }
function CardTitle({ icon: Icon, title, action }) { return <div className="card-title-row"><span><Icon size={18} /> <b>{title}</b></span>{action}</div>; }
function Info({ label, value }) { return <div className="info"><span>{label}</span><b>{value || '—'}</b></div>; }
function Empty({ text = 'داده‌ای برای نمایش نیست.' }) { return <div className="orders-empty">{text}</div>; }
function Status({ status }) { return <span className={`status-pill ${status}`}>{DELIVERY_LABELS[status] || status}</span>; }
function Badge({ children }) { return <span className="crm-badge">{children}</span>; }
function daysText(days, status) { if (status === 'cancelled') return 'لغوشده'; if (status === 'closed') return 'بسته‌شده'; if (days == null) return '—'; if (days < 0) return `${formatNumber(Math.abs(days))} روز تأخیر`; if (days === 0) return 'امروز'; return `${formatNumber(days)} روز مانده`; }
function daysUntil(value) { if (!value) return 999; const diff = new Date(value).getTime() - Date.now(); return Math.ceil(diff / 86400000); }
function formatDate(value) { return formatJalaliDate(value); }
function formatDateTime(value) { return formatJalaliDateTime(value); }
function formatMoney(value) { return formatToman(value, 'fa'); }
function safe(value) { return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
