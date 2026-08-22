import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardList,
  Edit3,
  FileText,
  Link2,
  ListChecks,
  Printer,
  PackageCheck,
  Search,
  RefreshCcw,
  RotateCcw,
  Settings,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAccountingData, useFinanceDocumentBundle, usePartyStatement } from '../../hooks/useAccountingData';
import { useAuth } from '../../auth/AuthProvider';
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
  getFinancePrintSettings,
  saveFinancePrintSettings,
  DEFAULT_FINANCE_PRINT_SETTINGS,
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
  updateFinanceParty,
  archiveFinanceParty,
  createFinancePartiesBulk,
  createFinanceOrderCost,
  createFinanceLoan,
  updateFinanceLoan,
  archiveFinanceLoan,
  createFinancePayrollEmployee,
  updateFinancePayrollEmployee,
  archiveFinancePayrollEmployee,
  saveFinancePayrollSlip,
  archiveFinancePayrollSlip,
  registerFinancePayrollPayment,
  markFinanceLoanInstallmentPaid,
  createFinanceBankAccount,
  updateFinanceBankAccount,
  archiveFinanceBankAccount,
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
      payroll: 'حقوق و دستمزد',
      loans: 'وام‌ها',
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
    monthSales: 'دریافت‌های ماه',
    monthCosts: 'پرداخت‌های ماه',
    monthProfit: 'خالص گردش ماه',
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
    tabs: { overview: 'Overview', documents: 'Invoices', parties: 'Parties', cashflow: 'Cash & Bank', checks: 'Checks', itemKardex: 'Item Kardex', profitability: 'Order Profit', payroll: 'Payroll', loans: 'Loans', fiscal: 'Fiscal', referrals: 'Referrals', settings: 'Settings' },
    loading: 'Loading finance data...',
    error: 'Finance data failed to load. Finance migrations may not be applied yet.',
    noData: 'No data yet.',
    receivable: 'Receivables', payable: 'Payables', overdue: 'Overdue', monthSales: 'Month receipts', monthCosts: 'Month payments', monthProfit: 'Month net cashflow', openReferrals: 'Open referrals',
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
  pending: { fa: 'در انتظار', en: 'Pending' },
  overdue: { fa: 'عقب‌افتاده', en: 'Overdue' },
};

