import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Eye,
  Edit3,
  FileText,
  ListChecks,
  LockKeyhole,
  PackageCheck,
  PhoneCall,
  Printer,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Target,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { useOrdersData, useOrderDetails, useOrderSalesDocumentBundle } from '../../hooks/useOrdersData';
import { useAuth } from '../../auth/AuthProvider';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import JalaliDateInput from '../../components/JalaliDateInput';
import ProductPicker from '../../components/ProductPicker';
import SearchableSelect from '../../components/SearchableSelect';
import MoneyInput from '../../components/MoneyInput';
import { printFinanceDocument } from '../accounting/FinanceDocumentDetails';
import { formatJalaliDate, formatJalaliDateTime, formatNumber, formatToman } from '../../lib/formatters';
import {
  cancelOrder,
  createCrmFollowup,
  createOrderReferral,
  createOrderWithItems,
  createOrUpdateCustomer,
  createSalesProformaFromOrder,
  deactivateCustomer,
  downloadCsv,
  downloadExcelHtml,
  markCrmFollowupDone,
  openPrintable,
  reserveOrderInventory,
  setOrderStage,
  dispatchOrderShipment,
  updateOrderStageSafe,
  updateWorkflowTemplate,
  updateWorkflowStep,
  createWorkflowStep,
  createWorkflowTemplateWithSteps,
} from '../../lib/orderApi';
import './OrdersModule.css';
import { getFriendlyErrorMessage, getTechnicalErrorMessage } from '../../lib/errorMessages';

const PATH_LABELS = { trading: 'بازرگانی', rnd: 'R&D', production: 'تولید مستقیم' };
const DELIVERY_LABELS = { cancelled: 'لغو شده', closed: 'بسته‌شده', late: 'عقب‌افتاده', due_soon: 'نزدیک تحویل', on_track: 'طبق برنامه' };
const STOCK_LABELS = { available: 'کافی', short: 'کمبود', unknown: 'نامشخص' };
const FINANCE_LABELS = { none: 'بدون فاکتور', proforma: 'پیش‌فاکتور', invoiced: 'فاکتور شده', partial: 'بخشی تسویه', paid: 'تسویه کامل' };
const SALES_DOCUMENT_LABELS = { sales_proforma: 'پیش‌فاکتور فروش', sales_invoice: 'فاکتور فروش' };
const SALES_DOCUMENT_STATUS_LABELS = { draft: 'پیش‌نویس', pending_approval: 'در انتظار تأیید', approved: 'تأیید شده', sent: 'ارسال شده', partially_paid: 'بخشی تسویه', paid: 'تسویه شده', cancelled: 'لغو شده', void: 'باطل شده' };
const CHANNEL_LABELS = { phone: 'تلفن', website: 'سایت', whatsapp: 'واتساپ', telegram: 'تلگرام', instagram: 'اینستاگرام', in_person: 'حضوری', email: 'ایمیل', other: 'سایر' };
const CRM_STATUS_LABELS = { lead: 'سرنخ', active_customer: 'مشتری فعال', vip: 'VIP', at_risk: 'در معرض ریزش', inactive: 'غیرفعال' };
const ACTIVITY_LABELS = { call: 'تماس', message: 'پیام', email: 'ایمیل', meeting: 'جلسه', visit: 'بازدید', note: 'یادداشت', follow_up: 'پیگیری', complaint: 'شکایت', other: 'سایر' };
const OPPORTUNITY_STAGE_LABELS = { new: 'جدید', follow_up: 'پیگیری', proposal: 'پیشنهاد', negotiation: 'مذاکره', won: 'برد', lost: 'باخت' };

function catalogSalePrice(item) {
  return Number(item?.sale_price_rial ?? item?.effective_sale_price ?? item?.unit_sale_price_estimate ?? 0);
}

