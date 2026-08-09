import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardList,
  FileText,
  Link2,
  ListChecks,
  Printer,
  RefreshCcw,
  RotateCcw,
  Settings,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAccountingData, useFinanceDocumentBundle, usePartyStatement } from '../../hooks/useAccountingData';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import { formatJalaliDate, formatToman } from '../../lib/formatters';
import {
  closeFiscalPeriod,
  closeFiscalYear,
  convertProformaToInvoice,
  createAutomationReferral,
  createSalesInvoiceFromOrder,
  createFinanceCheck,
  createFinanceDocument,
  createFinancePayment,
  createIoDocument,
  createSalesReturnFromInvoice,
  downloadCsv,
  downloadExcelHtml,
  openPrintableDocument,
  postFinanceDocument,
  reopenFiscalPeriod,
  reopenFiscalYear,
  updateFinanceCheckStatus,
  updateFinanceDocument,
  updateNumberingRule,
  voidFinanceDocument,
} from '../../lib/financeApi';
import {
  FinanceCheckForm,
  FinanceDocumentForm,
  FinanceModal,
  FinancePaymentForm,
  FinanceReferralForm,
  OrderInvoiceForm,
} from './AccountingForms';
import FinanceDocumentDetails from './FinanceDocumentDetails';
import './AccountingModule.css';

const COPY = {
  fa: {
    title: 'مالی و حسابداری',
    subtitle: 'فاکتور، دریافت/پرداخت، چک، صورت‌حساب اشخاص، سود سفارش، دوره مالی و تنظیمات شماره‌گذاری',
    refresh: 'به‌روزرسانی',
    tabs: {
      overview: 'نمای کلی',
      documents: 'فاکتورها',
      parties: 'اشخاص و صورت‌حساب',
      profitability: 'سود سفارش‌ها',
      treasury: 'چک‌ها / خزانه',
      fiscal: 'دوره مالی',
      referrals: 'ارجاعات',
      settings: 'تنظیمات',
    },
    loading: 'در حال دریافت اطلاعات...',
    error: 'دریافت اطلاعات مالی با خطا روبه‌رو شد. احتمالاً migrationهای مالی هنوز روی Supabase اجرا نشده‌اند.',
    noData: 'هنوز داده‌ای ثبت نشده است.',
    receivable: 'دریافتنی‌ها',
    payable: 'پرداختنی‌ها',
    overdue: 'سررسید گذشته',
    monthSales: 'فروش ماه',
    monthCosts: 'هزینه/خرید ماه',
    monthProfit: 'سود ماه',
    openReferrals: 'ارجاع باز مالی',
    selectParty: 'برای مشاهده گردش، یک شخص را انتخاب کنید.',
    official: 'حساب رسمی',
    unofficial: 'حساب غیررسمی',
    all: 'همه',
    debtors: 'بدهکارها',
    creditors: 'بستانکارها',
    settled: 'تسویه‌شده‌ها',
    debitOnly: 'فقط بدهکار',
    creditOnly: 'فقط بستانکار',
    printPdf: 'چاپ / PDF',
    exportCsv: 'خروجی Excel',
  },
  en: {
    title: 'Accounting & Finance',
    subtitle: 'Invoices, payments, checks, statements, order profit, fiscal periods, and numbering settings',
    refresh: 'Refresh',
    tabs: { overview: 'Overview', documents: 'Documents', parties: 'Parties', profitability: 'Profit', treasury: 'Treasury', fiscal: 'Fiscal', referrals: 'Referrals', settings: 'Settings' },
    loading: 'Loading finance data...',
    error: 'Finance data failed to load. Finance migrations may not be applied yet.',
    noData: 'No data yet.',
    receivable: 'Receivables', payable: 'Payables', overdue: 'Overdue', monthSales: 'Month sales', monthCosts: 'Month costs', monthProfit: 'Month profit', openReferrals: 'Open referrals',
    selectParty: 'Select a party to view statement.', official: 'Official account', unofficial: 'Unofficial account', all: 'All', debtors: 'Debtors', creditors: 'Creditors', settled: 'Settled', debitOnly: 'Debit only', creditOnly: 'Credit only', printPdf: 'Print / PDF', exportCsv: 'Export Excel',
  },
};