export default function AccountingModule({ lang = 'fa' }) {
  const { profile } = useAuth();
  const userRoles = [...new Set([profile?.role, ...(profile?.additional_roles || [])].filter(Boolean))];
  const isAdmin = userRoles.includes('admin');
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const [tab, setTab] = useState('overview');
  const [partyFilter, setPartyFilter] = useState('all');
  const [statementFlowFilter, setStatementFlowFilter] = useState('all');
  const [selectedPartyId, setSelectedPartyId] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [statementDetail, setStatementDetail] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [investmentModal, setInvestmentModal] = useState(null);
  const [partyModal, setPartyModal] = useState(null);
  const [partyDeleteModal, setPartyDeleteModal] = useState(null);
  const [partyImportModal, setPartyImportModal] = useState(false);
  const [orderCostModal, setOrderCostModal] = useState(null);
  const [loanModal, setLoanModal] = useState(null);
  const [loanDeleteModal, setLoanDeleteModal] = useState(null);
  const [loanPaymentModal, setLoanPaymentModal] = useState(null);
  const [payrollEmployeeModal, setPayrollEmployeeModal] = useState(null);
  const [payrollSlipModal, setPayrollSlipModal] = useState(null);
  const [payrollDeleteModal, setPayrollDeleteModal] = useState(null);
  const [payrollPaymentModal, setPayrollPaymentModal] = useState(null);
  const [accountModal, setAccountModal] = useState(null);
  const [accountDeleteModal, setAccountDeleteModal] = useState(null);

  const data = useAccountingData();
  const selectedParty = useMemo(() => data.parties.find((p) => p.party_id === selectedPartyId), [data.parties, selectedPartyId]);
  const statement = usePartyStatement(selectedPartyId, statementFlowFilter);
  const documentBundle = useFinanceDocumentBundle(selectedDocumentId);
  const modalDocumentId = typeof modal === 'object' && modal?.type === 'document' ? modal.documentId : null;
  const editDocumentBundle = useFinanceDocumentBundle(modalDocumentId);
  const statementDocumentBundle = useFinanceDocumentBundle(statementDetail?.type === 'document' ? statementDetail.documentId : null);
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
      setPartyDeleteModal(null);
      setPartyImportModal(false);
      setOrderCostModal(null);
      setLoanModal(null);
      setLoanDeleteModal(null);
      setLoanPaymentModal(null);
      setPayrollEmployeeModal(null);
      setPayrollSlipModal(null);
      setPayrollDeleteModal(null);
      setPayrollPaymentModal(null);
      setAccountModal(null);
      setAccountDeleteModal(null);
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
        message: 'این فاکتور قبلاً تأیید یا سند حسابداری آن ثبت شده است. با تأیید شما، سند حسابداری قبلی باطل و سند جدید براساس اطلاعات اصلاح‌شده ثبت می‌شود؛ سند خروج انبار قبلی هم لغو و سند جدید صادر می‌شود. دلیل اصلاح را وارد کنید.',
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

  const monthlyCashflow = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    return (data.paymentLedger || []).reduce((acc, row) => {
      if (row.status && row.status !== 'confirmed') return acc;
      const day = String(row.payment_date || row.created_at || '').slice(0, 10);
      if (!day || day < monthStart) return acc;
      if (row.direction === 'receipt') acc.receipts += Number(row.amount || 0);
      if (row.direction === 'payment') acc.payments += Number(row.amount || 0);
      return acc;
    }, { receipts: 0, payments: 0 });
  }, [data.paymentLedger]);
  const monthlyNetCashflow = monthlyCashflow.receipts - monthlyCashflow.payments;

  const kpis = [
    { label: t.receivable, value: data.dashboard.receivable_total, icon: ArrowDownLeft, accent: 'green', target: 'documents' },
    { label: t.payable, value: data.dashboard.payable_total, icon: ArrowUpRight, accent: 'red', target: 'documents' },
    { label: t.overdue, value: data.dashboard.overdue_total, icon: Banknote, accent: 'amber', target: 'documents' },
    { label: t.monthSales, value: monthlyCashflow.receipts, icon: BarChart3, accent: 'green', target: 'cashflow' },
    { label: t.monthCosts, value: monthlyCashflow.payments, icon: WalletCards, accent: 'red', target: 'cashflow' },
    { label: t.monthProfit, value: monthlyNetCashflow, icon: BookOpen, accent: Number(monthlyNetCashflow) >= 0 ? 'green' : 'red', target: 'cashflow' },
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
        const activeEditBundle = modalDocumentId ? editDocumentBundle : documentBundle;
        return (
          <FinanceModal title={modalTitle(modalType)} onClose={() => setModal(null)}>
            {modalType === 'document' && modalDocumentId && activeEditBundle.loading && <p className="muted">در حال دریافت اطلاعات فاکتور برای ویرایش...</p>}
            {modalType === 'document' && (!modalDocumentId || (!activeEditBundle.loading && activeEditBundle.document)) && <FinanceDocumentForm parties={data.parties} orders={data.orders} stock={data.stock} initialDocument={modalDocumentId ? activeEditBundle.document : null} initialItems={modalDocumentId ? activeEditBundle.items : []} busy={busy} onCancel={() => setModal(null)} onSubmit={submitDocument} />}
            {modalType === 'document' && modalDocumentId && !activeEditBundle.loading && activeEditBundle.error && <div className="accounting-message error">{getFriendlyErrorMessage(activeEditBundle.error, 'خطا در دریافت فاکتور برای ویرایش')}</div>}
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
      {partyModal && <PartyModal initial={partyModal.party} busy={busy} onClose={() => setPartyModal(null)} onDelete={(party) => { setPartyModal(null); setPartyDeleteModal({ party }); }} onSubmit={(payload) => runAction(() => partyModal.party ? updateFinanceParty(partyModal.party.party_id || partyModal.party.id, payload) : createFinanceParty(payload), partyModal.party ? 'اطلاعات شخص ویرایش شد.' : 'شخص جدید ثبت و با بانک مشتریان هماهنگ شد.')} />}
      {partyDeleteModal && <PartyDeleteModal party={partyDeleteModal.party} busy={busy} onClose={() => setPartyDeleteModal(null)} onConfirm={(reason) => runAction(() => archiveFinanceParty(partyDeleteModal.party.party_id || partyDeleteModal.party.id, reason), 'شخص مالی حذف/غیرفعال شد و از لیست خارج شد.')} />}
      {partyImportModal && <PartyImportModal busy={busy} onClose={() => setPartyImportModal(false)} onSubmit={(rows) => runAction(() => createFinancePartiesBulk(rows), `${rows.length} شخص از فایل اکسل ثبت شد.`)} />}
      {orderCostModal && <OrderCostModal order={orderCostModal.order} busy={busy} onClose={() => setOrderCostModal(null)} onSubmit={(payload) => runAction(() => createFinanceOrderCost(payload), 'هزینه سفارش ثبت شد و در سود سفارش لحاظ می‌شود.')} />}
      {loanModal && <LoanModal initial={loanModal.loan} busy={busy} onClose={() => setLoanModal(null)} onSubmit={(payload) => runAction(() => loanModal.loan ? updateFinanceLoan(loanModal.loan.id, payload) : createFinanceLoan(payload), loanModal.loan ? 'اطلاعات وام و اقساط باز ویرایش شد.' : 'وام و برنامه اقساط ثبت شد.')} />}
      {loanDeleteModal && <LoanDeleteModal loan={loanDeleteModal.loan} busy={busy} onClose={() => setLoanDeleteModal(null)} onConfirm={(reason) => runAction(() => archiveFinanceLoan(loanDeleteModal.loan.id, reason), 'وام حذف/بایگانی شد و از لیست فعال خارج شد.')} />}
      {payrollEmployeeModal && <PayrollEmployeeModal initial={payrollEmployeeModal.employee} busy={busy} onClose={() => setPayrollEmployeeModal(null)} onSubmit={(payload) => runAction(() => payrollEmployeeModal.employee ? updateFinancePayrollEmployee(payrollEmployeeModal.employee.id, payload) : createFinancePayrollEmployee(payload), payrollEmployeeModal.employee ? 'اطلاعات کارمند ویرایش شد.' : 'کارمند حقوق و دستمزد ثبت شد.')} />}
      {payrollSlipModal && <PayrollSlipModal initial={payrollSlipModal.slip} employee={payrollSlipModal.employee} employees={data.payrollEmployees || []} lines={data.payrollLines || []} slips={data.payrollSlips || []} busy={busy} onClose={() => setPayrollSlipModal(null)} onSubmit={(payload) => runAction(() => saveFinancePayrollSlip(payload), payrollSlipModal.slip ? 'فیش حقوقی ویرایش شد.' : 'فیش حقوقی ثبت شد.')} />}
      {payrollPaymentModal && <PayrollPaymentModal slip={payrollPaymentModal.slip} accounts={data.bankAccounts || []} cashboxes={data.cashboxes || []} busy={busy} onClose={() => setPayrollPaymentModal(null)} onSubmit={(payload) => runAction(() => registerFinancePayrollPayment(payload), 'سند پرداخت حقوق ثبت شد و مانده فیش کاهش یافت.')} />}
      {payrollDeleteModal && <PayrollDeleteModal item={payrollDeleteModal.item} kind={payrollDeleteModal.kind} busy={busy} onClose={() => setPayrollDeleteModal(null)} onConfirm={(reason) => runAction(() => payrollDeleteModal.kind === 'employee' ? archiveFinancePayrollEmployee(payrollDeleteModal.item.id, reason) : archiveFinancePayrollSlip(payrollDeleteModal.item.id, reason), payrollDeleteModal.kind === 'employee' ? 'کارمند حذف/غیرفعال شد.' : 'فیش حقوقی حذف/بایگانی شد.')} />}
      {loanPaymentModal && <LoanPaymentModal installment={loanPaymentModal.installment} payments={data.payments} busy={busy} onClose={() => setLoanPaymentModal(null)} onSubmit={(payload) => runAction(() => markFinanceLoanInstallmentPaid(payload), 'پرداخت قسط وام ثبت شد.')} />}
      {accountModal && <BankAccountModal initial={accountModal.account} busy={busy} onClose={() => setAccountModal(null)} onSubmit={(payload) => runAction(() => accountModal.account ? updateFinanceBankAccount(accountModal.account.id || accountModal.account.account_id, payload) : createFinanceBankAccount(payload), accountModal.account ? 'اطلاعات حساب/کارت ویرایش شد.' : 'حساب/کارت بانکی اضافه شد.')} />}
      {statementDetail?.type === 'document' && <div className="finance-detail-modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&setStatementDetail(null)}><div className="finance-detail-modal"><FinanceDocumentDetails bundle={statementDocumentBundle} loading={statementDocumentBundle.loading} busy={busy} onPost={(id) => runAction(() => postFinanceDocument(id), 'سند حسابداری فاکتور ثبت شد.')} onEdit={(id) => setModal({ type: 'document', documentId: id })} onConvert={(id) => runAction(() => convertProformaToInvoice(id), 'پیش‌فاکتور به فاکتور تبدیل شد.')} onVoid={(id) => setConfirmAction({ type: 'void', id, title: 'ابطال فاکتور', message: 'آیا از ابطال این سند مطمئن هستید؟' })} onReturn={(id) => setConfirmAction({ type: 'return', id, title: 'فاکتور برگشتی', message: 'دلیل فاکتور برگشتی را وارد کنید.' })} onNewPayment={(id) => setModal({ type: 'payment', documentId: id })} onNewReferral={(id) => setModal({ type: 'referral', documentId: id })} onClose={() => setStatementDetail(null)} /></div></div>}
      {statementDetail?.type === 'payment' && <PaymentDetailModal payment={statementDetail.payment} row={statementDetail.row} onClose={() => setStatementDetail(null)} />}
      {accountDeleteModal && <BankAccountDeleteModal account={accountDeleteModal.account} busy={busy} isAdmin={isAdmin} onClose={() => setAccountDeleteModal(null)} onConfirm={(reason) => runAction(() => archiveFinanceBankAccount(accountDeleteModal.account.id || accountDeleteModal.account.account_id, reason), 'حساب/کارت بانکی با تأیید مدیر غیرفعال شد.')} />}

      <nav className="accounting-tabs">
        {Object.entries(t.tabs).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {notice && <div className="accounting-message">{notice}</div>}
      {data.loading && <div className="accounting-message">{t.loading}</div>}
      {!data.loading && data.error && <div className="accounting-message error">{getFriendlyErrorMessage(data.error, t.error)}<br /><small dir="ltr">{getTechnicalErrorMessage(data.error)}</small></div>}

      {!data.loading && tab === 'overview' && <Overview kpis={kpis} dashboard={data.dashboard} docs={activeDocuments} profit={data.profitability} payments={data.paymentLedger} checks={data.checks} lang={lang} t={t} setTab={setTab} />}
      {!data.loading && tab === 'documents' && <DocumentsSection docs={activeDocuments} selectedDocument={selectedDocument} documentBundle={documentBundle} lang={lang} t={t} busy={busy} onSelect={setSelectedDocumentId} onCloseDetails={() => setSelectedDocumentId(null)} onPost={(id) => runAction(() => postFinanceDocument(id), 'سند حسابداری فاکتور ثبت شد.')} onEdit={(id) => setModal({ type: 'document', documentId: id })} onConvert={(id) => runAction(() => convertProformaToInvoice(id), 'پیش‌فاکتور به فاکتور تبدیل شد و به فاکتور فروش منتقل شد.')} onVoid={(id) => setConfirmAction({ type: 'void', id, title: 'ابطال فاکتور', message: 'آیا از ابطال این سند مطمئن هستید؟ بعد از ابطال از لیست فعال حذف می‌شود.' })} onReturn={(id) => setConfirmAction({ type: 'return', id, title: 'فاکتور برگشتی', message: 'دلیل و توضیح ایجاد فاکتور برگشتی را وارد کنید.' })} onNewPayment={(id) => setModal({ type: 'payment', documentId: id })} onNewReferral={(id) => setModal({ type: 'referral', documentId: id })} />}
      {!data.loading && tab === 'parties' && <PartiesSection parties={filteredParties} allParties={data.parties} payments={data.payments} filter={partyFilter} setFilter={setPartyFilter} selectedPartyId={selectedPartyId} setSelectedPartyId={setSelectedPartyId} selectedParty={selectedParty} statement={statement} statementFlowFilter={statementFlowFilter} setStatementFlowFilter={setStatementFlowFilter} lang={lang} t={t} onNewParty={() => setPartyModal({})} onEditParty={(party) => setPartyModal({ party })} onDeleteParty={(party) => setPartyDeleteModal({ party })} onImportParties={() => setPartyImportModal(true)} onDownloadTemplate={downloadPartyImportTemplate} onOpenStatementDocument={(documentId, row) => setStatementDetail({ type: 'document', documentId, row })} onOpenStatementPayment={(payment, row) => setStatementDetail({ type: 'payment', payment, row })} />}
      {!data.loading && tab === 'cashflow' && <CashFlowSection accounts={data.treasuryAccounts} bankAccounts={data.bankAccounts} ledger={data.paymentLedger} investments={data.investments} lang={lang} onNewPayment={() => setModal('payment')} onNewAccount={() => setAccountModal({})} onEditAccount={(account) => setAccountModal({ account })} onDeleteAccount={(account) => setAccountDeleteModal({ account })} isAdmin={isAdmin} onNewInvestment={() => setInvestmentModal({})} onEditInvestment={(item) => setInvestmentModal({ item })} onArchiveInvestment={(item) => runAction(() => archiveFinanceInvestment(item.id), 'سرمایه‌گذاری آرشیو شد.')} />}
      {!data.loading && tab === 'checks' && <ChecksSection checks={data.checks} parties={data.parties} accounts={data.bankAccounts} lang={lang} busy={busy} onNewCheck={() => setModal('check')} onSettle={(payload) => runAction(() => settleFinanceCheck(payload), 'وضعیت چک و گردش بانک ثبت شد.')} onChangeStatus={(id, status) => runAction(() => updateFinanceCheckStatus(id, status), 'وضعیت چک تغییر کرد.')} />}
      {!data.loading && tab === 'itemKardex' && <ItemKardexSection stock={data.stock} rows={data.itemKardex} lastSales={data.itemLastSales} lang={lang} />}
      {!data.loading && tab === 'profitability' && <ProfitCard rows={data.profitability} lang={lang} t={t} full onAddCost={(order) => setOrderCostModal({ order })} orderCosts={data.orderCosts} />}
      {!data.loading && tab === 'payroll' && <PayrollSection employees={data.payrollEmployees || []} slips={data.payrollSlips || []} lines={data.payrollLines || []} payments={data.payrollPayments || []} lang={lang} busy={busy} onNewEmployee={() => setPayrollEmployeeModal({})} onEditEmployee={(employee) => setPayrollEmployeeModal({ employee })} onDeleteEmployee={(employee) => setPayrollDeleteModal({ kind: 'employee', item: employee })} onNewSlip={(employee) => setPayrollSlipModal({ employee })} onEditSlip={(slip) => setPayrollSlipModal({ slip })} onPaySlip={(slip) => setPayrollPaymentModal({ slip })} onDeleteSlip={(slip) => setPayrollDeleteModal({ kind: 'slip', item: slip })} /> }
      {!data.loading && tab === 'loans' && <LoansSection loans={data.loans || []} installments={data.loanInstallments || []} payments={data.payments || []} lang={lang} busy={busy} onNewLoan={() => setLoanModal({})} onEditLoan={(loan) => setLoanModal({ loan })} onDeleteLoan={(loan) => setLoanDeleteModal({ loan })} onPayInstallment={(installment) => setLoanPaymentModal({ installment })} />}
      {!data.loading && tab === 'fiscal' && <FiscalSection fiscalYears={data.fiscalYears} fiscalPeriods={data.fiscalPeriods} lang={lang} busy={busy} onClosePeriod={(id) => runAction(() => closeFiscalPeriod(id), 'ماه مالی بسته شد.')} onReopenPeriod={(id) => runAction(() => reopenFiscalPeriod(id), 'ماه مالی بازگشایی شد.')} onCloseYear={(id) => runAction(() => closeFiscalYear(id), 'سال مالی بسته شد.')} onReopenYear={(id) => runAction(() => reopenFiscalYear(id), 'سال مالی بازگشایی شد.')} />}
      {!data.loading && tab === 'referrals' && <div className="accounting-grid"><ReferralPanel sourceModule="accounting" title="ارجاعات" defaultTarget="sales" /></div>}
      {!data.loading && tab === 'settings' && <SettingsSection numbering={data.numbering} ioDocuments={data.ioDocuments} lang={lang} busy={busy} onUpdateNumbering={(ruleKey, patch) => runAction(() => updateNumberingRule(ruleKey, patch), 'تنظیمات شماره‌گذاری ذخیره شد.')} onAddIo={(type) => runAction(() => createIoDocument({ io_type: type, title_fa: type === 'incoming' ? 'سند ورودی نمونه' : 'سند خروجی نمونه', source_module: 'accounting', status: 'registered' }), 'سند ورودی/خروجی ثبت شد.')} />}
    </div>
  );
}

function Overview({ kpis, docs, profit, payments, checks, lang, t, setTab }) {
  return <>
    <section className="finance-kpi-grid clickable-kpis">
      {kpis.map((kpi) => <button key={kpi.label} className="kpi-button" onClick={() => setTab(kpi.target || 'cashflow')}><FinanceKPI {...kpi} lang={lang} /></button>)}
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

function DocumentsSection({ docs, selectedDocument, documentBundle, lang, t, busy, onSelect, onCloseDetails, onPost, onEdit, onConvert, onVoid, onReturn, onNewPayment, onNewReferral }) {
  const proformas = docs.filter(d => d.document_type === 'sales_proforma' && !docs.some(inv => inv.converted_from_document_id === d.id && inv.status !== 'void'));
  const salesInvoices = docs.filter(d => ['sales_invoice', 'sales_return'].includes(d.document_type));
  const purchaseInvoices = docs.filter(d => ['purchase_invoice', 'purchase_return', 'expense_invoice'].includes(d.document_type));
  const otherDocs = docs.filter(d => !['sales_proforma','sales_invoice','sales_return','purchase_invoice','purchase_return','expense_invoice'].includes(d.document_type));
  const quickBundle = selectedDocument ? {
    ...documentBundle,
    document: documentBundle.document || selectedDocument,
    items: documentBundle.document ? documentBundle.items : [],
    payments: documentBundle.document ? documentBundle.payments : [],
    events: documentBundle.document ? documentBundle.events : [],
    referrals: documentBundle.document ? documentBundle.referrals : [],
    ioDocuments: documentBundle.document ? documentBundle.ioDocuments : [],
    party: documentBundle.document ? documentBundle.party : null,
    order: documentBundle.document ? documentBundle.order : null,
  } : documentBundle;
  return <div className="accounting-grid document-workspace finance-doc-split document-modal-workspace">
    <DocumentsCard title="پیش‌فاکتورهای فروش" docs={proformas} lang={lang} t={t} full kind="proforma" onSelect={onSelect} onEdit={onEdit} busy={busy} onConvert={onConvert} onVoid={onVoid} />
    <DocumentsCard title="فاکتورهای فروش" docs={salesInvoices} lang={lang} t={t} full kind="sales" onSelect={onSelect} onEdit={onEdit} busy={busy} onVoid={onVoid} onReturn={onReturn} />
    <DocumentsCard title="فاکتورهای خرید و هزینه" docs={purchaseInvoices} lang={lang} t={t} full kind="purchase" onSelect={onSelect} onEdit={onEdit} busy={busy} onVoid={onVoid} />
    {otherDocs.length > 0 && <DocumentsCard title="سایر اسناد مالی" docs={otherDocs} lang={lang} t={t} full kind="other" onSelect={onSelect} onEdit={onEdit} busy={busy} onVoid={onVoid} />}
    {selectedDocument && <div className="finance-detail-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCloseDetails?.()}><div className="finance-detail-modal"><FinanceDocumentDetails bundle={quickBundle} loading={documentBundle.loading} busy={busy} onPost={onPost} onEdit={onEdit} onConvert={onConvert} onVoid={onVoid} onReturn={onReturn} onNewPayment={onNewPayment} onNewReferral={onNewReferral} onClose={onCloseDetails} /></div></div>}
  </div>;
}

function DocumentsCard({ title, docs, lang, t, full, onSelect, onEdit, busy, onConvert, onVoid, onReturn }) {
  const [sort, setSort] = useState({ key: 'issue_date', dir: 'desc' });
  const rows = useMemo(() => sortRows(docs, sort), [docs, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <section className="finance-card invoice-list-card">
    <div className="finance-card-header between"><CardHeader icon={FileText} title={title} bare />{full && <button className="mini-btn" onClick={() => exportDocuments(rows, lang)}>{t.exportCsv}</button>}</div>
    {rows.length === 0 ? <Empty t={t} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr>{th('doc_number','شماره')}{th('issue_date','تاریخ')}{th('document_type','نوع')}{th('status','وضعیت')}{th('party_name','شخص')}{th('order_code','سفارش')}{th('total_amount','مبلغ')}{th('balance_amount','مانده')}{full && <th>عملیات</th>}</tr></thead><tbody>{rows.map((d) => <tr key={d.id} className={d.is_overdue ? 'overdue clickable-row' : 'clickable-row'} onClick={() => onSelect?.(d.id)}><td dir="ltr">{d.doc_number}</td><td>{formatDate(d.issue_date, lang)}</td><td>{docLabel(d.document_type, lang)}</td><td><StatusBadge status={d.status} lang={lang} /></td><td>{d.party_name || '—'}</td><td dir="ltr">{d.order_code || '—'}</td><td>{formatMoney(d.total_amount, lang)}</td><td className={Number(d.balance_amount) > 0 ? 'negative-soft' : 'positive'}>{formatMoney(d.balance_amount, lang)}</td>{full && <td className="actions-cell" onClick={(e)=>e.stopPropagation()}><button disabled={busy} onClick={() => onSelect?.(d.id)}>جزئیات</button><button disabled={busy || ['void','cancelled'].includes(d.status)} title={['draft','pending_approval'].includes(d.status) ? 'ویرایش پیش‌نویس' : 'اصلاح فاکتور تأییدشده و همگام‌سازی اسناد'} onClick={() => onEdit?.(d.id)}>{['draft','pending_approval'].includes(d.status) ? 'ویرایش' : 'اصلاح'}</button><button className="note-action" disabled={busy || ['void','cancelled'].includes(d.status)} title="ثبت / ویرایش جزئیات زیر فاکتور در چاپ" onClick={() => onEdit?.(d.id)}>📝 جزئیات</button>{d.document_type === 'sales_proforma' && <button disabled={busy} onClick={() => onConvert?.(d.id)}>تبدیل</button>}{d.document_type === 'sales_invoice' && <button disabled={busy} onClick={() => onReturn?.(d.id)}>برگشتی</button>}<button disabled={busy || d.status === 'void'} onClick={() => onVoid?.(d.id)}>ابطال</button><button onClick={() => printSimpleDocument(d, lang)}>PDF</button></td>}</tr>)}</tbody></table></div>}
  </section>;
}

function PartiesSection({ parties, allParties, payments = [], filter, setFilter, selectedPartyId, setSelectedPartyId, selectedParty, statement, statementFlowFilter, setStatementFlowFilter, lang, t, onNewParty, onEditParty, onDeleteParty, onImportParties, onDownloadTemplate, onOpenStatementDocument, onOpenStatementPayment }) {
  const [partySearch, setPartySearch] = useState('');
  const visibleParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) => `${p.display_name || ''} ${p.phone || ''} ${p.economic_code || ''} ${p.registration_number || ''} ${p.national_id || ''} ${p.postal_code || ''} ${p.address || ''}`.toLowerCase().includes(q));
  }, [parties, partySearch]);
  return <>
    <div className="accounting-grid two parties-layout">
      <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={Users} title="اشخاص مالی" bare /><div className="actions-cell party-import-actions"><button className="mini-btn" onClick={onNewParty}>＋ شخص جدید</button><button className="mini-btn" onClick={onDownloadTemplate}>قالب Excel</button><button className="mini-btn primary-soft" onClick={onImportParties}>ورود از Excel</button></div></div><div className="toolbar-line parties-toolbar"><input value={partySearch} onChange={(e)=>setPartySearch(e.target.value)} placeholder="جست‌وجوی نام، تلفن، کد اقتصادی، شناسه ملی..." autoComplete="off" /><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t.all}</option><option value="debtors">{t.debtors}</option><option value="creditors">{t.creditors}</option><option value="settled">{t.settled}</option></select></div>{visibleParties.length === 0 ? <Empty t={{ noData: partySearch ? 'شخصی با این جست‌وجو پیدا نشد.' : t.noData }} /> : <div className="party-list">{visibleParties.map((p) => <article key={p.party_id} className={selectedPartyId === p.party_id ? 'party-row active party-row-card' : 'party-row party-row-card'}><button type="button" className="party-main-btn" onClick={() => setSelectedPartyId(p.party_id)}><span><strong>{p.display_name}</strong><small>{partyTypeLabel(p.party_type, lang)} · {p.phone || p.economic_code || p.national_id || '—'}</small></span><b className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</b></button><div className="party-row-actions"><button type="button" onClick={() => onEditParty?.(p)}>ویرایش</button><button type="button" className="danger" onClick={() => onDeleteParty?.(p)}>حذف</button></div></article>)}</div>}</section>
      <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={BookOpen} title={selectedParty ? `صورت‌حساب: ${selectedParty.display_name}` : 'صورت‌حساب شخص'} bare />{selectedParty && <div className="actions-cell"><button className="mini-btn" onClick={() => printStatement(selectedParty, statement.rows, lang)}>{t.printPdf}</button><button className="mini-btn" onClick={() => exportStatement(selectedParty, statement.rows, lang)}>خروجی Excel</button></div>}</div><div className="toolbar-line"><select value={statementFlowFilter} onChange={(e) => setStatementFlowFilter(e.target.value)}><option value="all">{t.all}</option><option value="debit">{t.debitOnly}</option><option value="credit">{t.creditOnly}</option></select></div>{!selectedPartyId ? <p className="muted">{t.selectParty}</p> : statement.loading ? <p className="muted">{t.loading}</p> : statement.rows.length === 0 ? <Empty t={t} /> : <StatementTable rows={statement.rows} payments={payments} lang={lang} onOpenDocument={onOpenStatementDocument} onOpenPayment={onOpenStatementPayment} />}</section>
    </div>
    <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={ListChecks} title="لیست بدهکاران و بستانکاران" bare /><button className="mini-btn" onClick={() => exportBalances(allParties, filter, lang)}>{t.exportCsv}</button></div><BalanceTable parties={visibleParties} lang={lang} /></section>
  </>;
}


function StatementTable({ rows, payments = [], lang, onOpenDocument, onOpenPayment }) {
  const paymentById = useMemo(() => Object.fromEntries((payments || []).map((p) => [p.id, p])), [payments]);
  function openRow(row) {
    if (row.document_id) {
      onOpenDocument?.(row.document_id, row);
      return;
    }
    if (row.payment_id) {
      onOpenPayment?.(paymentById[row.payment_id] || null, row);
    }
  }
  return <div className="table-scroll"><table className="finance-table compact"><thead><tr><th>تاریخ</th><th>شماره</th><th>نوع</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>تشخیص</th><th>مانده</th><th>جزئیات</th></tr></thead><tbody>{rows.map((r, i) => { const clickable = Boolean(r.document_id || r.payment_id); return <tr key={`${r.ref_number}-${i}`} className={clickable ? 'clickable-row statement-clickable-row' : ''} onClick={() => clickable && openRow(r)}><td>{formatDate(r.entry_date, lang)}</td><td dir="ltr">{r.ref_number}</td><td>{entryTypeLabel(r.entry_type, lang)}</td><td>{r.description || '—'}</td><td>{formatMoney(r.debit_amount, lang)}</td><td>{formatMoney(r.credit_amount, lang)}</td><td>{Number(r.running_balance) >= 0 ? 'بدهکار' : 'بستانکار'}</td><td className={Number(r.running_balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.running_balance, lang)}</td><td>{clickable ? <button type="button" className="mini-btn" onClick={(e)=>{e.stopPropagation();openRow(r);}}>مشاهده</button> : '—'}</td></tr>; })}</tbody></table></div>;
}

function PaymentDetailModal({ payment, row, onClose }) {
  const direction = payment?.direction || row?.entry_type;
  const isReceipt = direction === 'receipt';
  const amount = payment?.amount ?? (isReceipt ? row?.credit_amount : row?.debit_amount);
  return <div className="finance-detail-modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><div className="finance-detail-modal payment-detail-modal"><section className="finance-card document-detail-card"><header className="detail-header"><div><span className="detail-eyebrow">{isReceipt ? 'سند دریافت' : 'سند پرداخت'}</span><h2 dir="ltr">{payment?.payment_number || row?.ref_number || '—'}</h2><p>{payment?.description || row?.description || 'بدون توضیح'}</p></div><div className="detail-header-actions"><span className={`status-badge ${payment?.status || 'confirmed'}`}>{payment?.status === 'draft' ? 'پیش‌نویس' : payment?.status === 'confirmed' ? 'تأیید شده' : payment?.status || 'ثبت‌شده'}</span><button type="button" className="detail-close-btn" onClick={onClose}>×</button></div></header><div className="detail-grid"><Info label="نوع" value={isReceipt ? 'دریافت / واریز' : 'پرداخت / برداشت'} /><Info label="تاریخ" value={formatDate(payment?.payment_date || row?.entry_date, 'fa')} /><Info label="مبلغ" value={formatMoney(amount, 'fa')} highlight /><Info label="حساب" value={payment?.account_name || '—'} /><Info label="بانک" value={payment?.bank_name || '—'} /><Info label="شخص" value={payment?.party_name || '—'} /><Info label="روش" value={payment?.method || '—'} /><Info label="شماره سفارش" value={payment?.order_code || '—'} /></div><div className="detail-block"><h3>شرح سند</h3><p className="muted">{payment?.description || row?.description || 'شرحی ثبت نشده است.'}</p></div></section></div></div>;
}

function BalanceTable({ parties, lang }) {
  const [sort, setSort] = useState({ key: 'balance', dir: 'desc' });
  const rows = useMemo(() => sortRows(parties.filter((p) => Number(p.balance) !== 0), sort), [parties, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <div className="table-scroll limited-list"><table className="finance-table"><thead><tr>{th('display_name','شخص')}{th('party_type','نوع')}{th('balance','وضعیت')}{th('total_debit','بدهکار')}{th('total_credit','بستانکار')}{th('balance','مانده')}</tr></thead><tbody>{rows.map((p) => <tr key={p.party_id}><td>{p.display_name}</td><td>{partyTypeLabel(p.party_type, lang)}</td><td>{Number(p.balance) > 0 ? 'بدهکار' : 'بستانکار'}</td><td>{Number(p.balance) > 0 ? formatMoney(p.balance, lang) : '—'}</td><td>{Number(p.balance) < 0 ? formatMoney(Math.abs(p.balance), lang) : '—'}</td><td className={Number(p.balance) >= 0 ? 'positive' : 'negative'}>{formatMoney(p.balance, lang)}</td></tr>)}</tbody></table></div>;
}

function CashFlowSection({ accounts, bankAccounts = [], ledger, investments, lang, onNewPayment, onNewAccount, onEditAccount, onDeleteAccount, isAdmin, onNewInvestment, onEditInvestment, onArchiveInvestment }) {
  const [filters, setFilters] = useState({ accountId: 'all', direction: 'all', from: '', to: '', q: '' });
  const [sort, setSort] = useState({ key: 'payment_date', dir: 'desc' });
  const detailsById = useMemo(() => Object.fromEntries((bankAccounts || []).map((a) => [a.id, a])), [bankAccounts]);
  const enrichedAccounts = useMemo(() => accounts.map((a) => ({ ...a, ...(detailsById[a.account_id] || {}) })).filter((a) => a.is_active !== false), [accounts, detailsById]);
  const filtered = useMemo(() => sortRows(ledger.filter((r) => (filters.accountId === 'all' || r.account_id === filters.accountId) && (filters.direction === 'all' || r.direction === filters.direction) && (!filters.from || r.payment_date >= filters.from) && (!filters.to || r.payment_date <= filters.to) && (!filters.q || `${r.payment_number || ''} ${r.party_name || ''} ${r.description || ''}`.includes(filters.q))), sort), [ledger, filters, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  return <div className="accounting-grid cashflow-layout finance-cashflow-full">
    <section className="finance-card cashflow-main-card full-width"><div className="finance-card-header between"><CardHeader icon={Banknote} title="صندوق و گردش حساب" bare /><div className="actions-cell"><button className="mini-btn" onClick={onNewAccount}>＋ افزودن حساب/کارت</button><button className="mini-btn" onClick={onNewPayment}>＋ دریافت/پرداخت</button></div></div><div className="cash-account-grid bank-card-grid">{enrichedAccounts.map((a) => <BankFlipCard key={`${a.account_kind}-${a.account_id}`} account={a} lang={lang} onEdit={onEditAccount} onDelete={onDeleteAccount} isAdmin={isAdmin} />)}</div><div className="toolbar-line"><select value={filters.accountId} onChange={(e)=>setFilters({...filters,accountId:e.target.value})}><option value="all">همه حساب‌ها</option>{enrichedAccounts.map(a=><option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}</select><select value={filters.direction} onChange={(e)=>setFilters({...filters,direction:e.target.value})}><option value="all">همه گردش‌ها</option><option value="receipt">واریزی</option><option value="payment">برداشت</option></select><input value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})} placeholder="جست‌وجوی شماره، شخص، شرح..." /></div><div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr>{th('payment_date','تاریخ')}{th('payment_number','شماره')}{th('account_name','حساب')}{th('party_name','شخص')}{th('direction','نوع')}{th('method','روش')}{th('amount','مبلغ')}<th>شرح</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{formatDate(r.payment_date, lang)}</td><td dir="ltr">{r.payment_number}</td><td>{r.account_name || '—'}</td><td>{r.party_name || '—'}</td><td className={r.direction==='receipt'?'receipt-text':'payment-text'}>{r.direction === 'receipt' ? 'واریز' : 'برداشت'}</td><td>{r.method}</td><td className={r.direction==='receipt'?'receipt-text':'payment-text'}>{formatMoney(r.amount, lang)}</td><td>{r.description || '—'}</td></tr>)}</tbody></table></div></section>
    <section className="finance-card investment-full-card full-width"><div className="finance-card-header between"><CardHeader icon={WalletCards} title="سرمایه‌گذاری‌ها" bare /><button className="mini-btn" onClick={onNewInvestment}>＋ سرمایه‌گذاری</button></div>{investments.length === 0 ? <Empty t={{noData:'سرمایه‌گذاری ثبت نشده است.'}}/> : <div className="investment-list investment-list-full">{investments.map(i=><article key={i.id}><div><b>{i.title_fa}</b><span>{investmentType(i.asset_type)} · {formatDate(i.acquisition_date, lang)}</span></div><strong>{formatMoney(i.current_estimated_value, lang)}</strong><div><button onClick={()=>onEditInvestment(i)}>ویرایش</button><button onClick={()=>onArchiveInvestment(i)}>آرشیو</button></div></article>)}</div>}</section>
  </div>;
}

function bankCardVariant(account) {
  const text = String(account.account_id || account.id || account.account_name || '0');
  const sum = [...text].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return (sum % 6) + 1;
}
function BankFlipCard({ account, lang, onEdit, onDelete, isAdmin }) {
  const [flipped, setFlipped] = useState(false);
  const isBank = account.account_kind === 'bank';
  const cardNumber = account.card_number || 'ثبت نشده';
  const groupedCard = String(cardNumber).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  const variant = bankCardVariant(account);
  return <article className={`bank-flip-card ${flipped ? 'flipped' : ''} ${isBank ? 'bank' : 'cash'} v${variant}`} onClick={() => setFlipped((v) => !v)} title="برای نمایش پشت کارت کلیک کنید">
    <div className="bank-card-inner">
      <div className="bank-card-face bank-card-front">
        <div className="bank-card-chip" />
        <span>{isBank ? (account.bank_name || 'بانک') : 'صندوق'}</span>
        <b>{account.account_name}</b>
        <strong>{formatMoney(account.current_balance, lang)}</strong>
        <small>واریز {formatMoney(account.total_receipts, lang)} · برداشت {formatMoney(account.total_payments, lang)}</small>
        {isBank && <div className="bank-front-actions"><button type="button" title="ویرایش کارت" aria-label="ویرایش کارت" onClick={(e)=>{e.stopPropagation(); onEdit?.(account);}}><Edit3 size={13} /></button><button type="button" className="danger" aria-label="حذف کارت" title={isAdmin ? 'حذف/غیرفعال‌سازی با تأیید مدیر' : 'حذف کارت فقط با دسترسی مدیر کل مجاز است'} onClick={(e)=>{e.stopPropagation(); onDelete?.(account);}}><Trash2 size={13} /></button></div>}
        <em>{isBank ? 'کلیک روی کارت برای مشخصات کامل' : 'گردش صندوق'}</em>
      </div>
      <div className="bank-card-face bank-card-back">
        <div className="bank-back-scroll">
          <b>{account.account_holder_name || account.account_name}</b>
          <small>بانک: <span>{account.bank_name || '—'}</span></small>
          <small>شماره کارت: <span dir="ltr">{groupedCard}</span></small>
          <small>شماره حساب: <span dir="ltr">{account.account_number || '—'}</span></small>
          <small className="iban-row">شبا: <span dir="ltr" className="iban-text">{account.iban || '—'}</span></small>
          <small>شعبه: <span>{account.branch_name || '—'}</span></small>
          <small>نوع: <span>{account.account_usage === 'official' ? 'رسمی' : account.account_usage === 'unofficial' ? 'غیررسمی' : 'صندوق'}</span></small>
          {account.notes && <small>یادداشت: <span>{account.notes}</span></small>}
        </div>
        <div className="bank-card-actions">
          {isBank && <button type="button" title="ویرایش کارت" aria-label="ویرایش کارت" onClick={(e)=>{e.stopPropagation(); onEdit?.(account);}}><Edit3 size={13} /><span>ویرایش</span></button>}
          {isBank && <button type="button" className="danger" aria-label="حذف کارت" title={isAdmin ? 'حذف/غیرفعال‌سازی با تأیید مدیر' : 'حذف کارت فقط با دسترسی مدیر کل مجاز است'} onClick={(e)=>{e.stopPropagation(); onDelete?.(account);}}><Trash2 size={13} /><span>حذف</span></button>}
        </div>
      </div>
    </div>
  </article>;
}

function BankAccountDeleteModal({ account, busy, isAdmin, onClose, onConfirm }) {
  const [reason, setReason] = useState('حذف/غیرفعال‌سازی کارت بانکی با تأیید مدیر');
  return <FinanceModal title="حذف / غیرفعال‌سازی کارت بانکی" onClose={onClose}>
    <div className="confirm-finance bank-delete-confirm">
      {!isAdmin ? <>
        <p>حذف کارت بانکی نیاز به دسترسی مدیر کل دارد.</p>
        <p className="muted">لطفاً از مدیر کل بخواهید با حساب مدیر وارد شود و حذف را تأیید کند.</p>
        <div className="finance-form-actions"><button type="button" onClick={onClose}>متوجه شدم</button></div>
      </> : <>
        <p>آیا مطمئن هستید کارت/حساب «{account?.account_name}» حذف یا غیرفعال شود؟</p>
        <p className="muted">این عملیات به صورت امن انجام می‌شود و حساب غیرفعال خواهد شد تا تاریخچه پرداخت‌ها حفظ شود.</p>
        <textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="دلیل حذف/غیرفعال‌سازی را بنویسید..." autoFocus />
        <div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button className="danger-btn" disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>تأیید مدیر و حذف کارت</button></div>
      </>}
    </div>
  </FinanceModal>;
}


function ChecksSection({ checks, accounts, lang, busy, onNewCheck, onSettle, onChangeStatus }) {
  const [filters, setFilters] = useState({ status: 'all', type: 'all', q: '' });
  const [sort, setSort] = useState({ key: 'due_date', dir: 'asc' });
  const [settle, setSettle] = useState(null);
  const filtered = useMemo(() => sortRows(checks.filter((c) => {
    const text = `${c.internal_check_code || ''} ${c.check_number || ''} ${c.owner_name || ''} ${c.bank_name || ''} ${c.branch_name || ''}`.toLowerCase();
    return (filters.status === 'all' || c.status === filters.status)
      && (filters.type === 'all' || c.check_type === filters.type)
      && (!filters.q || text.includes(filters.q.toLowerCase()));
  }), sort), [checks, filters, sort]);
  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  const totalOpen = filtered.filter((c)=>!['cleared','cancelled'].includes(c.status)).reduce((sum,c)=>sum+Number(c.amount||0),0);
  return <section className="finance-card checks-workspace checks-full-card"><div className="finance-card-header between"><CardHeader icon={WalletCards} title="چک‌ها" bare /><div className="actions-cell"><span className="finance-note">جمع چک‌های باز: {formatMoney(totalOpen, lang)}</span><button className="mini-btn primary-soft" onClick={onNewCheck}>＋ ثبت چک</button></div></div><div className="toolbar-line"><select value={filters.type} onChange={(e)=>setFilters({...filters,type:e.target.value})}><option value="all">همه نوع‌ها</option><option value="received">دریافتی</option><option value="issued">پرداختی</option></select><select value={filters.status} onChange={(e)=>setFilters({...filters,status:e.target.value})}><option value="all">همه وضعیت‌ها</option>{['in_hand','deposited','cleared','returned','issued','cancelled'].map(st=><option key={st} value={st}>{STATUS_LABELS[st]?.[lang]||st}</option>)}</select><input value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})} placeholder="شماره/بانک/صاحب/شعبه..." /></div>{filtered.length === 0 ? <Empty t={{noData:'چکی برای نمایش وجود ندارد.'}} /> : <div className="table-scroll limited-list tall"><table className="finance-table checks-table"><thead><tr>{th('internal_check_code','کد داخلی')}{th('check_type','نوع')}{th('check_number','شماره')}{th('bank_name','بانک')}{th('branch_name','شعبه')}{th('owner_name','صاحب')}{th('issue_date','تاریخ صدور')}{th('due_date','تاریخ وصول')}{th('cleared_date','تاریخ تسویه')}{th('amount','مبلغ')}{th('status','وضعیت')}<th>عملیات</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td dir="ltr">{c.internal_check_code||'—'}</td><td>{c.check_type==='received'?'دریافتی':'پرداختی'}</td><td dir="ltr">{c.check_number}</td><td>{c.bank_name||'—'}</td><td>{c.branch_name||'—'}</td><td>{c.owner_name||'—'}</td><td>{formatDate(c.issue_date, lang)}</td><td>{formatDate(c.due_date, lang)}</td><td>{c.cleared_date ? formatDate(c.cleared_date, lang) : '—'}</td><td>{formatMoney(c.amount, lang)}</td><td><StatusBadge status={c.status} lang={lang}/></td><td className="actions-cell"><button disabled={busy} onClick={()=>setSettle(c)}>وصول/تسویه</button><select disabled={busy} value={c.status} onChange={(e)=>onChangeStatus(c.id,e.target.value)}>{['in_hand','deposited','cleared','returned','issued','cancelled'].map(st=><option key={st} value={st}>{STATUS_LABELS[st]?.[lang]||st}</option>)}</select></td></tr>)}</tbody></table></div>}{settle&&<CheckSettleModal check={settle} accounts={accounts} busy={busy} onClose={()=>setSettle(null)} onSubmit={(payload)=>{setSettle(null);onSettle(payload)}} />}</section>;
}