export default function OrdersModule({ lang = 'fa' }) {
  const [tab, setTab] = useState('overview');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedSalesDocumentId, setSelectedSalesDocumentId] = useState(null);
  const [pathFilter, setPathFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [followupPrefill, setFollowupPrefill] = useState({});
  const [orderPrefill, setOrderPrefill] = useState({});
  const [pendingEditOrderId, setPendingEditOrderId] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const { hasRole } = useAuth();
  const hasFullOrderAccess = hasRole('admin', 'sales', 'sales_manager');
  const canDispatchShipments = hasFullOrderAccess;
  const canManageCredit = hasFullOrderAccess;
  const canViewSalesDocuments = hasRole('admin', 'accountant', 'sales', 'sales_manager');

  const data = useOrdersData();
  const activeOrders = useMemo(() => data.orders.filter((o) => o.delivery_status !== 'cancelled'), [data.orders]);
  const activeOrderIds = useMemo(() => new Set(activeOrders.map((o) => o.id)), [activeOrders]);
  const activeDueFollowups = useMemo(() => data.dueFollowups.filter((f) => !f.related_order_id || activeOrderIds.has(f.related_order_id)), [data.dueFollowups, activeOrderIds]);
  const details = useOrderDetails(selectedOrderId, canViewSalesDocuments);
  const salesDocumentBundle = useOrderSalesDocumentBundle(canViewSalesDocuments ? selectedSalesDocumentId : null);
  const selectedOrder = useMemo(() => activeOrders.find((o) => o.id === selectedOrderId), [activeOrders, selectedOrderId]);

  useEffect(() => {
    if (!pendingEditOrderId || details.loading || details.order?.id !== pendingEditOrderId) return;
    setOrderPrefill({ editing: true, order: details.order, items: details.orderItems || [] });
    setModal('order');
    setPendingEditOrderId(null);
  }, [pendingEditOrderId, details.loading, details.order, details.orderItems]);

  const filteredOrders = useMemo(() => activeOrders.filter((o) => {
    const text = `${o.order_code} ${o.customer_name} ${o.current_stage_name_fa} ${o.contact_phone || ''} ${o.customer_city || ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (pathFilter === 'all' || o.sales_path === pathFilter)
      && (deliveryFilter === 'all' || o.delivery_status === deliveryFilter);
  }), [activeOrders, query, pathFilter, deliveryFilter]);

  const kpis = useMemo(() => {
    const open = activeOrders.filter((o) => o.delivery_status !== 'cancelled' && o.current_stage !== 'closed' && o.delivery_status !== 'closed');
    const overdue = open.filter((o) => Number(o.days_to_delivery) < 0);
    const dueSoon = open.filter((o) => Number(o.days_to_delivery) >= 0 && Number(o.days_to_delivery) <= 10);
    return {
      active: open.length,
      late: overdue.length,
      dueSoon: dueSoon.length,
      finance: open.filter((o) => ['none', 'proforma'].includes(o.financial_status)).length,
      stock: open.filter((o) => o.stock_status !== 'available').length,
      production: open.filter((o) => o.sales_path === 'production').length,
      rnd: open.filter((o) => o.sales_path === 'rnd').length,
      paid: open.filter((o) => o.financial_status === 'paid').length,
    };
  }, [activeOrders]);

  async function runAction(fn, ok) {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      setModal(null);
      await data.refetch();
      await details.refetch?.();
      return true;
    } catch (e) {
      setNotice(getFriendlyErrorMessage(e, 'خطا در اجرای عملیات'));
      return false;
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

  function openOrderEdit(orderOrId) {
    const id = typeof orderOrId === 'string' ? orderOrId : orderOrId?.id;
    if (!id) return;
    setSelectedOrderId(id);
    setTab('flow');
    if (details.order?.id === id && !details.loading) {
      setOrderPrefill({ editing: true, order: details.order, items: details.orderItems || [] });
      setModal('order');
    } else {
      setPendingEditOrderId(id);
      setNotice('در حال دریافت آخرین نسخه سفارش برای ویرایش امن...');
    }
  }

  function openCustomerModal(customer = null) {
    setEditingCustomer(customer);
    setModal('customer');
  }

  function confirmCancelOrder(order) {
    const id = typeof order === 'string' ? order : order?.id;
    const code = typeof order === 'string' ? '' : order?.order_code;
    const reason = window.prompt(`دلیل لغو کامل سفارش ${code || ''}:`, 'لغو سفارش توسط فروش');
    if (!reason?.trim() || !id) return;
    const confirmed = window.confirm('لغو کامل، رزروهای فعال و مراحل/پیگیری‌های باز سفارش را می‌بندد. اسناد مالی ثبت‌شده، تولید انجام‌شده و ارسال‌های فیزیکی حذف یا بازنویسی نمی‌شوند. ادامه می‌دهید؟');
    if (!confirmed) return;
    runAction(async () => {
      await cancelOrder(id, reason.trim());
      if (selectedOrderId === id) setSelectedOrderId(null);
    }, 'لغو کامل سفارش ثبت شد؛ رزروها و گردش‌های باز سفارش بسته شدند و سوابق نهایی محفوظ ماندند.');
  }

  function exportOrders(kind = 'csv') {
    const headers = ['کد', 'تاریخ ثبت', 'مشتری', 'تلفن', 'شهر', 'روش ارتباط', 'مسیر', 'مرحله', 'پیشرفت', 'روز مانده', 'وضعیت مالی', 'وضعیت انبار', 'مبلغ فاکتور', 'پرداخت', 'مانده'];
    const rows = filteredOrders.map((o) => [o.order_code, formatDate(o.registered_at), o.customer_name, o.contact_phone, o.customer_city, CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel, PATH_LABELS[o.sales_path], o.current_stage_name_fa, `${o.progress_percent || 0}%`, daysText(o.days_to_delivery, o.delivery_status), FINANCE_LABELS[o.financial_status] || o.financial_status, STOCK_LABELS[o.stock_status] || o.stock_status, formatMoney(o.invoiced_amount), formatMoney(o.paid_amount), formatMoney(o.balance_amount)]);
    if (kind === 'excel') downloadExcelHtml('orders.xls', headers, rows, 'گزارش سفارش‌ها');
    else downloadCsv('orders.csv', [headers, ...rows]);
  }

  function printOrders() {
    const rows = filteredOrders.map((o) => `<tr><td>${safe(o.order_code)}</td><td>${formatDate(o.registered_at)}</td><td>${safe(o.customer_name)}</td><td>${safe(o.contact_phone || '—')}</td><td>${PATH_LABELS[o.sales_path] || '—'}</td><td>${safe(o.current_stage_name_fa)}</td><td>${formatNumber(o.progress_percent)}٪</td><td>${daysText(o.days_to_delivery, o.delivery_status)}</td><td>${FINANCE_LABELS[o.financial_status] || o.financial_status}</td></tr>`).join('');
    openPrintable('لیست سفارش‌ها', `<h1>لیست سفارش‌ها</h1><table><thead><tr><th>کد</th><th>تاریخ</th><th>مشتری</th><th>تلفن</th><th>مسیر</th><th>مرحله</th><th>پیشرفت</th><th>موعد</th><th>مالی</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function exportCrm(kind = 'excel') {
    const headers = ['نام', 'کد مشتری', 'نوع', 'تلفن', 'امتیاز', 'تعداد سفارش', 'فروش کل'];
    const rows = data.customers.map((c) => [c.company_name, c.customer_code || '—', CRM_STATUS_LABELS[c.crm_status] || c.crm_status, c.contact_phone, c.lead_score, c.total_orders, formatMoney(c.total_sales_amount)]);
    if (kind === 'excel') downloadExcelHtml('crm-customers.xls', headers, rows, 'گزارش CRM مشتریان');
    else downloadCsv('crm-customers.csv', [headers, ...rows]);
  }

  function printCrm() {
    const rows = data.customers.map((c) => `<tr><td>${safe(c.company_name)}</td><td>${safe(c.customer_code || '—')}</td><td>${CRM_STATUS_LABELS[c.crm_status] || c.crm_status || '—'}</td><td>${safe(c.contact_phone || '—')}</td><td>${formatNumber(c.lead_score)}</td><td>${formatNumber(c.total_orders)}</td><td>${formatMoney(c.total_sales_amount)}</td></tr>`).join('');
    openPrintable('CRM مشتریان', `<h1>CRM مشتریان</h1><table><thead><tr><th>نام</th><th>کد مشتری</th><th>نوع</th><th>تلفن</th><th>امتیاز</th><th>تعداد سفارش</th><th>فروش کل</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  return (
    <div className="orders-page" dir="rtl" lang={lang}>
      <header className="orders-hero">
        <div>
          <div className="eyebrow">Order Lifecycle · Aryaman CRM Sync</div>
          <h1>سفارش‌ها و CRM فروش</h1>
          <p>پیگیری سفارش از ثبت تا تحویل و تسویه، همراه با پرونده مشتری، CRM، موجودی و وضعیت مالی. مدیر کل، مدیر فروش و فروشنده در این ماژول دسترسی عملیاتی کامل و یکسان دارند.</p>
        </div>
        <div className="orders-actions">
          <button onClick={() => openOrderModal()} className="primary"><FileText size={16} /> سفارش جدید</button>
          <button onClick={() => openFollowup()}><PhoneCall size={16} /> پیگیری CRM</button>
          <button onClick={() => openCustomerModal()}><UserPlus size={16} /> مشتری/سرنخ</button>
          <button onClick={data.refetch}><RefreshCcw size={16} /> به‌روزرسانی</button>
        </div>
      </header>

      {notice && <div className={`orders-message ${notice.includes('خطا') ? 'error' : ''}`}>{notice}</div>}
      {data.loading && <div className="orders-message">در حال دریافت اطلاعات سفارش‌ها...</div>}
      {data.error && <div className="orders-message error">{getFriendlyErrorMessage(data.error, 'دریافت اطلاعات سفارش‌ها با خطا روبه‌رو شد.')}<br /><small dir="ltr">{getTechnicalErrorMessage(data.error)}</small></div>}

      {modal === 'order' && <OrderModal templates={data.templates} templateSteps={data.templateSteps} customers={data.customers} stock={data.stock} busy={busy} initialCustomerId={orderPrefill.customerId} initialOrder={orderPrefill.editing ? orderPrefill.order : null} initialItems={orderPrefill.editing ? orderPrefill.items : []} onClose={() => setModal(null)} onSubmit={(payload) => orderPrefill.editing ? runAction(() => updateOrderStageSafe({ orderId: orderPrefill.order.id, ...payload, expectedRevision: orderPrefill.order.edit_revision }), 'نسخه جدید سفارش ثبت و پیش‌فاکتور، رزرو و وابستگی‌های مجاز همگام شدند.') : runAction(() => createOrderWithItems(payload), 'سفارش جدید ثبت شد.')} />}
      {modal === 'followup' && <FollowupModal customers={data.customers} orders={activeOrders} busy={busy} initial={followupPrefill} onClose={() => setModal(null)} onSubmit={(payload) => runAction(() => createCrmFollowup(payload), 'پیگیری CRM ثبت شد و در فهرست پیگیری‌های باز قرار گرفت.')} />}
      {modal === 'customer' && <CustomerModal initialCustomer={editingCustomer} canManageCredit={canManageCredit} busy={busy} onClose={() => { setModal(null); setEditingCustomer(null); }} onSubmit={(payload) => runAction(() => createOrUpdateCustomer(payload), editingCustomer ? 'اطلاعات مشتری ویرایش شد.' : 'مشتری/سرنخ ثبت شد.')} />}
      {selectedSalesDocumentId && canViewSalesDocuments && <SalesDocumentViewer bundle={salesDocumentBundle} onClose={() => setSelectedSalesDocumentId(null)} />}

      <nav className="orders-tabs">
        {[
          ['overview', 'نمای کلی'], ['crm', 'CRM مشتریان'], ['flow', 'مراحل سفارش'], ['list', 'لیست سفارش‌ها'], ['stock', 'موجودی انبار'], ...(canViewSalesDocuments ? [['documents', 'فاکتور و پیش‌فاکتور']] : []), ['referrals', 'ارجاع و اسناد'], ['settings', 'تنظیم مراحل']
        ].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} followups={activeDueFollowups} orders={activeOrders} onOpenOrder={setSelectedOrderId} onNewFollowup={openFollowup} setTab={setTab} />}
      {!data.loading && tab === 'crm' && <CrmSection customers={data.customers} followups={activeDueFollowups} interactions={data.crmInteractions} opportunities={data.crmOpportunities} orders={activeOrders} busy={busy} onNewFollowup={openFollowup} onNewCustomer={() => openCustomerModal()} onQuickOrder={(customer) => openOrderModal({ customerId: customer.id })} onEditCustomer={(customer) => openCustomerModal(customer)} onDeactivateCustomer={(customer) => { if (window.confirm(`مشتری «${customer.company_name}» غیرفعال شود؟`)) runAction(() => deactivateCustomer(customer.id), 'مشتری غیرفعال شد.'); }} onMarkDone={(followup) => runAction(() => markCrmFollowupDone(followup.id), 'پیگیری انجام شد و از فهرست باز حذف شد.')} onExport={() => exportCrm('excel')} onPrint={printCrm} />}
      {!data.loading && tab === 'flow' && <FlowSection orders={filteredOrders} templateSteps={data.templateSteps} production={data.production} rnd={data.rnd} productionStages={data.productionStages} rndStages={data.rndStages} details={details} selectedOrder={selectedOrder} busy={busy} canDispatchShipments={canDispatchShipments} canViewSalesDocuments={canViewSalesDocuments} onOpenSalesDocument={setSelectedSalesDocumentId} onSelect={setSelectedOrderId} onEdit={openOrderEdit} onSetStage={(stage) => selectedOrder && runAction(() => setOrderStage(selectedOrder.id, stage, 'تغییر مرحله از ماژول سفارش'), 'مرحله سفارش تغییر کرد.')} onDispatch={(payload) => selectedOrder && runAction(() => dispatchOrderShipment(selectedOrder.id, payload), 'ارسال سفارش، سند خروج، کاردکس و مصرف رزرو با موفقیت ثبت شد.')} onProforma={(id) => runAction(() => createSalesProformaFromOrder(id), 'پیش‌فاکتور سفارش ساخته شد.')} onReserve={(id) => runAction(() => reserveOrderInventory(id), 'موجودی سفارش رزرو شد.')} onReferral={(id, targetModule, targetRole, label) => runAction(() => createOrderReferral({ orderId: id, targetModule, targetRole, title: `ارجاع سفارش به ${label}`, priority: 2 }), `ارجاع به ${label} ثبت شد.`)} onCancelOrder={(id) => confirmCancelOrder(activeOrders.find((o) => o.id === id) || id)} onCloseDetails={() => setSelectedOrderId(null)} />}
      {!data.loading && tab === 'list' && <ListSection orders={filteredOrders} query={query} setQuery={setQuery} pathFilter={pathFilter} setPathFilter={setPathFilter} deliveryFilter={deliveryFilter} setDeliveryFilter={setDeliveryFilter} onSelect={(id) => { setSelectedOrderId(id); setTab('flow'); }} onEdit={openOrderEdit} onCancel={confirmCancelOrder} onExcel={() => exportOrders('excel')} onPrint={printOrders} />}
      {!data.loading && tab === 'stock' && <StockSection stock={data.stock} onRefresh={() => data.refetch({ silent: true })} />}
      {!data.loading && tab === 'documents' && canViewSalesDocuments && <SalesDocumentsSection documents={data.salesDocuments} onOpen={setSelectedSalesDocumentId} onRefresh={() => data.refetch({ silent: true })} />}
      {!data.loading && tab === 'referrals' && <div className="orders-grid"><ReferralPanel sourceModule="orders" title="ارجاع و اسناد سفارش‌ها" defaultTarget="accounting" /></div>}
      {!data.loading && tab === 'settings' && <TemplateSection templates={data.templates} steps={data.templateSteps} busy={busy} onUpdateTemplate={(id, patch) => runAction(() => updateWorkflowTemplate(id, patch), 'قالب مراحل ذخیره شد.')} onUpdateStep={(id, patch) => runAction(() => updateWorkflowStep(id, patch), 'مرحله ذخیره شد.')} onCreateStep={(payload) => runAction(() => createWorkflowStep(payload), 'مرحله جدید اضافه شد.')} onCreateTemplate={(payload) => runAction(() => createWorkflowTemplateWithSteps(payload), 'قالب جدید ساخته شد و در ثبت سفارش قابل انتخاب است.')} />}
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
      <section className="orders-card"><CardTitle icon={PackageCheck} title="نزدیک‌ترین تحویل‌ها" action={<button onClick={() => setTab('flow')}>مراحل</button>} />{near.map((o) => <button key={o.id} className="near-order" onClick={() => onOpenOrder(o.id)}><span className="near-order-main"><b>{o.customer_name}</b><small>{o.order_code} · {o.current_stage_name_fa}</small><em>{formatDate(o.expected_delivery_date)} · {daysText(o.days_to_delivery, o.delivery_status)}</em></span><Status status={o.delivery_status} /></button>)}</section>
    </div>
  </>;
}
function Kpi({ icon, label, value, danger, warning, success }) { return <div className={`orders-kpi ${danger ? 'danger' : warning ? 'warning' : success ? 'success' : ''}`}><i>{icon}</i><span>{label}</span><b>{formatNumber(value || 0)}</b></div>; }

function CrmSection({ customers, followups, interactions, opportunities, orders, busy, onNewFollowup, onNewCustomer, onQuickOrder, onEditCustomer, onDeactivateCustomer, onMarkDone, onExport, onPrint }) {
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

    <div className="orders-grid two crm-layout crm-main-layout">
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجوی نام، تلفن، ایمیل..." />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">همه وضعیت‌ها</option>
            {Object.entries(CRM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="all">همه روش‌های ارتباط</option>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="orders-table-wrap crm-table-wrap compact-crm-table"><table><thead><tr><th>نام</th><th>کد مشتری</th><th>نوع</th><th>تلفن</th><th>امتیاز</th><th>سفارش</th><th>فروش کل</th><th>عملیات</th></tr></thead><tbody>{filteredCustomers.map((c) => <tr key={c.id} className={selectedCustomer?.id === c.id ? 'selected-row' : ''}><td><button className="link-button" onClick={() => setSelectedCustomerId(c.id)}>{c.company_name}</button></td><td dir="ltr">{c.customer_code || '—'}</td><td><Badge>{CRM_STATUS_LABELS[c.crm_status] || c.crm_status || '—'}</Badge></td><td dir="ltr">{c.contact_phone || '—'}</td><td>{formatNumber(c.lead_score)}</td><td>{formatNumber(c.total_orders)}</td><td>{formatMoney(c.total_sales_amount)}</td><td><div className="row-actions crm-row-actions"><button onClick={() => setSelectedCustomerId(c.id)}><Eye size={14} /> پرونده</button><button onClick={() => onEditCustomer(c)}><Edit3 size={14} /> ویرایش</button><button className="danger" onClick={() => onDeactivateCustomer(c)}><Ban size={14} /> غیرفعال</button></div></td></tr>)}</tbody></table></div>
        {filteredCustomers.length === 0 && <Empty text="مشتری یا سرنخی با این فیلتر پیدا نشد." />}
      </section>

      <section className="orders-card crm-followups-card">
        <CardTitle icon={CalendarClock} title="پیگیری‌های امروز و باز" action={<button onClick={() => onNewFollowup({ customerId: selectedCustomer?.id })}>＋ پیگیری</button>} />
        {dueToday.length === 0 ? <Empty text="پیگیری فوری نداریم. برای تست، یک پیگیری جدید با موعد امروز/فردا ثبت کن." /> : <div className="crm-followup-list">{dueToday.map((f) => <article key={f.id} className={f.is_overdue ? 'overdue' : ''}><div><strong>{f.title}</strong><small>{f.company_name} · {formatDateTime(f.due_at)} · {f.order_code || 'بدون سفارش'}</small></div><div className="row-actions"><button disabled={busy} onClick={() => onMarkDone(f)}><CheckCircle2 size={14} /> انجام شد</button><button onClick={() => onNewFollowup({ customerId: f.customer_id, orderId: f.related_order_id || '', title: `پیگیری مجدد: ${f.title}` })}>پیگیری مجدد</button></div></article>)}</div>}
      </section>
    </div>

    {selectedCustomer && <section className="orders-card orders-grid customer-dossier">
      <div className="dossier-header"><div><span className="eyebrow">Customer File</span><h2>{selectedCustomer.company_name}</h2><p>{CRM_STATUS_LABELS[selectedCustomer.crm_status] || 'پرونده CRM'} · {selectedCustomer.contact_person_name || 'بدون شخص تماس'}</p></div><div className="dossier-actions"><button onClick={() => onQuickOrder(selectedCustomer)}>ثبت سفارش</button><button onClick={() => onNewFollowup({ customerId: selectedCustomer.id })}>ثبت پیگیری</button><button onClick={() => onEditCustomer(selectedCustomer)}>ویرایش مشتری</button><button className="danger" onClick={() => onDeactivateCustomer(selectedCustomer)}>غیرفعال‌سازی</button></div></div>
      <div className="detail-mini-grid"><Info label="تلفن" value={selectedCustomer.contact_phone} /><Info label="ایمیل" value={selectedCustomer.contact_email} /><Info label="شخص تماس" value={selectedCustomer.contact_person_name} /><Info label="روش ارتباط" value={CHANNEL_LABELS[selectedCustomer.preferred_contact_channel] || selectedCustomer.preferred_contact_channel} /><Info label="امتیاز" value={formatNumber(selectedCustomer.lead_score)} /><Info label="پیگیری بعدی" value={formatDateTime(selectedCustomer.next_follow_up_at)} /><Info label="تعداد سفارش" value={formatNumber(selectedCustomer.total_orders)} /><Info label="فروش کل" value={formatMoney(selectedCustomer.total_sales_amount)} /><Info label="آخرین تماس" value={formatDateTime(selectedCustomer.last_contacted_at)} /></div>
      <div className="orders-grid two dossier-blocks"><section className="detail-block"><h3>سفارش‌های مرتبط</h3>{selectedOrders.length === 0 ? <p className="muted">هنوز سفارشی برای این مشتری ثبت نشده است.</p> : <div className="orders-table-wrap"><table><thead><tr><th>کد</th><th>عنوان</th><th>مرحله</th><th>مالی</th></tr></thead><tbody>{selectedOrders.map((o) => <tr key={o.id}><td dir="ltr">{o.order_code}</td><td>{o.customer_name}</td><td>{o.current_stage_name_fa}</td><td>{FINANCE_LABELS[o.financial_status] || o.financial_status}</td></tr>)}</tbody></table></div>}</section><section className="detail-block"><h3>پیگیری‌های باز این مشتری</h3>{selectedFollowups.length === 0 ? <p className="muted">پیگیری بازی ندارد.</p> : <div className="crm-followup-list mini">{selectedFollowups.map((f) => <article key={f.id}><strong>{f.title}</strong><small>{formatDateTime(f.due_at)} · {f.order_code || 'بدون سفارش'}</small></article>)}</div>}</section></div>
      <section className="detail-block"><h3>آخرین تعاملات این مشتری</h3>{selectedInteractions.length === 0 ? <p className="muted">تعاملی برای این مشتری ثبت نشده.</p> : <div className="orders-timeline interaction-timeline">{selectedInteractions.map((i) => <article key={i.id}><strong>{ACTIVITY_LABELS[i.activity_type] || i.activity_type} · {i.title}</strong><small>{formatDateTime(i.activity_at || i.created_at)} · {CHANNEL_LABELS[i.contact_channel] || i.contact_channel || '—'}</small>{i.description && <p>{i.description}</p>}</article>)}</div>}</section>
    </section>}

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

function FlowSection({ orders, templateSteps = [], production = [], rnd = [], productionStages = [], rndStages = [], selectedOrder, details, busy, canDispatchShipments, canViewSalesDocuments, onOpenSalesDocument, onSelect, onEdit, onCloseDetails, onSetStage, onDispatch, onProforma, onReserve, onReferral, onCancelOrder }) {
  const [flowPath, setFlowPath] = useState('all');
  const [flowStatus, setFlowStatus] = useState('all');
  const [flowFromDate, setFlowFromDate] = useState('');
  const [flowToDate, setFlowToDate] = useState('');
  const [flowLimit, setFlowLimit] = useState(10);
  const productionByOrderId = useMemo(() => Object.fromEntries((production || []).filter((p) => p.source_order_id).map((p) => [p.source_order_id, p])), [production]);
  const rndByOrderId = useMemo(() => Object.fromEntries((rnd || []).filter((r) => r.source_order_id).map((r) => [r.source_order_id, r])), [rnd]);
  const productionStagesByOrderId = useMemo(() => {
    const byProductionId = (productionStages || []).reduce((map, stage) => {
      if (!map[stage.production_order_id]) map[stage.production_order_id] = [];
      map[stage.production_order_id].push(stage);
      return map;
    }, {});
    return Object.fromEntries((production || []).filter((p) => p.source_order_id).map((p) => [p.source_order_id, (byProductionId[p.id] || []).sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0))]));
  }, [production, productionStages]);
  const rndStagesByOrderId = useMemo(() => {
    const byRndId = (rndStages || []).reduce((map, stage) => {
      if (!map[stage.rnd_project_id]) map[stage.rnd_project_id] = [];
      map[stage.rnd_project_id].push(stage);
      return map;
    }, {});
    return Object.fromEntries((rnd || []).filter((r) => r.source_order_id).map((r) => [r.source_order_id, (byRndId[r.id] || []).sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0))]));
  }, [rnd, rndStages]);
  const flowOrders = useMemo(() => orders.filter((o) => (
    o.delivery_status !== 'cancelled'
    && (flowPath === 'all' || o.sales_path === flowPath)
    && (flowStatus === 'all'
      || (flowStatus === 'late' && o.delivery_status === 'late')
      || (flowStatus === 'due_soon' && o.delivery_status === 'due_soon')
      || (flowStatus === 'waitingFinance' && ['none', 'proforma'].includes(o.financial_status))
      || (flowStatus === 'stockIssue' && o.stock_status !== 'available'))
    && (!flowFromDate || String(o.registered_at || '').slice(0, 10) >= flowFromDate)
    && (!flowToDate || String(o.registered_at || '').slice(0, 10) <= flowToDate)
  )).sort((a, b) => compareOrderValues(a, b, { key: 'registered_at', dir: 'desc' }) || String(b.order_code || '').localeCompare(String(a.order_code || ''), 'fa')), [orders, flowPath, flowStatus, flowFromDate, flowToDate]);
  const visibleFlowOrders = flowOrders.slice(0, flowLimit);

  return <section className="orders-card flow-workspace-card">
    <div className="flow-section-head">
      <div>
        <CardTitle icon={ListChecks} title="مراحل سفارش" />
        <p className="muted">نمای خطی هر سفارش: مسیر، مرحله فعلی، درصد پیشرفت و زمان باقی‌مانده تا تحویل.</p>
      </div>
      <div className="filters flow-filters">
        <select value={flowPath} onChange={(e) => setFlowPath(e.target.value)}><option value="all">همه مسیرها</option><option value="trading">بازرگانی</option><option value="rnd">R&D</option><option value="production">تولید مستقیم</option></select>
        <select value={flowStatus} onChange={(e) => { setFlowStatus(e.target.value); setFlowLimit(10); }}><option value="all">همه وضعیت‌ها</option><option value="late">فقط عقب‌افتاده</option><option value="due_soon">تحویل نزدیک</option><option value="waitingFinance">در انتظار مالی</option><option value="stockIssue">نیاز به بررسی انبار</option></select><label className="flow-date-filter">از تاریخ <JalaliDateInput value={flowFromDate} onChange={(value) => { setFlowFromDate(value); setFlowLimit(10); }} /></label><label className="flow-date-filter">تا تاریخ <JalaliDateInput value={flowToDate} onChange={(value) => { setFlowToDate(value); setFlowLimit(10); }} /></label>
      </div>
    </div>
    {flowOrders.length === 0 ? <Empty /> : <div className="flow-list advanced-flow-list">{visibleFlowOrders.map((o) => {
      const linkedProduction = productionByOrderId[o.id];
      const linkedRnd = rndByOrderId[o.id];
      const linkedInfo = o.sales_path === 'production' ? linkedProduction : o.sales_path === 'rnd' ? linkedRnd : null;
      const linkedStages = o.sales_path === 'production' ? (productionStagesByOrderId[o.id] || []) : o.sales_path === 'rnd' ? (rndStagesByOrderId[o.id] || []) : [];
      const steps = stageStepsForOrder(o, templateSteps, linkedInfo, linkedStages);
      const currentStageName = linkedInfo?.current_stage_name_fa || o.current_stage_name_fa;
      const progressPercent = linkedInfo?.progress_percent ?? o.progress_percent;
      const linkedLabel = linkedInfo ? (o.sales_path === 'production' ? 'مراحل زنده تولید' : 'مراحل زنده R&D') : 'مراحل سفارش';
      return <article key={o.id} className={`flow-card advanced-flow-card ${linkedInfo ? 'delegated-flow-card' : ''}`}>
        <div className="flow-card-top">
          <div className="flow-title-block">
            <h3>{o.order_code} · {o.customer_name}</h3>
            <small>ثبت: {formatDate(o.registered_at)} · {o.customer_name} · مسیر: {PATH_LABELS[o.sales_path]} · {linkedLabel}: {currentStageName || '—'}</small>
          </div>
          <div className="flow-badges">
            <span className="flow-badge date">ثبت: {formatDate(o.registered_at)}</span>
            <span className={o.delivery_status === 'late' ? 'flow-badge red' : o.delivery_status === 'due_soon' ? 'flow-badge amber' : 'flow-badge'}>{daysText(o.days_to_delivery, o.delivery_status)}</span>
            <span className={o.stock_status === 'available' ? 'flow-badge green' : 'flow-badge amber'}>انبار: {STOCK_LABELS[o.stock_status] || o.stock_status}</span>
            {linkedInfo && <span className="flow-badge violet">{linkedLabel}</span>}
            <span className="flow-badge blue">{FINANCE_LABELS[o.financial_status] || o.financial_status}</span>
          </div>
        </div>
        <div className="advanced-progress"><span style={{ width: `${Number(progressPercent || 0)}%` }} /></div>
        <div className="flow-progress-note">پیشرفت {linkedLabel}: {formatNumber(progressPercent || 0)}٪ · مرحله فعلی: {currentStageName || '—'}</div>
        <div className="stage-stepper advanced-stepper">
          {steps.map((s, index) => <div key={`${o.id}-${s.stage_key}-${index}`} className={`stage-step ${s.state}`}>
            <div className="stage-dot">{s.state === 'done' ? '✓' : index + 1}</div>
            <small>{s.stage_name_fa}</small>
          </div>)}
        </div>
        <div className="advanced-flow-footer">
          <div className="miniDueBox advancedDueBox">
            <span>{daysText(o.days_to_delivery, o.delivery_status)}</span>
            <b>تا تحویل نهایی</b>
            <small>{formatDate(o.expected_delivery_date)}</small>
          </div>
          <div className="flow-footer-actions"><button onClick={() => onEdit?.(o)}><Edit3 size={15}/> ویرایش امن</button><button onClick={() => onSelect(o.id)}>جزئیات و عملیات</button></div>
        </div>
      </article>;
    })}</div>}
    {flowOrders.length > flowLimit && <div className="flow-more-row"><span>نمایش {visibleFlowOrders.length} از {flowOrders.length} سفارش</span><button type="button" onClick={() => setFlowLimit((n) => n + 10)}>نمایش بیشتر</button></div>}

    {selectedOrder && <div className="order-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCloseDetails?.()}>
      <aside className="order-detail-drawer-left">
        <OrderDetailPanel order={selectedOrder} details={details} busy={busy} canDispatchShipments={canDispatchShipments} canViewSalesDocuments={canViewSalesDocuments} onOpenSalesDocument={onOpenSalesDocument} onEdit={onEdit} onClose={onCloseDetails} onSetStage={onSetStage} onDispatch={onDispatch} onProforma={onProforma} onReserve={onReserve} onReferral={onReferral} onCancelOrder={onCancelOrder} />
      </aside>
    </div>}
  </section>;
}

function stageStepsForOrder(order, templateSteps, linkedInfo = null, linkedStages = []) {
  if (linkedInfo && linkedStages.length > 0) {
    return linkedStages.map((stage, index) => ({
      stage_key: stage.id || `${linkedInfo.id}-${index}`,
      stage_order: stage.order_index || index + 1,
      stage_name_fa: stageNameLinked(stage),
      state: linkedStageState(stage.status),
      source: 'linked',
    }));
  }
  if (linkedInfo) {
    return [{
      stage_key: linkedInfo.id,
      stage_order: 1,
      stage_name_fa: linkedInfo.current_stage_name_fa || (order.sales_path === 'production' ? 'مرحله تولید' : 'مرحله R&D'),
      state: Number(linkedInfo.progress_percent || 0) >= 100 ? 'done' : 'current',
      source: 'linked',
    }];
  }
  const steps = templateSteps
    .filter((s) => s.template_id === order.workflow_template_id && s.is_active !== false)
    .sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0));
  const fallback = steps.length ? steps : [{ stage_key: order.current_stage, stage_order: 1, stage_name_fa: order.current_stage_name_fa || order.current_stage }];
  const currentIndex = Math.max(0, fallback.findIndex((s) => s.stage_key === order.current_stage));
  return fallback.map((s, index) => ({
    ...s,
    state: order.delivery_status === 'cancelled' ? 'cancelled' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
    source: 'order',
  }));
}



function OrderDetailPanel({ order, details, busy, canDispatchShipments, canViewSalesDocuments, onOpenSalesDocument, onEdit, onClose, onSetStage, onDispatch, onProforma, onReserve, onReferral, onCancelOrder }) {
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  if (!order) return <section className="orders-card"><div className="orders-empty">یک سفارش را انتخاب کنید.</div></section>;
  const hasProforma = Number(order.proforma_count || 0) > 0 || details.documents.some((d) => d.document_type === 'sales_proforma' && d.status !== 'void');
  const productionStages = details.productionStages || [];
  const rndStages = details.rndStages || [];
  const linkedProduction = details.production?.[0];
  const linkedRnd = details.rnd?.[0];
  const isDelegatedToProduction = order.sales_path === 'production' && (linkedProduction || productionStages.length > 0);
  const isDelegatedToRnd = order.sales_path === 'rnd' && (linkedRnd || rndStages.length > 0);
  const isDelegated = isDelegatedToProduction || isDelegatedToRnd;
  const delegatedTitle = isDelegatedToProduction ? 'مراحل تأییدشده تولید' : isDelegatedToRnd ? 'مراحل تأییدشده R&D' : '';
  const linkedInfo = linkedProduction || linkedRnd;
  const shipmentItems = details.shipmentItems || [];
  const shipments = details.shipments || [];
  const remainingItems = shipmentItems.filter((item) => Number(item.remaining_quantity || 0) > 0);
  const hasApprovedInvoice = shipmentItems.some((item) => item.has_approved_invoice)
    || details.documents.some((d) => d.document_type === 'sales_invoice' && ['approved', 'sent', 'partially_paid', 'paid'].includes(d.status));
  const canOpenDispatch = canDispatchShipments && remainingItems.length > 0 && hasApprovedInvoice && order.delivery_status !== 'cancelled';

  async function submitDispatch(payload) {
    const ok = await onDispatch?.(payload);
    if (ok) setShipmentModalOpen(false);
    return ok;
  }

  return <section className="orders-card detail-card">
    {shipmentModalOpen && <OrderShipmentModal order={order} items={shipmentItems} busy={busy} onClose={() => setShipmentModalOpen(false)} onSubmit={submitDispatch} />}
    <CardTitle icon={FileText} title={`جزئیات ${order.order_code}`} action={onClose ? <button onClick={onClose}>بستن ×</button> : null} />
    <div className="detail-mini-grid"><Info label="مشتری" value={order.customer_name} /><Info label="مرحله" value={isDelegated ? (linkedInfo?.current_stage_name_fa || order.current_stage_name_fa) : order.current_stage_name_fa} /><Info label="تاریخ ثبت" value={formatDate(order.registered_at)} /><Info label="پیشرفت" value={`${formatNumber(isDelegated ? (linkedInfo?.progress_percent ?? order.progress_percent) : (order.progress_percent || 0))}٪`} /><Info label="تحویل" value={daysText(order.days_to_delivery, order.delivery_status)} /><Info label="مالی" value={FINANCE_LABELS[order.financial_status] || order.financial_status} /><Info label="انبار" value={STOCK_LABELS[order.stock_status] || order.stock_status} /><Info label="مانده" value={formatMoney(order.balance_amount)} /></div>
    {details.credit?.requires_credit_review && <div className="order-credit-warning"><TriangleAlert size={18}/><div><b>نیاز به بررسی اعتبار مشتری</b><span>{details.credit.credit_hold ? 'حساب مشتری در توقف اعتباری است.' : `مانده باز ${formatMoney(details.credit.outstanding_amount)} از سقف اعتبار ${formatMoney(details.credit.credit_limit)} عبور کرده است.`}{details.credit.credit_control_note ? ` · ${details.credit.credit_control_note}` : ''}</span></div></div>}
    <div className="detail-actions"><button className="primary-edit" disabled={busy || details.loading} onClick={() => onEdit?.(order)}><Edit3 size={15}/> ویرایش مرحله‌ای</button><button disabled={busy || hasProforma} title={hasProforma ? 'برای این سفارش قبلاً پیش‌فاکتور صادر شده است.' : ''} onClick={() => onProforma(order.id)}>{hasProforma ? 'پیش‌فاکتور صادر شده' : 'صدور پیش‌فاکتور'}</button><button disabled={busy} onClick={() => onReserve(order.id)}>رزرو انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'accounting', 'accountant', 'مالی')}>ارجاع مالی</button><button disabled={busy} onClick={() => onReferral(order.id, 'warehouse', 'warehouse', 'انبار')}>ارجاع انبار</button><button disabled={busy} onClick={() => onReferral(order.id, 'admin', 'admin', 'مدیر کل')}>ارجاع مدیر کل</button><button className="danger" disabled={busy || order.delivery_status === 'cancelled'} onClick={() => onCancelOrder(order.id)}>لغو کامل سفارش</button></div>

    <section className="detail-block order-shipment-center">
      <div className="order-shipment-head">
        <div><h3>ارسال از سفارش</h3><p>هر بار فقط تعداد واقعی تحویلی را ثبت کنید؛ سند خروج، کاردکس و مصرف رزرو هم‌زمان و قطعی ثبت می‌شوند.</p></div>
        <button className="dispatch-order-btn" disabled={busy || !canOpenDispatch} title={!canDispatchShipments ? 'این حساب دسترسی عملیاتی ماژول سفارش‌ها را ندارد' : 'ارسال قطعی از RPC اتمیک سفارش ثبت می‌شود'} onClick={() => setShipmentModalOpen(true)}><PackageCheck size={16} />{remainingItems.length === 0 && shipmentItems.length > 0 ? 'ارسال کامل شده' : !canDispatchShipments ? 'دسترسی ارسال ندارید' : 'ثبت ارسال جدید'}</button>
      </div>
      {!hasApprovedInvoice && <p className="shipment-gate-note">برای ثبت ارسال، ابتدا فاکتور فروش نهایی این سفارش باید تأیید شود.</p>}
      {shipmentItems.length === 0 ? <p className="muted">قلم ساختاریافته‌ای برای ارسال پیدا نشد.</p> : <div className="shipment-progress-list">{shipmentItems.map((item) => <article key={item.order_item_id} className={Number(item.remaining_quantity || 0) <= 0 ? 'complete' : !item.is_warehouse_mapped ? 'blocked' : ''}>
        <div><b>{item.item_name_fa}</b><small dir="ltr">{item.warehouse_item_code || 'بدون اتصال انبار'}</small></div>
        <div className="shipment-qty-flow"><span>سفارش <b>{formatNumber(item.ordered_quantity)}</b></span><span>ارسال‌شده <b>{formatNumber(item.sent_quantity)}</b></span><span className="remaining">مانده <b>{formatNumber(item.remaining_quantity)} {item.unit}</b></span></div>
      </article>)}</div>}
      <small className="shipment-role-hint">{canDispatchShipments ? 'شما مجاز به ثبت قطعی ارسال هستید.' : 'برای ثبت قطعی، سفارش را به انبار ارجاع دهید؛ فقط مدیر یا انبار مجاز به خروج موجودی است.'} سفارش تولیدی نیز پس از ورود محصول نهایی به انبار، از همین بخش ارسال می‌شود.</small>
    </section>

    {shipments.length > 0 && <section className="detail-block order-shipment-history"><h3>محموله‌های این سفارش</h3><div className="shipment-history-list">{shipments.map((shipment) => <article key={shipment.id} className={shipment.status === 'cancelled' ? 'cancelled' : ''}>
      <header><div><b dir="ltr">{shipment.shipment_number || '—'}</b><small>{formatDate(shipment.shipment_date)} · سند خروج <span dir="ltr">{shipment.warehouse_doc_number || '—'}</span></small></div><span className={`shipment-status ${shipment.status}`}>{orderShipmentStatus(shipment.status)}</span></header>
      <div className="shipment-history-lines">{orderShipmentLines(shipment).map((line) => <span key={line.id || `${line.item_code}-${line.line_no}`}><b>{line.item_name}</b><em dir="ltr">{line.item_code}</em><strong>{formatNumber(line.quantity)} {line.unit}</strong></span>)}</div>
      <footer><span>{shipment.carrier_name || 'حامل ثبت نشده'}</span><span>رهگیری: <b dir="ltr">{shipment.tracking_code || '—'}</b></span><span>تحویل‌گیرنده: {shipment.receiver_name || '—'}</span></footer>
      {shipment.status === 'cancelled' && shipment.cancellation_reason && <p>{shipment.cancellation_reason}</p>}
    </article>)}</div></section>}

    {canViewSalesDocuments && <section className="detail-block order-sales-documents"><div className="order-sales-documents-head"><div><h3>فاکتور و پیش‌فاکتور این سفارش</h3><p>دسترسی این بخش فقط مشاهده و دریافت خروجی رسمی/غیررسمی است؛ عملیات حسابداری از اینجا در دسترس نیست.</p></div></div>{details.loading ? <p className="muted">در حال دریافت اسناد فروش...</p> : details.documents.length === 0 ? <p className="muted">هنوز فاکتور یا پیش‌فاکتوری برای این سفارش ثبت نشده است.</p> : <div className="order-sales-document-list">{details.documents.map((document) => <article key={document.id}><div><span className={`sales-doc-kind ${document.document_type}`}>{SALES_DOCUMENT_LABELS[document.document_type] || document.document_type}</span><b dir="ltr">{document.doc_number}</b><small>{formatDate(document.issue_date)} · {SALES_DOCUMENT_STATUS_LABELS[document.status] || document.status}</small></div><div><strong>{formatMoney(document.total_amount)}</strong><small>مانده: {formatMoney(document.balance_amount)}</small></div><button type="button" onClick={() => onOpenSalesDocument?.(document.id)}><Eye size={15}/> مشاهده و خروجی</button></article>)}</div>}</section>}
    {hasProforma && <p className="orders-info-note">برای این سفارش پیش‌فاکتور قبلاً صادر شده است؛ صدور مجدد از بخش سفارش‌ها مجاز نیست.</p>}
    {isDelegated && <p className="orders-info-note delegated">این سفارش بعد از ورود به {isDelegatedToProduction ? 'تولید' : 'R&D'}، مراحلش از همان بخش کنترل می‌شود و فروش فقط روند را مشاهده می‌کند. پایان تولید/R&D به‌تنهایی محموله مشتری ایجاد نمی‌کند.</p>}
    {isDelegated ? <section className="detail-block delegated-stage-block"><h3>{delegatedTitle}</h3><p className="orders-info-note delegated">نوار اصلی این سفارش از مراحل زنده {isDelegatedToProduction ? 'تولید' : 'R&D'} در کارت روند سفارش نمایش داده می‌شود. فروش/مدیر فروش برای تغییر مرحله این سفارش دسترسی ندارد.</p></section> : <section className="detail-block"><h3>تغییر مرحله فروش/سفارش</h3>{details.stages.length === 0 ? <p className="muted">مرحله‌ای ثبت نشده است.</p> : <div className="stage-buttons">{details.stages.map((s) => <button key={s.id} disabled={busy || s.status === 'current' || order.delivery_status === 'cancelled'} className={s.status} onClick={() => onSetStage(s.stage_key)}>{s.stage_order}. {s.stage_name_fa}</button>)}</div>}</section>}
    {(details.production?.length > 0 || details.rnd?.length > 0) && <section className="detail-block live-linked-progress"><h3>پیشرفت آنلاین تولید / R&D</h3>{details.production?.map((p) => <article key={p.id}><b>{p.code} · {p.product_name_fa}</b><span>{p.current_stage_name_fa || '—'} · پیشرفت {formatNumber(p.progress_percent)}٪ · تولید {formatNumber(p.quantity_produced || p.output_registered_qty || 0)} از {formatNumber(p.quantity_planned || 0)} · کد انبار {p.output_item_code || '—'}</span></article>)}{details.rnd?.map((r) => <article key={r.id}><b>{r.code} · {r.title_fa}</b><span>{r.current_stage_name_fa || '—'} · پیشرفت {formatNumber(r.progress_percent)}٪ · هزینه {formatMoney(r.actual_total_cost)}</span></article>)}</section>}
    <section className="detail-block"><h3>وضعیت موجودی اقلام</h3>{details.stock.length === 0 ? <p className="muted">قلم انباری ندارد.</p> : <div className="orders-table-wrap"><table><thead><tr><th>قلم</th><th>کد</th><th>درخواست</th><th>قابل فروش</th><th>وضعیت</th></tr></thead><tbody>{details.stock.map((s) => <tr key={s.order_item_id}><td>{s.item_name_fa}</td><td dir="ltr">{s.warehouse_item_code || '—'}</td><td>{formatNumber(s.requested_qty)}</td><td>{formatNumber(s.available_for_sale_qty)}</td><td>{s.stock_status}</td></tr>)}</tbody></table></div>}</section>
    {details.revisions.length>0&&<section className="detail-block order-revision-history"><h3>نسخه‌های ویرایش سفارش</h3><div className="orders-timeline">{details.revisions.map((revision)=><article key={revision.id}><strong>نسخه {formatNumber(revision.revision_no)} · {revision.reason}</strong><small>{formatDateTime(revision.created_at)} · {Number(revision.dependency_snapshot?.shipment_count||0)>0?'اسناد ارسال قبلی حفظ شد':'بدون ارسال فیزیکی قبلی'} · {Number(revision.dependency_snapshot?.production_count||0)>0?'وابستگی تولید بررسی شد':'بدون وابستگی تولید'}</small>{revision.sync_result?.warnings?.length>0&&<p>{revision.sync_result.warnings.join(' · ')}</p>}</article>)}</div></section>}
    <section className="detail-block"><h3>تاریخچه رویدادها</h3>{details.events.length === 0 ? <p className="muted">رویدادی ثبت نشده است.</p> : <div className="orders-timeline order-history-scroll">{details.events.map((e) => <article key={e.id}><strong>{e.title}</strong><small>{formatDateTime(e.created_at)} · {e.description || ''}</small></article>)}</div>}</section><ReferralPanel compact sourceModule="orders" relatedOrderId={order.id} title="ارجاعات همین سفارش" defaultTarget="accounting" />
  </section>;
}

function OrderShipmentModal({ order, items = [], busy, onClose, onSubmit }) {
  const eligible = items.filter((item) => Number(item.remaining_quantity || 0) > 0);
  const [quantities, setQuantities] = useState(() => Object.fromEntries(eligible.map((item) => [item.order_item_id, Math.max(0, Math.min(Number(item.remaining_quantity || 0), Number(item.available_to_this_line || 0)))])));
  const [form, setForm] = useState({ shipment_date: new Date().toISOString().slice(0, 10), carton_count: 0, carrier_name: '', tracking_code: '', receiver_name: '', notes: '' });
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() || `shipment-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    const lines = eligible.map((item) => ({ order_item_id: item.order_item_id, quantity: Number(quantities[item.order_item_id] || 0) })).filter((line) => line.quantity > 0);
    if (lines.length === 0) {
      setError('حداقل برای یک قلم، تعداد ارسال را بیشتر از صفر وارد کنید.');
      return;
    }
    const invalid = eligible.find((item) => Number(quantities[item.order_item_id] || 0) > Number(item.remaining_quantity || 0));
    if (invalid) {
      setError(`تعداد «${invalid.item_name_fa}» از مانده سفارش بیشتر است.`);
      return;
    }
    await onSubmit({ ...form, lines, idempotency_key: idempotencyKey });
  }

  return <div className="orders-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}><div className="orders-modal order-shipment-modal"><header><div><h3>ثبت قطعی ارسال سفارش</h3><small>{order.order_code} · {order.customer_name}</small></div><button disabled={busy} onClick={onClose}>×</button></header><div><form onSubmit={submit}>
    <div className="shipment-atomic-note"><PackageCheck size={20} /><div><b>عملیات اتمیک انبار</b><span>با ثبت نهایی، موجودی اقلام انتخاب‌شده کم، سند خروج و کاردکس ساخته و رزرو همان مقدار مصرف می‌شود.</span></div></div>
    {error && <div className="orders-message error">{error}</div>}
    <div className="dispatch-lines"><div className="dispatch-lines-head"><span>قلم سفارش</span><span>سفارش / قبلاً ارسال</span><span>موجودی قابل استفاده</span><span>تعداد این ارسال</span></div>{eligible.map((item) => { const max = Number(item.remaining_quantity || 0); const available = Number(item.available_to_this_line || 0); return <div className={`dispatch-line ${!item.is_warehouse_mapped || available <= 0 ? 'blocked' : ''}`} key={item.order_item_id}><div><b>{item.item_name_fa}</b><small dir="ltr">{item.warehouse_item_code || 'بدون اتصال انبار'}</small></div><span>{formatNumber(item.ordered_quantity)} / {formatNumber(item.sent_quantity)} {item.unit}</span><span>{formatNumber(available)} {item.unit}<small>رزرو این قلم: {formatNumber(item.reserved_quantity)}</small></span><label><input type="number" min="0" max={Math.max(0, Math.min(max, available))} step="any" disabled={!item.is_warehouse_mapped || available <= 0} value={quantities[item.order_item_id] ?? 0} onChange={(e) => setQuantities({ ...quantities, [item.order_item_id]: e.target.value })} /><small>از مانده {formatNumber(max)}</small></label></div>})}</div>
    <div className="form-grid shipment-logistics-form"><label><span>تاریخ ارسال</span><JalaliDateInput value={form.shipment_date} onChange={(value) => setForm({ ...form, shipment_date: value })} /></label><label><span>تعداد کارتن/بسته</span><input type="number" min="0" step="any" value={form.carton_count} onChange={(e) => setForm({ ...form, carton_count: e.target.value })} /></label><label><span>حامل / باربری</span><input value={form.carrier_name} onChange={(e) => setForm({ ...form, carrier_name: e.target.value })} placeholder="نام باربری یا پیک" /></label><label><span>کد رهگیری</span><input value={form.tracking_code} onChange={(e) => setForm({ ...form, tracking_code: e.target.value })} dir="ltr" /></label><label><span>تحویل‌گیرنده</span><input value={form.receiver_name} onChange={(e) => setForm({ ...form, receiver_name: e.target.value })} /></label><label className="full"><span>یادداشت ارسال</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div>
    <p className="shipment-final-warning">این دکمه «تیک نمایشی» نیست؛ خروج واقعی انبار را ثبت می‌کند. برای اصلاح بعدی باید از عملیات برگشت ارسال در ماژول انبار استفاده شود.</p>
    <div className="modal-actions"><button type="button" disabled={busy} onClick={onClose}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ثبت...' : 'ثبت قطعی و خروج از انبار'}</button></div>
  </form></div></div></div>;
}

function orderShipmentLines(shipment) {
  if (Array.isArray(shipment?.line_items)) return shipment.line_items;
  if (typeof shipment?.line_items === 'string') {
    try { const parsed = JSON.parse(shipment.line_items); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}
function orderShipmentStatus(status) { return ({ sent: 'ارسال‌شده', delivered: 'تحویل‌شده', cancelled: 'برگشت/لغو', ready: 'آماده' }[status] || status || '—'); }

function linkedStageState(status) {
  if (status === 'completed' || status === 'done') return 'done';
  if (status === 'in_progress' || status === 'current') return 'current';
  if (status === 'rejected' || status === 'failed') return 'cancelled';
  return 'pending';
}
function stageNameLinked(stage) { return stage.custom_name_fa || stage.stage_name_fa || stage.stage_name_en || stage.custom_stage_type || 'مرحله'; }

function nextSort(current, key) { return { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }; }
function orderSortValue(row, key) {
  if (key === 'sales_path') return PATH_LABELS[row.sales_path] || row.sales_path || '';
  if (key === 'preferred_contact_channel') return CHANNEL_LABELS[row.preferred_contact_channel] || row.preferred_contact_channel || '';
  if (key === 'financial_status') return FINANCE_LABELS[row.financial_status] || row.financial_status || '';
  if (key === 'stock_status') return STOCK_LABELS[row.stock_status] || row.stock_status || '';
  if (key === 'days_to_delivery') return row.days_to_delivery ?? 999999;
  if (key === 'progress_percent') return Number(row.progress_percent || 0);
  return row?.[key] ?? '';
}
function compareOrderValues(a, b, sort) {
  const dir = sort.dir === 'desc' ? -1 : 1;
  const av = orderSortValue(a, sort.key);
  const bv = orderSortValue(b, sort.key);
  if (sort.key === 'registered_at') {
    return (new Date(av || 0).getTime() - new Date(bv || 0).getTime()) * dir;
  }
  const an = Number(av); const bn = Number(bv);
  if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
  return String(av || '').localeCompare(String(bv || ''), 'fa') * dir;
}

function ListSection({ orders, query, setQuery, pathFilter, setPathFilter, deliveryFilter, setDeliveryFilter, onSelect, onEdit, onCancel, onExcel, onPrint }) {
  const [sort, setSort] = useState({ key: 'registered_at', dir: 'desc' });
  const sortedOrders = useMemo(() => [...orders].sort((a, b) => compareOrderValues(a, b, sort)), [orders, sort]);
  const th = (key, label) => <th><button type="button" className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <section className="orders-card"><div className="section-head"><CardTitle icon={Search} title="لیست سفارش‌ها" /><div><button onClick={onExcel}>Excel</button><button onClick={onPrint}>PDF</button></div></div><div className="filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجو..." /><select value={pathFilter} onChange={(e) => setPathFilter(e.target.value)}><option value="all">همه مسیرها</option><option value="trading">بازرگانی</option><option value="rnd">R&D</option><option value="production">تولید</option></select><select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value)}><option value="all">همه وضعیت تحویل</option><option value="late">عقب‌افتاده</option><option value="due_soon">تحویل نزدیک</option><option value="on_track">طبق برنامه</option><option value="closed">بسته‌شده</option></select></div><div className="orders-table-wrap orders-list-scroll"><table className="has-row-numbers"><thead><tr><th className="row-number-column">ردیف</th>{th('order_code','کد')}{th('registered_at','تاریخ')}{th('customer_name','مشتری')}{th('customer_code','کد مشتری')}{th('contact_phone','تلفن')}{th('customer_city','شهر')}{th('preferred_contact_channel','روش ارتباط')}{th('sales_path','مسیر')}{th('current_stage_name_fa','مرحله')}{th('progress_percent','پیشرفت')}{th('days_to_delivery','روز مانده')}{th('financial_status','مالی')}{th('stock_status','انبار')}<th>عملیات</th></tr></thead><tbody>{sortedOrders.map((o, index) => <tr key={o.id}><td className="row-number-column">{index + 1}</td><td dir="ltr">{o.order_code}</td><td>{formatDate(o.registered_at)}</td><td>{o.customer_name}</td><td dir="ltr">{o.customer_code || '—'}</td><td dir="ltr">{o.contact_phone || '—'}</td><td>{o.customer_city || '—'}</td><td>{CHANNEL_LABELS[o.preferred_contact_channel] || o.preferred_contact_channel || '—'}</td><td>{PATH_LABELS[o.sales_path]}</td><td>{o.current_stage_name_fa}</td><td>{formatNumber(o.progress_percent || 0)}٪</td><td>{daysText(o.days_to_delivery, o.delivery_status)}</td><td>{FINANCE_LABELS[o.financial_status] || o.financial_status}</td><td>{STOCK_LABELS[o.stock_status] || o.stock_status}</td><td><div className="row-actions"><button onClick={() => onSelect(o.id)}>جزئیات</button><button onClick={() => onEdit?.(o)}><Edit3 size={14}/> ویرایش</button><button className="danger" disabled={o.delivery_status === 'cancelled'} onClick={() => onCancel(o)}>لغو کامل</button></div></td></tr>)}</tbody></table></div></section>;
}


function StockSection({ stock, onRefresh }) {
  const [stockQuery, setStockQuery] = useState('');
  const filtered = useMemo(() => stock.filter((s) => {
    const text = `${s.item_code || ''} ${s.item_name_fa || ''} ${s.item_name_en || ''} ${s.category || ''}`.toLowerCase();
    return !stockQuery || text.includes(stockQuery.toLowerCase());
  }), [stock, stockQuery]);
  const latestUpdate = useMemo(() => stock.reduce((latest, item) => {
    const value = item.pricing_updated_at || item.rate_checked_at || item.last_synced_at;
    return value && (!latest || new Date(value) > new Date(latest)) ? value : latest;
  }, null), [stock]);
  return <section className="orders-card order-live-stock"><div className="section-head"><div><CardTitle icon={PackageCheck} title="موجودی و قیمت فروش آنلاین انبار" /><p className="live-stock-note"><i/>همگام زنده با موجودی، رزرو، قیمت فروش و نرخ ارز انبار · آخرین داده: {latestUpdate ? formatDateTime(latestUpdate) : 'در انتظار همگام‌سازی'}</p></div><button type="button" onClick={onRefresh}><RefreshCcw size={15}/> به‌روزرسانی الآن</button></div><div className="filters"><input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder="جست‌وجوی کد، نام کالا، گروه..." /></div>{filtered.length === 0 ? <Empty text="کالایی با این جست‌وجو پیدا نشد." /> : <div className="orders-table-wrap order-live-stock-table"><table><thead><tr><th>کد</th><th>کالا</th><th>موجودی</th><th>رزروشده</th><th>قابل فروش</th><th>قیمت فروش روز</th><th>مبنای قیمت</th><th>حداقل</th><th>وضعیت</th></tr></thead><tbody>{filtered.map((s) => { const salePrice = Number(s.sale_price_rial ?? s.effective_sale_price ?? s.unit_sale_price_estimate ?? 0); const basePrice = Number(s.base_sale_price || 0); const currency = s.price_currency; return <tr key={s.item_id}><td dir="ltr">{s.item_code}</td><td><b>{s.item_name_fa}</b><small>{s.item_group_label || s.item_group || s.category || '—'}</small></td><td>{formatNumber(s.current_qty)} {s.unit}</td><td>{formatNumber(s.reserved_qty)}</td><td className={Number(s.available_for_sale_qty) > 0 ? 'positive' : 'negative'}><b>{formatNumber(s.available_for_sale_qty)}</b></td><td className="online-sale-price">{salePrice > 0 ? <><b>{formatMoney(salePrice)}</b><small>قیمت جاری قابل استفاده در سفارش جدید</small></> : <span>فاقد قیمت فروش</span>}</td><td>{['USD','CNY'].includes(currency) && basePrice > 0 ? <><b dir="ltr">{currency === 'USD' ? '$' : '¥'}{formatPriceNumber(basePrice)}</b><small>{currency === 'USD' ? 'دلار' : 'یوان'} · نرخ روز</small></> : <span>ریالی</span>}</td><td>{formatNumber(s.min_stock_threshold)}</td><td>{s.is_low_stock ? <span className="stock-sale-status low">کمبود</span> : <span className="stock-sale-status ok">قابل فروش</span>}</td></tr>;})}</tbody></table></div>}</section>;
}

function SalesDocumentsSection({ documents = [], onOpen, onRefresh }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const filtered = useMemo(() => documents.filter((document) => {
    const text = `${document.doc_number || ''} ${document.order_code || ''} ${document.party_name || document.customer_name || ''}`.toLowerCase();
    return (type === 'all' || document.document_type === type) && (!query || text.includes(query.toLowerCase()));
  }), [documents, query, type]);
  const invoices = documents.filter((document) => document.document_type === 'sales_invoice').length;
  const proformas = documents.filter((document) => document.document_type === 'sales_proforma').length;

  return <>
    <section className="orders-grid sales-document-kpis">
      <article><span>اسناد مرتبط قابل مشاهده</span><b>{formatNumber(documents.length)}</b><small>فقط اسناد فروش متصل به سفارش‌های مجاز</small></article>
      <article><span>فاکتور فروش</span><b>{formatNumber(invoices)}</b><small>مشاهده و دریافت خروجی</small></article>
      <article><span>پیش‌فاکتور فروش</span><b>{formatNumber(proformas)}</b><small>مشاهده و دریافت خروجی</small></article>
    </section>
    <section className="orders-card sales-documents-card">
      <div className="section-head"><div><CardTitle icon={FileText} title="فاکتورها و پیش‌فاکتورهای مرتبط"/><p className="muted">این فهرست فقط‌خواندنی است و هیچ دسترسی به خزانه، حساب‌ها، ثبت پرداخت، ویرایش، ابطال یا تبدیل سند ایجاد نمی‌کند.</p></div><button type="button" onClick={onRefresh}><RefreshCcw size={15}/> به‌روزرسانی</button></div>
      <div className="filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی شماره سند، سفارش یا مشتری..."/><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">همه اسناد</option><option value="sales_invoice">فاکتور فروش</option><option value="sales_proforma">پیش‌فاکتور فروش</option></select></div>
      {filtered.length === 0 ? <Empty text="سند فروش مرتبطی پیدا نشد."/> : <div className="orders-table-wrap sales-documents-table"><table><thead><tr><th>نوع سند</th><th>شماره سند</th><th>تاریخ</th><th>سفارش مرتبط</th><th>مشتری</th><th>وضعیت</th><th>مبلغ کل</th><th>مانده</th><th>عملیات مجاز</th></tr></thead><tbody>{filtered.map((document) => <tr key={document.id}><td><span className={`sales-doc-kind ${document.document_type}`}>{SALES_DOCUMENT_LABELS[document.document_type] || document.document_type}</span></td><td dir="ltr"><b>{document.doc_number}</b></td><td>{formatDate(document.issue_date)}</td><td dir="ltr">{document.order_code || '—'}</td><td>{document.party_name || document.customer_name || '—'}</td><td><span className="status-pill">{SALES_DOCUMENT_STATUS_LABELS[document.status] || document.status}</span></td><td><b>{formatMoney(document.total_amount)}</b></td><td>{formatMoney(document.balance_amount)}</td><td><button type="button" className="sales-document-open" onClick={() => onOpen(document.id)}><Eye size={15}/> مشاهده و خروجی</button></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function SalesDocumentViewer({ bundle, onClose }) {
  const document = bundle.document;
  return <div className="orders-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="orders-modal sales-document-viewer"><header><div><h3>مشاهده محدود سند فروش</h3><small>{document ? `${SALES_DOCUMENT_LABELS[document.document_type] || document.document_type} · ${document.doc_number}` : 'در حال دریافت سند...'}</small></div><button type="button" aria-label="بستن" onClick={onClose}>×</button></header><div>
    <div className="sales-document-readonly-note"><Eye size={18}/><div><b>حالت فقط‌خواندنی سفارش‌ها</b><span>تنها مشاهده سند و خروجی رسمی/غیررسمی مجاز است؛ اطلاعات پرداخت، حساب بانکی/صندوق، دفتر روزنامه و عملیات مالی در این نما بارگذاری نمی‌شوند.</span></div></div>
    {bundle.loading && <p className="orders-message">در حال دریافت نسخه امن سند...</p>}
    {bundle.error && <p className="orders-message error">دریافت سند ممکن نشد: {bundle.error.message}</p>}
    {!bundle.loading && document && <>
      <div className="sales-document-viewer-actions"><button type="button" onClick={() => printFinanceDocument(bundle, 'company')}><Printer size={16}/> خروجی غیررسمی / شرکتی</button><button type="button" className="primary-soft" onClick={() => printFinanceDocument(bundle, 'official')}><Printer size={16}/> خروجی رسمی</button></div>
      <section className="sales-document-summary"><div><span>نوع سند</span><b>{SALES_DOCUMENT_LABELS[document.document_type] || document.document_type}</b></div><div><span>شماره</span><b dir="ltr">{document.doc_number}</b></div><div><span>تاریخ صدور</span><b>{formatDate(document.issue_date)}</b></div><div><span>وضعیت</span><b>{SALES_DOCUMENT_STATUS_LABELS[document.status] || document.status}</b></div><div><span>سفارش</span><b dir="ltr">{bundle.order?.order_code || '—'}</b></div><div><span>خریدار</span><b>{bundle.party?.display_name || bundle.order?.customer_name || '—'}</b></div></section>
      <div className="orders-table-wrap sales-document-items"><table><thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th><th>واحد</th><th>مبلغ واحد</th><th>تخفیف</th><th>مالیات</th><th>مبلغ نهایی</th></tr></thead><tbody>{bundle.items.length === 0 ? <tr><td colSpan="8">ردیفی ثبت نشده است.</td></tr> : bundle.items.map((item, index) => <tr key={item.id || index}><td>{index + 1}</td><td>{item.description_fa || '—'}</td><td>{formatNumber(item.quantity)}</td><td>{item.unit || '—'}</td><td>{formatMoney(item.unit_price)}</td><td>{formatMoney(item.discount_amount)}</td><td>{formatMoney(item.tax_amount)}</td><td><b>{formatMoney(item.line_total)}</b></td></tr>)}</tbody></table></div>
      <section className="sales-document-totals"><div><span>جمع قبل از تخفیف</span><b>{formatMoney(document.subtotal_amount)}</b></div><div><span>تخفیف</span><b>{formatMoney(document.discount_amount)}</b></div><div><span>مالیات</span><b>{formatMoney(document.tax_amount)}</b></div><div className="grand"><span>قابل پرداخت</span><b>{formatMoney(document.total_amount)}</b></div></section>
      {(document.description || document.print_note) && <section className="sales-document-notes"><b>توضیحات سند</b><p>{document.description || '—'}</p>{document.print_note && <p>{document.print_note}</p>}</section>}
      <footer className="sales-document-locked-capabilities"><LockKeyhole size={16}/><span>ویرایش، ثبت/تأیید، تبدیل، ابطال، پرداخت و عملیات خزانه در این نما غیرفعال و غیرقابل دسترسی‌اند.</span></footer>
    </>}
  </div></div></div>;
}

function TemplateSection({ templates, steps, busy, onUpdateTemplate, onUpdateStep, onCreateStep, onCreateTemplate }) {
  const activeTemplates = templates.filter((t) => t.is_active !== false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(activeTemplates[0]?.id || templates[0]?.id || '');
  const selected = templates.find((t) => t.id === selectedTemplateId) || templates[0];
  const selectedSteps = useMemo(() => steps
    .filter((s) => s.template_id === selected?.id)
    .sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0)), [steps, selected?.id]);
  const [draftRows, setDraftRows] = useState({});
  const [newStep, setNewStep] = useState({ stage_key: '', stage_name_fa: '', stage_order: 1, responsible_role: '' });
  const [newTemplate, setNewTemplate] = useState({ nameFa: '', salesPath: 'all', stageCount: 5 });

  if (!selected) return <section className="orders-card"><CardTitle icon={Settings} title="قالب‌های مراحل سفارش" /><Empty text="قالبی برای مراحل سفارش ثبت نشده است." /></section>;

  function rowValue(step, field) {
    return draftRows[step.id]?.[field] ?? step[field] ?? '';
  }
  function patchDraft(stepId, patch) {
    setDraftRows((rows) => ({ ...rows, [stepId]: { ...(rows[stepId] || {}), ...patch } }));
  }
  function saveStep(step) {
    const draft = draftRows[step.id] || {};
    onUpdateStep(step.id, {
      stage_order: Number(draft.stage_order ?? step.stage_order),
      stage_name_fa: draft.stage_name_fa ?? step.stage_name_fa,
      stage_name_en: draft.stage_name_en ?? step.stage_name_en ?? null,
      responsible_role: draft.responsible_role === '' ? null : (draft.responsible_role ?? step.responsible_role ?? null),
      notify_role_on_enter: draft.notify_role_on_enter === '' ? null : (draft.notify_role_on_enter ?? step.notify_role_on_enter ?? null),
      is_active: draft.is_active ?? step.is_active,
    });
  }
  function addStep(e) {
    e.preventDefault();
    const key = newStep.stage_key.trim();
    const name = newStep.stage_name_fa.trim();
    if (!key || !name) return;
    onCreateStep({
      template_id: selected.id,
      stage_key: key,
      stage_order: Number(newStep.stage_order || selectedSteps.length + 1),
      stage_name_fa: name,
      stage_name_en: key,
      responsible_role: newStep.responsible_role || null,
      notify_role_on_enter: newStep.responsible_role || null,
      is_required: false,
      is_terminal: false,
      is_active: true,
    });
    setNewStep({ stage_key: '', stage_name_fa: '', stage_order: selectedSteps.length + 2, responsible_role: '' });
  }

  function addTemplate(e) {
    e.preventDefault();
    if (!newTemplate.nameFa.trim()) return;
    onCreateTemplate({
      nameFa: newTemplate.nameFa,
      salesPath: newTemplate.salesPath,
      stageCount: Number(newTemplate.stageCount || 5),
    });
    setNewTemplate({ nameFa: '', salesPath: 'all', stageCount: 5 });
  }

  return <section className="orders-card configurable-stages">
    <CardTitle icon={Settings} title="قالب‌ها و مراحل قابل تنظیم سفارش" />
    <p className="muted">هر قالبی که اینجا فعال باشد، در فرم «ثبت سفارش» در قسمت «قالب مراحل» قابل انتخاب است. ترتیب، نام مرحله، مسئول و فعال/غیرفعال بودن مراحل از همین بخش تغییر می‌کند.</p>
    <form className="new-template-form" onSubmit={addTemplate}>
      <input value={newTemplate.nameFa} onChange={(e) => setNewTemplate({ ...newTemplate, nameFa: e.target.value })} placeholder="نام قالب جدید فروشنده، مثلاً سفارش ویژه ۸ مرحله‌ای" />
      <select value={newTemplate.salesPath} onChange={(e) => setNewTemplate({ ...newTemplate, salesPath: e.target.value })}><option value="all">همه مسیرها</option><option value="trading">بازرگانی</option><option value="rnd">R&D</option><option value="production">تولید مستقیم</option></select>
      <select value={newTemplate.stageCount} onChange={(e) => setNewTemplate({ ...newTemplate, stageCount: Number(e.target.value) })}>{Array.from({ length: 9 }).map((_, i) => <option key={i + 4} value={i + 4}>{i + 4} مرحله</option>)}</select>
      <button disabled={busy} type="submit">＋ ساخت قالب</button>
    </form>
    <div className="template-settings-grid">
      <aside className="template-list-panel">
        <h3>قالب مراحل</h3>
        {templates.map((t) => <button key={t.id} className={selected.id === t.id ? 'active' : ''} onClick={() => setSelectedTemplateId(t.id)}>
          <b>{t.name_fa}</b><span>{t.sales_path ? PATH_LABELS[t.sales_path] : 'عمومی'} · {t.is_active ? 'فعال' : 'غیرفعال'}</span>
        </button>)}
      </aside>
      <div className="template-editor-panel">
        <div className="template-editor-head">
          <div><h3>{selected.name_fa}</h3><p>{selected.sales_path ? PATH_LABELS[selected.sales_path] : 'عمومی'} · {selected.is_default ? 'پیش‌فرض' : 'قالب سفارشی'}</p></div>
          <button disabled={busy} onClick={() => onUpdateTemplate(selected.id, { is_active: !selected.is_active })}>{selected.is_active ? 'غیرفعال کردن قالب' : 'فعال کردن قالب'}</button>
        </div>
        <div className="stage-preview-line">
          {selectedSteps.filter((s) => s.is_active !== false).map((s, i) => <span key={s.id}><i>{i + 1}</i>{s.stage_name_fa}</span>)}
        </div>
        <div className="orders-table-wrap stage-config-table"><table><thead><tr><th>ترتیب</th><th>کلید</th><th>نام مرحله</th><th>مسئول</th><th>فعال</th><th>ذخیره</th></tr></thead><tbody>{selectedSteps.map((step) => <tr key={step.id}><td><input type="number" value={rowValue(step, 'stage_order')} onChange={(e) => patchDraft(step.id, { stage_order: e.target.value })} /></td><td dir="ltr">{step.stage_key}</td><td><input value={rowValue(step, 'stage_name_fa')} onChange={(e) => patchDraft(step.id, { stage_name_fa: e.target.value })} /></td><td><select value={rowValue(step, 'responsible_role')} onChange={(e) => patchDraft(step.id, { responsible_role: e.target.value })}><option value="">بدون مسئول</option><option value="sales">فروش</option><option value="accountant">مالی</option><option value="warehouse">انبار</option><option value="production">تولید</option><option value="rnd">R&D</option><option value="admin">مدیر</option></select></td><td><input type="checkbox" checked={rowValue(step, 'is_active') !== false} onChange={(e) => patchDraft(step.id, { is_active: e.target.checked })} /></td><td><button disabled={busy} onClick={() => saveStep(step)}>ذخیره</button></td></tr>)}</tbody></table></div>
        <form className="add-stage-form" onSubmit={addStep}>
          <input dir="ltr" value={newStep.stage_key} onChange={(e) => setNewStep({ ...newStep, stage_key: e.target.value.replace(/\s+/g, '_') })} placeholder="stage_key" />
          <input value={newStep.stage_name_fa} onChange={(e) => setNewStep({ ...newStep, stage_name_fa: e.target.value })} placeholder="نام مرحله جدید" />
          <input type="number" value={newStep.stage_order} onChange={(e) => setNewStep({ ...newStep, stage_order: e.target.value })} placeholder="ترتیب" />
          <select value={newStep.responsible_role} onChange={(e) => setNewStep({ ...newStep, responsible_role: e.target.value })}><option value="">بدون مسئول</option><option value="sales">فروش</option><option value="accountant">مالی</option><option value="warehouse">انبار</option><option value="production">تولید</option><option value="rnd">R&D</option><option value="admin">مدیر</option></select>
          <button disabled={busy} type="submit">＋ افزودن مرحله</button>
        </form>
      </div>
    </div>
  </section>;
}

function OrderModal({ templates, templateSteps = [], customers, stock, busy, initialCustomerId, initialOrder = null, initialItems = [], onClose, onSubmit }) {
  const isEdit = !!initialOrder;
  const initialCustomer = customers.find((c) => c.id === (initialOrder?.customer_id || initialCustomerId)) || customers[0];
  const [customerMode, setCustomerMode] = useState(initialCustomer ? 'existing' : 'new');
  const [form, setForm] = useState({
    customer_id: initialOrder?.customer_id || initialCustomer?.id || '',
    company_name: '',
    contact_phone: initialOrder?.customer_phone_snapshot || initialCustomer?.contact_phone || '',
    city: initialOrder?.customer_city_snapshot || initialCustomer?.city || '',
    preferred_contact_channel: initialOrder?.contact_channel || initialCustomer?.preferred_contact_channel || 'phone',
    sales_path: initialOrder?.sales_path || 'trading',
    workflow_template_id: initialOrder?.workflow_template_id || '',
    registered_at: initialOrder?.registered_at || new Date().toISOString().slice(0, 10),
    expected_delivery_date: initialOrder?.expected_delivery_date || '',
    title_fa: initialOrder?.title_fa || '',
    description_fa: initialOrder?.description_fa || '',
    priority: initialOrder?.priority || 2,
  });
  const [options, setOptions] = useState({ createProforma: true, refFinance: true, refWarehouse: false, refPath: true });
  const [editReason, setEditReason] = useState('');
  const [requestKey] = useState(() => globalThis.crypto?.randomUUID?.() || `order-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const availableTemplates = templates.filter((t) => t.is_active !== false);
  const selectedTemplate = (isEdit ? templates : availableTemplates).find((t) => t.id === form.workflow_template_id) || availableTemplates[0];
  const customerOptions = useMemo(() => customers.map((c) => ({
    value: c.id,
    label: c.company_name || 'بدون نام',
    description: `${c.contact_phone || ''}${c.city ? ` · ${c.city}` : ''}${c.contact_person_name ? ` · ${c.contact_person_name}` : ''}${c.finance_party_id ? ' · متصل به حسابداری' : ''}`.trim(),
    searchText: `${c.company_name || ''} ${c.contact_person_name || ''} ${c.contact_phone || ''} ${c.city || ''} ${c.acquisition_source || ''} ${c.economic_code || ''} ${c.registration_number || ''} ${c.national_id || ''} ${c.postal_code || ''}`,
  })), [customers]);
  const [items, setItems] = useState(initialItems.length ? initialItems.map((item) => ({ ...item })) : [{ item_name_fa: 'قلم سفارش', warehouse_item_code: '', quantity: 1, unit: 'عدد', unit_price: 0, discount_percent: 0, discount_amount: 0 }]);
  const liveStockByCode = useMemo(() => new Map(stock.filter((item) => item.item_code).map((item) => [item.item_code, item])), [stock]);

  useEffect(() => {
    if (isEdit) return;
    setItems((rows) => rows.map((row) => {
      const liveItem = liveStockByCode.get(row.warehouse_item_code);
      if (!liveItem) return row;
      const nextPrice = catalogSalePrice(liveItem);
      if (Number(row.unit_price || 0) === nextPrice) return row;
      const discountPercent = Number(row.discount_percent || 0);
      const discountAmount = discountPercent > 0
        ? Math.round(Number(row.quantity || 0) * nextPrice * discountPercent / 100)
        : Number(row.discount_amount || 0);
      return { ...row, unit_price: nextPrice, discount_amount: discountAmount };
    }));
  }, [isEdit, liveStockByCode]);

  function chooseCustomer(id) {
    const customer = customers.find((c) => c.id === id);
    setForm({ ...form, customer_id: id, contact_phone: customer?.contact_phone || '', city: customer?.city || '', preferred_contact_channel: customer?.preferred_contact_channel || form.preferred_contact_channel });
  }

  function submit(e) {
    e.preventDefault();
    if (isEdit) {
      onSubmit({
        order: {
          customer_id: form.customer_id,
          sales_path: form.sales_path,
          registered_at: form.registered_at,
          expected_delivery_date: form.expected_delivery_date || null,
          title_fa: form.title_fa,
          description_fa: form.description_fa || null,
          priority: form.priority,
          customer_phone_snapshot: form.contact_phone || null,
          customer_city_snapshot: form.city || null,
          contact_channel: form.preferred_contact_channel || null,
        },
        items,
        reason: editReason,
      });
      return;
    }
    const customer = customerMode === 'new'
      ? {
          company_name: form.company_name,
          contact_phone: form.contact_phone,
          city: form.city,
          preferred_contact_channel: form.preferred_contact_channel,
          crm_status: 'active_customer',
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
      requestKey,
    });
  }

  return <Modal title={isEdit ? `ویرایش مرحله‌ای ${initialOrder.order_code}` : 'ثبت سفارش جدید'} onClose={onClose} className="order-create-modal">
    <form onSubmit={submit} className="order-create-form">
      <div className="form-grid order-create-grid">
        {!isEdit && <label><span>نوع مشتری</span><select value={customerMode} onChange={(e) => setCustomerMode(e.target.value)}><option value="existing" disabled={customers.length === 0}>مشتری موجود</option><option value="new">مشتری/سرنخ جدید</option></select></label>}
        {customerMode === 'existing'
          ? <label><span>مشتری</span><SearchableSelect options={customerOptions} value={form.customer_id} onChange={(value) => chooseCustomer(value)} placeholder="نام، تلفن یا شهر مشتری را بنویس..." emptyText="مشتری پیدا نشد." /></label>
          : <label><span>نام مشتری</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label>}
        <label><span>تلفن</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label>
        <label><span>شهر</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label><span>روش ارتباط</span><select value={form.preferred_contact_channel} onChange={(e) => setForm({ ...form, preferred_contact_channel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>مسیر</span><select value={form.sales_path} disabled={isEdit} title={isEdit?'مسیر سفارش پس از ثبت برای حفظ وابستگی مراحل ثابت است.':''} onChange={(e) => setForm({ ...form, sales_path: e.target.value })}>{Object.entries(PATH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>قالب مراحل</span><select value={form.workflow_template_id} disabled={isEdit} title={isEdit?'قالب مراحل ثبت‌شده برای حفظ تاریخچه تغییر نمی‌کند.':''} onChange={(e) => setForm({ ...form, workflow_template_id: e.target.value })}><option value="">پیش‌فرض سیستم</option>{availableTemplates.map((t) => { const count = templateSteps.filter((s) => s.template_id === t.id && s.is_active !== false).length; return <option key={t.id} value={t.id}>{t.name_fa} · {t.sales_path ? PATH_LABELS[t.sales_path] : 'همه مسیرها'} · {formatNumber(count)} مرحله</option>; })}</select></label>
        <label><span>تاریخ ثبت شمسی</span><JalaliDateInput value={form.registered_at} onChange={(value) => setForm({ ...form, registered_at: value })} /></label>
        <label><span>موعد تحویل شمسی</span><JalaliDateInput value={form.expected_delivery_date} onChange={(value) => setForm({ ...form, expected_delivery_date: value })} /></label>
        <label><span>اولویت</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}><option value={1}>فوری</option><option value={2}>عادی</option><option value={3}>کم‌اهمیت</option></select></label>
        <label className="half order-title-field"><span>عنوان</span><input value={form.title_fa} onChange={(e) => setForm({ ...form, title_fa: e.target.value })} required /></label>
        <label className="full"><span>شرح</span><textarea value={form.description_fa} onChange={(e) => setForm({ ...form, description_fa: e.target.value })} /></label>
      </div>

      {isEdit && <div className="stage-safe-edit-note"><ShieldCheck size={20}/><div><b>ویرایش Stage-safe</b><span>مقدار هیچ قلمی نمی‌تواند از مقدار ارسال/تولیدشده کمتر شود. اسناد فیزیکی نهایی بازنویسی نمی‌شوند و نسخه قبلی با دلیل شما در تاریخچه می‌ماند.</span></div></div>}
      {selectedTemplate && <div className="order-template-preview"><b>مراحل قالب انتخاب‌شده:</b>{templateSteps.filter((s) => s.template_id === selectedTemplate.id && s.is_active !== false).sort((a, b) => Number(a.stage_order || 0) - Number(b.stage_order || 0)).map((s, i) => <span key={s.id}>{i + 1}. {s.stage_name_fa}</span>)}</div>}

      {!isEdit && <div className="order-options">
        <label><input type="checkbox" checked={options.createProforma} onChange={(e) => setOptions({ ...options, createProforma: e.target.checked })} /> ساخت پیش‌فاکتور بعد از ثبت</label>
        <label><input type="checkbox" checked={options.refFinance} onChange={(e) => setOptions({ ...options, refFinance: e.target.checked })} /> ارجاع به مالی</label>
        <label><input type="checkbox" checked={options.refWarehouse} onChange={(e) => setOptions({ ...options, refWarehouse: e.target.checked })} /> ارجاع به انبار</label>
        <label><input type="checkbox" checked={options.refPath} onChange={(e) => setOptions({ ...options, refPath: e.target.checked })} /> ارجاع به تولید/R&D بر اساس مسیر</label>
      </div>}

      {!isEdit && <div className="order-live-price-note"><RefreshCcw size={16}/><span>قیمت اقلام متصل به انبار از کاتالوگ فروش امن خوانده می‌شود و با تغییر نرخ ارز یا قیمت کالا، تا پیش از ثبت سفارش به‌صورت زنده به‌روزرسانی خواهد شد.</span></div>}
      {isEdit && <div className="order-snapshot-price-note"><LockKeyhole size={16}/><span>قیمت سفارش ثبت‌شده Snapshot است و هنگام ویرایش Stage-safe با نرخ روز جایگزین نمی‌شود.</span></div>}
      <ItemEditor items={items} setItems={setItems} stock={stock} />
      {isEdit && <label className="order-edit-reason"><span>دلیل ویرایش (الزامی)</span><textarea value={editReason} onChange={(e)=>setEditReason(e.target.value)} placeholder="مثلاً اصلاح تعداد طبق درخواست مشتری، تغییر موعد تحویل یا افزودن قلم..." required/></label>}
      <div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy || items.length===0 || (isEdit && !editReason.trim())}>{busy ? 'در حال ثبت...' : isEdit ? 'ثبت نسخه جدید و همگام‌سازی' : 'ثبت سفارش'}</button></div>
    </form>
  </Modal>;
}

function ItemEditor({ items, setItems, stock }) {
  function update(i, patch) { setItems((rows) => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)); }
  function selectStock(i, selected) {
    update(i, {
      warehouse_item_code: selected?.item_code || '',
      item_name_fa: selected?.item_name_fa || items[i]?.item_name_fa || '',
      item_name_en: selected?.item_name_en || items[i]?.item_name_en || null,
      unit: selected?.unit || items[i]?.unit || 'عدد',
      unit_price: selected ? catalogSalePrice(selected) : (items[i]?.unit_price ?? 0),
    });
  }
  return <div className="item-editor searchable-items"><table><thead><tr><th>کد/نام کالا</th><th>شرح کالا</th><th>تعداد</th><th>واحد</th><th>فی ریال / تومان</th><th>تخفیف٪</th><th>تخفیف ریال</th><th></th></tr></thead><tbody>{items.map((item, i) => <tr key={i}><td><ProductPicker items={stock} value={item.warehouse_item_code || ''} onSelect={(selected) => selectStock(i, selected)} placeholder="کد یا نام کالا را بنویس..." /></td><td><input value={item.item_name_fa} onChange={(e) => update(i, { item_name_fa: e.target.value })} placeholder="شرح کالا / خدمت" /></td><td><input type="number" value={item.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td><td><input value={item.unit} onChange={(e) => update(i, { unit: e.target.value })} /></td><td><MoneyInput value={item.unit_price} onChange={(value) => update(i, { unit_price: value })} /></td><td><input type="number" min="0" max="100" value={item.discount_percent || 0} onChange={(e) => { const percent = Number(e.target.value || 0); const base = Number(item.quantity || 0) * Number(item.unit_price || 0); update(i, { discount_percent: percent, discount_amount: Math.round(base * percent / 100) }); }} /></td><td><input type="number" min="0" value={item.discount_amount || 0} onChange={(e) => { const amount = Number(e.target.value || 0); const base = Number(item.quantity || 0) * Number(item.unit_price || 0); update(i, { discount_amount: amount, discount_percent: base ? Math.min(100, amount * 100 / base) : 0 }); }} /></td><td><button type="button" onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>×</button></td></tr>)}</tbody></table><button type="button" onClick={() => setItems((rows) => [...rows, { item_name_fa: 'ردیف جدید', warehouse_item_code: '', quantity: 1, unit: 'عدد', unit_price: 0, discount_percent: 0, discount_amount: 0 }])}>＋ افزودن قلم</button></div>;
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
  return <Modal title="ثبت پیگیری CRM واقعی" onClose={onClose}><form onSubmit={submit}>{customers.length === 0 && <div className="orders-message error">برای ثبت پیگیری ابتدا باید مشتری/سرنخ ثبت شود.</div>}<div className="form-grid"><label><span>مشتری</span><select value={form.customerId} onChange={(e) => { const c = customers.find((x) => x.id === e.target.value); setForm({ ...form, customerId: e.target.value, orderId: '', contactChannel: c?.preferred_contact_channel || form.contactChannel }); }} required>{customers.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><label><span>سفارش مرتبط</span><select value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}><option value="">بدون سفارش</option>{customerOrders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name}</option>)}</select></label><label><span>نوع فعالیت</span><select value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}>{Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>روش ارتباط</span><select value={form.contactChannel} onChange={(e) => setForm({ ...form, contactChannel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span>تاریخ پیگیری شمسی</span><JalaliDateInput value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} required /></label><label><span>ساعت</span><input type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} required /></label><label className="full"><span>عنوان پیگیری</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={selectedCustomer ? `تماس با ${selectedCustomer.company_name}` : 'مثلاً تماس برای پیگیری پیش‌فاکتور'} required /></label><label className="full"><span>شرح / نتیجه مورد انتظار</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="شرح تماس، موضوع پیگیری، قول مشتری یا اقدام بعدی..." /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy || customers.length === 0}>{busy ? 'در حال ثبت...' : 'ثبت پیگیری'}</button></div></form></Modal>;
}

function CustomerModal({ initialCustomer, canManageCredit = false, busy, onClose, onSubmit }) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    id: initialCustomer?.id || null,
    company_name: initialCustomer?.company_name || '',
    contact_person_name: initialCustomer?.contact_person_name || '',
    contact_phone: initialCustomer?.contact_phone || '',
    contact_email: initialCustomer?.contact_email || '',
    city: initialCustomer?.city || '',
    address: initialCustomer?.address || '',
    preferred_contact_channel: initialCustomer?.preferred_contact_channel || 'phone',
    acquisition_source: initialCustomer?.acquisition_source || '',
    crm_status: initialCustomer?.crm_status || 'lead',
    lead_score: initialCustomer?.lead_score ?? 50,
    next_follow_up_at: initialCustomer?.next_follow_up_at ? String(initialCustomer.next_follow_up_at).slice(0, 10) : tomorrow,
    finance_party_id: initialCustomer?.finance_party_id || null,
    economic_code: initialCustomer?.economic_code || '',
    registration_number: initialCustomer?.registration_number || '',
    national_id: initialCustomer?.national_id || '',
    postal_code: initialCustomer?.postal_code || '',
    finance_notes: initialCustomer?.finance_notes || '',
    credit_limit: initialCustomer?.credit_limit || 0,
    credit_hold: initialCustomer?.credit_hold || false,
    credit_control_note: initialCustomer?.credit_control_note || '',
  });
  const isLead = form.crm_status === 'lead';
  function submit(e) {
    e.preventDefault();
    const payload = { ...form, next_follow_up_at: form.next_follow_up_at ? `${form.next_follow_up_at}T09:00:00` : null };
    if (!canManageCredit) { delete payload.credit_limit; delete payload.credit_hold; delete payload.credit_control_note; }
    if (initialCustomer && initialCustomer.address === undefined && !payload.address) delete payload.address;
    onSubmit(payload);
  }
  return <Modal title={initialCustomer ? 'ویرایش اطلاعات مشتری' : 'ثبت مشتری / سرنخ CRM'} onClose={onClose}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label><span>نام شرکت/مشتری</span><input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required /></label>
        <label><span>نام شخص تماس</span><input value={form.contact_person_name} onChange={(e) => setForm({ ...form, contact_person_name: e.target.value })} /></label>
        <label><span>تلفن</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></label>
        <label><span>ایمیل</span><input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></label>
        <label><span>شهر</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label><span>روش ارتباط</span><select value={form.preferred_contact_channel} onChange={(e) => setForm({ ...form, preferred_contact_channel: e.target.value })}>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>روش جذب</span><input value={form.acquisition_source} onChange={(e) => setForm({ ...form, acquisition_source: e.target.value })} placeholder="سایت، معرفی، نمایشگاه..." /></label>
        <label><span>وضعیت CRM</span><select value={form.crm_status} onChange={(e) => setForm({ ...form, crm_status: e.target.value })}>{Object.entries(CRM_STATUS_LABELS).filter(([k]) => k !== 'inactive').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>امتیاز سرنخ</span><input type="number" min="0" max="100" value={form.lead_score} onChange={(e) => setForm({ ...form, lead_score: e.target.value })} /></label>
        <label><span>پیگیری بعدی شمسی</span><JalaliDateInput value={form.next_follow_up_at} onChange={(value) => setForm({ ...form, next_follow_up_at: value })} /></label>
        <label className="full"><span>آدرس</span><textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
      </div>
      <div className="orders-accounting-sync-box">
        <b>اطلاعات مشترک با حسابداری</b>
        <small>{isLead ? 'این رکورد فعلاً سرنخ است و جدا از حسابداری می‌ماند. وقتی وضعیت را مشتری فعال/VIP/در خطر بگذاری یا برایش سفارش ثبت شود، با اشخاص حسابداری همگام می‌شود.' : 'این اطلاعات از هر دو بخش سفارش‌ها و حسابداری قابل خواندن/ویرایش است.'}</small>
        <div className="form-grid">
          <label><span>کد اقتصادی</span><input dir="ltr" value={form.economic_code} onChange={(e) => setForm({ ...form, economic_code: e.target.value })} disabled={isLead} /></label>
          <label><span>شماره ثبت</span><input dir="ltr" value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} disabled={isLead} /></label>
          <label><span>شناسه ملی</span><input dir="ltr" value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} disabled={isLead} /></label>
          <label><span>کد پستی</span><input dir="ltr" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} disabled={isLead} /></label>
          <label className="full"><span>یادداشت حسابداری</span><textarea value={form.finance_notes} onChange={(e) => setForm({ ...form, finance_notes: e.target.value })} disabled={isLead} /></label>
        </div>
      </div>
      {canManageCredit && <div className="orders-credit-control-box"><b>کنترل اعتبار فروش</b><small>این تنظیم فقط هشدار حرفه‌ای ایجاد می‌کند و بدون تصمیم مدیر، اسناد قبلی را تغییر نمی‌دهد.</small><div className="form-grid"><label><span>سقف اعتبار ریال</span><MoneyInput value={form.credit_limit} onChange={(value)=>setForm({...form,credit_limit:value})}/></label><label className="credit-hold-toggle"><span>توقف اعتباری</span><input type="checkbox" checked={form.credit_hold} onChange={(e)=>setForm({...form,credit_hold:e.target.checked})}/></label><label className="full"><span>یادداشت کنترل اعتبار</span><textarea value={form.credit_control_note} onChange={(e)=>setForm({...form,credit_control_note:e.target.value})} placeholder="شرط پرداخت، تأیید مدیر یا توضیح محدودیت..."/></label></div></div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ذخیره...' : initialCustomer ? 'ذخیره ویرایش' : 'ثبت مشتری'}</button></div>
    </form>
  </Modal>;
}

function Modal({ title, onClose, children, className = '' }) { return <div className="orders-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`orders-modal ${className}`.trim()}><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>; }
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
function formatPriceNumber(value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(value || 0)); }
function safe(value) { return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
