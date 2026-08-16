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
  PackageCheck,
  Search,
  RefreshCcw,
  RotateCcw,
  Settings,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAccountingData, useFinanceDocumentBundle, usePartyStatement } from '../../hooks/useAccountingData';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import JalaliDateInput from '../../components/JalaliDateInput';
import { formatJalaliDate, formatToman } from '../../lib/formatters';
import { formatRial, rialToPersianWords } from '../../lib/persianNumbers';
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
  openOfficialFinancePrint,
  postFinanceDocument,
  reopenFiscalPeriod,
  reopenFiscalYear,
  updateFinanceCheckStatus,
  updateFinanceDocument,
  updateNumberingRule,
  voidFinanceDocument,
  settleFinanceCheck,
  createFinanceInvestment,
  updateFinanceInvestment,
  archiveFinanceInvestment,
  createFinanceParty,
  createFinanceOrderCost,
  createFinanceBankAccount,
  updateFinanceBankAccount,
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
import { getFriendlyErrorMessage, getTechnicalErrorMessage } from '../../lib/errorMessages';

const COPY = {
  fa: {
    title: 'مالی و حسابداری',
    subtitle: 'فاکتور، دریافت/پرداخت، چک، صورت‌حساب اشخاص، سود سفارش، دوره مالی و تنظیمات شماره‌گذاری',
    refresh: 'به‌روزرسانی',
    tabs: {
      overview: 'نمای کلی',
      documents: 'فاکتورها',
      parties: 'اشخاص و صورت‌حساب‌ها',
      cashflow: 'صندوق و گردش حساب',
      checks: 'چک‌ها',
      itemKardex: 'کاردکس کالاها',
      profitability: 'سود سفارش‌ها',
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
    tabs: { overview: 'Overview', documents: 'Invoices', parties: 'Parties', cashflow: 'Cash & Bank', checks: 'Checks', itemKardex: 'Item Kardex', profitability: 'Order Profit', fiscal: 'Fiscal', referrals: 'Referrals', settings: 'Settings' },
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
  const [confirmAction, setConfirmAction] = useState(null);
  const [investmentModal, setInvestmentModal] = useState(null);
  const [partyModal, setPartyModal] = useState(null);
  const [orderCostModal, setOrderCostModal] = useState(null);
  const [accountModal, setAccountModal] = useState(null);

  const data = useAccountingData();
  const selectedParty = useMemo(() => data.parties.find((p) => p.party_id === selectedPartyId), [data.parties, selectedPartyId]);
  const statement = usePartyStatement(selectedPartyId, statementFlowFilter);
  const documentBundle = useFinanceDocumentBundle(selectedDocumentId);
  const selectedDocument = useMemo(() => data.documents.find((d) => d.id === selectedDocumentId), [data.documents, selectedDocumentId]);
  const activeDocuments = useMemo(() => data.documents.filter((d) => d.status !== 'void'), [data.documents]);

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
      setInvestmentModal(null);
      setPartyModal(null);
      setOrderCostModal(null);
      setAccountModal(null);
      await data.refetch();
      documentBundle.refetch?.();
    } catch (e) {
      setNotice(getFriendlyErrorMessage(e, 'خطا در اجرای عملیات'));
    } finally {
      setBusy(false);
    }
  }

  function submitDocument(payload) {
    const existing = payload.documentId ? (documentBundle.document || data.documents.find((d) => d.id === payload.documentId)) : null;
    if (existing && !['draft', 'pending_approval'].includes(existing.status)) {
      setConfirmAction({
        type: 'edit_document',
        id: payload.documentId,
        payload,
        title: 'ویرایش فاکتور تأییدشده',
        message: 'این فاکتور قبلاً تأیید/ثبت شده است. آیا مایل هستید بعد از ویرایش، اسناد مرتبط مثل خروج/ورود انبار و سندهای مربوط نیز متناسب با فاکتور اصلاح شوند؟ دلیل ویرایش را وارد کنید.',
      });
      return;
    }
    runAction(
      () => payload.documentId ? updateFinanceDocument(payload.documentId, payload) : createFinanceDocument(payload),
      payload.documentId ? 'سند مالی ویرایش شد.' : 'سند مالی با شماره خودکار ثبت شد.'
    );
  }
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
          <button type="button" className="primary" onClick={() => setModal('orderInvoice')}><FileText size={16} /> فاکتور از سفارش</button>
          <button type="button" onClick={() => setModal('document')}><FileText size={16} /> فاکتور جدید</button>
          <button type="button" onClick={() => setModal('payment')}><Banknote size={16} /> دریافت/پرداخت</button>
          <button type="button" onClick={data.refetch}><RefreshCcw size={16} /> به‌روزرسانی</button>
        </div>
      </header>

      {modal && (() => {
        const modalType = typeof modal === 'string' ? modal : modal.type;
        const modalDocumentId = typeof modal === 'object' ? modal.documentId : null;
        return (
          <FinanceModal title={modalTitle(modalType)} onClose={() => setModal(null)}>
            {modalType === 'document' && <FinanceDocumentForm parties={data.parties} orders={data.orders} stock={data.stock} initialDocument={modalDocumentId ? documentBundle.document : null} initialItems={modalDocumentId ? documentBundle.items : []} busy={busy} onCancel={() => setModal(null)} onSubmit={submitDocument} />}
            {modalType === 'orderInvoice' && <OrderInvoiceForm orders={data.orders} busy={busy} onCancel={() => setModal(null)} onSubmit={submitOrderInvoice} />}
            {modalType === 'payment' && <FinancePaymentForm parties={data.parties} documents={activeDocuments} accounts={data.bankAccounts} initialDocumentId={modalDocumentId} busy={busy} onCancel={() => setModal(null)} onSubmit={submitPayment} />}
            {modalType === 'check' && <FinanceCheckForm parties={data.parties} busy={busy} onCancel={() => setModal(null)} onSubmit={submitCheck} />}
            {modalType === 'referral' && <FinanceReferralForm documents={activeDocuments} initialDocumentId={modalDocumentId} busy={busy} onCancel={() => setModal(null)} onSubmit={submitReferral} />}
          </FinanceModal>
        );
      })()}

      {confirmAction && <FinanceConfirmModal action={confirmAction} busy={busy} onClose={() => setConfirmAction(null)} onConfirm={(reason) => {
        const action = confirmAction;
        setConfirmAction(null);
        if (action.type === 'void') runAction(() => voidFinanceDocument(action.id, reason), 'سند باطل شد و از لیست فعال حذف شد.');
        if (action.type === 'return') runAction(() => createSalesReturnFromInvoice(action.id, reason), 'فاکتور برگشتی ساخته شد.');
        if (action.type === 'edit_document') runAction(() => updateFinanceDocument(action.id, { ...action.payload, syncLinkedDocuments: true, edit_reason: reason }), 'فاکتور و اسناد مرتبط با آن ویرایش و همگام شد.');
      }} />}
      {investmentModal && <InvestmentModal initial={investmentModal.item} busy={busy} onClose={() => setInvestmentModal(null)} onSubmit={(payload) => runAction(() => investmentModal.item ? updateFinanceInvestment(investmentModal.item.id, payload) : createFinanceInvestment(payload), investmentModal.item ? 'سرمایه‌گذاری ویرایش شد.' : 'سرمایه‌گذاری ثبت شد.')} />}
      {partyModal && <PartyModal busy={busy} onClose={() => setPartyModal(null)} onSubmit={(payload) => runAction(() => createFinanceParty(payload), 'شخص جدید ثبت و با بانک مشتریان هماهنگ شد.')} />}
      {orderCostModal && <OrderCostModal order={orderCostModal.order} busy={busy} onClose={() => setOrderCostModal(null)} onSubmit={(payload) => runAction(() => createFinanceOrderCost(payload), 'هزینه سفارش ثبت شد و در سود سفارش لحاظ می‌شود.')} />}
      {accountModal && <BankAccountModal initial={accountModal.account} busy={busy} onClose={() => setAccountModal(null)} onSubmit={(payload) => runAction(() => accountModal.account ? updateFinanceBankAccount(accountModal.account.id || accountModal.account.account_id, payload) : createFinanceBankAccount(payload), accountModal.account ? 'اطلاعات حساب/کارت ویرایش شد.' : 'حساب/کارت بانکی اضافه شد.')} />}

      <nav className="accounting-tabs">
        {Object.entries(t.tabs).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {notice && <div className="accounting-message">{notice}</div>}
      {data.loading && <div className="accounting-message">{t.loading}</div>}
      {!data.loading && data.error && <div className="accounting-message error">{getFriendlyErrorMessage(data.error, t.error)}<br /><small dir="ltr">{getTechnicalErrorMessage(data.error)}</small></div>}

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} dashboard={data.dashboard} docs={activeDocuments} profit={data.profitability} payments={data.paymentLedger} checks={data.checks} lang={lang} t={t} setTab={setTab} />}
      {!data.loading && tab === 'documents' && <DocumentsSection docs={activeDocuments} selectedDocument={selectedDocument} documentBundle={documentBundle} lang={lang} t={t} busy={busy} onSelect={setSelectedDocumentId} onCloseDetails={() => setSelectedDocumentId(null)} onPost={(id) => runAction(() => postFinanceDocument(id), 'سند حسابداری فاکتور ثبت شد.')} onEdit={(id) => setModal({ type: 'document', documentId: id })} onConvert={(id) => runAction(() => convertProformaToInvoice(id), 'پیش‌فاکتور به فاکتور تبدیل شد و به فاکتور فروش منتقل شد.')} onVoid={(id) => setConfirmAction({ type: 'void', id, title: 'ابطال فاکتور', message: 'آیا از ابطال این سند مطمئن هستید؟ بعد از ابطال از لیست فعال حذف می‌شود.' })} onReturn={(id) => setConfirmAction({ type: 'return', id, title: 'فاکتور برگشتی', message: 'دلیل و توضیح ایجاد فاکتور برگشتی را وارد کنید.' })} onNewPayment={(id) => setModal({ type: 'payment', documentId: id })} onNewReferral={(id) => setModal({ type: 'referral', documentId: id })} />}
      {!data.loading && tab === 'parties' && <PartiesSection parties={filteredParties} allParties={data.parties} filter={partyFilter} setFilter={setPartyFilter} selectedPartyId={selectedPartyId} setSelectedPartyId={setSelectedPartyId} selectedParty={selectedParty} statement={statement} statementFlowFilter={statementFlowFilter} setStatementFlowFilter={setStatementFlowFilter} lang={lang} t={t} onNewParty={() => setPartyModal({})} />}
      {!data.loading && tab === 'cashflow' && <CashFlowSection accounts={data.treasuryAccounts} bankAccounts={data.bankAccounts} ledger={data.paymentLedger} investments={data.investments} lang={lang} onNewPayment={() => setModal('payment')} onNewAccount={() => setAccountModal({})} onEditAccount={(account) => setAccountModal({ account })} onNewInvestment={() => setInvestmentModal({})} onEditInvestment={(item) => setInvestmentModal({ item })} onArchiveInvestment={(item) => runAction(() => archiveFinanceInvestment(item.id), 'سرمایه‌گذاری آرشیو شد.')} />}
      {!data.loading && tab === 'checks' && <ChecksSection checks={data.checks} parties={data.parties} accounts={data.bankAccounts} lang={lang} busy={busy} onNewCheck={() => setModal('check')} onSettle={(payload) => runAction(() => settleFinanceCheck(payload), 'وضعیت چک و گردش بانک ثبت شد.')} onChangeStatus={(id, status) => runAction(() => updateFinanceCheckStatus(id, status), 'وضعیت چک تغییر کرد.')} />}
      {!data.loading && tab === 'itemKardex' && <ItemKardexSection stock={data.stock} rows={data.itemKardex} lastSales={data.itemLastSales} />}
      {!data.loading && tab === 'profitability' && <ProfitCard rows={data.profitability} lang={lang} t={t} full onAddCost={(order) => setOrderCostModal({ order })} orderCosts={data.orderCosts} />}
      {!data.loading && tab === 'fiscal' && <FiscalSection fiscalYears={data.fiscalYears} fiscalPeriods={data.fiscalPeriods} lang={lang} busy={busy} onClosePeriod={(id) => runAction(() => closeFiscalPeriod(id), 'ماه مالی بسته شد.')} onReopenPeriod={(id) => runAction(() => reopenFiscalPeriod(id), 'ماه مالی بازگشایی شد.')} onCloseYear={(id) => runAction(() => closeFiscalYear(id), 'سال مالی بسته شد.')} onReopenYear={(id) => runAction(() => reopenFiscalYear(id), 'سال مالی بازگشایی شد.')} />}
      {!data.loading && tab === 'referrals' && <div className="accounting-grid"><ReferralPanel sourceModule="accounting" title="ارجاعات" defaultTarget="sales" /></div>}
      {!data.loading && tab === 'settings' && <SettingsSection numbering={data.numbering} ioDocuments={data.ioDocuments} lang={lang} busy={busy} onUpdateNumbering={(ruleKey, patch) => runAction(() => updateNumberingRule(ruleKey, patch), 'تنظیمات شماره‌گذاری ذخیره شد.')} onAddIo={(type) => runAction(() => createIoDocument({ io_type: type, title_fa: type === 'incoming' ? 'سند ورودی نمونه' : 'سند خروجی نمونه', source_module: 'accounting', status: 'registered' }), 'سند ورودی/خروجی ثبت شد.')} />}
    </div>
  );
}