function ItemKardexSection({ stock = [], rows = [], lastSales = [], lang = 'fa' }) {
  const [filters, setFilters] = useState({ itemId: 'all', direction: 'all', q: '' });
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });

  const lastSaleByItem = useMemo(() => Object.fromEntries((lastSales || []).map((sale) => [sale.warehouse_item_id, sale])), [lastSales]);
  const stockById = useMemo(() => Object.fromEntries((stock || []).map((item) => [item.item_id, item])), [stock]);
  const query = filters.q.trim().toLowerCase();

  const visibleStock = useMemo(() => {
    const base = (stock || []).filter((item) => {
      if (!query) return true;
      return `${item.item_code || ''} ${item.item_name_fa || ''} ${item.item_name_en || ''} ${item.item_group || ''} ${item.category || ''}`.toLowerCase().includes(query);
    });
    return sortRows(base, { key: 'item_name_fa', dir: 'asc' }).slice(0, 180);
  }, [stock, query]);

  const filteredRows = useMemo(() => sortRows((rows || []).filter((row) => {
    const item = stockById[row.item_id] || {};
    const text = `${row.item_code || ''} ${row.item_name_fa || ''} ${item.item_name_en || ''} ${row.doc_number || ''} ${row.note || ''}`.toLowerCase();
    return (filters.itemId === 'all' || row.item_id === filters.itemId)
      && (filters.direction === 'all' || row.direction === filters.direction)
      && (!query || text.includes(query));
  }), sort), [rows, stockById, filters, query, sort]);

  const selectedItem = filters.itemId === 'all' ? null : (stockById[filters.itemId] || rows.find((row) => row.item_id === filters.itemId));
  const selectedLastSale = selectedItem ? lastSaleByItem[selectedItem.item_id] : null;
  const totals = filteredRows.reduce((acc, row) => {
    const qty = Number(row.quantity || 0);
    if (row.direction === 'out' || row.transaction_type === 'issue') acc.outQty += qty;
    else acc.inQty += qty;
    acc.count += 1;
    return acc;
  }, { inQty: 0, outQty: 0, count: 0 });

  const th = (key, label) => <th><button className="sort-th" onClick={() => setSort(nextSort(sort, key))}>{label}<span>{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  const selectedCurrentQty = Number(selectedItem?.current_qty ?? selectedItem?.running_balance ?? 0);
  const selectedAvailableQty = Number(selectedItem?.available_for_sale_qty ?? selectedCurrentQty ?? 0);

  return <div className="accounting-grid item-kardex-workspace">
    <section className="finance-card item-kardex-header-card">
      <div className="finance-card-header between">
        <CardHeader icon={PackageCheck} title="کاردکس کالاها" bare />
        <div className="actions-cell">
          <button className="mini-btn" onClick={() => exportItemKardex(filteredRows, lang)}>خروجی Excel</button>
          <button className="mini-btn" onClick={() => printItemKardex(selectedItem, filteredRows, lang)}><Printer size={14} /> چاپ / PDF</button>
        </div>
      </div>
      <div className="toolbar-line item-kardex-toolbar">
        <label><Search size={14} /><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="جست‌وجوی کد، نام کالا، سند یا شرح..." /></label>
        <select value={filters.itemId} onChange={(e) => setFilters({ ...filters, itemId: e.target.value })}>
          <option value="all">همه کالاها</option>
          {stock.map((item) => <option key={item.item_id} value={item.item_id}>{item.item_code || 'بدون کد'} · {item.item_name_fa || item.item_name_en || 'کالا'}</option>)}
        </select>
        <select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
          <option value="all">همه گردش‌ها</option>
          <option value="in">ورود</option>
          <option value="out">خروج</option>
        </select>
        <button className="mini-btn" onClick={() => setFilters({ itemId: 'all', direction: 'all', q: '' })}>پاک‌کردن فیلتر</button>
      </div>
      <div className="detail-grid item-kardex-kpis">
        <Info label="تعداد گردش نمایش‌داده‌شده" value={formatNumber(totals.count, lang)} />
        <Info label="جمع ورود" value={formatNumber(totals.inQty, lang)} highlight />
        <Info label="جمع خروج" value={formatNumber(totals.outQty, lang)} highlight />
        <Info label="آخرین قیمت فروش" value={selectedLastSale ? formatMoney(selectedLastSale.last_sale_unit_price, lang) : '—'} />
      </div>
      {selectedItem && <div className="selected-item-strip">
        <div><span>کالای انتخاب‌شده</span><b>{selectedItem.item_name_fa || selectedItem.item_name_en || '—'}</b><small dir="ltr">{selectedItem.item_code || '—'}</small></div>
        <div><span>گروه</span><b>{productionItemLabel(selectedItem)}</b></div>
        <div><span>موجودی فعلی</span><b>{formatNumber(selectedCurrentQty, lang)} {selectedItem.unit || ''}</b></div>
        <div><span>قابل فروش</span><b>{formatNumber(selectedAvailableQty, lang)} {selectedItem.unit || ''}</b></div>
      </div>}
    </section>

    <div className="accounting-grid two item-kardex-split">
      <section className="finance-card item-catalog-card">
        <div className="finance-card-header between"><CardHeader icon={Search} title="انتخاب سریع کالا" bare /><span className="finance-note">{formatNumber(visibleStock.length, lang)} مورد</span></div>
        {visibleStock.length === 0 ? <Empty t={{ noData: 'کالایی برای نمایش پیدا نشد.' }} /> : <div className="item-kardex-list">
          <button className={filters.itemId === 'all' ? 'item-kardex-row active' : 'item-kardex-row'} onClick={() => setFilters({ ...filters, itemId: 'all' })}><span><b>همه کالاها</b><small>نمایش تمام گردش‌ها</small></span><strong>{formatNumber(rows.length, lang)}</strong></button>
          {visibleStock.map((item) => {
            const lastSale = lastSaleByItem[item.item_id];
            return <button key={item.item_id} className={filters.itemId === item.item_id ? 'item-kardex-row active' : 'item-kardex-row'} onClick={() => setFilters({ ...filters, itemId: item.item_id })}>
              <span><b>{item.item_name_fa || item.item_name_en || '—'}</b><small dir="ltr">{item.item_code || '—'} · {productionItemLabel(item)}</small></span>
              <strong>{formatNumber(item.current_qty || 0, lang)} {item.unit || ''}</strong>
              <em>{lastSale ? formatMoney(lastSale.last_sale_unit_price, lang) : 'بدون فروش'}</em>
            </button>;
          })}
        </div>}
      </section>

      <section className="finance-card item-kardex-table-card">
        <div className="finance-card-header between"><CardHeader icon={ListChecks} title="ریز گردش کالا" bare /><span className="finance-note">ورود و خروج‌های نهایی انبار</span></div>
        {filteredRows.length === 0 ? <Empty t={{ noData: 'گردشی برای این فیلتر وجود ندارد.' }} /> : <div className="table-scroll limited-list tall"><table className="finance-table item-kardex-table"><thead><tr>{th('created_at','تاریخ')}{th('item_code','کد')}{th('item_name_fa','کالا')}{th('direction','نوع')}{th('quantity','تعداد')}{th('running_balance','مانده')}{th('doc_number','سند')}{th('document_status','وضعیت سند')}<th>شرح</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.tx_id}><td>{formatDate(row.created_at, lang)}</td><td dir="ltr">{row.item_code || '—'}</td><td>{row.item_name_fa || stockById[row.item_id]?.item_name_fa || '—'}</td><td><span className={`movement-pill ${row.direction === 'out' ? 'out' : 'in'}`}>{movementLabel(row)}</span></td><td className={row.direction === 'out' ? 'payment-text' : 'receipt-text'}>{row.direction === 'out' ? '−' : '+'}{formatNumber(row.quantity, lang)}</td><td>{formatNumber(row.running_balance, lang)}</td><td dir="ltr">{row.doc_number || '—'}</td><td><StatusBadge status={row.document_status || 'final'} lang={lang} /></td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </div>;
}