const DOC_LABELS = {
  sales_proforma: { fa: 'پیش‌فاکتور فروش', en: 'Sales proforma' },
  sales_invoice: { fa: 'فاکتور فروش', en: 'Sales invoice' },
  purchase_invoice: { fa: 'فاکتور خرید', en: 'Purchase invoice' },
  sales_return: { fa: 'فاکتور برگشتی فروش', en: 'Sales return' },
  purchase_return: { fa: 'برگشت از خرید', en: 'Purchase return' },
  expense_invoice: { fa: 'هزینه', en: 'Expense invoice' },
  credit_note: { fa: 'یادداشت بستانکار', en: 'Credit note' },
  debit_note: { fa: 'یادداشت بدهکار', en: 'Debit note' },
  opening_balance: { fa: 'مانده افتتاحیه', en: 'Opening balance' },
};

const STATUS_LABELS = {
  draft: { fa: 'پیش‌نویس', en: 'Draft' },
  pending_approval: { fa: 'در انتظار تأیید', en: 'Pending' },
  approved: { fa: 'تأیید شده', en: 'Approved' },
  sent: { fa: 'ارسال شده', en: 'Sent' },
  partially_paid: { fa: 'بخشی تسویه', en: 'Partially paid' },
  paid: { fa: 'تسویه شده', en: 'Paid' },
  cancelled: { fa: 'لغو شده', en: 'Cancelled' },
  void: { fa: 'باطل شده', en: 'Void' },
  open: { fa: 'باز', en: 'Open' },
  in_progress: { fa: 'در حال انجام', en: 'In progress' },
  answered: { fa: 'پاسخ داده شده', en: 'Answered' },
  done: { fa: 'انجام شده', en: 'Done' },
  in_hand: { fa: 'در دست', en: 'In hand' },
  deposited: { fa: 'خوابانده‌شده', en: 'Deposited' },
  cleared: { fa: 'پاس‌شده', en: 'Cleared' },
  returned: { fa: 'برگشتی', en: 'Returned' },
  issued: { fa: 'صادر شده', en: 'Issued' },
};