function Overview({ kpis, docs, profit, payments, checks, lang, t, setTab }) {
  return <>
    <section className="finance-kpi-grid clickable-kpis">
      {kpis.map((kpi) => <button key={kpi.label} className="kpi-button" onClick={() => {
        if (kpi.label === t.receivable || kpi.label === t.payable || kpi.label === t.overdue || kpi.label === t.monthSales) setTab('documents');
        else setTab('cashflow');
      }}><FinanceKPI {...kpi} lang={lang} /></button>)}
      <button className="kpi-button" onClick={() => setTab('referrals')}><div className="finance-kpi referral-kpi"><ClipboardList size={20} /><span>{t.openReferrals}</span><strong>مشاهده</strong></div></button>
    </section>
    <div className="accounting-grid three overview-finance-grid">
      <DocumentsCard title="آخرین فاکتورها" docs={docs.filter(d=>d.document_type!=='sales_proforma').slice(0, 10)} lang={lang} t={t} />
      <section className="finance-card"><CardHeader icon={Banknote} title="آخرین گردش بانک و صندوق" />{payments.length ? <div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>تاریخ</th><th>حساب</th><th>نوع</th><th>مبلغ</th></tr></thead><tbody>{payments.slice(0, 12).map(p=><tr key={p.id}><td>{formatDate(p.payment_date, lang)}</td><td>{p.account_name || '—'}</td><td>{p.direction==='receipt'?'واریز':'برداشت'}</td><td>{formatMoney(p.amount, lang)}</td></tr>)}</tbody></table></div> : <Empty t={t}/>}</section>
      <section className="finance-card"><CardHeader icon={WalletCards} title="چک‌های نزدیک و باز" />{checks.length ? <div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>کد</th><th>سررسید</th><th>وضعیت</th><th>مبلغ</th></tr></thead><tbody>{checks.slice(0, 12).map(c=><tr key={c.id}><td dir="ltr">{c.internal_check_code||c.check_number}</td><td>{formatDate(c.due_date, lang)}</td><td><StatusBadge status={c.status} lang={lang}/></td><td>{formatMoney(c.amount, lang)}</td></tr>)}</tbody></table></div> : <Empty t={t}/>}</section>
    </div>
    <div className="accounting-grid"><ProfitCard rows={profit.slice(0, 12)} lang={lang} t={t} /></div>
  </>;
}
function FinanceKPI({ label, value, icon: Icon, accent, lang }) {
  return <div className={`finance-kpi ${accent}`}><Icon size={20} /><span>{label}</span><strong>{formatMoney(value, lang)}</strong></div>;
}