function movementLabel(row) {
  if (row.transaction_type === 'issue' || row.direction === 'out') return 'خروج';
  if (row.transaction_type === 'receipt') return 'ورود';
  if (row.transaction_type === 'reversal') return 'برگشت';
  if (row.transaction_type === 'adjustment') return 'اصلاح';
  return row.direction === 'in' ? 'ورود' : 'گردش';
}

function exportItemKardex(rows, lang) {
  const headers = ['تاریخ', 'کد کالا', 'نام کالا', 'نوع گردش', 'تعداد', 'مانده', 'شماره سند', 'وضعیت سند', 'شرح'];
  const body = rows.map((row) => [formatDate(row.created_at, lang), row.item_code, row.item_name_fa, movementLabel(row), row.quantity, row.running_balance, row.doc_number, row.document_status, row.note]);
  downloadExcelHtml(`item-kardex-${new Date().toISOString().slice(0, 10)}.xls`, headers, body, 'گزارش کاردکس کالاها');
}

function printItemKardex(item, rows, lang) {
  const title = item ? `کاردکس کالا ${item.item_name_fa || item.item_name_en || item.item_code || ''}` : 'کاردکس همه کالاها';
  const totals = rows.reduce((acc, row) => {
    const qty = Number(row.quantity || 0);
    if (row.direction === 'out' || row.transaction_type === 'issue') acc.outQty += qty;
    else acc.inQty += qty;
    return acc;
  }, { inQty: 0, outQty: 0 });
  const bodyRows = rows.map((row, index) => `<tr class="${index % 2 ? 'alt' : ''}"><td>${index + 1}</td><td>${formatDate(row.created_at, lang)}</td><td dir="ltr">${htmlSafe(row.item_code || '—')}</td><td>${htmlSafe(row.item_name_fa || '—')}</td><td>${movementLabel(row)}</td><td class="money">${formatNumber(row.quantity, lang)}</td><td class="money">${formatNumber(row.running_balance, lang)}</td><td dir="ltr">${htmlSafe(row.doc_number || '—')}</td><td>${htmlSafe(row.note || '—')}</td></tr>`).join('');
  openOfficialFinancePrint({
    title,
    reportLabel: 'کاردکس کالا',
    subtitle: 'بوشهر، بهمنی، خلیج فارس، پردیس فناوری',
    body: `
      <section class="box-row">
        <div class="box-grid four">
          <div class="field"><b>کالا:</b> ${htmlSafe(item?.item_name_fa || item?.item_name_en || 'همه کالاها')}</div>
          <div class="field"><b>کد:</b> <span dir="ltr">${htmlSafe(item?.item_code || '—')}</span></div>
          <div class="field"><b>جمع ورود:</b> <span class="money">${formatNumber(totals.inQty, lang)}</span></div>
          <div class="field"><b>جمع خروج:</b> <span class="money">${formatNumber(totals.outQty, lang)}</span></div>
        </div>
      </section>
      <table class="official-table">
        <thead><tr><th>ردیف</th><th>تاریخ</th><th>کد</th><th>کالا</th><th>نوع</th><th>تعداد</th><th>مانده</th><th>سند</th><th>شرح</th></tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="9">گردشی برای نمایش وجود ندارد.</td></tr>'}</tbody>
      </table>
    `,
  });
}