export default function AccountingModule({ lang = 'fa' }) {
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const [tab, setTab] = useState('overview');
  const [partyFilter, setPartyFilter] = useState('all');
  const [statementFlowFilter, setStatementFlowFilter] = useState('all');
  const [selectedPartyId, setSelectedPartyId] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const data = useAccountingData();
  const selectedParty = useMemo(() => data.parties.find((p) => p.party_id === selectedPartyId), [data.parties, selectedPartyId]);
  const statement = usePartyStatement(selectedPartyId, statementFlowFilter);
  const documentBundle = useFinanceDocumentBundle(selectedDocumentId);
  const selectedDocument = useMemo(() => data.documents.find((d) => d.id === selectedDocumentId), [data.documents, selectedDocumentId]);

  const filteredParties = useMemo(() => data.parties.filter((p) => {
    const b = Number(p.balance || 0);
    if (partyFilter === 'debtors') return b > 0;
    if (partyFilter === 'creditors') return b < 0;
    if (partyFilter === 'settled') return b === 0;
    return true;
  }), [data.parties, partyFilter]);

  const accounts = useMemo(() => ({
    official: data.bankAccounts.filter((a) => a.account_usage === 'official'),
    unofficial: data.bankAccounts.filter((a) => a.account_usage === 'unofficial'),
  }), [data.bankAccounts]);

  async function runAction(fn, successMessage) {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      setNotice(successMessage);
      setModal(null);
      await data.refetch();
      documentBundle.refetch?.();
    } catch (e) {
      setNotice(e.message || 'خطا در اجرای عملیات');
    } finally {
      setBusy(false);
    }
  }

  const submitDocument = (payload) => runAction(
    () => payload.documentId
      ? updateFinanceDocument(payload.documentId, payload)
      : createFinanceDocument(payload),
    payload.documentId ? 'سند مالی ویرایش شد.' : 'سند مالی با شماره خودکار ثبت شد.'
  );
  const submitOrderInvoice = (orderId) => runAction(() => createSalesInvoiceFromOrder(orderId), 'فاکتور فروش از سفارش ساخته شد.');
  const submitPayment = (payload) => runAction(() => createFinancePayment(payload), 'دریافت/پرداخت ثبت و سند حسابداری آن ایجاد شد.');
  const submitCheck = (payload) => runAction(() => createFinanceCheck(payload), 'چک با کد داخلی ثبت شد.');
  const submitReferral = (payload) => runAction(() => createAutomationReferral(payload), 'ارجاع با شماره خودکار ثبت شد.');

  const kpis = [
    { label: t.receivable, value: data.dashboard.receivable_total, icon: ArrowDownLeft, accent: 'green' },
    { label: t.payable, value: data.dashboard.payable_total, icon: ArrowUpRight, accent: 'red' },
    { label: t.overdue, value: data.dashboard.overdue_total, icon: Banknote, accent: 'amber' },
    { label: t.monthSales, value: data.dashboard.month_sales, icon: BarChart3, accent: 'blue' },
    { label: t.monthCosts, value: data.dashboard.month_costs, icon: WalletCards, accent: 'slate' },
    { label: t.monthProfit, value: data.dashboard.month_profit, icon: BookOpen, accent: Number(data.dashboard.month_profit) >= 0 ? 'green' : 'red' },
  ];

  return (
    <div className="accounting-page" dir={dir} lang={lang}>
      <header className="accounting-hero">
        <div>
          <div className="eyebrow">Automation Finance</div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={data.refetch}><RefreshCcw size={16} /> {t.refresh}</button>
          <button type="button" onClick={() => setModal('document')}><FileText size={16} /> فاکتور جدید</button>
          <button type="button" onClick={() => setModal('orderInvoice')}><FileText size={16} /> فاکتور از سفارش</button>
          <button type="button" onClick={() => setModal('payment')}><Banknote size={16} /> دریافت/پرداخت</button>
          <button type="button" onClick={() => setModal('check')}><WalletCards size={16} /> ثبت چک</button>
          <button type="button" onClick={() => setModal('referral')}><Link2 size={16} /> ارجاع</button>
          <button type="button" className="primary" onClick={() => setTab('settings')}><Settings size={16} /> {t.tabs.settings}</button>
        </div>
      </header>

      {modal && (() => {
        const modalType = typeof modal === 'string' ? modal : modal.type;
        const modalDocumentId = typeof modal === 'object' ? modal.documentId : null;
        return (
          <FinanceModal title={modalTitle(modalType)} onClose={() => setModal(null)}>
            {modalType === 'document' && <FinanceDocumentForm parties={data.parties} orders={data.orders} stock={data.stock} initialDocument={modalDocumentId ? documentBundle.document : null} initialItems={modalDocumentId ? documentBundle.items : []} busy={busy} onCancel={() => setModal(null)} onSubmit={submitDocument} />}
            {modalType === 'orderInvoice' && <OrderInvoiceForm orders={data.orders} busy={busy} onCancel={() => setModal(null)} onSubmit={submitOrderInvoice} />}
            {modalType === 'payment' && <FinancePaymentForm parties={data.parties} documents={data.documents} accounts={data.bankAccounts} initialDocumentId={modalDocumentId} busy={busy} onCancel={() => setModal(null)} onSubmit={submitPayment} />}
            {modalType === 'check' && <FinanceCheckForm parties={data.parties} busy={busy} onCancel={() => setModal(null)} onSubmit={submitCheck} />}
            {modalType === 'referral' && <FinanceReferralForm documents={data.documents} initialDocumentId={modalDocumentId} busy={busy} onCancel={() => setModal(null)} onSubmit={submitReferral} />}
          </FinanceModal>
        );
      })()}

      <nav className="accounting-tabs">
        {Object.entries(t.tabs).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {notice && <div className="accounting-message">{notice}</div>}
      {data.loading && <div className="accounting-message">{t.loading}</div>}
      {!data.loading && data.error && <div className="accounting-message error">{t.error}<br /><small dir="ltr">{data.error.message}</small></div>}

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} dashboard={data.dashboard} docs={data.documents} profit={data.profitability} lang={lang} t={t} />}
      {!data.loading && tab === 'documents' && <DocumentsSection docs={data.documents} selectedDocument={selectedDocument} documentBundle={documentBundle} lang={lang} t={t} busy={busy} onSelect={setSelectedDocumentId} onPost={(id) => runAction(() => postFinanceDocument(id), 'سند حسابداری فاکتور ثبت شد.')} onEdit={(id) => setModal({ type: 'document', documentId: id })} onConvert={(id) => runAction(() => convertProformaToInvoice(id), 'پیش‌فاکتور به فاکتور تبدیل شد.')} onVoid={(id) => { const reason = window.prompt('دلیل ابطال سند را وارد کنید:'); if (reason) runAction(() => voidFinanceDocument(id, reason), 'سند باطل شد.'); }} onReturn={(id) => { const reason = window.prompt('دلیل فاکتور برگشتی را وارد کنید:'); if (reason) runAction(() => createSalesReturnFromInvoice(id, reason), 'فاکتور برگشتی ساخته شد.'); }} onNewPayment={(id) => setModal({ type: 'payment', documentId: id })} onNewReferral={(id) => setModal({ type: 'referral', documentId: id })} />}
      {!data.loading && tab === 'parties' && <PartiesSection parties={filteredParties} allParties={data.parties} filter={partyFilter} setFilter={setPartyFilter} selectedPartyId={selectedPartyId} setSelectedPartyId={setSelectedPartyId} selectedParty={selectedParty} statement={statement} statementFlowFilter={statementFlowFilter} setStatementFlowFilter={setStatementFlowFilter} lang={lang} t={t} />}
      {!data.loading && tab === 'profitability' && <ProfitCard rows={data.profitability} lang={lang} t={t} full />}
      {!data.loading && tab === 'treasury' && <TreasurySection payments={data.payments} checks={data.checks} accounts={accounts} lang={lang} t={t} busy={busy} onChangeCheckStatus={(id, status) => runAction(() => updateFinanceCheckStatus(id, status), 'وضعیت چک تغییر کرد.')} />}
      {!data.loading && tab === 'fiscal' && <FiscalSection fiscalYears={data.fiscalYears} fiscalPeriods={data.fiscalPeriods} lang={lang} busy={busy} onClosePeriod={(id) => runAction(() => closeFiscalPeriod(id), 'ماه مالی بسته شد.')} onReopenPeriod={(id) => runAction(() => reopenFiscalPeriod(id), 'ماه مالی بازگشایی شد.')} onCloseYear={(id) => runAction(() => closeFiscalYear(id), 'سال مالی بسته شد.')} onReopenYear={(id) => runAction(() => reopenFiscalYear(id), 'سال مالی بازگشایی شد.')} />}
      {!data.loading && tab === 'referrals' && <div className="accounting-grid"><ReferralPanel sourceModule="accounting" title="ارجاع و اسناد مالی" defaultTarget="sales" /></div>}
      {!data.loading && tab === 'settings' && <SettingsSection numbering={data.numbering} ioDocuments={data.ioDocuments} lang={lang} busy={busy} onUpdateNumbering={(ruleKey, patch) => runAction(() => updateNumberingRule(ruleKey, patch), 'تنظیمات شماره‌گذاری ذخیره شد.')} onAddIo={(type) => runAction(() => createIoDocument({ io_type: type, title_fa: type === 'incoming' ? 'سند ورودی نمونه' : 'سند خروجی نمونه', source_module: 'accounting', status: 'registered' }), 'سند ورودی/خروجی ثبت شد.')} />}
    </div>
  );
}