function DocumentsSection({ docs, documentBundle, lang, t, busy, onSelect, onCloseDetails, onPost, onEdit, onConvert, onVoid, onReturn, onNewPayment, onNewReferral }) {
  const proformas = docs.filter(d => d.document_type === 'sales_proforma' && !docs.some(inv => inv.converted_from_document_id === d.id && inv.status !== 'void'));
  const salesInvoices = docs.filter(d => ['sales_invoice', 'sales_return'].includes(d.document_type));
  const purchaseInvoices = docs.filter(d => ['purchase_invoice', 'purchase_return', 'expense_invoice'].includes(d.document_type));
  const otherDocs = docs.filter(d => !['sales_proforma','sales_invoice','sales_return','purchase_invoice','purchase_return','expense_invoice'].includes(d.document_type));
  return <div className="accounting-grid document-workspace finance-doc-split document-modal-workspace">
    <DocumentsCard title="پیش‌فاکتورهای فروش" docs={proformas} lang={lang} t={t} full kind="proforma" onSelect={onSelect} busy={busy} onConvert={onConvert} onVoid={onVoid} />
    <DocumentsCard title="فاکتورهای فروش" docs={salesInvoices} lang={lang} t={t} full kind="sales" onSelect={onSelect} busy={busy} onVoid={onVoid} onReturn={onReturn} />
    <DocumentsCard title="فاکتورهای خرید و هزینه" docs={purchaseInvoices} lang={lang} t={t} full kind="purchase" onSelect={onSelect} busy={busy} onVoid={onVoid} />
    {otherDocs.length > 0 && <DocumentsCard title="سایر اسناد مالی" docs={otherDocs} lang={lang} t={t} full kind="other" onSelect={onSelect} busy={busy} onVoid={onVoid} />}
    {documentBundle.document && <div className="finance-detail-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCloseDetails?.()}><div className="finance-detail-modal"><FinanceDocumentDetails bundle={documentBundle} loading={documentBundle.loading} busy={busy} onPost={onPost} onEdit={onEdit} onConvert={onConvert} onVoid={onVoid} onReturn={onReturn} onNewPayment={onNewPayment} onNewReferral={onNewReferral} onClose={onCloseDetails} /></div></div>}
  </div>;
}

function DocumentsCard({ title, docs, lang, t, full, onSelect, busy, onConvert, onVoid, onReturn }) {
  const [sort, setSort] = useState({ key: 'issue_date', dir: 'desc' });
  const rows = useMemo(() => sortRows(docs, sort), [docs, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <section className="finance-card invoice-list-card">
    <div className="finance-card-header between"><CardHeader icon={FileText} title={title} bare />{full && <button className="mini-btn" onClick={() => exportDocuments(rows, lang)}>{t.exportCsv}</button>}</div>
    {rows.length === 0 ? <Empty t={t} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr>{th('doc_number','شماره')}{th('document_type','نوع')}{th('status','وضعیت')}{th('party_name','شخص')}{th('order_code','سفارش')}{th('total_amount','مبلغ')}{th('balance_amount','مانده')}{full && <th>عملیات</th>}</tr></thead><tbody>{rows.map((d) => <tr key={d.id} className={d.is_overdue ? 'overdue clickable-row' : 'clickable-row'} onClick={() => onSelect?.(d.id)}><td dir="ltr">{d.doc_number}</td><td>{docLabel(d.document_type, lang)}</td><td><StatusBadge status={d.status} lang={lang} /></td><td>{d.party_name || '—'}</td><td dir="ltr">{d.order_code || '—'}</td><td>{formatMoney(d.total_amount, lang)}</td><td className={Number(d.balance_amount) > 0 ? 'negative-soft' : 'positive'}>{formatMoney(d.balance_amount, lang)}</td>{full && <td className="actions-cell" onClick={(e)=>e.stopPropagation()}><button disabled={busy} onClick={() => onSelect?.(d.id)}>جزئیات</button>{d.document_type === 'sales_proforma' && <button disabled={busy} onClick={() => onConvert?.(d.id)}>تبدیل</button>}{d.document_type === 'sales_invoice' && <button disabled={busy} onClick={() => onReturn?.(d.id)}>برگشتی</button>}<button disabled={busy || d.status === 'void'} onClick={() => onVoid?.(d.id)}>ابطال</button><button onClick={() => printSimpleDocument(d, lang)}>PDF</button></td>}</tr>)}</tbody></table></div>}
  </section>;
}

function PartiesSection({ parties, allParties, filter, setFilter, selectedPartyId, setSelectedPartyId, selectedParty, statement, statementFlowFilter, setStatementFlowFilter, lang, t, onNewParty }) {
  return <>
    <div className="accounting-grid two parties-layout">
      <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={Users} title="اشخاص مالی" bare /><button className="mini-btn" onClick={onNewParty}>＋ شخص جدید</button></div><div className="toolbar-line"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t.all}</option><option value="debtors">{t.debtors}</option><option value="creditors">{t.creditors}</option><option value="settled">{t.settled}</option></select></div>{parties.length === 0 ? <Empty t={t} /> : <div className="party-list">{parties.map((p) => <button key={p.party_id} className={selectedPartyId === p.party_id ? 'party-row active' : 'party-row'} onClick={() => setSelectedPartyId(p.party_id)}><span><strong>{p.display_name}</strong><small>{partyTypeLabel(p.party_type, lang)} · {p.phone || p.email || '—'}</small></span><b className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</b></button>)}</div>}</section>
      <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={BookOpen} title={selectedParty ? `صورت‌حساب: ${selectedParty.display_name}` : 'صورت‌حساب شخص'} bare />{selectedParty && <button className="mini-btn" onClick={() => printStatement(selectedParty, statement.rows, lang)}>{t.printPdf}</button>}</div><div className="toolbar-line"><select value={statementFlowFilter} onChange={(e) => setStatementFlowFilter(e.target.value)}><option value="all">{t.all}</option><option value="debit">{t.debitOnly}</option><option value="credit">{t.creditOnly}</option></select></div>{!selectedPartyId ? <p className="muted">{t.selectParty}</p> : statement.loading ? <p className="muted">{t.loading}</p> : statement.rows.length === 0 ? <Empty t={t} /> : <StatementTable rows={statement.rows} lang={lang} />}</section>
    </div>
    <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={ListChecks} title="لیست بدهکاران و بستانکاران" bare /><button className="mini-btn" onClick={() => exportBalances(allParties, filter, lang)}>{t.exportCsv}</button></div><BalanceTable parties={parties} lang={lang} /></section>
  </>;
}

function StatementTable({ rows, lang }) {
  return <div className="table-scroll"><table className="finance-table compact"><thead><tr><th>تاریخ</th><th>شماره</th><th>نوع</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>تشخیص</th><th>مانده</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.ref_number}-${i}`}><td>{formatDate(r.entry_date, lang)}</td><td dir="ltr">{r.ref_number}</td><td>{entryTypeLabel(r.entry_type, lang)}</td><td>{r.description || '—'}</td><td>{formatMoney(r.debit_amount, lang)}</td><td>{formatMoney(r.credit_amount, lang)}</td><td>{Number(r.running_balance) >= 0 ? 'بدهکار' : 'بستانکار'}</td><td className={Number(r.running_balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.running_balance, lang)}</td></tr>)}</tbody></table></div>;
}

function BalanceTable({ parties, lang }) {
  const [sort, setSort] = useState({ key: 'balance', dir: 'desc' });
  const rows = useMemo(() => sortRows(parties.filter((p) => Number(p.balance) !== 0), sort), [parties, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <div className="table-scroll limited-list"><table className="finance-table"><thead><tr>{th('display_name','شخص')}{th('party_type','نوع')}{th('balance','وضعیت')}{th('total_debit','بدهکار')}{th('total_credit','بستانکار')}{th('balance','مانده')}</tr></thead><tbody>{rows.map((p) => <tr key={p.party_id}><td>{p.display_name}</td><td>{partyTypeLabel(p.party_type, lang)}</td><td>{Number(p.balance) > 0 ? 'بدهکار' : 'بستانکار'}</td><td>{Number(p.balance) > 0 ? formatMoney(p.balance, lang) : '—'}</td><td>{Number(p.balance) < 0 ? formatMoney(Math.abs(p.balance), lang) : '—'}</td><td className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</td></tr>)}</tbody></table></div>;
}

function CashFlowSection({ accounts, bankAccounts = [], ledger, investments, lang, onNewPayment, onNewAccount, onEditAccount, onNewInvestment, onEditInvestment, onArchiveInvestment }) {
  const [filters, setFilters] = useState({ accountId: 'all', direction: 'all', from: '', to: '', q: '' });
  const [sort, setSort] = useState({ key: 'payment_date', dir: 'desc' });
  const detailsById = useMemo(() => Object.fromEntries((bankAccounts || []).map((a) => [a.id, a])), [bankAccounts]);
  const enrichedAccounts = useMemo(() => accounts.map((a) => ({ ...a, ...(detailsById[a.account_id] || {}) })), [accounts, detailsById]);
  const filtered = useMemo(() => sortRows(ledger.filter((r) => (filters.accountId === 'all' || r.account_id === filters.accountId) && (filters.direction === 'all' || r.direction === filters.direction) && (!filters.from || r.payment_date >= filters.from) && (!filters.to || r.payment_date <= filters.to) && (!filters.q || `${r.payment_number || ''} ${r.party_name || ''} ${r.description || ''}`.includes(filters.q))), sort), [ledger, filters, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <div className="accounting-grid cashflow-layout finance-cashflow-full">
    <section className="finance-card cashflow-main-card full-width"><div className="finance-card-header between"><CardHeader icon={Banknote} title="صندوق و گردش حساب" bare /><div className="actions-cell"><button className="mini-btn" onClick={onNewAccount}>＋ افزودن حساب/کارت</button><button className="mini-btn" onClick={onNewPayment}>＋ دریافت/پرداخت</button></div></div><div className="cash-account-grid bank-card-grid">{enrichedAccounts.map((a) => <BankFlipCard key={`${a.account_kind}-${a.account_id}`} account={a} lang={lang} onEdit={onEditAccount} />)}</div><div className="toolbar-line"><select value={filters.accountId} onChange={(e)=>setFilters({...filters,accountId:e.target.value})}><option value="all">همه حساب‌ها</option>{enrichedAccounts.map(a=><option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}</select><select value={filters.direction} onChange={(e)=>setFilters({...filters,direction:e.target.value})}><option value="all">همه گردش‌ها</option><option value="receipt">واریزی</option><option value="payment">برداشت</option></select><input value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})} placeholder="جست‌وجوی شماره، شخص، شرح..." /></div><div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr>{th('payment_date','تاریخ')}{th('payment_number','شماره')}{th('account_name','حساب')}{th('party_name','شخص')}{th('direction','نوع')}{th('method','روش')}{th('amount','مبلغ')}<th>شرح</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{formatDate(r.payment_date, lang)}</td><td dir="ltr">{r.payment_number}</td><td>{r.account_name || '—'}</td><td>{r.party_name || '—'}</td><td className={r.direction==='receipt'?'receipt-text':'payment-text'}>{r.direction === 'receipt' ? 'واریز' : 'برداشت'}</td><td>{r.method}</td><td className={r.direction==='receipt'?'receipt-text':'payment-text'}>{formatMoney(r.amount, lang)}</td><td>{r.description || '—'}</td></tr>)}</tbody></table></div></section>
    <section className="finance-card investment-full-card full-width"><div className="finance-card-header between"><CardHeader icon={WalletCards} title="سرمایه‌گذاری‌ها" bare /><button className="mini-btn" onClick={onNewInvestment}>＋ سرمایه‌گذاری</button></div>{investments.length === 0 ? <Empty t={{noData:'سرمایه‌گذاری ثبت نشده است.'}}/> : <div className="investment-list investment-list-full">{investments.map(i=><article key={i.id}><div><b>{i.title_fa}</b><span>{investmentType(i.asset_type)} · {formatDate(i.acquisition_date, lang)}</span></div><strong>{formatMoney(i.current_estimated_value, lang)}</strong><div><button onClick={()=>onEditInvestment(i)}>ویرایش</button><button onClick={()=>onArchiveInvestment(i)}>آرشیو</button></div></article>)}</div>}</section>
  </div>;
}

function BankFlipCard({ account, lang, onEdit }) {
  const [flipped, setFlipped] = useState(false);
  const isBank = account.account_kind === 'bank';
  const cardNumber = account.card_number || 'ثبت نشده';
  const groupedCard = String(cardNumber).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  return <article className={`bank-flip-card ${flipped ? 'flipped' : ''} ${isBank ? 'bank' : 'cash'}`} onClick={() => setFlipped((v) => !v)} title="برای نمایش پشت کارت کلیک کنید">
    <div className="bank-card-inner">
      <div className="bank-card-face bank-card-front">
        <span>{isBank ? (account.bank_name || 'بانک') : 'صندوق'}</span>
        <b>{account.account_name}</b>
        <strong>{formatMoney(account.current_balance, lang)}</strong>
        <small>واریز {formatMoney(account.total_receipts, lang)} · برداشت {formatMoney(account.total_payments, lang)}</small>
        <em>{isBank ? 'کلیک برای مشخصات حساب' : 'گردش صندوق'}</em>
      </div>
      <div className="bank-card-face bank-card-back">
        <b>{account.account_holder_name || account.account_name}</b>
        <small>بانک: {account.bank_name || '—'}</small>
        <small>شماره کارت: <span dir="ltr">{groupedCard}</span></small>
        <small>شماره حساب: <span dir="ltr">{account.account_number || '—'}</span></small>
        <small>شبا: <span dir="ltr">{account.iban || '—'}</span></small>
        <small>شعبه: {account.branch_name || '—'}</small>
        <small>نوع: {account.account_usage === 'official' ? 'رسمی' : account.account_usage === 'unofficial' ? 'غیررسمی' : 'صندوق'}</small>
        {isBank && <button type="button" onClick={(e)=>{e.stopPropagation(); onEdit?.(account);}}>ویرایش اطلاعات</button>}
      </div>
    </div>
  </article>;
}

function ChecksSection({ checks, accounts, lang, busy, onNewCheck, onSettle, onChangeStatus }) {
  const [filters, setFilters] = useState({ status: 'all', type: 'all', q: '' });
  const [settle, setSettle] = useState(null);
  const filtered = checks.filter((c) => (filters.status === 'all' || c.status === filters.status) && (filters.type === 'all' || c.check_type === filters.type) && (!filters.q || `${c.check_number || ''} ${c.owner_name || ''} ${c.bank_name || ''}`.includes(filters.q)));
  return <section className="finance-card checks-workspace"><div className="finance-card-header between"><CardHeader icon={WalletCards} title="چک‌ها" bare /><button className="mini-btn" onClick={onNewCheck}>＋ ثبت چک</button></div><div className="toolbar-line"><select value={filters.type} onChange={(e)=>setFilters({...filters,type:e.target.value})}><option value="all">همه نوع‌ها</option><option value="received">دریافتی</option><option value="issued">پرداختی</option></select><select value={filters.status} onChange={(e)=>setFilters({...filters,status:e.target.value})}><option value="all">همه وضعیت‌ها</option>{['in_hand','deposited','cleared','returned','issued','cancelled'].map(st=><option key={st} value={st}>{STATUS_LABELS[st]?.[lang]||st}</option>)}</select><input value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})} placeholder="شماره/بانک/صاحب چک..." /></div><div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr><th>کد داخلی</th><th>نوع</th><th>شماره</th><th>بانک</th><th>صاحب</th><th>سررسید</th><th>مبلغ</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td dir="ltr">{c.internal_check_code||'—'}</td><td>{c.check_type==='received'?'دریافتی':'پرداختی'}</td><td dir="ltr">{c.check_number}</td><td>{c.bank_name||'—'}</td><td>{c.owner_name||'—'}</td><td>{formatDate(c.due_date, lang)}</td><td>{formatMoney(c.amount, lang)}</td><td><StatusBadge status={c.status} lang={lang}/></td><td className="actions-cell"><button disabled={busy} onClick={()=>setSettle(c)}>وصول/تسویه</button><select disabled={busy} value={c.status} onChange={(e)=>onChangeStatus(c.id,e.target.value)}>{['in_hand','deposited','cleared','returned','issued','cancelled'].map(st=><option key={st} value={st}>{STATUS_LABELS[st]?.[lang]||st}</option>)}</select></td></tr>)}</tbody></table></div>{settle&&<CheckSettleModal check={settle} accounts={accounts} busy={busy} onClose={()=>setSettle(null)} onSubmit={(payload)=>{setSettle(null);onSettle(payload)}} />}</section>;
}

function ItemKardexSection({ stock, rows, lastSales = [] }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const lastSaleByItem = useMemo(() => Object.fromEntries(lastSales.map((s) => [s.warehouse_item_id, s])), [lastSales]);
  const groups = useMemo(() => [...new Set(stock.map((i) => productionItemLabel(i)).filter(Boolean))], [stock]);
  const filteredStock = stock.filter(i => `${i.item_code||''} ${i.item_name_fa||''} ${i.category||''}`.toLowerCase().includes(query.toLowerCase()) && (group === 'all' || productionItemLabel(i) === group));
  const itemRows = rows.filter(r => r.item_id === selectedItem?.item_id);
  return <section className="finance-card"><CardHeader icon={PackageCheck} title="کاردکس کالاها - فقط مشاهده حسابداری" /><div className="toolbar-line"><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="جست‌وجوی کالا..."/><select value={group} onChange={(e)=>setGroup(e.target.value)}><option value="all">همه گروه‌ها</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select></div><div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>کد</th><th>کالا</th><th>گروه</th><th>موجودی</th><th>قیمت مرجع</th><th>آخرین فروش</th><th>عملیات</th></tr></thead><tbody>{filteredStock.map(i=>{const sale=lastSaleByItem[i.item_id]; return <tr key={i.item_id} className="clickable-row" onClick={()=>setSelectedItem(i)}><td dir="ltr">{i.item_code}</td><td>{i.item_name_fa}</td><td>{productionItemLabel(i)}</td><td>{formatNumber(i.current_qty || i.available_for_sale_qty, 'fa')} {i.unit}</td><td>{formatMoney(i.unit_price_estimate, 'fa')}</td><td>{sale ? formatMoney(sale.last_sale_unit_price, 'fa') : '—'}</td><td><button className="mini-btn" onClick={(e)=>{e.stopPropagation();setSelectedItem(i);}}>نمایش کاردکس</button></td></tr>})}</tbody></table></div>{selectedItem && <div className="finance-detail-modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&setSelectedItem(null)}><div className="finance-detail-modal kardex-modal"><header className="kardex-modal-head"><div><span className="detail-eyebrow">کاردکس کالا</span><h2>{selectedItem.item_code} · {selectedItem.item_name_fa}</h2><p>موجودی: {formatNumber(selectedItem.current_qty || selectedItem.available_for_sale_qty, 'fa')} {selectedItem.unit} · قیمت مرجع: {formatMoney(selectedItem.unit_price_estimate, 'fa')}</p></div><button className="detail-close-btn" onClick={()=>setSelectedItem(null)}>×</button></header>{itemRows.length ? <div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr><th>تاریخ</th><th>سند</th><th>نوع</th><th>مقدار</th><th>مانده</th><th>مشتری/خریدار</th><th>قیمت/ارزش</th><th>شرح</th></tr></thead><tbody>{itemRows.map(r=><tr key={r.tx_id}><td>{formatDate(r.created_at, 'fa')}</td><td dir="ltr">{r.doc_number||'—'}</td><td>{r.direction==='out'?'خروج':'ورود'}</td><td>{formatNumber(r.quantity,'fa')}</td><td>{formatNumber(r.running_balance,'fa')}</td><td>{r.customer_name || r.party_name || '—'}</td><td>{r.unit_price ? formatMoney(r.unit_price, 'fa') : r.line_total ? formatMoney(r.line_total, 'fa') : '—'}</td><td>{r.note||'—'}</td></tr>)}</tbody></table></div> : <Empty t={{noData:'کاردکسی برای این کالا ثبت نشده است.'}}/>}</div></div>}</section>;
}

function FinanceConfirmModal({ action, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return <FinanceModal title={action.title} onClose={onClose}><div className="confirm-finance"><p>{action.message}</p><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="دلیل/شرح عملیات..." autoFocus/><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>تأیید</button></div></div></FinanceModal>;
}

function CheckSettleModal({ check, accounts, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ bankAccountId: accounts[0]?.id || '', status: 'cleared', note: '' });
  return <FinanceModal title="وصول/تسویه چک" onClose={onClose}><div className="form-grid finance-form-grid"><label className="finance-field"><span>چک</span><input readOnly value={`${check.check_number} · ${formatMoney(check.amount,'fa')}`} /></label><label className="finance-field"><span>حساب مقصد/مبدأ</span><select value={form.bankAccountId} onChange={(e)=>setForm({...form,bankAccountId:e.target.value})}>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_name} · {a.bank_name}</option>)}</select></label><label className="finance-field"><span>وضعیت</span><select value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="deposited">خوابانده‌شده</option><option value="cleared">پاس/وصول‌شده</option><option value="returned">برگشتی</option><option value="cancelled">لغو</option></select></label><label className="finance-field full"><span>شرح</span><textarea value={form.note} onChange={(e)=>setForm({...form,note:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !form.bankAccountId} onClick={()=>onSubmit({checkId:check.id,bankAccountId:form.bankAccountId,status:form.status,note:form.note})}>ثبت وضعیت چک</button></div></FinanceModal>;
}

function InvestmentModal({ initial, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ asset_type: initial?.asset_type || 'gold', title_fa: initial?.title_fa || '', acquisition_date: initial?.acquisition_date || new Date().toISOString().slice(0,10), quantity: initial?.quantity || 1, unit: initial?.unit || 'عدد', purchase_amount: initial?.purchase_amount || 0, current_estimated_value: initial?.current_estimated_value || initial?.purchase_amount || 0, location: initial?.location || '', notes: initial?.notes || '', status: initial?.status || 'active' });
  return <FinanceModal title={initial?'ویرایش سرمایه‌گذاری':'ثبت سرمایه‌گذاری'} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>نوع</span><select value={form.asset_type} onChange={(e)=>setForm({...form,asset_type:e.target.value})}><option value="gold">طلا</option><option value="silver">نقره</option><option value="land">زمین</option><option value="currency">ارز</option><option value="equipment">تجهیزات</option><option value="stock">سهام</option><option value="other">سایر</option></select></label><label className="finance-field"><span>عنوان</span><input value={form.title_fa} onChange={(e)=>setForm({...form,title_fa:e.target.value})} /></label><label className="finance-field"><span>تاریخ خرید</span><JalaliDateInput value={form.acquisition_date} onChange={(v)=>setForm({...form,acquisition_date:v})}/></label><label className="finance-field"><span>مقدار</span><input type="number" value={form.quantity} onChange={(e)=>setForm({...form,quantity:e.target.value})}/></label><label className="finance-field"><span>واحد</span><input value={form.unit} onChange={(e)=>setForm({...form,unit:e.target.value})}/></label><label className="finance-field"><span>مبلغ خرید ریال</span><input type="number" value={form.purchase_amount} onChange={(e)=>setForm({...form,purchase_amount:e.target.value})}/></label><label className="finance-field"><span>ارزش روز ریال</span><input type="number" value={form.current_estimated_value} onChange={(e)=>setForm({...form,current_estimated_value:e.target.value})}/></label><label className="finance-field"><span>محل نگهداری</span><input value={form.location} onChange={(e)=>setForm({...form,location:e.target.value})}/></label><label className="finance-field full"><span>یادداشت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !form.title_fa} onClick={()=>onSubmit(form)}>ذخیره</button></div></FinanceModal>;
}


function BankAccountModal({ initial, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({
    account_name: initial?.account_name || '',
    bank_name: initial?.bank_name || '',
    account_number: initial?.account_number || '',
    card_number: initial?.card_number || '',
    iban: initial?.iban || '',
    branch_name: initial?.branch_name || '',
    account_holder_name: initial?.account_holder_name || '',
    account_usage: initial?.account_usage === 'cash' ? 'official' : (initial?.account_usage || 'official'),
    opening_balance: initial?.opening_balance || 0,
    currency: initial?.currency || 'IRR',
    notes: initial?.notes || '',
    is_active: initial?.is_active !== false,
  });
  function submit(e) {
    e.preventDefault();
    onSubmit(form);
  }
  return <FinanceModal title={initial ? 'ویرایش حساب / کارت بانکی' : 'افزودن حساب / کارت بانکی'} onClose={onClose}><form onSubmit={submit}><div className="finance-form-grid"><label className="finance-field"><span>عنوان حساب/کارت</span><input value={form.account_name} onChange={(e)=>setForm({...form,account_name:e.target.value})} placeholder="مثلاً حساب بانک ملی شرکت" required /></label><label className="finance-field"><span>نام بانک</span><input value={form.bank_name} onChange={(e)=>setForm({...form,bank_name:e.target.value})} placeholder="بانک ایران، ملی، صادرات..." /></label><label className="finance-field"><span>صاحب حساب</span><input value={form.account_holder_name} onChange={(e)=>setForm({...form,account_holder_name:e.target.value})} placeholder="نام صاحب حساب" /></label><label className="finance-field"><span>نوع حساب</span><select value={form.account_usage} onChange={(e)=>setForm({...form,account_usage:e.target.value})}><option value="official">رسمی</option><option value="unofficial">غیررسمی / داخلی</option></select></label><label className="finance-field"><span>شماره کارت</span><input dir="ltr" value={form.card_number} onChange={(e)=>setForm({...form,card_number:e.target.value})} placeholder="---- ---- ---- ----" /></label><label className="finance-field"><span>شماره حساب</span><input dir="ltr" value={form.account_number} onChange={(e)=>setForm({...form,account_number:e.target.value})} /></label><label className="finance-field"><span>شماره شبا</span><input dir="ltr" value={form.iban} onChange={(e)=>setForm({...form,iban:e.target.value})} placeholder="IR..." /></label><label className="finance-field"><span>شعبه</span><input value={form.branch_name} onChange={(e)=>setForm({...form,branch_name:e.target.value})} /></label><label className="finance-field"><span>مانده اول دوره ریال</span><input type="number" value={form.opening_balance} onChange={(e)=>setForm({...form,opening_balance:e.target.value})} /></label><label className="finance-field"><span>ارز</span><select value={form.currency} onChange={(e)=>setForm({...form,currency:e.target.value})}><option value="IRR">ریال</option><option value="USD">دلار</option><option value="EUR">یورو</option><option value="AED">درهم</option></select></label><label className="finance-field"><span>وضعیت</span><select value={form.is_active ? 'true' : 'false'} onChange={(e)=>setForm({...form,is_active:e.target.value === 'true'})}><option value="true">فعال</option><option value="false">غیرفعال</option></select></label><label className="finance-field full"><span>یادداشت / اطلاعات تکمیلی</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} placeholder="اطلاعات کارت‌خوان، توضیح حساب، محدودیت استفاده و..." /></label></div><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy || !form.account_name.trim()}>{busy ? 'در حال ذخیره...' : 'ذخیره حساب/کارت'}</button></div></form></FinanceModal>;
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
  const [editing, setEditing] = useState(null);
  function saveRule() {
    if (!editing) return;
    onUpdateNumbering(editing.rule_key, { prefix: editing.prefix, padding: Number(editing.padding || 5), separator: editing.separator || '-' });
    setEditing(null);
  }
  return <div className="accounting-grid two"><section className="finance-card"><CardHeader icon={Settings} title="تنظیمات و شماره‌گذاری مرکزی" />{numbering.length === 0 ? <Empty t={{ noData: 'قواعد شماره‌گذاری هنوز اجرا نشده‌اند.' }} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr><th>عنوان</th><th>پیشوند</th><th>دوره</th><th>آخرین شماره</th><th>شماره بعدی</th><th>عملیات</th></tr></thead><tbody>{numbering.map((r) => <tr key={r.rule_key}><td>{lang === 'fa' ? r.label_fa : r.label_en}</td><td dir="ltr">{r.prefix}</td><td>{r.reset_scope}</td><td>{r.current_counter}</td><td dir="ltr"><b>{r.next_number_preview}</b></td><td><button className="mini-btn" disabled={busy} onClick={() => setEditing({ ...r })}>تنظیم</button></td></tr>)}</tbody></table></div>}{editing && <div className="numbering-editor"><h3>ویرایش شماره‌گذاری</h3><label><span>پیشوند</span><input value={editing.prefix} onChange={(e)=>setEditing({...editing,prefix:e.target.value})}/></label><label><span>تعداد رقم</span><input type="number" value={editing.padding} onChange={(e)=>setEditing({...editing,padding:e.target.value})}/></label><label><span>جداکننده</span><input value={editing.separator} onChange={(e)=>setEditing({...editing,separator:e.target.value})}/></label><div><button onClick={()=>setEditing(null)}>انصراف</button><button disabled={busy} onClick={saveRule}>ذخیره</button></div></div>}</section><section className="finance-card"><div className="finance-card-header between"><CardHeader icon={FileText} title="اسناد ورودی / خروجی" bare /><div className="actions-cell"><button disabled={busy} onClick={() => onAddIo('incoming')}>＋ ورودی</button><button disabled={busy} onClick={() => onAddIo('outgoing')}>＋ خروجی</button></div></div>{ioDocuments.length === 0 ? <Empty t={{ noData: 'سند ورودی/خروجی ثبت نشده است.' }} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>تاریخ</th></tr></thead><tbody>{ioDocuments.map((d) => <tr key={d.id}><td dir="ltr">{d.io_number}</td><td>{d.io_type === 'incoming' ? 'ورودی' : 'خروجی'}</td><td>{d.title_fa}</td><td>{formatDate(d.registered_at, lang)}</td></tr>)}</tbody></table></div>}</section></div>;
}

function ProfitCard({ rows, lang, t, full, onAddCost }) {
  return <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={BarChart3} title="سود و زیان سفارش‌ها" bare />{full && <span className="finance-note">هزینه‌ها از تولید، R&D، خرید/هزینه و هزینه دستی سفارش جمع می‌شوند.</span>}</div>{rows.length === 0 ? <Empty t={t} /> : <div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr><th>سفارش</th><th>مشتری</th><th>درآمد</th><th>هزینه</th><th>سود</th><th>حاشیه</th>{full && <th>هزینه دستی</th>}</tr></thead><tbody>{rows.map((r) => <tr key={r.order_id}><td dir="ltr">{r.order_code}</td><td>{r.company_name || r.title_fa}</td><td>{formatMoney(r.revenue_before_tax, lang)}</td><td>{formatMoney(r.cost_before_tax, lang)}</td><td className={Number(r.gross_profit) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.gross_profit, lang)}</td><td>{r.gross_margin_pct == null ? '—' : `${formatNumber(r.gross_margin_pct, lang)}٪`}</td>{full && <td><button className="mini-btn" onClick={() => onAddCost?.(r)}>ثبت هزینه</button></td>}</tr>)}</tbody></table>{full && <p className="finance-note">برای ثبت هزینه‌های مستقیم مثل حمل، بسته‌بندی، دستمزد یا اصلاح تولید، روی «ثبت هزینه» همان سفارش بزنید.</p>}</div>}</section>;
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
function nextSort(current, key) { return { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }; }
function sortRows(rows, sort) {
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a,b)=>{
    const av = a?.[sort.key] ?? '';
    const bv = b?.[sort.key] ?? '';
    const an = Number(av); const bn = Number(bv);
    if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return (an-bn)*dir;
    return String(av).localeCompare(String(bv), 'fa') * dir;
  });
}
function investmentType(type) { return ({ gold: 'طلا', silver: 'نقره', land: 'زمین', currency: 'ارز', equipment: 'تجهیزات', stock: 'سهام', other: 'سایر' }[type] || type); }
function productionItemLabel(item) { return (item.category === 'Finished' || item.item_group === 'Finished') ? 'تولید شده‌ها' : (item.item_group || item.category || 'کالا'); }
function formatNumber(value, lang) { return new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function formatMoney(value, lang) { return formatToman(value, lang); }
function formatDate(value) { return formatJalaliDate(value); }
function PartyModal({ busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ party_type: 'customer', display_name: '', phone: '', email: '', address: '', opening_balance: 0, notes: '' });
  return <FinanceModal title="ثبت شخص جدید" onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>نوع شخص</span><select value={form.party_type} onChange={(e)=>setForm({...form,party_type:e.target.value})}><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="employee">کارمند</option><option value="shareholder">سهامدار</option><option value="other">سایر</option></select></label><label className="finance-field"><span>نام</span><input value={form.display_name} onChange={(e)=>setForm({...form,display_name:e.target.value})} required/></label><label className="finance-field"><span>تلفن</span><input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label><label className="finance-field"><span>ایمیل</span><input value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label><label className="finance-field"><span>مانده اول دوره</span><input type="number" value={form.opening_balance} onChange={(e)=>setForm({...form,opening_balance:e.target.value})}/></label><label className="finance-field full"><span>آدرس</span><textarea value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></label><label className="finance-field full"><span>یادداشت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !form.display_name.trim()} onClick={()=>onSubmit(form)}>ثبت شخص</button></div></FinanceModal>;
}

function OrderCostModal({ order, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ related_order_id: order?.order_id || order?.id || '', cost_type: 'other', amount: 0, notes: '' });
  return <FinanceModal title={`ثبت هزینه سفارش ${order?.order_code || ''}`} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>سفارش</span><input readOnly value={`${order?.order_code || '—'} · ${order?.company_name || order?.title_fa || ''}`}/></label><label className="finance-field"><span>نوع هزینه</span><select value={form.cost_type} onChange={(e)=>setForm({...form,cost_type:e.target.value})}><option value="material">متریال</option><option value="labor">دستمزد</option><option value="overhead">سربار</option><option value="purchase">خرید</option><option value="rnd">R&D</option><option value="warehouse">انبار</option><option value="shipping">حمل</option><option value="other">سایر</option></select></label><label className="finance-field"><span>مبلغ ریال</span><input type="number" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})}/></label><label className="finance-field full"><span>شرح</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || Number(form.amount)<=0} onClick={()=>onSubmit(form)}>ثبت هزینه سفارش</button></div></FinanceModal>;
}

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
  openOfficialFinancePrint({
    title: `${docLabel(d.document_type, lang)} ${d.doc_number}`,
    reportLabel: docLabel(d.document_type, lang),
    subtitle: 'بوشهر، بهمنی، نخلج فارس، پردیس فناوری',
    body: `<div class="section-label">خلاصه سند</div><section class="box-row"><div class="box-grid four"><div class="field"><b>شماره:</b><br><span dir="ltr">${htmlSafe(d.doc_number)}</span></div><div class="field"><b>شخص:</b> ${htmlSafe(d.party_name || '—')}</div><div class="field"><b>سفارش:</b> ${htmlSafe(d.order_code || '—')}</div><div class="field"><b>وضعیت:</b> ${STATUS_LABELS[d.status]?.[lang] || d.status}</div></div></section><section class="statement-summary"><div><span>مبلغ</span><strong class="money">${formatRial(d.total_amount)}</strong></div><div><span>پرداخت</span><strong class="money">${formatRial(d.paid_amount)}</strong></div><div><span>مانده</span><strong class="money">${formatRial(d.balance_amount)}</strong></div><div><span>مبلغ به حروف</span><strong>${rialToPersianWords(d.total_amount)}</strong></div></section><section class="signatures"><span>امضاء فروشنده</span><span>امضاء مالی</span><span>مهر شرکت</span></section>`,
  });
}
function htmlSafe(value) {
  return String(value ?? '').replace(/[&<>\"]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    return '&quot;';
  });
}
function printStatement(party, rows, lang) {
  const totalDebit = rows.reduce((sum, r) => sum + Number(r.debit_amount || 0), 0);
  const totalCredit = rows.reduce((sum, r) => sum + Number(r.credit_amount || 0), 0);
  const lastBalance = rows.length ? Number(rows[rows.length - 1].running_balance || 0) : Number(party.balance || 0);
  const bodyRows = rows.map((r, index) => {
    const balance = Number(r.running_balance || 0);
    return `<tr class="${index % 2 === 1 ? 'alt' : ''}"><td>${index + 1}</td><td>${formatDate(r.entry_date, lang)}</td><td class="desc">${htmlSafe(r.description || entryTypeLabel(r.entry_type, lang))}</td><td class="money">${Number(r.debit_amount || 0) ? formatRial(r.debit_amount) : '۰'}</td><td class="money">${Number(r.credit_amount || 0) ? formatRial(r.credit_amount) : '۰'}</td><td class="status-cell">${balance >= 0 ? 'بدهکار' : 'بستانکار'}</td><td class="money">${formatRial(Math.abs(balance))}</td><td dir="ltr">${htmlSafe(r.ref_number || '—')}</td></tr>`;
  }).join('');

  openOfficialFinancePrint({
    title: `صورت‌حساب ${party.display_name}`,
    reportLabel: `صورت حساب ${party.display_name}`,
    subtitle: 'بوشهر، بهمنی، نخلج فارس، پردیس فناوری',
    body: `
      <section class="box-row">
        <div class="box-grid four">
          <div class="field"><b>کد:</b> ${htmlSafe(String(party.party_id || '').slice(0, 8) || '—')}</div>
          <div class="field"><b>عنوان:</b> ${htmlSafe(party.display_name || '—')}</div>
          <div class="field"><b>نوع شخص:</b> ${partyTypeLabel(party.party_type, lang)}</div>
          <div class="field"><b>تلفن:</b> ${htmlSafe(party.phone || party.email || '—')}</div>
        </div>
      </section>
      <section class="statement-summary">
        <div><span>جمع بدهکار</span><strong class="money">${formatRial(totalDebit)}</strong></div>
        <div><span>جمع بستانکار</span><strong class="money">${formatRial(totalCredit)}</strong></div>
        <div><span>تشخیص نهایی</span><strong>${lastBalance >= 0 ? 'بدهکار' : 'بستانکار'}</strong></div>
        <div><span>مانده نهایی</span><strong class="money">${formatRial(Math.abs(lastBalance))}</strong></div>
      </section>
      <table class="official-table">
        <thead><tr><th>ردیف</th><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>تشخیص</th><th>مانده</th><th>شماره</th></tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="8">گردشی برای این شخص ثبت نشده است.</td></tr>'}</tbody>
      </table>
      <div class="continued">${rows.length > 18 ? 'ادامه دارد ...' : ''}</div>
      <div class="notes-box"><b>مانده به حروف:</b> ${rialToPersianWords(Math.abs(lastBalance))} ${lastBalance >= 0 ? 'بدهکار می‌باشد.' : 'بستانکار می‌باشد.'}</div>
      <section class="signatures"><span>امضاء حسابداری</span><span>امضاء تأییدکننده</span><span>مهر شرکت</span></section>
    `,
  });
}