function FinanceConfirmModal({ action, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return <FinanceModal title={action.title} onClose={onClose}><div className="confirm-finance"><p>{action.message}</p><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="دلیل/شرح عملیات..." autoFocus/><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>تأیید</button></div></div></FinanceModal>;
}

function CheckSettleModal({ check, accounts, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ bankAccountId: accounts[0]?.id || '', status: 'cleared', clearedDate: new Date().toISOString().slice(0,10), note: '' });
  return <FinanceModal title="وصول/تسویه چک" onClose={onClose}><div className="form-grid finance-form-grid"><label className="finance-field"><span>چک</span><input readOnly value={`${check.check_number} · ${formatMoney(check.amount,'fa')}`} /></label><label className="finance-field"><span>حساب مقصد/مبدأ</span><select value={form.bankAccountId} onChange={(e)=>setForm({...form,bankAccountId:e.target.value})}>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_name} · {a.bank_name}</option>)}</select></label><label className="finance-field"><span>وضعیت</span><select value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="deposited">خوابانده‌شده</option><option value="cleared">پاس/وصول‌شده</option><option value="returned">برگشتی</option><option value="cancelled">لغو</option></select></label><label className="finance-field"><span>تاریخ وصول/تسویه</span><JalaliDateInput value={form.clearedDate} onChange={(value)=>setForm({...form,clearedDate:value})}/></label><label className="finance-field full"><span>شرح</span><textarea value={form.note} onChange={(e)=>setForm({...form,note:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !form.bankAccountId} onClick={()=>onSubmit({checkId:check.id,bankAccountId:form.bankAccountId,status:form.status,note:form.note,clearedDate:form.clearedDate})}>ثبت وضعیت چک</button></div></FinanceModal>;
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



function LoansSection({ loans = [], installments = [], payments = [], lang, busy, onNewLoan, onEditLoan, onDeleteLoan, onPayInstallment }) {
  const activeLoans = loans.filter((loan) => !['archived', 'cancelled'].includes(loan.status));
  const [selectedId, setSelectedId] = useState(activeLoans[0]?.id || '');
  const selected = activeLoans.find((loan) => loan.id === selectedId) || activeLoans[0];
  const selectedInstallments = installments.filter((i) => i.loan_id === selected?.id && i.status !== 'cancelled');
  const totals = activeLoans.reduce((acc, loan) => {
    acc.totalDebt += Number(loan.remaining_debt || 0);
    acc.overdue += Number(loan.overdue_amount || 0);
    acc.paid += Number(loan.paid_total || 0);
    return acc;
  }, { totalDebt: 0, overdue: 0, paid: 0 });
  const dueThisMonth = installments.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && String(i.due_date || '').slice(0,7) === new Date().toISOString().slice(0,7)).reduce((s, i) => s + Number(i.amount_due || 0), 0);
  return <div className="accounting-grid loans-workspace"><section className="finance-card loan-overview-card"><div className="finance-card-header between"><CardHeader icon={WalletCards} title="وام‌های شرکت" bare /><button className="mini-btn primary-soft" onClick={onNewLoan}>＋ افزودن وام</button></div><div className="loan-kpis"><Info label="جمع بدهی وام‌ها" value={formatMoney(totals.totalDebt, lang)} highlight /><Info label="اقساط عقب‌افتاده" value={formatMoney(totals.overdue, lang)} highlight={totals.overdue > 0} /><Info label="پرداخت‌شده" value={formatMoney(totals.paid, lang)} /><Info label="سررسید این ماه" value={formatMoney(dueThisMonth, lang)} /></div>{activeLoans.length === 0 ? <Empty t={{noData:'وامی ثبت نشده است.'}} /> : <div className="loan-card-grid">{activeLoans.map((loan) => <article key={loan.id} className={selected?.id === loan.id ? 'loan-card active' : 'loan-card'} onClick={() => setSelectedId(loan.id)}><span>{loan.loan_number}</span><b>{loan.title_fa}</b><small>{loan.lender_name} · {loan.bank_name || '—'}</small><strong>{formatMoney(loan.remaining_debt, lang)}</strong><em>{loan.overdue_installments > 0 ? `${formatNumber(loan.overdue_installments, lang)} قسط عقب‌افتاده` : loan.status === 'closed' ? 'تسویه/بسته‌شده' : 'طبق برنامه'}</em><div className="loan-card-actions"><button type="button" onClick={(e)=>{e.stopPropagation();onEditLoan?.(loan);}}>ویرایش وام</button><button type="button" className="danger" onClick={(e)=>{e.stopPropagation();onDeleteLoan?.(loan);}}>حذف وام</button></div></article>)}</div>}</section><section className="finance-card loan-installments-card"><div className="finance-card-header between"><CardHeader icon={ListChecks} title={selected ? `اقساط وام: ${selected.title_fa}` : 'اقساط وام'} bare />{selected && <span className="finance-note">قسط پرداخت‌شده را با سند پرداخت بانک/صندوق مرتبط کنید.</span>}</div>{!selected ? <Empty t={{noData:'یک وام را انتخاب کنید.'}} /> : selectedInstallments.length === 0 ? <Empty t={{noData:'قسطی برای این وام ثبت نشده است.'}} /> : <div className="table-scroll limited-list tall"><table className="finance-table"><thead><tr><th>قسط</th><th>سررسید</th><th>مبلغ</th><th>پرداخت‌شده</th><th>وضعیت</th><th>سند پرداخت</th><th>عملیات</th></tr></thead><tbody>{selectedInstallments.map((i) => <tr key={i.id} className={i.status === 'overdue' ? 'overdue' : ''}><td>{formatNumber(i.installment_no, lang)}</td><td>{formatDate(i.due_date, lang)}</td><td>{formatMoney(i.amount_due, lang)}</td><td>{i.paid_amount ? formatMoney(i.paid_amount, lang) : '—'}</td><td><StatusBadge status={i.status} lang={lang} /></td><td dir="ltr">{i.payment_number || '—'}</td><td><button className="mini-btn" disabled={busy || i.status === 'paid'} onClick={() => onPayInstallment(i)}>{i.status === 'paid' ? 'پرداخت شده' : 'ثبت پرداخت'}</button></td></tr>)}</tbody></table></div>}</section></div>;
}

function LoanModal({ initial, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ title_fa: initial?.title_fa || '', lender_name: initial?.lender_name || '', lender_type: initial?.lender_type || 'bank', bank_name: initial?.bank_name || '', principal_amount: initial?.principal_amount || 0, total_payable_amount: initial?.total_payable_amount || initial?.principal_amount || 0, installment_count: initial?.installment_count || 12, installment_interval_months: initial?.installment_interval_months || 1, interest_rate: initial?.interest_rate || 0, received_date: initial?.received_date || new Date().toISOString().slice(0,10), first_due_date: initial?.first_due_date || new Date().toISOString().slice(0,10), status: initial?.status || 'active', notes: initial?.notes || '' });
  const total = Number(form.total_payable_amount || form.principal_amount || 0);
  const count = Math.max(1, Number(form.installment_count || 1));
  const monthly = Math.round(total / count);
  const title = initial ? `ویرایش وام ${initial.loan_number || ''}` : 'ثبت وام جدید';
  return <FinanceModal title={title} onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();onSubmit({ loan: form, regenerateInstallments: true });}}><div className="finance-form-grid"><label className="finance-field"><span>عنوان وام</span><input value={form.title_fa} onChange={(e)=>setForm({...form,title_fa:e.target.value})} required placeholder="مثلاً وام سرمایه در گردش" /></label><label className="finance-field"><span>وام‌دهنده / بانک</span><input value={form.lender_name} onChange={(e)=>setForm({...form,lender_name:e.target.value})} required /></label><label className="finance-field"><span>نام بانک</span><input value={form.bank_name} onChange={(e)=>setForm({...form,bank_name:e.target.value})} /></label><label className="finance-field"><span>نوع وام‌دهنده</span><select value={form.lender_type} onChange={(e)=>setForm({...form,lender_type:e.target.value})}><option value="bank">بانک</option><option value="person">شخص</option><option value="company">شرکت</option><option value="other">سایر</option></select></label><label className="finance-field"><span>مبلغ اصل وام ریال</span><input type="number" value={form.principal_amount} onChange={(e)=>setForm({...form,principal_amount:e.target.value,total_payable_amount:form.total_payable_amount||e.target.value})} /></label><label className="finance-field"><span>جمع قابل پرداخت ریال</span><input type="number" value={form.total_payable_amount} onChange={(e)=>setForm({...form,total_payable_amount:e.target.value})} /></label><label className="finance-field"><span>تعداد ماه/اقساط</span><input type="number" value={form.installment_count} onChange={(e)=>setForm({...form,installment_count:e.target.value})} /></label><label className="finance-field"><span>فاصله اقساط ماه</span><input type="number" value={form.installment_interval_months} onChange={(e)=>setForm({...form,installment_interval_months:e.target.value})} /></label><label className="finance-field"><span>نرخ سود %</span><input type="number" value={form.interest_rate} onChange={(e)=>setForm({...form,interest_rate:e.target.value})} /></label><label className="finance-field"><span>تاریخ دریافت وام</span><JalaliDateInput value={form.received_date} onChange={(v)=>setForm({...form,received_date:v})}/></label><label className="finance-field"><span>اولین سررسید</span><JalaliDateInput value={form.first_due_date} onChange={(v)=>setForm({...form,first_due_date:v})}/></label><label className="finance-field"><span>مبلغ تقریبی هر قسط</span><input readOnly value={monthly} /></label>{initial && <label className="finance-field"><span>وضعیت</span><select value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="active">فعال</option><option value="closed">بسته/تسویه</option><option value="cancelled">لغوشده</option><option value="archived">بایگانی</option></select></label>}<label className="finance-field full"><span>جزئیات / توضیحات</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-note warning">{initial ? 'با ویرایش مبلغ، تعداد اقساط یا تاریخ سررسید، اقساط پرداخت‌نشده دوباره بر اساس اطلاعات جدید ساخته/به‌روزرسانی می‌شوند؛ اقساط پرداخت‌شده حفظ می‌شوند.' : 'سیستم بر اساس تعداد اقساط و تاریخ اولین سررسید، جدول اقساط ماهانه را خودکار می‌سازد.'}</div><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button type="submit" disabled={busy || !form.title_fa || !form.lender_name}>{busy?'در حال ذخیره...':initial?'ذخیره ویرایش وام':'ثبت وام و اقساط'}</button></div></form></FinanceModal>;
}

function LoanDeleteModal({ loan, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('حذف/بایگانی وام از لیست فعال');
  return <FinanceModal title="حذف / بایگانی وام" onClose={onClose}><div className="confirm-finance loan-delete-confirm"><p>آیا مطمئن هستید وام «{loan?.loan_number} · {loan?.title_fa}» از لیست فعال حذف/بایگانی شود؟</p><p className="muted">این عملیات امن است؛ وام واقعاً از دیتابیس پاک نمی‌شود، فقط بایگانی می‌شود و اقساط پرداخت‌نشده لغو می‌شوند تا سابقه پرداخت‌ها باقی بماند.</p><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="دلیل حذف/بایگانی وام..." autoFocus /><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button className="danger-btn" disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>تأیید حذف وام</button></div></div></FinanceModal>;
}


function LoanPaymentModal({ installment, payments = [], busy, onClose, onSubmit }) {
  const payablePayments = payments.filter((p) => p.direction === 'payment' && p.status === 'confirmed');
  const [form, setForm] = useState({ paymentId: '', paidAmount: installment?.amount_due || 0, paidAt: new Date().toISOString().slice(0,10), notes: '' });
  return <FinanceModal title={`ثبت پرداخت قسط ${installment?.installment_no || ''}`} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>قسط</span><input readOnly value={`${installment?.loan_title || 'وام'} · سررسید ${formatDate(installment?.due_date, 'fa')}`} /></label><label className="finance-field"><span>مبلغ پرداختی ریال</span><input type="number" value={form.paidAmount} onChange={(e)=>setForm({...form,paidAmount:e.target.value})}/></label><label className="finance-field"><span>تاریخ پرداخت</span><JalaliDateInput value={form.paidAt} onChange={(v)=>setForm({...form,paidAt:v})}/></label><label className="finance-field full"><span>سند پرداخت بانک/صندوق</span><select value={form.paymentId} onChange={(e)=>setForm({...form,paymentId:e.target.value})}><option value="">بدون انتخاب سند پرداخت</option>{payablePayments.map((p)=><option key={p.id} value={p.id}>{p.payment_number} · {p.account_name || '—'} · {formatMoney(p.amount, 'fa')} · {formatDate(p.payment_date, 'fa')}</option>)}</select></label><label className="finance-field full"><span>یادداشت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy} onClick={()=>onSubmit({ installmentId: installment.id, paymentId: form.paymentId || null, paidAmount: form.paidAmount, paidAt: form.paidAt, notes: form.notes })}>تأیید پرداخت قسط</button></div></FinanceModal>;
}

function defaultPayrollMonth() {
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}
function payrollLineTypeLabel(type) {
  return ({ earning: 'مزایا', deduction: 'کسورات', carry: 'مانده قبل', payment: 'پرداخت', note: 'یادداشت' }[type] || type || '—');
}
function PayrollSection({ employees = [], slips = [], lines = [], payments = [], lang, busy, onNewEmployee, onEditEmployee, onDeleteEmployee, onNewSlip, onEditSlip, onPaySlip, onDeleteSlip }) {
  const [month, setMonth] = useState(defaultPayrollMonth());
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employees[0]?.id || '');
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) || employees[0];
  const visibleEmployees = employees.filter((e) => !search || `${e.employee_code || ''} ${e.display_name || ''} ${e.role_title || ''} ${e.department || ''} ${e.phone || ''}`.toLowerCase().includes(search.toLowerCase()));
  const monthSlips = slips.filter((s) => String(s.payroll_month || '') === String(month || ''));
  const employeeSlips = selectedEmployee ? slips.filter((s) => s.employee_id === selectedEmployee.id).sort((a,b)=>String(b.payroll_month).localeCompare(String(a.payroll_month),'fa')) : [];
  const paymentsBySlip = useMemo(() => payments.reduce((map, p) => { if (!map[p.slip_id]) map[p.slip_id] = []; map[p.slip_id].push(p); return map; }, {}), [payments]);
  const employeePayments = selectedEmployee ? payments.filter((p) => p.employee_id === selectedEmployee.id).sort((a,b)=>new Date(b.paid_at||0)-new Date(a.paid_at||0)) : [];
  const slipLinesById = useMemo(() => lines.reduce((map, line) => { if (!map[line.slip_id]) map[line.slip_id] = []; map[line.slip_id].push(line); return map; }, {}), [lines]);
  const totals = monthSlips.reduce((acc, slip) => {
    acc.net += Number(slip.net_payable || 0);
    acc.paid += Number(slip.paid_amount || 0);
    acc.remaining += Number(slip.remaining_balance || 0);
    return acc;
  }, { net: 0, paid: 0, remaining: 0 });
  function exportMonth() {
    const headers = ['ماه', 'کد پرسنلی', 'نام', 'واحد', 'حقوق پایه', 'مانده قبل', 'مزایا', 'کسورات', 'خالص', 'پرداخت‌شده', 'مانده'];
    const rows = monthSlips.map((s) => [s.payroll_month, s.employee_code, s.employee_name, s.department || s.role_title || '—', s.base_salary, s.carried_balance, s.benefits_total, s.deductions_total, s.net_payable, s.paid_amount, s.remaining_balance]);
    downloadExcelHtml(`payroll-${month || 'month'}.xls`, headers, rows, `لیست حقوق ${month || ''}`);
  }
  function printMonth() {
    const bodyRows = monthSlips.map((s, i) => `<tr><td>${i + 1}</td><td dir="ltr">${htmlSafe(s.employee_code || '—')}</td><td>${htmlSafe(s.employee_name || '—')}</td><td>${htmlSafe(s.department || s.role_title || '—')}</td><td class="money">${formatRial(s.base_salary)}</td><td class="money">${formatRial(s.net_payable)}</td><td class="money">${formatRial(s.paid_amount)}</td><td class="money">${formatRial(s.remaining_balance)}</td></tr>`).join('');
    openOfficialFinancePrint({
      title: `لیست حقوق ${month || ''}`,
      reportLabel: 'لیست حقوق و دستمزد ماهانه',
      orientation: 'landscape',
      layout: 'invoice',
      meta: { number: month || '—', date: formatDate(new Date().toISOString().slice(0,10), lang) },
      body: `<div class="section-label">لیست حقوق ماه ${htmlSafe(month || '—')}</div><table class="official-table"><thead><tr><th>ردیف</th><th>کد</th><th>نام</th><th>واحد</th><th>حقوق پایه</th><th>خالص</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="8">فیشی برای این ماه ثبت نشده است.</td></tr>'}</tbody><tfoot><tr class="alt"><td colspan="5"><b>جمع کل</b></td><td class="money"><b>${formatRial(totals.net)}</b></td><td class="money"><b>${formatRial(totals.paid)}</b></td><td class="money"><b>${formatRial(totals.remaining)}</b></td></tr></tfoot></table><section class="signatures"><span>حسابداری</span><span>مدیر عامل</span><span>تنظیم‌کننده</span></section>`,
    });
  }
  return <div className="accounting-grid payroll-workspace"><section className="finance-card payroll-header-card"><div className="finance-card-header between"><CardHeader icon={Users} title="حقوق و دستمزد" bare /><div className="actions-cell"><button className="mini-btn" onClick={onNewEmployee}>＋ افزودن کارمند</button><button className="mini-btn primary-soft" onClick={() => onNewSlip(selectedEmployee)}>＋ ثبت حقوق ماهانه</button><button className="mini-btn" onClick={exportMonth}>Excel ماه</button><button className="mini-btn" onClick={printMonth}>PDF ماه</button></div></div><div className="loan-kpis"><Info label="جمع خالص ماه" value={formatMoney(totals.net, lang)} highlight /><Info label="پرداخت‌شده" value={formatMoney(totals.paid, lang)} /><Info label="مانده انتقالی" value={formatMoney(totals.remaining, lang)} highlight={totals.remaining > 0} /><Info label="تعداد فیش" value={formatNumber(monthSlips.length, lang)} /></div><div className="toolbar-line payroll-toolbar"><input value={month} onChange={(e)=>setMonth(e.target.value)} placeholder="ماه حقوق، مثال: ۱۴۰۵/۰۵" /><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="جستجوی کارمند، کد، واحد..." /></div></section><div className="accounting-grid two payroll-main-grid"><section className="finance-card"><div className="finance-card-header between"><CardHeader icon={Users} title="کارکنان" bare /><span className="finance-note">{formatNumber(visibleEmployees.length, lang)} نفر</span></div>{visibleEmployees.length === 0 ? <Empty t={{noData:'کارمندی ثبت نشده است.'}} /> : <div className="payroll-employee-list">{visibleEmployees.map((employee) => { const lastSlip = slips.filter((s)=>s.employee_id===employee.id).sort((a,b)=>String(b.payroll_month).localeCompare(String(a.payroll_month),'fa'))[0]; return <article key={employee.id} className={selectedEmployee?.id === employee.id ? 'payroll-employee-card active' : 'payroll-employee-card'}><button type="button" onClick={() => setSelectedEmployeeId(employee.id)}><b>{employee.display_name}</b><small>{employee.employee_code || 'بدون کد'} · {employee.department || employee.role_title || '—'}</small><strong>مانده قبلی: {formatMoney(lastSlip?.remaining_balance || 0, lang)}</strong></button><div><button onClick={()=>onNewSlip(employee)}>حقوق ماه</button><button onClick={()=>onEditEmployee(employee)}>ویرایش</button><button className="danger" onClick={()=>onDeleteEmployee(employee)}>حذف</button></div></article>; })}</div>}</section><section className="finance-card"><div className="finance-card-header between"><CardHeader icon={ListChecks} title={`لیست حقوق ${month || ''}`} bare /><span className="finance-note">برای پرداخت حقوق، روی «سند پرداخت» همان فیش بزنید.</span></div>{monthSlips.length === 0 ? <Empty t={{noData:'برای این ماه فیش حقوقی ثبت نشده است.'}} /> : <div className="table-scroll limited-list tall"><table className="finance-table payroll-table"><thead><tr><th>فیش</th><th>کارمند</th><th>واحد</th><th>خالص</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{monthSlips.map((slip) => <tr key={slip.id} className={selectedEmployee?.id === slip.employee_id ? 'selected-row' : ''}><td dir="ltr">{slip.slip_number}</td><td>{slip.employee_name}</td><td>{slip.department || slip.role_title || '—'}</td><td>{formatMoney(slip.net_payable, lang)}</td><td>{formatMoney(slip.paid_amount, lang)}</td><td className={Number(slip.remaining_balance) > 0 ? 'negative' : 'positive'}>{formatMoney(slip.remaining_balance, lang)}</td><td><StatusBadge status={slip.status} lang={lang} /></td><td className="actions-cell"><button className="mini-btn" onClick={()=>onEditSlip(slip)}>ویرایش</button><button className="mini-btn primary-soft" disabled={busy || Number(slip.remaining_balance || 0) <= 0} onClick={()=>onPaySlip?.(slip)}>سند پرداخت</button><button className="mini-btn" onClick={()=>printPayrollSlip(slip, slipLinesById[slip.id] || [], lang)}>فیش</button><button className="mini-btn danger" disabled={busy} onClick={()=>onDeleteSlip(slip)}>حذف</button></td></tr>)}</tbody></table></div>}</section></div>{selectedEmployee && <section className="finance-card payroll-history-card"><div className="finance-card-header between"><CardHeader icon={BookOpen} title={`پرونده حقوق: ${selectedEmployee.display_name}`} bare /><span className="finance-note">تمام ماه‌ها و سندهای پرداختی این شخص</span></div><div className="accounting-grid two payroll-history-grid"><div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>ماه</th><th>فیش</th><th>خالص</th><th>پرداخت‌شده</th><th>مانده</th><th>عملیات</th></tr></thead><tbody>{employeeSlips.map((slip)=><tr key={slip.id}><td>{slip.payroll_month}</td><td dir="ltr">{slip.slip_number}</td><td>{formatMoney(slip.net_payable, lang)}</td><td>{formatMoney(slip.paid_amount, lang)}</td><td className={Number(slip.remaining_balance)>0?'negative':'positive'}>{formatMoney(slip.remaining_balance, lang)}</td><td><button className="mini-btn" onClick={()=>printPayrollSlip(slip, slipLinesById[slip.id] || [], lang)}>فیش</button></td></tr>)}</tbody></table></div><div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>تاریخ پرداخت</th><th>شماره سند</th><th>مبلغ</th><th>حساب</th><th>یادداشت</th></tr></thead><tbody>{employeePayments.length ? employeePayments.map((p)=><tr key={p.id}><td>{formatDate(p.paid_at, lang)}</td><td dir="ltr">{p.payment_number || '—'}</td><td className="payment-text">{formatMoney(p.paid_amount, lang)}</td><td>{p.bank_account_name || p.cashbox_name || '—'}</td><td>{p.notes || '—'}</td></tr>) : <tr><td colSpan={5}>سند پرداختی برای این کارمند ثبت نشده است.</td></tr>}</tbody></table></div></div></section>}</div>;
}