function Overview({ kpis, dashboard, docs, profit, lang, t }) {
  return <>
    <section className="finance-kpi-grid">
      {kpis.map((kpi) => <FinanceKPI key={kpi.label} {...kpi} lang={lang} />)}
      <div className="finance-kpi referral-kpi"><ClipboardList size={20} /><span>{t.openReferrals}</span><strong>{formatNumber(dashboard.open_accounting_referrals || 0, lang)}</strong></div>
    </section>
    <div className="accounting-grid two">
      <DocumentsCard title="آخرین اسناد" docs={docs.slice(0, 8)} lang={lang} t={t} />
      <ProfitCard rows={profit.slice(0, 8)} lang={lang} t={t} />
    </div>
  </>;
}

function FinanceKPI({ label, value, icon: Icon, accent, lang }) {
  return <div className={`finance-kpi ${accent}`}><Icon size={20} /><span>{label}</span><strong>{formatMoney(value, lang)}</strong></div>;
}

function DocumentsSection({ docs, documentBundle, lang, t, busy, onSelect, onPost, onEdit, onConvert, onVoid, onReturn, onNewPayment, onNewReferral }) {
  return <div className="accounting-grid two document-workspace">
    <DocumentsCard title="فاکتورها و اسناد مالی" docs={docs} lang={lang} t={t} full onSelect={onSelect} busy={busy} onConvert={onConvert} onVoid={onVoid} onReturn={onReturn} />
    <FinanceDocumentDetails
      bundle={documentBundle}
      loading={documentBundle.loading}
      busy={busy}
      onPost={onPost}
      onEdit={onEdit}
      onConvert={onConvert}
      onVoid={onVoid}
      onReturn={onReturn}
      onNewPayment={onNewPayment}
      onNewReferral={onNewReferral}
    />
  </div>;
}

