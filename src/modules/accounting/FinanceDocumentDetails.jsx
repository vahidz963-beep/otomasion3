import { Banknote, FileText, History, Link2, Printer, ReceiptText } from 'lucide-react';
import { openOfficialFinancePrint } from '../../lib/financeApi';
import { formatJalaliDate, formatToman } from '../../lib/formatters';
import { formatRial, rialToPersianWords } from '../../lib/persianNumbers';

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

function esc(value) {
  return String(value ?? '').replace(/[&<>\"]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    return '&quot;';
  });
}

function shortCode(value) {
  return value ? String(value).slice(0, 8) : '—';
}

function printDocument(bundle, variant = 'company') {
  const d = bundle.document;
  const party = bundle.party || {};
  const order = bundle.order || {};
  const itemDiscountTotal = bundle.items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
  const discountTotal = Number(d.discount_amount || 0) + itemDiscountTotal;
  const rows = bundle.items.map((item, index) => {
    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const gross = qty * unitPrice;
    const finalAmount = Number(item.line_total || 0);
    return `
      <tr class="${index % 2 === 1 ? 'alt' : ''}">
        <td>${index + 1}</td>
        <td class="desc">${esc(item.description_fa)}</td>
        <td>${new Intl.NumberFormat('fa-IR').format(qty)}</td>
        <td>${esc(item.unit || '')}</td>
        <td class="money">${formatRial(unitPrice)}</td>
        <td class="money">${formatRial(gross)}</td>
        <td class="money">${formatRial(item.discount_amount || 0)}</td>
        <td class="money">${formatRial(finalAmount)}</td>
      </tr>
    `;
  }).join('');

  const companyReportLabel = d.document_type === 'sales_proforma'
    ? '( پیش‌فاکتور فروش )'
    : d.document_type === 'purchase_invoice'
      ? '( فاکتور خرید )'
      : d.document_type === 'expense_invoice'
        ? '( سند هزینه )'
        : '( فاکتور فروش )';
  const reportLabel = variant === 'official' ? 'صورت‌حساب فروش کالا و خدمات' : companyReportLabel;
  const sellerBlock = variant === 'official' ? `
      <div class="section-label">مشخصات فروشنده</div>
      <section class="box-row">
        <div class="box-grid four">
          <div class="field"><b>شرکت:</b> پیشرو الکترونیک آریامن پارس</div>
          <div class="field"><b>شماره اقتصادی:</b> 14009467259</div>
          <div class="field"><b>شماره ثبت:</b> 13452</div>
          <div class="field"><b>کد پستی:</b> 75169 - 13817</div>
          <div class="field" style="grid-column:1/-1"><b>نشانی:</b> بوشهر، بهمنی، نخلج فارس، پردیس فناوری · <b>تلفن:</b> 09173742966</div>
        </div>
      </section>` : '';

  openOfficialFinancePrint({
    title: `${DOC_LABELS[d.document_type] || d.document_type} ${d.doc_number}`,
    reportLabel,
    subtitle: 'بوشهر، بهمنی، نخلج فارس، پردیس فناوری',
    body: `
      <div class="section-label">مشخصات فاکتور</div>
      <section class="box-row">
        <div class="box-grid four">
          <div class="field"><b>شماره فاکتور:</b><br><span dir="ltr">${esc(d.doc_number)}</span></div>
          <div class="field"><b>تاریخ:</b> ${date(d.issue_date)}</div>
          <div class="field"><b>سررسید:</b> ${date(d.due_date)}</div>
          <div class="field"><b>وضعیت:</b> ${STATUS_LABELS[d.status] || d.status}</div>
        </div>
      </section>
      ${sellerBlock}
      <div class="section-label">مشخصات خریدار</div>
      <section class="box-row">
        <div class="box-grid two">
          <div class="field"><b>نام شخص حقیقی / حقوقی:</b> ${esc(party.display_name || order.customer_name || '—')}</div>
          <div class="field"><b>شناسه / کد:</b> ${esc(party.national_id || party.economic_code || shortCode(party.id || d.party_id))}</div>
          <div class="field"><b>تلفن تماس:</b> ${esc(party.phone || order.contact_phone || '—')}</div>
          <div class="field"><b>سفارش:</b> ${esc(order.order_code || d.related_order_id || '—')}</div>
          <div class="field" style="grid-column:1/-1"><b>نشانی:</b> ${esc(party.address || order.customer_city || '—')}</div>
        </div>
      </section>
      <div class="section-label">${variant === 'official' ? 'مشخصات کالا یا خدمات مورد معامله' : 'جزئیات اقلام'}</div>
      <table class="official-table">
        <thead><tr><th>ردیف</th><th>شرح کالا / خدمات</th><th>تعداد</th><th>واحد</th><th>مبلغ واحد</th><th>مبلغ کل</th><th>تخفیف</th><th>مبلغ نهایی</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">ردیفی ثبت نشده است.</td></tr>'}</tbody>
      </table>
      <div class="notes-box"><b>توضیحات:</b> ${esc(d.description || d.print_note || '—')}</div>
      <section class="totals-wrap">
        <table class="totals-table">
          <tbody>
            <tr><td>مبلغ کل فاکتور</td><td class="money">${formatRial(d.subtotal_amount)}</td></tr>
            <tr><td>تخفیف</td><td class="money">${formatRial(discountTotal)}</td></tr>
            <tr><td>مالیات</td><td class="money">${formatRial(d.tax_amount)}</td></tr>
            <tr><td>قابل پرداخت</td><td class="money">${formatRial(d.total_amount)}</td></tr>
            <tr><td>مانده فاکتور</td><td class="money">${formatRial(d.balance_amount)}</td></tr>
          </tbody>
        </table>
        <div class="amount-words">
          <b>مبلغ به حروف:</b> ${rialToPersianWords(d.total_amount)}
          <br><b>مانده حساب نهایی:</b> ${formatRial(d.balance_amount)} ${Number(d.balance_amount || 0) > 0 ? 'بدهکار می‌باشد.' : 'تسویه می‌باشد.'}
        </div>
      </section>
      <section class="signatures"><span>امضاء فروشنده</span><span>امضاء خریدار</span><span>امضاء تحویل‌گیرنده</span></section>
    `,
  });
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
  onClose,
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
        <div className="detail-header-actions"><span className={`status-badge ${d.status}`}>{STATUS_LABELS[d.status] || d.status}</span>{onClose && <button type="button" className="detail-close-btn" onClick={onClose}>×</button>}</div>
      </header>

      <div className="detail-actions">
        {!['void', 'cancelled'].includes(d.status) && <button disabled={busy} onClick={() => onEdit(d.id)}><FileText size={14} /> {['draft', 'pending_approval'].includes(d.status) ? 'ویرایش پیش‌نویس' : 'ویرایش / اصلاح فاکتور'}</button>}
        <button disabled={busy} onClick={() => onPost(d.id)}><ReceiptText size={14} /> ثبت سند حسابداری</button>
        {d.document_type === 'sales_proforma' && <button disabled={busy} onClick={() => onConvert(d.id)}>تبدیل به فاکتور</button>}
        {d.document_type === 'sales_invoice' && <button disabled={busy} onClick={() => onReturn(d.id)}>فاکتور برگشتی</button>}
        <button disabled={busy || d.status === 'void'} onClick={() => onVoid(d.id)}>ابطال</button>
        <button disabled={busy} onClick={() => onNewPayment(d.id)}><Banknote size={14} /> دریافت/پرداخت</button>
        <button disabled={busy} onClick={() => onNewReferral(d.id)}><Link2 size={14} /> ارجاع</button>
        <button onClick={() => printDocument(bundle, 'company')}><Printer size={14} /> چاپ شرکتی</button><button onClick={() => printDocument(bundle, 'official')}><Printer size={14} /> چاپ رسمی</button>
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