function printPayrollSlip(slip, lines = [], lang = 'fa') {
  const earningRows = lines.length ? lines : [
    { line_no: 1, line_type: 'earning', title_fa: 'حقوق پایه ماهانه', amount: slip.base_salary },
    { line_no: 2, line_type: 'carry', title_fa: 'مانده پرداخت‌نشده از ماه قبل', amount: slip.carried_balance },
    { line_no: 3, line_type: 'earning', title_fa: 'مزایا / پاداش', amount: slip.benefits_total },
    { line_no: 4, line_type: 'deduction', title_fa: 'کسورات', amount: slip.deductions_total },
  ];
  const rows = earningRows.map((line, index) => `<tr class="${index % 2 ? 'alt' : ''}"><td>${index + 1}</td><td>${htmlSafe(line.title_fa)}</td><td>${payrollLineTypeLabel(line.line_type)}</td><td class="money">${formatRial(line.amount)}</td></tr>`).join('');
  openOfficialFinancePrint({
    title: `فیش حقوقی ${slip.employee_name || ''}`,
    reportLabel: 'فیش حقوقی',
    orientation: 'portrait',
    layout: 'statement',
    meta: { number: slip.slip_number || '—', date: formatDate(slip.issue_date, lang) },
    body: `<div class="section-label">مشخصات کارمند</div><section class="box-row"><div class="box-grid three"><div class="field"><b>کد پرسنلی:</b> ${htmlSafe(slip.employee_code || '—')}</div><div class="field"><b>نام:</b> ${htmlSafe(slip.employee_name || '—')}</div><div class="field"><b>واحد:</b> ${htmlSafe(slip.department || slip.role_title || '—')}</div><div class="field"><b>ماه حقوق:</b> ${htmlSafe(slip.payroll_month || '—')}</div><div class="field"><b>شماره ملی:</b> ${htmlSafe(slip.national_id || '—')}</div><div class="field"><b>شماره حساب:</b> ${htmlSafe(slip.bank_account_number || '—')}</div></div></section><div class="section-label">ریز حقوق و مزایا / کسورات</div><table class="official-table"><thead><tr><th>ردیف</th><th>شرح</th><th>نوع</th><th>مبلغ</th></tr></thead><tbody>${rows}</tbody></table><section class="totals-wrap"><table class="totals-table"><tbody><tr><td>جمع ناخالص</td><td class="money">${formatRial(slip.gross_amount)}</td></tr><tr><td>کسورات</td><td class="money">${formatRial(slip.deductions_total)}</td></tr><tr><td>خالص قابل پرداخت</td><td class="money">${formatRial(slip.net_payable)}</td></tr><tr><td>پرداخت‌شده</td><td class="money">${formatRial(slip.paid_amount)}</td></tr><tr><td>مانده انتقالی</td><td class="money">${formatRial(slip.remaining_balance)}</td></tr></tbody></table><div class="amount-words"><b>مبلغ خالص به حروف:</b> ${rialToPersianWords(slip.net_payable)}<br><b>توضیحات:</b> ${htmlSafe(slip.notes || 'مانده پرداخت‌نشده به ماه بعد منتقل می‌شود.')}</div></section><section class="signatures"><span>امضاء کارمند</span><span>تأیید مدیر عامل</span><span>حسابداری</span></section>`,
  });
}
function PayrollEmployeeModal({ initial, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ employee_code: initial?.employee_code || '', display_name: initial?.display_name || '', role_title: initial?.role_title || '', department: initial?.department || '', national_id: initial?.national_id || '', phone: initial?.phone || '', bank_account_number: initial?.bank_account_number || '', bank_iban: initial?.bank_iban || '', base_salary: initial?.base_salary || 0, notes: initial?.notes || '', is_active: initial?.is_active !== false });
  return <FinanceModal title={initial ? 'ویرایش کارمند' : 'افزودن کارمند حقوق'} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>کد پرسنلی</span><input value={form.employee_code} onChange={(e)=>setForm({...form,employee_code:e.target.value})}/></label><label className="finance-field"><span>نام و نام خانوادگی</span><input value={form.display_name} onChange={(e)=>setForm({...form,display_name:e.target.value})} required/></label><label className="finance-field"><span>سمت</span><input value={form.role_title} onChange={(e)=>setForm({...form,role_title:e.target.value})}/></label><label className="finance-field"><span>واحد</span><input value={form.department} onChange={(e)=>setForm({...form,department:e.target.value})}/></label><label className="finance-field"><span>شناسه/کد ملی</span><input dir="ltr" value={form.national_id} onChange={(e)=>setForm({...form,national_id:e.target.value})}/></label><label className="finance-field"><span>تلفن</span><input dir="ltr" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label><label className="finance-field"><span>شماره حساب</span><input dir="ltr" value={form.bank_account_number} onChange={(e)=>setForm({...form,bank_account_number:e.target.value})}/></label><label className="finance-field"><span>شبا</span><input dir="ltr" value={form.bank_iban} onChange={(e)=>setForm({...form,bank_iban:e.target.value})}/></label><label className="finance-field"><span>حقوق پایه ریال</span><input type="number" value={form.base_salary} onChange={(e)=>setForm({...form,base_salary:e.target.value})}/></label><label className="finance-field full"><span>یادداشت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !form.display_name.trim()} onClick={()=>onSubmit(form)}>{initial ? 'ذخیره ویرایش' : 'ثبت کارمند'}</button></div></FinanceModal>;
}
function PayrollSlipModal({ initial, employee, employees = [], lines = [], slips = [], busy, onClose, onSubmit }) {
  const activeEmployee = employee || employees.find((e) => e.id === initial?.employee_id) || employees[0];
  const previousRemaining = activeEmployee ? slips.filter((s) => s.employee_id === activeEmployee.id && s.id !== initial?.id && s.status !== 'archived').sort((a,b)=>String(b.payroll_month).localeCompare(String(a.payroll_month),'fa'))[0]?.remaining_balance || 0 : 0;
  const [slip, setSlip] = useState({ id: initial?.id || null, employee_id: initial?.employee_id || activeEmployee?.id || '', payroll_month: initial?.payroll_month || defaultPayrollMonth(), issue_date: initial?.issue_date || new Date().toISOString().slice(0,10), base_salary: initial?.base_salary || activeEmployee?.base_salary || 0, paid_amount: initial?.paid_amount || 0, status: initial?.status || 'approved', notes: initial?.notes || '' });
  const initialLines = initial ? lines.filter((l)=>l.slip_id===initial.id).map((l)=>({ line_type:l.line_type, title_fa:l.title_fa, amount:l.amount, notes:l.notes || '' })) : [
    { line_type: 'carry', title_fa: 'مانده پرداخت‌نشده از ماه قبل', amount: previousRemaining },
    { line_type: 'earning', title_fa: 'مزایا / پاداش / اضافه‌کاری', amount: 0 },
    { line_type: 'deduction', title_fa: 'کسورات بیمه / مالیات / سایر', amount: 0 },
  ];
  const [rows, setRows] = useState(initialLines);
  function updateRow(index, patch) { setRows((list)=>list.map((row,i)=>i===index?{...row,...patch}:row)); }
  const totals = useMemo(() => {
    const benefits = rows.filter((l)=>l.line_type==='earning').reduce((s,l)=>s+Number(l.amount||0),0);
    const carry = rows.filter((l)=>l.line_type==='carry').reduce((s,l)=>s+Number(l.amount||0),0);
    const deductions = rows.filter((l)=>l.line_type==='deduction').reduce((s,l)=>s+Number(l.amount||0),0);
    const gross = Number(slip.base_salary||0)+benefits+carry;
    const net = gross-deductions;
    return { gross, net, remaining: net-Number(slip.paid_amount||0) };
  }, [rows, slip.base_salary, slip.paid_amount]);
  return <FinanceModal title={initial ? 'ویرایش فیش حقوقی' : 'ثبت حقوق ماهانه'} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>کارمند</span><select value={slip.employee_id} onChange={(e)=>{ const emp=employees.find((x)=>x.id===e.target.value); setSlip({...slip,employee_id:e.target.value,base_salary:emp?.base_salary||slip.base_salary}); }}><option value="">انتخاب کارمند</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.employee_code || '—'} · {e.display_name}</option>)}</select></label><label className="finance-field"><span>ماه حقوق</span><input value={slip.payroll_month} onChange={(e)=>setSlip({...slip,payroll_month:e.target.value})} placeholder="۱۴۰۵/۰۵"/></label><label className="finance-field"><span>تاریخ صدور</span><JalaliDateInput value={slip.issue_date} onChange={(v)=>setSlip({...slip,issue_date:v})}/></label><label className="finance-field"><span>حقوق پایه ریال</span><input type="number" value={slip.base_salary} onChange={(e)=>setSlip({...slip,base_salary:e.target.value})}/></label><label className="finance-field"><span>پرداخت‌شده ریال</span><input type="number" value={slip.paid_amount} onChange={(e)=>setSlip({...slip,paid_amount:e.target.value})}/></label><label className="finance-field"><span>وضعیت</span><select value={slip.status} onChange={(e)=>setSlip({...slip,status:e.target.value})}><option value="draft">پیش‌نویس</option><option value="approved">تأییدشده</option><option value="paid">پرداخت‌شده</option><option value="void">باطل</option></select></label><label className="finance-field full"><span>توضیحات</span><textarea value={slip.notes} onChange={(e)=>setSlip({...slip,notes:e.target.value})}/></label></div><div className="line-editor payroll-line-editor"><table><thead><tr><th>نوع</th><th>شرح</th><th>مبلغ ریال</th><th></th></tr></thead><tbody>{rows.map((row,index)=><tr key={index}><td><select value={row.line_type} onChange={(e)=>updateRow(index,{line_type:e.target.value})}><option value="earning">مزایا</option><option value="deduction">کسورات</option><option value="carry">مانده قبل</option><option value="note">یادداشت</option></select></td><td><input value={row.title_fa} onChange={(e)=>updateRow(index,{title_fa:e.target.value})}/></td><td><input type="number" value={row.amount} onChange={(e)=>updateRow(index,{amount:e.target.value})}/></td><td><button type="button" onClick={()=>setRows((list)=>list.filter((_,i)=>i!==index))}>×</button></td></tr>)}</tbody></table><button type="button" className="mini-btn" onClick={()=>setRows((list)=>[...list,{line_type:'earning',title_fa:'ردیف جدید',amount:0}])}>＋ افزودن ردیف</button></div><div className="form-summary"><span>ناخالص: {formatMoney(totals.gross,'fa')}</span><span>خالص: {formatMoney(totals.net,'fa')}</span><b>مانده انتقالی: {formatMoney(totals.remaining,'fa')}</b></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || !slip.employee_id || !slip.payroll_month} onClick={()=>onSubmit({ slip, lines: rows })}>{initial ? 'ذخیره ویرایش' : 'ثبت فیش حقوقی'}</button></div></FinanceModal>;
}
function PayrollPaymentModal({ slip, accounts = [], cashboxes = [], busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ paidAmount: slip?.remaining_balance || slip?.net_payable || 0, paidAt: new Date().toISOString().slice(0,10), accountType: accounts[0]?.id ? 'bank' : 'cash', bankAccountId: accounts[0]?.id || '', cashboxId: cashboxes[0]?.id || '', notes: '' });
  return <FinanceModal title={`ثبت سند پرداخت حقوق ${slip?.employee_name || ''}`} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>فیش</span><input readOnly value={`${slip?.slip_number || '—'} · ${slip?.payroll_month || '—'}`} /></label><label className="finance-field"><span>کارمند</span><input readOnly value={slip?.employee_name || '—'} /></label><label className="finance-field"><span>مانده قابل پرداخت</span><input readOnly value={formatMoney(slip?.remaining_balance || 0, 'fa')} /></label><label className="finance-field"><span>مبلغ پرداختی ریال</span><input type="number" value={form.paidAmount} onChange={(e)=>setForm({...form,paidAmount:e.target.value})} /></label><label className="finance-field"><span>تاریخ پرداخت</span><JalaliDateInput value={form.paidAt} onChange={(value)=>setForm({...form,paidAt:value})}/></label><label className="finance-field"><span>نوع حساب</span><select value={form.accountType} onChange={(e)=>setForm({...form,accountType:e.target.value})}><option value="bank">بانک / کارت</option><option value="cash">صندوق</option></select></label>{form.accountType === 'bank' ? <label className="finance-field full"><span>حساب/کارت پرداخت</span><select value={form.bankAccountId} onChange={(e)=>setForm({...form,bankAccountId:e.target.value})}>{accounts.map((a)=><option key={a.id} value={a.id}>{a.account_name} · {a.bank_name || '—'}</option>)}</select></label> : <label className="finance-field full"><span>صندوق پرداخت</span><select value={form.cashboxId} onChange={(e)=>setForm({...form,cashboxId:e.target.value})}>{cashboxes.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<label className="finance-field full"><span>یادداشت سند پرداخت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} placeholder="مثلاً پرداخت حقوق ماهانه از بانک ملی" /></label></div><div className="finance-note warning">بعد از ثبت سند پرداخت، همین مبلغ از مانده فیش کم می‌شود و سند پرداخت در صندوق و گردش حساب ثبت می‌گردد.</div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || Number(form.paidAmount) <= 0 || (form.accountType === 'bank' && !form.bankAccountId) || (form.accountType === 'cash' && !form.cashboxId)} onClick={()=>onSubmit({ slipId: slip.id, paidAmount: form.paidAmount, paidAt: form.paidAt, bankAccountId: form.accountType === 'bank' ? form.bankAccountId : null, cashboxId: form.accountType === 'cash' ? form.cashboxId : null, notes: form.notes })}>ثبت سند پرداخت حقوق</button></div></FinanceModal>;
}