function DocumentsCard({ title, docs, lang, t, full, onSelect, busy, onConvert, onVoid, onReturn }) {
  return <section className="finance-card">
    <div className="finance-card-header between"><CardHeader icon={FileText} title={title} bare />{full && <button className="mini-btn" onClick={() => exportDocuments(docs, lang)}>{t.exportCsv}</button>}</div>
    {docs.length === 0 ? <Empty t={t} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>شماره</th><th>نوع</th><th>وضعیت</th><th>شخص</th><th>سفارش</th><th>مبلغ</th><th>مانده</th>{full && <th>عملیات</th>}</tr></thead><tbody>{docs.map((d) => <tr key={d.id} className={d.is_overdue ? 'overdue' : ''}><td dir="ltr">{d.doc_number}</td><td>{docLabel(d.document_type, lang)}</td><td><StatusBadge status={d.status} lang={lang} /></td><td>{d.party_name || '—'}</td><td dir="ltr">{d.order_code || '—'}</td><td>{formatMoney(d.total_amount, lang)}</td><td className={Number(d.balance_amount) > 0 ? 'negative-soft' : 'positive'}>{formatMoney(d.balance_amount, lang)}</td>{full && <td className="actions-cell"><button disabled={busy} onClick={() => onSelect?.(d.id)}>تاریخچه</button>{d.document_type === 'sales_proforma' && <button disabled={busy} onClick={() => onConvert?.(d.id)}>تبدیل</button>}{d.document_type === 'sales_invoice' && <button disabled={busy} onClick={() => onReturn?.(d.id)}>برگشتی</button>}<button disabled={busy || d.status === 'void'} onClick={() => onVoid?.(d.id)}>ابطال</button><button onClick={() => printSimpleDocument(d, lang)}>PDF</button></td>}</tr>)}</tbody></table></div>}
  </section>;
}

function PartiesSection({ parties, allParties, filter, setFilter, selectedPartyId, setSelectedPartyId, selectedParty, statement, statementFlowFilter, setStatementFlowFilter, lang, t }) {
  return <>
    <div className="accounting-grid two parties-layout">
      <section className="finance-card"><CardHeader icon={Users} title="اشخاص مالی" /><div className="toolbar-line"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t.all}</option><option value="debtors">{t.debtors}</option><option value="creditors">{t.creditors}</option><option value="settled">{t.settled}</option></select></div>{parties.length === 0 ? <Empty t={t} /> : <div className="party-list">{parties.map((p) => <button key={p.party_id} className={selectedPartyId === p.party_id ? 'party-row active' : 'party-row'} onClick={() => setSelectedPartyId(p.party_id)}><span><strong>{p.display_name}</strong><small>{partyTypeLabel(p.party_type, lang)} · {p.phone || p.email || '—'}</small></span><b className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</b></button>)}</div>}</section>
      <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={BookOpen} title={selectedParty ? `صورت‌حساب: ${selectedParty.display_name}` : 'صورت‌حساب شخص'} bare />{selectedParty && <button className="mini-btn" onClick={() => printStatement(selectedParty, statement.rows, lang)}>{t.printPdf}</button>}</div><div className="toolbar-line"><select value={statementFlowFilter} onChange={(e) => setStatementFlowFilter(e.target.value)}><option value="all">{t.all}</option><option value="debit">{t.debitOnly}</option><option value="credit">{t.creditOnly}</option></select></div>{!selectedPartyId ? <p className="muted">{t.selectParty}</p> : statement.loading ? <p className="muted">{t.loading}</p> : statement.rows.length === 0 ? <Empty t={t} /> : <StatementTable rows={statement.rows} lang={lang} />}</section>
    </div>
    <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={ListChecks} title="لیست بدهکاران و بستانکاران" bare /><button className="mini-btn" onClick={() => exportBalances(allParties, filter, lang)}>{t.exportCsv}</button></div><BalanceTable parties={parties} lang={lang} /></section>
  </>;
}

