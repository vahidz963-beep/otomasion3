import { Banknote, FileText, History, Link2, Printer, ReceiptText } from 'lucide-react';
import { openPrintableDocument } from '../../lib/financeApi';
import { formatJalaliDate, formatToman } from '../../lib/formatters';

const DOC_LABELS = {
  sales_proforma: 'پیش‌فاکتور فروش',
  sales_invoice: 'فاکتور فروش',
  purchase_invoice: 'فاکتور خرید',
  sales_return: 'فاکتور برگشتی فروش',
  purchase_return: 'برگشت از خرید',
  expense_invoice: 'هزینه',
  credit_note: 'یادداشت بستانکار',
  debit_note: 'یادداشت بدهکار',
  opening_balance: 'مانده افتتاحیه',
};

const STATUS_LABELS = {
  draft: 'پیش‌نویس',
  pending_approval: 'در انتظار تأیید',
  approved: 'تأیید شده',
  sent: 'ارسال شده',
  partially_paid: 'بخشی تسویه',
  paid: 'تسویه شده',
  cancelled: 'لغو شده',
  void: 'باطل شده',
};

function money(value) {
  return formatToman(value, 'fa');
}

function date(value) {
  return formatJalaliDate(value);
}

function printDocument(bundle) {
  const d = bundle.document;
  const rows = bundle.items.map((item) => `
    <tr>
      <td>${item.description_fa}</td>
      <td>${new Intl.NumberFormat('fa-IR').format(Number(item.quantity || 0))}</td>
      <td>${item.unit || ''}</td>
      <td class="money">${money(item.unit_price)}</td>
      <td>${new Intl.NumberFormat('fa-IR').format(Number(item.tax_rate || 0))}٪</td>
      <td class="money">${money(item.line_total)}</td>
    </tr>
  `).join('');

  openPrintableDocument(d.doc_number, `
    <h1>${DOC_LABELS[d.document_type] || d.document_type} ${d.doc_number}</h1>
    <div class="meta">
      <div><b>تاریخ:</b> ${date(d.issue_date)}</div>
      <div><b>سررسید:</b> ${date(d.due_date)}</div>
      <div><b>نوع:</b> ${d.is_official ? 'رسمی' : 'غیررسمی'}</div>
      <div><b>وضعیت:</b> ${STATUS_LABELS[d.status] || d.status}</div>
    </div>
    <table>
      <thead><tr><th>شرح</th><th>تعداد</th><th>واحد</th><th>فی</th><th>مالیات</th><th>جمع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>جمع کل: ${money(d.total_amount)}</h2>
    <p>پرداخت‌شده: ${money(d.paid_amount)} | مانده: ${money(d.balance_amount)}</p>
    <div class="footer"><span>امضای فروش</span><span>امضای مالی</span><span>مهر شرکت</span></div>
  `);
}

export default function FinanceDocumentDetails({
  bundle,
  loading,
  busy,
  onPost,
  onEdit,
  onConvert,
  onVoid,
  onReturn,
  onNewPayment,
  onNewReferral,
}) {
  const d = bundle.document;

  if (!d) {
    return (
      <section className="finance-card document-detail-card">
        <div className="finance-empty">برای مشاهده جزئیات، یک سند را انتخاب کنید.</div>
      </section>
    );
  }

  return (
    <section className="finance-card document-detail-card">
      <header className="detail-header">
        <div>
          <span className="detail-eyebrow">{DOC_LABELS[d.document_type] || d.document_type}</span>
          <h2>{d.doc_number}</h2>
          <p>{d.description || 'بدون توضیح'}</p>
        </div>
        <span className={`status-badge ${d.status}`}>{STATUS_LABELS[d.status] || d.status}</span>
      </header>

      <div className="detail-actions">
        {d.status === 'draft' && <button disabled={busy} onClick={() => onEdit(d.id)}><FileText size={14} /> ویرایش پیش‌نویس</button>}
        <button disabled={busy} onClick={() => onPost(d.id)}><ReceiptText size={14} /> ثبت سند حسابداری</button>
        {d.document_type === 'sales_proforma' && <button disabled={busy} onClick={() => onConvert(d.id)}>تبدیل به فاکتور</button>}
        {d.document_type === 'sales_invoice' && <button disabled={busy} onClick={() => onReturn(d.id)}>فاکتور برگشتی</button>}
        <button disabled={busy || d.status === 'void'} onClick={() => onVoid(d.id)}>ابطال</button>
        <button disabled={busy} onClick={() => onNewPayment(d.id)}><Banknote size={14} /> دریافت/پرداخت</button>
        <button disabled={busy} onClick={() => onNewReferral(d.id)}><Link2 size={14} /> ارجاع</button>
        <button onClick={() => printDocument(bundle)}><Printer size={14} /> چاپ/PDF</button>
      </div>

      {loading && <p className="muted">در حال دریافت جزئیات...</p>}

      <div className="detail-grid">
        <Info label="تاریخ صدور" value={date(d.issue_date)} />
        <Info label="سررسید" value={date(d.due_date)} />
        <Info label="رسمی/غیررسمی" value={d.is_official ? 'رسمی' : 'غیررسمی'} />
        <Info label="مانده" value={money(d.balance_amount)} highlight={Number(d.balance_amount) > 0} />
        <Info label="جمع قبل مالیات" value={money(d.subtotal_amount)} />
        <Info label="مالیات" value={money(d.tax_amount)} />
        <Info label="پرداخت‌شده" value={money(d.paid_amount)} />
        <Info label="جمع کل" value={money(d.total_amount)} />
      </div>

      <DetailBlock icon={FileText} title="اقلام سند">
        {bundle.items.length === 0 ? <p className="muted">ردیفی ثبت نشده است.</p> : (
          <div className="table-scroll">
            <table className="finance-table compact">
              <thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th><th>فی</th><th>مالیات</th><th>جمع</th></tr></thead>
              <tbody>{bundle.items.map((item) => <tr key={item.id}><td>{item.line_no}</td><td>{item.description_fa}</td><td>{item.quantity} {item.unit}</td><td>{money(item.unit_price)}</td><td>{item.tax_rate}٪</td><td>{money(item.line_total)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </DetailBlock>

      <DetailBlock icon={Banknote} title="پرداخت‌های مرتبط">
        {bundle.payments.length === 0 ? <p className="muted">پرداختی برای این سند ثبت نشده است.</p> : (
          <div className="table-scroll">
            <table className="finance-table compact">
              <thead><tr><th>شماره</th><th>نوع</th><th>روش</th><th>تاریخ</th><th>مبلغ</th></tr></thead>
              <tbody>{bundle.payments.map((p) => <tr key={p.id}><td dir="ltr">{p.payment_number}</td><td>{p.direction === 'receipt' ? 'دریافت' : 'پرداخت'}</td><td>{p.method}</td><td>{date(p.payment_date)}</td><td>{money(p.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </DetailBlock>

      <DetailBlock icon={History} title="تاریخچه سند">
        {bundle.events.length === 0 ? <p className="muted">رویدادی ثبت نشده است.</p> : <div className="timeline-list">{bundle.events.map((e) => <article key={e.id}><strong>{e.description}</strong><small>{date(e.created_at)} · {e.actor_name || 'سیستم'}</small></article>)}</div>}
      </DetailBlock>
    </section>
  );
}

function Info({ label, value, highlight }) {
  return <div className={highlight ? 'detail-info highlight' : 'detail-info'}><span>{label}</span><strong>{value}</strong></div>;
}

function DetailBlock({ icon: Icon, title, children }) {
  return <div className="detail-block"><h3><Icon size={16} /> {title}</h3>{children}</div>;
}