function PayrollDeleteModal({ item, kind, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState(kind === 'employee' ? 'حذف/غیرفعال‌سازی کارمند از حقوق و دستمزد' : 'حذف/بایگانی فیش حقوقی');
  return <FinanceModal title={kind === 'employee' ? 'تأیید حذف کارمند' : 'تأیید حذف فیش حقوقی'} onClose={onClose}><div className="confirm-finance payroll-delete-confirm"><p>آیا از حذف/غیرفعال‌سازی «{item?.display_name || item?.employee_name || item?.slip_number}» مطمئن هستید؟</p><p className="muted">این حذف امن است و برای حفظ سوابق، رکورد بایگانی/غیرفعال می‌شود.</p><textarea value={reason} onChange={(e)=>setReason(e.target.value)} /><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button className="danger-btn" disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>تأیید حذف</button></div></div></FinanceModal>;
}

function FiscalSection({ fiscalYears, fiscalPeriods, lang, busy, onClosePeriod, onReopenPeriod, onCloseYear, onReopenYear }) {
  const year = fiscalYears[0];
  return <div className="accounting-grid two"><section className="finance-card"><CardHeader icon={CalendarClock} title="سال مالی" />{!year ? <Empty t={{ noData: 'سال مالی تعریف نشده است.' }} /> : <div className="fiscal-box"><p><b>{year.title}</b></p><p>{formatDate(year.start_date, lang)} تا {formatDate(year.end_date, lang)}</p><StatusBadge status={year.is_closed ? 'paid' : 'open'} lang={lang} /><div className="actions-cell"><button disabled={busy || year.is_closed} onClick={() => onCloseYear(year.id)}>بستن سال</button><button disabled={busy || !year.is_closed} onClick={() => onReopenYear(year.id)}>بازگشایی</button></div></div>}</section><section className="finance-card"><CardHeader icon={ListChecks} title="ماه‌های مالی" />{fiscalPeriods.length === 0 ? <Empty t={{ noData: 'دوره‌ای تعریف نشده است.' }} /> : <div className="table-scroll"><table className="finance-table"><thead><tr><th>ماه</th><th>شروع</th><th>پایان</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{fiscalPeriods.map((p) => <tr key={p.id}><td>{p.title_fa}</td><td>{formatDate(p.start_date, lang)}</td><td>{formatDate(p.end_date, lang)}</td><td><StatusBadge status={p.is_closed ? 'paid' : 'open'} lang={lang} /></td><td className="actions-cell"><button disabled={busy || p.is_closed} onClick={() => onClosePeriod(p.id)}>بستن</button><button disabled={busy || !p.is_closed} onClick={() => onReopenPeriod(p.id)}>بازگشایی</button></td></tr>)}</tbody></table></div>}</section></div>;
}

function SettingsSection({ numbering, ioDocuments, lang, busy, onUpdateNumbering, onAddIo }) {
  const [editing, setEditing] = useState(null);
  const [printSettings, setPrintSettings] = useState(() => getFinancePrintSettings());
  const [printSaved, setPrintSaved] = useState('');
  function saveRule() {
    if (!editing) return;
    onUpdateNumbering(editing.rule_key, { prefix: editing.prefix, padding: Number(editing.padding || 5), separator: editing.separator || '-' });
    setEditing(null);
  }
  function patchPrintSettings(patch) {
    setPrintSettings((current) => ({ ...current, ...patch }));
    setPrintSaved('');
  }
  function savePrintSettings() {
    const saved = saveFinancePrintSettings(printSettings);
    setPrintSettings(saved);
    setPrintSaved('تنظیمات چاپ ذخیره شد. از چاپ بعدی اعمال می‌شود.');
  }
  function resetPrintSettings() {
    const saved = saveFinancePrintSettings(DEFAULT_FINANCE_PRINT_SETTINGS);
    setPrintSettings(saved);
    setPrintSaved('تنظیمات چاپ به حالت پیشنهادی برگشت.');
  }
  return <div className="accounting-grid two settings-layout-grid"><section className="finance-card"><CardHeader icon={Settings} title="تنظیمات و شماره‌گذاری مرکزی" />{numbering.length === 0 ? <Empty t={{ noData: 'قواعد شماره‌گذاری هنوز اجرا نشده‌اند.' }} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr><th>عنوان</th><th>پیشوند</th><th>دوره</th><th>آخرین شماره</th><th>شماره بعدی</th><th>عملیات</th></tr></thead><tbody>{numbering.map((r) => <tr key={r.rule_key}><td>{lang === 'fa' ? r.label_fa : r.label_en}</td><td dir="ltr">{r.prefix}</td><td>{r.reset_scope}</td><td>{r.current_counter}</td><td dir="ltr"><b>{r.next_number_preview}</b></td><td><button className="mini-btn" disabled={busy} onClick={() => setEditing({ ...r })}>تنظیم</button></td></tr>)}</tbody></table></div>}{editing && <div className="numbering-editor"><h3>ویرایش شماره‌گذاری</h3><label><span>پیشوند</span><input value={editing.prefix} onChange={(e)=>setEditing({...editing,prefix:e.target.value})}/></label><label><span>تعداد رقم</span><input type="number" value={editing.padding} onChange={(e)=>setEditing({...editing,padding:e.target.value})}/></label><label><span>جداکننده</span><input value={editing.separator} onChange={(e)=>setEditing({...editing,separator:e.target.value})}/></label><div><button onClick={()=>setEditing(null)}>انصراف</button><button disabled={busy} onClick={saveRule}>ذخیره</button></div></div>}</section><section className="finance-card print-settings-card"><CardHeader icon={Printer} title="تنظیمات چاپ فاکتور و صورت‌حساب" /><p className="finance-note">این تنظیمات روی همین مرورگر ذخیره می‌شود و از چاپ بعدی فاکتور، پیش‌فاکتور و صورت‌حساب اعمال می‌شود.</p><div className="print-settings-grid"><label className="finance-field"><span>حاشیه کاغذ A4 میلی‌متر</span><input type="number" min="5" max="20" value={printSettings.marginMm} onChange={(e)=>patchPrintSettings({ marginMm: Number(e.target.value) })}/></label><label className="finance-field"><span>بزرگی نوشته‌ها</span><select value={printSettings.fontScale} onChange={(e)=>patchPrintSettings({ fontScale: Number(e.target.value) })}><option value={0.9}>کوچک</option><option value={1}>معمولی</option><option value={1.15}>بزرگ</option><option value={1.3}>خیلی بزرگ</option><option value={1.45}>حداکثر</option></select></label><label className="finance-field"><span>بزرگی اعداد و مبالغ</span><select value={printSettings.numberScale} onChange={(e)=>patchPrintSettings({ numberScale: Number(e.target.value) })}><option value={0.9}>کوچک</option><option value={1}>معمولی</option><option value={1.15}>بزرگ</option><option value={1.3}>خیلی بزرگ</option><option value={1.5}>حداکثر</option></select></label><label className="finance-field"><span>جهت فاکتور/پیش‌فاکتور</span><select value={printSettings.invoiceOrientation} onChange={(e)=>patchPrintSettings({ invoiceOrientation: e.target.value })}><option value="landscape">افقی</option><option value="portrait">عمودی</option></select></label><label className="finance-field"><span>جهت صورت‌حساب</span><select value={printSettings.statementOrientation} onChange={(e)=>patchPrintSettings({ statementOrientation: e.target.value })}><option value="portrait">عمودی</option><option value="landscape">افقی</option></select></label><label className="finance-field print-check-field"><span>پاورقی اتوماسیون</span><label><input type="checkbox" checked={printSettings.showFooter !== false} onChange={(e)=>patchPrintSettings({ showFooter: e.target.checked })}/> نمایش داده شود</label></label></div><div className="print-settings-preview"><span>پیشنهاد فعلی:</span><b>حاشیه {printSettings.marginMm}mm · متن ×{printSettings.fontScale} · اعداد ×{printSettings.numberScale}</b></div>{printSaved && <div className="finance-note success">{printSaved}</div>}<div className="finance-form-actions"><button type="button" onClick={resetPrintSettings}>بازگشت به حالت پیشنهادی</button><button type="button" onClick={savePrintSettings}>ذخیره تنظیمات چاپ</button></div></section><section className="finance-card"><div className="finance-card-header between"><CardHeader icon={FileText} title="اسناد ورودی / خروجی" bare /><div className="actions-cell"><button disabled={busy} onClick={() => onAddIo('incoming')}>＋ ورودی</button><button disabled={busy} onClick={() => onAddIo('outgoing')}>＋ خروجی</button></div></div>{ioDocuments.length === 0 ? <Empty t={{ noData: 'سند ورودی/خروجی ثبت نشده است.' }} /> : <div className="table-scroll limited-list"><table className="finance-table"><thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>تاریخ</th></tr></thead><tbody>{ioDocuments.map((d) => <tr key={d.id}><td dir="ltr">{d.io_number}</td><td>{d.io_type === 'incoming' ? 'ورودی' : 'خروجی'}</td><td>{d.title_fa}</td><td>{formatDate(d.registered_at, lang)}</td></tr>)}</tbody></table></div>}</section></div>;
}


function ProfitCard({ rows, lang, t, full, onAddCost, orderCosts = [] }) {
  const [detailOrder, setDetailOrder] = useState(null);
  const costsByOrder = useMemo(() => orderCosts.reduce((map, cost) => {
    const id = cost.order_id || cost.related_order_id;
    if (!id) return map;
    if (!map[id]) map[id] = [];
    map[id].push(cost);
    return map;
  }, {}), [orderCosts]);
  const selectedCosts = detailOrder ? (costsByOrder[detailOrder.order_id] || []) : [];
  return <section className="finance-card"><div className="finance-card-header between"><CardHeader icon={BarChart3} title="سود و زیان سفارش‌ها" bare />{full && <span className="finance-note">برای دیدن ریز هزینه‌ها روی ردیف سفارش یا مبلغ هزینه کلیک کنید.</span>}</div>{rows.length === 0 ? <Empty t={t} /> : <div className="table-scroll limited-list tall"><table className="finance-table profitability-table"><thead><tr><th>سفارش</th><th>مشتری</th><th>درآمد</th><th>هزینه</th><th>سود</th><th>حاشیه</th>{full && <th>هزینه دستی</th>}</tr></thead><tbody>{rows.map((r) => { const costCount = (costsByOrder[r.order_id] || []).length; return <tr key={r.order_id} className="clickable-row profitability-clickable-row" onClick={() => setDetailOrder(r)} title="مشاهده ریز هزینه‌های این سفارش"><td dir="ltr">{r.order_code}</td><td>{r.company_name || r.title_fa}</td><td>{formatMoney(r.revenue_before_tax, lang)}</td><td><button type="button" className="cost-detail-link" onClick={(e)=>{e.stopPropagation();setDetailOrder(r);}}>{formatMoney(r.cost_before_tax, lang)}<small>{costCount ? `${formatNumber(costCount, lang)} ردیف` : 'بدون ریز'}</small></button></td><td className={Number(r.gross_profit) >= 0 ? 'positive' : 'negative'}>{formatMoney(r.gross_profit, lang)}</td><td>{r.gross_margin_pct == null ? '—' : `${formatNumber(r.gross_margin_pct, lang)}٪`}</td>{full && <td onClick={(e)=>e.stopPropagation()}><button className="mini-btn" onClick={() => onAddCost?.(r)}>ثبت هزینه</button></td>}</tr>; })}</tbody></table>{full && <p className="finance-note">هزینه‌ها از خرید/هزینه، تولید، R&D و هزینه دستی سفارش جمع می‌شوند. برای مشاهده ریز، روی ردیف کلیک کنید.</p>}</div>}{detailOrder && <OrderCostDetailsModal order={detailOrder} costs={selectedCosts} lang={lang} onClose={() => setDetailOrder(null)} />}</section>;
}

function OrderCostDetailsModal({ order, costs = [], lang, onClose }) {
  const total = costs.reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  const sortedCosts = useMemo(() => [...costs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), [costs]);
  return <div className="finance-detail-modal-backdrop cost-detail-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><div className="finance-detail-modal cost-detail-modal"><section className="finance-card document-detail-card"><header className="detail-header"><div><span className="detail-eyebrow">ریز هزینه‌های سفارش</span><h2 dir="ltr">{order.order_code || '—'}</h2><p>{order.company_name || order.title_fa || '—'}</p></div><div className="detail-header-actions"><Info label="جمع ریز هزینه‌ها" value={formatMoney(total, lang)} highlight /><button type="button" className="detail-close-btn" onClick={onClose}>×</button></div></header>{sortedCosts.length === 0 ? <Empty t={{ noData: 'برای این سفارش هنوز ریز هزینه‌ای ثبت نشده یا هزینه فقط از اسناد تجمیعی قدیمی آمده است.' }} /> : <div className="table-scroll limited-list tall"><table className="finance-table compact cost-detail-table"><thead><tr><th>تاریخ</th><th>منبع</th><th>نوع هزینه</th><th>شرح</th><th>مبلغ</th></tr></thead><tbody>{sortedCosts.map((cost, index) => <tr key={`${cost.source_type}-${cost.source_id}-${index}`}><td>{formatDate(cost.created_at, lang)}</td><td>{sourceTypeLabel(cost.source_type)}</td><td>{costTypeLabel(cost.cost_type)}</td><td>{cost.notes || '—'}</td><td className="payment-text">{formatMoney(cost.amount, lang)}</td></tr>)}</tbody><tfoot><tr><td colSpan={4}><b>جمع کل ریز هزینه‌ها</b></td><td className="payment-text"><b>{formatMoney(total, lang)}</b></td></tr></tfoot></table></div>}<div className="finance-note">اگر جمع ریز هزینه‌ها با ستون هزینه تفاوت داشت، بخشی از هزینه از فاکتورهای خرید/هزینه یا اسناد قدیمی تجمیعی آمده است. بعد از اجرای SQL 055، هزینه‌های اسنادی هم در همین جدول دیده می‌شوند.</div></section></div></div>;
}

function costTypeLabel(type) {
  return ({ material: 'متریال', labor: 'دستمزد', overhead: 'سربار', purchase: 'خرید', rnd: 'R&D', warehouse: 'انبار', shipping: 'حمل', production: 'تولید', document: 'سند خرید/هزینه', other: 'سایر' }[type] || type || '—');
}
function sourceTypeLabel(type) {
  return ({ manual_finance_cost: 'هزینه دستی مالی', production_bom: 'فرمول/تولید', rnd_cost: 'هزینه R&D', finance_document_cost: 'فاکتور خرید/هزینه', finance_document: 'سند مالی', manual: 'دستی' }[type] || type || '—');
}


function ReferralsCard({ rows, lang, t }) {
  return <section className="finance-card"><CardHeader icon={Link2} title="ارجاع و اسناد مالی" />{rows.length === 0 ? <Empty t={t} /> : <div className="referral-list">{rows.map((r) => <article key={r.id} className={`referral-card p${r.priority}`}><div><strong>{r.title_fa}</strong><small>{r.referral_number} · {moduleLabel(r.source_module, lang)} → {moduleLabel(r.target_module, lang)}</small></div><div className="referral-meta"><StatusBadge status={r.status} lang={lang} /><span>{r.due_date ? formatDate(r.due_date, lang) : '—'}</span></div></article>)}</div>}</section>;
}

function CardHeader({ icon: Icon, title, bare }) {
  const content = <><Icon size={18} /><h2>{title}</h2></>;
  return bare ? <div className="finance-card-header inline-title">{content}</div> : <header className="finance-card-header">{content}</header>;
}
function Info({ label, value, highlight }) { return <div className={highlight ? 'detail-info highlight' : 'detail-info'}><span>{label}</span><strong>{value || '—'}</strong></div>; }
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

const PARTY_IMPORT_HEADERS = ['نوع شخص', 'نام', 'تلفن', 'کد اقتصادی', 'شماره ثبت', 'شناسه ملی', 'کد پستی', 'آدرس', 'مانده اول دوره', 'یادداشت'];
const PARTY_TYPE_IMPORT_MAP = {
  'مشتری': 'customer', customer: 'customer',
  'تأمین‌کننده': 'supplier', 'تامین‌کننده': 'supplier', 'تامین کننده': 'supplier', supplier: 'supplier',
  'کارمند': 'employee', employee: 'employee',
  'سهامدار': 'shareholder', shareholder: 'shareholder',
  'سایر': 'other', other: 'other',
};
function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}
function normalizePartyType(value) {
  const text = String(value || '').trim();
  return PARTY_TYPE_IMPORT_MAP[text] || PARTY_TYPE_IMPORT_MAP[text.toLowerCase()] || 'customer';
}
function normalizePartyImportRows(rows = []) {
  return rows.map((row) => ({
    party_type: normalizePartyType(firstValue(row, ['نوع شخص', 'party_type', 'type'])),
    display_name: String(firstValue(row, ['نام', 'نام شخص', 'display_name', 'name', 'customer_name']) || '').trim(),
    phone: String(firstValue(row, ['تلفن', 'موبایل', 'phone', 'mobile']) || '').trim(),
    economic_code: String(firstValue(row, ['کد اقتصادی', 'کد اقتصادي', 'economic_code', 'economicCode']) || '').trim(),
    registration_number: String(firstValue(row, ['شماره ثبت', 'registration_number', 'registrationNumber', 'register_no']) || '').trim(),
    national_id: String(firstValue(row, ['شناسه ملی', 'شناسه ملي', 'national_id', 'nationalId']) || '').trim(),
    postal_code: String(firstValue(row, ['کد پستی', 'کد پستي', 'postal_code', 'postalCode', 'zip']) || '').trim(),
    address: String(firstValue(row, ['آدرس', 'address']) || '').trim(),
    opening_balance: Number(firstValue(row, ['مانده اول دوره', 'opening_balance', 'balance']) || 0),
    notes: String(firstValue(row, ['یادداشت', 'توضیحات', 'notes']) || '').trim(),
  })).filter((row) => row.display_name);
}
function downloadPartyImportTemplate() {
  const sampleRows = [
    ['مشتری', 'شرکت نمونه پارسیان', '09120000000', '14009489849', '13452', '14009467259', '75169-13817', 'تهران، خیابان نمونه', 0, 'مشتری انتقالی از سیستم قبلی'],
    ['تأمین‌کننده', 'تأمین قطعات آریا', '02100000000', '11000000000', '2451', '10100000000', '81500-00000', 'اصفهان', 15000000, 'مانده اول دوره بستانکاری/بدهکاری با علامت عددی ثبت شود'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([PARTY_IMPORT_HEADERS, ...sampleRows]);
  ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 42 }, { wch: 18 }, { wch: 42 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'parties');
  XLSX.writeFile(wb, 'finance_parties_import_template.xlsx');
}

function PartyImportModal({ busy, onClose, onSubmit }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const normalized = normalizePartyImportRows(jsonRows);
        if (normalized.length === 0) throw new Error('هیچ ردیف معتبری در فایل پیدا نشد. ستون «نام» الزامی است.');
        setRows(normalized);
      } catch (err) {
        setRows([]);
        setError(getFriendlyErrorMessage(err, 'خطا در خواندن فایل اکسل'));
      }
    };
    reader.readAsArrayBuffer(file);
  }
  return <FinanceModal title="ورود گروهی اشخاص از Excel" onClose={onClose}>
    <div className="party-import-modal">
      <div className="finance-note">برای انتقال مشتریان از سیستم دیگر، فایل Excel را با قالب نمونه پر کنید. ستون‌های ضروری: نوع شخص، نام، تلفن؛ برای فاکتور رسمی ستون‌های کد اقتصادی، شماره ثبت، شناسه ملی و کد پستی را هم کامل کنید.</div>
      <div className="import-tools party-import-tools"><button type="button" onClick={downloadPartyImportTemplate}>دانلود قالب Excel نمونه</button><a className="template-link" href="/templates/finance_parties_import_template.xlsx" download>دانلود فایل نمونه آماده</a><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} /></div>
      {error && <div className="accounting-message error">{error}</div>}
      {rows.length > 0 && <><div className="finance-note success">{rows.length} ردیف معتبر آماده ثبت است.</div><div className="table-scroll limited-list"><table className="finance-table compact"><thead><tr><th>نوع</th><th>نام</th><th>تلفن</th><th>کد اقتصادی</th><th>شماره ثبت</th><th>شناسه ملی</th><th>کد پستی</th><th>مانده اول دوره</th><th>یادداشت</th></tr></thead><tbody>{rows.slice(0, 30).map((row, i) => <tr key={i}><td>{partyTypeLabel(row.party_type, 'fa')}</td><td>{row.display_name}</td><td dir="ltr">{row.phone || '—'}</td><td dir="ltr">{row.economic_code || '—'}</td><td dir="ltr">{row.registration_number || '—'}</td><td dir="ltr">{row.national_id || '—'}</td><td dir="ltr">{row.postal_code || '—'}</td><td>{formatMoney(row.opening_balance, 'fa')}</td><td>{row.notes || '—'}</td></tr>)}</tbody></table></div></>}
      <div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button disabled={busy || rows.length === 0} onClick={() => onSubmit(rows)}>{busy ? 'در حال ثبت...' : `ثبت ${rows.length} شخص`}</button></div>
    </div>
  </FinanceModal>;
}