function StatementTable({ rows, lang }) {
  return <div className="table-scroll"><table className="finance-table compact"><thead><tr><th>تاریخ</th><th>شماره</th><th>نوع</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.ref_number}-${i}`}><td>{formatDate(r.entry_date, lang)}</td><td dir="ltr">{r.ref_number}</td><td>{entryTypeLabel(r.entry_type, lang)}</td><td>{formatMoney(r.debit_amount, lang)}</td><td>{formatMoney(r.credit_amount, lang)}</td><td className={Number(r.running_balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.running_balance, lang)}</td></tr>)}</tbody></table></div>;
}

function BalanceTable({ parties, lang }) {
  return <div className="table-scroll"><table className="finance-table"><thead><tr><th>شخص</th><th>نوع</th><th>وضعیت</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody>{parties.map((p) => <tr key={p.party_id}><td>{p.display_name}</td><td>{partyTypeLabel(p.party_type, lang)}</td><td>{Number(p.balance) > 0 ? 'بدهکار' : Number(p.balance) < 0 ? 'بستانکار' : 'تسویه'}</td><td>{Number(p.balance) > 0 ? formatMoney(p.balance, lang) : '—'}</td><td>{Number(p.balance) < 0 ? formatMoney(Math.abs(p.balance), lang) : '—'}</td><td className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</td></tr>)}</tbody></table></div>;
}

function TreasurySection({ payments, checks, accounts, lang, t, busy, onChangeCheckStatus }) {
  return <div className="accounting-grid two"><section className="finance-card"><CardHeader icon={Banknote} title="حساب‌ها" /><div className="finance-kpi-grid compact-kpis"><MiniAccount title={t.official} rows={accounts.official} lang={lang} /><MiniAccount title={t.unofficial} rows={accounts.unofficial} lang={lang} /></div><CardHeader icon={WalletCards} title="دریافت و پرداخت‌ها" /><SimplePaymentsTable rows={payments} lang={lang} /></section><section className="finance-card"><CardHeader icon={CalendarClock} title="چک‌ها" /><SimpleChecksTable rows={checks} lang={lang} busy={busy} onChangeStatus={onChangeCheckStatus} /></section></div>;
}

function MiniAccount({ title, rows, lang }) {
  const total = rows.reduce((s, r) => s + Number(r.opening_balance || 0), 0);
  return <div className="finance-kpi"><span>{title}</span><strong>{formatMoney(total, lang)}</strong><small>{rows.map((r) => r.account_name).join('، ') || '—'}</small></div>;
}

function SimplePaymentsTable({ rows, lang }) {
  return rows.length === 0 ? <Empty t={{ noData: 'داده‌ای نیست' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>شماره</th><th>نوع</th><th>روش</th><th>تاریخ</th><th>مبلغ</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td dir="ltr">{r.payment_number}</td><td>{r.direction === 'receipt' ? 'دریافت' : 'پرداخت'}</td><td>{r.method}</td><td>{formatDate(r.payment_date, lang)}</td><td>{formatMoney(r.amount, lang)}</td></tr>)}</tbody></table></div>;
}

function SimpleChecksTable({ rows, lang, busy, onChangeStatus }) {
  const flow = ['in_hand', 'deposited', 'cleared', 'returned', 'spent', 'issued', 'cancelled'];
  return rows.length === 0 ? <Empty t={{ noData: 'داده‌ای نیست' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>کد داخلی</th><th>نوع</th><th>شماره</th><th>بانک</th><th>سررسید</th><th>مبلغ</th><th>وضعیت</th><th>تغییر وضعیت</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td dir="ltr">{r.internal_check_code || '—'}</td><td>{r.check_type === 'received' ? 'دریافتی' : 'پرداختی'}</td><td dir="ltr">{r.check_number}</td><td>{r.bank_name || '—'}</td><td>{formatDate(r.due_date, lang)}</td><td>{formatMoney(r.amount, lang)}</td><td><StatusBadge status={r.status} lang={lang} /></td><td><select disabled={busy} value={r.status} onChange={(e) => onChangeStatus(r.id, e.target.value)}>{flow.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]?.[lang] || s}</option>)}</select></td></tr>)}</tbody></table></div>;
}

function FiscalSection({ fiscalYears, fiscalPeriods, lang, busy, onClosePeriod, onReopenPeriod, onCloseYear, onReopenYear }) {
  const year = fiscalYears[0];
  return <div className="accounting-grid two"><section className="finance-card"><CardHeader icon={CalendarClock} title="سال مالی" />{!year ? <Empty t={{ noData: 'سال مالی تعریف نشده است.' }} /> : <div className="fiscal-box"><p><b>{year.title}</b></p><p>{formatDate(year.start_date, lang)} تا {formatDate(year.end_date, lang)}</p><StatusBadge status={year.is_closed ? 'paid' : 'open'} lang={lang} /><div className="actions-cell"><button disabled={busy || year.is_closed} onClick={() => onCloseYear(year.id)}>بستن سال</button><button disabled={busy || !year.is_closed} onClick={() => onReopenYear(year.id)}>بازگشایی</button></div></div>}</section><section className="finance-card"><CardHeader icon={ListChecks} title="ماه‌های مالی" />{fiscalPeriods.length === 0 ? <Empty t={{ noData: 'دوره‌ای تعریف نشده است.' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>ماه</th><th>شروع</th><th>پایان</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{fiscalPeriods.map((p) => <tr key={p.id}><td>{p.title_fa}</td><td>{formatDate(p.start_date, lang)}</td><td>{formatDate(p.end_date, lang)}</td><td><StatusBadge status={p.is_closed ? 'paid' : 'open'} lang={lang} /></td><td className="actions-cell"><button disabled={busy || p.is_closed} onClick={() => onClosePeriod(p.id)}>بستن</button><button disabled={busy || !p.is_closed} onClick={() => onReopenPeriod(p.id)}>بازگشایی</button></td></tr>)}</tbody></table></div>}</section></div>;
}

function SettingsSection({ numbering, ioDocuments, lang, busy, onUpdateNumbering, onAddIo }) {
  function editRule(rule) {
    const prefix = window.prompt('پیشوند جدید را وارد کنید:', rule.prefix);
    if (!prefix) return;
    const paddingText = window.prompt('تعداد رقم شماره را وارد کنید:', String(rule.padding || 5));
    const padding = Number(paddingText || rule.padding || 5);
    onUpdateNumbering(rule.rule_key, { prefix, padding });
  }

  return <div className="accounting-grid two"><section className="finance-card"><CardHeader icon={Settings} title="تنظیمات و شماره‌گذاری مرکزی" />{numbering.length === 0 ? <Empty t={{ noData: 'قواعد شماره‌گذاری هنوز اجرا نشده‌اند.' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>عنوان</th><th>پیشوند</th><th>دوره</th><th>آخرین شماره</th><th>شماره بعدی</th><th>عملیات</th></tr></thead><tbody>{numbering.map((r) => <tr key={r.rule_key}><td>{lang === 'fa' ? r.label_fa : r.label_en}</td><td dir="ltr">{r.prefix}</td><td>{r.reset_scope}</td><td>{r.current_counter}</td><td dir="ltr"><b>{r.next_number_preview}</b></td><td><button className="mini-btn" disabled={busy} onClick={() => editRule(r)}>تنظیم</button></td></tr>)}</tbody></table></div>}</section><section className="finance-card"><div className="finance-card-header between"><CardHeader icon={FileText} title="اسناد ورودی / خروجی" bare /><div className="actions-cell"><button disabled={busy} onClick={() => onAddIo('incoming')}>＋ ورودی</button><button disabled={busy} onClick={() => onAddIo('outgoing')}>＋ خروجی</button></div></div>{ioDocuments.length === 0 ? <Empty t={{ noData: 'سند ورودی/خروجی ثبت نشده است.' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>تاریخ</th></tr></thead><tbody>{ioDocuments.map((d) => <tr key={d.id}><td dir="ltr">{d.io_number}</td><td>{d.io_type === 'incoming' ? 'ورودی' : 'خروجی'}</td><td>{d.title_fa}</td><td>{formatDate(d.registered_at, lang)}</td></tr>)}</tbody></table></div>}</section></div>;
}

function ProfitCard({ rows, lang, t, full }) {
  return <section className="finance-card"><CardHeader icon={BarChart3} title="سود و زیان سفارش‌ها" />{rows.length === 0 ? <Empty t={t} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>سفارش</th><th>مشتری</th><th>درآمد</th><th>هزینه</th><th>سود</th><th>حاشیه</th></tr></thead><tbody>{rows.map((r) => <tr key={r.order_id}><td dir="ltr">{r.order_code}</td><td>{r.company_name || r.title_fa}</td><td>{formatMoney(r.revenue_before_tax, lang)}</td><td>{formatMoney(r.cost_before_tax, lang)}</td><td className={Number(r.gross_profit) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.gross_profit, lang)}</td><td>{r.gross_margin_pct == null ? '—' : `${formatNumber(r.gross_margin_pct, lang)}٪`}</td></tr>)}</tbody></table>{full && <p className="finance-note">این گزارش از فاکتور فروش، خرید، هزینه مستقیم و هزینه‌های سفارش محاسبه می‌شود.</p>}</div>}</section>;
}

function ReferralsCard({ rows, lang, t }) {
  return <section className="finance-card"><CardHeader icon={Link2} title="ارجاع و اسناد مالی" />{rows.length === 0 ? <Empty t={t} /> : <div className="referral-list">{rows.map((r) => <article key={r.id} className={`referral-card p${r.priority}`}><div><strong>{r.title_fa}</strong><small>{r.referral_number} · {moduleLabel(r.source_module, lang)} → {moduleLabel(r.target_module, lang)}</small></div><div className="referral-meta"><StatusBadge status={r.status} lang={lang} /><span>{r.due_date ? formatDate(r.due_date, lang) : '—'}</span></div></article>)}</div>}</section>;
}

function CardHeader({ icon: Icon, title, bare }) {
  const content = <><Icon size={18} /><h2>{title}</h2></>;
  return bare ? <div className="finance-card-header inline-title">{content}</div> : <header className="finance-card-header">{content}</header>;
}
function Empty({ t }) { return <div className="finance-empty">{t.noData}</div>; }
function StatusBadge({ status, lang }) { return <span className={`status-badge ${status}`}>{STATUS_LABELS[status]?.[lang] || status}</span>; }

function docLabel(type, lang) { return DOC_LABELS[type]?.[lang] || type; }
function entryTypeLabel(type, lang) { return DOC_LABELS[type]?.[lang] || STATUS_LABELS[type]?.[lang] || type; }
function partyTypeLabel(type, lang) { return ({ customer: { fa: 'مشتری', en: 'Customer' }, supplier: { fa: 'تأمین‌کننده', en: 'Supplier' }, employee: { fa: 'کارمند', en: 'Employee' }, shareholder: { fa: 'سهامدار', en: 'Shareholder' }, other: { fa: 'سایر', en: 'Other' } }[type]?.[lang] || type); }
function eventLabel(type, lang) { return ({ created: { fa: 'ایجاد', en: 'Created' }, status_changed: { fa: 'تغییر وضعیت', en: 'Status changed' }, converted_to_invoice: { fa: 'تبدیل به فاکتور', en: 'Converted' }, voided: { fa: 'ابطال', en: 'Voided' }, return_created: { fa: 'برگشتی', en: 'Return' } }[type]?.[lang] || type); }
function moduleLabel(module, lang) { return ({ orders: { fa: 'سفارش', en: 'Orders' }, sales: { fa: 'فروش', en: 'Sales' }, rnd: { fa: 'R&D', en: 'R&D' }, production: { fa: 'تولید', en: 'Production' }, warehouse: { fa: 'انبار', en: 'Warehouse' }, accounting: { fa: 'مالی', en: 'Finance' }, admin: { fa: 'مدیریت', en: 'Admin' }, manual: { fa: 'دستی', en: 'Manual' } }[module]?.[lang] || module); }
function formatNumber(value, lang) { return new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function formatMoney(value, lang) { return formatToman(value, lang); }
function formatDate(value) { return formatJalaliDate(value); }
function modalTitle(type) {
  return ({ document: 'فاکتور / سند مالی جدید', orderInvoice: 'ساخت فاکتور از سفارش', payment: 'ثبت دریافت / پرداخت', check: 'ثبت چک', referral: 'ارجاع مالی' }[type] || 'فرم مالی');
}

function exportDocuments(docs, lang) {
  const headers = ['شماره', 'نوع', 'وضعیت', 'شخص', 'سفارش', 'مبلغ', 'پرداخت', 'مانده'];
  const rows = docs.map((d) => [d.doc_number, docLabel(d.document_type, lang), STATUS_LABELS[d.status]?.[lang] || d.status, d.party_name, d.order_code, d.total_amount, d.paid_amount, d.balance_amount]);
  downloadExcelHtml(`finance-documents-${new Date().toISOString().slice(0, 10)}.xls`, headers, rows, 'گزارش اسناد مالی');
}
function exportBalances(parties, filter, lang) {
  const rows = parties.filter((p) => filter === 'all' || (filter === 'debtors' && Number(p.balance) > 0) || (filter === 'creditors' && Number(p.balance) < 0) || (filter === 'settled' && Number(p.balance) === 0));
  downloadExcelHtml(`party-balances-${new Date().toISOString().slice(0, 10)}.xls`, ['شخص', 'نوع', 'مانده'], rows.map((p) => [p.display_name, partyTypeLabel(p.party_type, lang), p.balance]), 'گزارش بدهکاران و بستانکاران');
}
function printSimpleDocument(d, lang) {
  openPrintableDocument(d.doc_number, `<h1>${docLabel(d.document_type, lang)} ${d.doc_number}</h1><div class="meta"><div><b>شخص:</b> ${d.party_name || '—'}</div><div><b>سفارش:</b> ${d.order_code || '—'}</div><div><b>مبلغ:</b> <span class="money">${formatMoney(d.total_amount, lang)}</span></div><div><b>مانده:</b> <span class="money">${formatMoney(d.balance_amount, lang)}</span></div></div><div class="footer"><span>امضای فروش</span><span>امضای مالی</span><span>مهر شرکت</span></div>`);
}
function printStatement(party, rows, lang) {
  openPrintableDocument(`صورت‌حساب ${party.display_name}`, `<h1>صورت‌حساب ${party.display_name}</h1><table><thead><tr><th>تاریخ</th><th>شماره</th><th>نوع</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${formatDate(r.entry_date, lang)}</td><td>${r.ref_number}</td><td>${entryTypeLabel(r.entry_type, lang)}</td><td class="money">${formatMoney(r.debit_amount, lang)}</td><td class="money">${formatMoney(r.credit_amount, lang)}</td><td class="money">${formatMoney(r.running_balance, lang)}</td></tr>`).join('')}</tbody></table>`);
}