function PartyModal({ initial, busy, onClose, onSubmit, onDelete }) {
  const [form, setForm] = useState({ party_type: initial?.party_type || 'customer', display_name: initial?.display_name || '', phone: initial?.phone || '', economic_code: initial?.economic_code || '', registration_number: initial?.registration_number || '', national_id: initial?.national_id || '', postal_code: initial?.postal_code || '', address: initial?.address || '', opening_balance: initial?.opening_balance || 0, notes: initial?.notes || '' });
  return <FinanceModal title={initial ? `ویرایش شخص: ${initial.display_name}` : 'ثبت شخص جدید'} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>نوع شخص</span><select value={form.party_type} onChange={(e)=>setForm({...form,party_type:e.target.value})}><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option><option value="employee">کارمند</option><option value="shareholder">سهامدار</option><option value="other">سایر</option></select></label><label className="finance-field"><span>نام</span><input value={form.display_name} onChange={(e)=>setForm({...form,display_name:e.target.value})} required/></label><label className="finance-field"><span>تلفن</span><input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label><label className="finance-field"><span>کد اقتصادی</span><input dir="ltr" value={form.economic_code} onChange={(e)=>setForm({...form,economic_code:e.target.value})}/></label><label className="finance-field"><span>شماره ثبت</span><input dir="ltr" value={form.registration_number} onChange={(e)=>setForm({...form,registration_number:e.target.value})}/></label><label className="finance-field"><span>شناسه ملی</span><input dir="ltr" value={form.national_id} onChange={(e)=>setForm({...form,national_id:e.target.value})}/></label><label className="finance-field"><span>کد پستی</span><input dir="ltr" value={form.postal_code} onChange={(e)=>setForm({...form,postal_code:e.target.value})}/></label><label className="finance-field"><span>مانده اول دوره</span><input type="number" value={form.opening_balance} onChange={(e)=>setForm({...form,opening_balance:e.target.value})}/></label><label className="finance-field full"><span>آدرس</span><textarea value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></label><label className="finance-field full"><span>یادداشت</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-note warning">حذف شخص به صورت امن انجام می‌شود و برای حفظ سوابق مالی، رکورد غیرفعال/مخفی می‌شود.</div><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button>{initial && <button type="button" className="danger-btn" disabled={busy} onClick={()=>onDelete?.(initial)}>حذف شخص</button>}<button disabled={busy || !form.display_name.trim()} onClick={()=>onSubmit(form)}>{initial ? 'ذخیره ویرایش' : 'ثبت شخص'}</button></div></FinanceModal>;
}

function PartyDeleteModal({ party, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('حذف/غیرفعال‌سازی شخص از لیست اشخاص مالی');
  return <FinanceModal title="تأیید حذف شخص مالی" onClose={onClose}><div className="confirm-finance party-delete-confirm"><p>آیا مطمئن هستید شخص «{party?.display_name}» از لیست اشخاص مالی حذف/غیرفعال شود؟</p><p className="muted">برای حفظ سوابق فاکتور، پرداخت و صورت‌حساب، حذف به صورت امن انجام می‌شود و اطلاعات از لیست فعال مخفی می‌شود.</p><textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="دلیل حذف..." autoFocus /><div className="finance-form-actions"><button type="button" onClick={onClose}>انصراف</button><button className="danger-btn" disabled={busy || !reason.trim()} onClick={()=>onConfirm(reason)}>بله، حذف/غیرفعال شود</button></div></div></FinanceModal>;
}


function OrderCostModal({ order, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ related_order_id: order?.order_id || order?.id || '', cost_type: 'other', amount: 0, notes: '' });
  return <FinanceModal title={`ثبت هزینه سفارش ${order?.order_code || ''}`} onClose={onClose}><div className="finance-form-grid"><label className="finance-field"><span>سفارش</span><input readOnly value={`${order?.order_code || '—'} · ${order?.company_name || order?.title_fa || ''}`}/></label><label className="finance-field"><span>نوع هزینه</span><select value={form.cost_type} onChange={(e)=>setForm({...form,cost_type:e.target.value})}><option value="material">متریال</option><option value="labor">دستمزد</option><option value="overhead">سربار</option><option value="purchase">خرید</option><option value="rnd">R&D</option><option value="warehouse">انبار</option><option value="shipping">حمل</option><option value="other">سایر</option></select></label><label className="finance-field"><span>مبلغ ریال</span><input type="number" value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})}/></label><label className="finance-field full"><span>شرح</span><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div><div className="finance-form-actions"><button onClick={onClose}>انصراف</button><button disabled={busy || Number(form.amount)<=0} onClick={()=>onSubmit(form)}>ثبت هزینه سفارش</button></div></FinanceModal>;
}

function modalTitle(type) {
  return ({ document: 'فاکتور / سند مالی جدید', orderInvoice: 'ساخت فاکتور از سفارش', payment: 'ثبت دریافت / پرداخت', check: 'ثبت چک', referral: 'ارجاع مالی' }[type] || 'فرم مالی');
}

function exportDocuments(docs, lang) {
  const headers = ['شماره', 'تاریخ', 'نوع', 'وضعیت', 'شخص', 'سفارش', 'مبلغ', 'پرداخت', 'مانده'];
  const rows = docs.map((d) => [d.doc_number, formatDate(d.issue_date, lang), docLabel(d.document_type, lang), STATUS_LABELS[d.status]?.[lang] || d.status, d.party_name, d.order_code, d.total_amount, d.paid_amount, d.balance_amount]);
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
    subtitle: 'بوشهر، بهمنی، خلیج فارس، پردیس فناوری',
    orientation: 'landscape',
    layout: 'invoice',
    meta: { number: d.doc_number, date: formatDate(d.issue_date, lang) },
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
function exportStatement(party, rows, lang) {
  const headers = ['تاریخ', 'شماره', 'نوع', 'شرح', 'بدهکار', 'بستانکار', 'تشخیص', 'مانده'];
  const body = (rows || []).map((r) => [
    formatDate(r.entry_date, lang),
    r.ref_number || '—',
    entryTypeLabel(r.entry_type, lang),
    r.description || '—',
    Number(r.debit_amount || 0) ? formatMoney(r.debit_amount, lang) : '0',
    Number(r.credit_amount || 0) ? formatMoney(r.credit_amount, lang) : '0',
    Number(r.running_balance || 0) >= 0 ? 'بدهکار' : 'بستانکار',
    formatMoney(Math.abs(Number(r.running_balance || 0)), lang),
  ]);
  downloadExcelHtml(`party-statement-${new Date().toISOString().slice(0, 10)}.xls`, headers, body, `صورت‌حساب ${party?.display_name || ''}`);
}

function printStatement(party, rows, lang) {
  const totalDebit = rows.reduce((sum, r) => sum + Number(r.debit_amount || 0), 0);
  const totalCredit = rows.reduce((sum, r) => sum + Number(r.credit_amount || 0), 0);
  const lastBalance = rows.length ? Number(rows[rows.length - 1].running_balance || 0) : Number(party.balance || 0);
  const bodyRows = rows.map((r, index) => {
    const balance = Number(r.running_balance || 0);
    const desc = `${htmlSafe(r.description || entryTypeLabel(r.entry_type, lang))}${r.ref_number ? `<br><small>شماره سند: ${htmlSafe(r.ref_number)}</small>` : ''}`;
    return `<tr class="${index % 2 === 1 ? 'alt' : ''}"><td>${index + 1}</td><td>${formatDate(r.entry_date, lang)}</td><td class="desc">${desc}</td><td class="money">${Number(r.debit_amount || 0) ? formatRial(r.debit_amount) : '۰'}</td><td class="money">${Number(r.credit_amount || 0) ? formatRial(r.credit_amount) : '۰'}</td><td class="status-cell">${balance >= 0 ? 'بدهکار' : 'بستانکار'}</td><td class="money">${formatRial(Math.abs(balance))}</td></tr>`;
  }).join('');

  openOfficialFinancePrint({
    title: `صورت‌حساب ${party.display_name}`,
    reportLabel: `گردش حساب شخص`,
    subtitle: 'بوشهر، بهمنی، خلیج فارس، پردیس فناوری',
    orientation: 'portrait',
    layout: 'statement',
    meta: { number: String(party.party_id || '').slice(0, 8), date: formatDate(new Date().toISOString().slice(0, 10), lang) },
    body: `
      <section class="box-row">
        <div class="box-grid four">
          <div class="field"><b>کد:</b> ${htmlSafe(String(party.party_id || '').slice(0, 8) || '—')}</div>
          <div class="field"><b>عنوان:</b> ${htmlSafe(party.display_name || '—')}</div>
          <div class="field"><b>نوع شخص:</b> ${partyTypeLabel(party.party_type, lang)}</div>
          <div class="field"><b>تلفن:</b> ${htmlSafe(party.phone || party.email || '—')}</div>
        </div>
      </section>
      <table class="official-table">
        <thead><tr><th>ردیف</th><th>تاریخ</th><th>شرح / شماره سند</th><th>بدهکار</th><th>بستانکار</th><th>تشخیص</th><th>مانده</th></tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="7">گردشی برای این شخص ثبت نشده است.</td></tr>'}</tbody>
        <tfoot><tr class="alt"><td colspan="3"><b>جمع و مانده نهایی</b></td><td class="money"><b>${formatRial(totalDebit)}</b></td><td class="money"><b>${formatRial(totalCredit)}</b></td><td><b>${lastBalance >= 0 ? 'بدهکار' : 'بستانکار'}</b></td><td class="money"><b>${formatRial(Math.abs(lastBalance))}</b></td></tr></tfoot>
      </table>
      <div class="continued">${rows.length > 18 ? 'ادامه دارد ...' : ''}</div>
      <div class="notes-box"><b>مانده نهایی حساب:</b> ${formatRial(Math.abs(lastBalance))} ${lastBalance >= 0 ? 'بدهکار' : 'بستانکار'} است.<br><b>مانده به حروف:</b> ${rialToPersianWords(Math.abs(lastBalance))} ${lastBalance >= 0 ? 'بدهکار می‌باشد.' : 'بستانکار می‌باشد.'}</div>
      <section class="signatures"><span>امضاء حسابداری</span><span>امضاء تأییدکننده</span><span>مهر شرکت</span></section>
    `,
  });
}
