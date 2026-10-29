import { useMemo, useState } from 'react';
import JalaliDateInput from '../../components/JalaliDateInput';
import ProductPicker from '../../components/ProductPicker';
import SearchableSelect from '../../components/SearchableSelect';
import MoneyInput from '../../components/MoneyInput';

const DOC_TYPES = [
  ['sales_proforma', 'پیش‌فاکتور فروش'],
  ['sales_invoice', 'فاکتور فروش'],
  ['purchase_invoice', 'فاکتور خرید'],
  ['expense_invoice', 'سند هزینه'],
];

export function FinanceModal({ title, onClose, children, footer }) {
  return (
    <div className="finance-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="finance-modal" role="dialog" aria-modal="true">
        <header className="finance-modal-header">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="finance-modal-body">{children}</div>
        <footer className="finance-modal-footer">{footer}</footer>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return <label className={full ? 'finance-field full' : 'finance-field'}><span>{label}</span>{children}</label>;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function FinanceDocumentForm({ parties, orders = [], stock = [], initialDocument, initialItems, onCancel, onSubmit, busy }) {
  const isConfirmedEdit = Boolean(initialDocument?.id) && !['draft', 'pending_approval'].includes(initialDocument?.status);
  const [document, setDocument] = useState({
    document_type: initialDocument?.document_type || 'sales_invoice',
    party_id: initialDocument?.party_id || parties[0]?.party_id || '',
    issue_date: initialDocument?.issue_date || today(),
    due_date: initialDocument?.due_date || addDays(7),
    is_official: initialDocument?.is_official ?? true,
    related_order_id: initialDocument?.related_order_id || '',
    description: initialDocument?.description || '',
    print_note: initialDocument?.print_note || '',
  });
  const [discountMode, setDiscountMode] = useState(initialDocument?.discount_amount ? 'amount' : 'percent');
  const [discountValue, setDiscountValue] = useState(initialDocument?.discount_amount || 0);
  const [items, setItems] = useState(
    initialItems?.length
      ? initialItems.map((item) => ({
          description_fa: item.description_fa || '',
          description_en: item.description_en || '',
          quantity: item.quantity || 1,
          unit: item.unit || 'عدد',
          unit_price: item.unit_price || 0,
          discount_amount: item.discount_amount || 0,
          tax_rate: item.tax_rate || 0,
          item_type: item.item_type || 'service',
          warehouse_item_id: item.warehouse_item_id || null,
          order_item_id: item.order_item_id || null,
          expense_category_id: item.expense_category_id || null,
          cost_center_id: item.cost_center_id || null,
          price_currency_snapshot: item.price_currency_snapshot || null,
          base_cost_price_snapshot: item.base_cost_price_snapshot ?? null,
          base_sale_price_snapshot: item.base_sale_price_snapshot ?? null,
          exchange_rate_rial_snapshot: item.exchange_rate_rial_snapshot ?? null,
          catalog_cost_rial_snapshot: item.catalog_cost_rial_snapshot ?? null,
          catalog_sale_rial_snapshot: item.catalog_sale_rial_snapshot ?? null,
          price_snapshot_at: item.price_snapshot_at || null,
        }))
      : [{ description_fa: 'شرح کالا / خدمت', quantity: 1, unit: 'عدد', unit_price: 0, discount_amount: 0, tax_rate: 10, item_type: 'service' }]
  );

  const totals = useMemo(() => items.reduce((acc, item) => {
    const base = Math.max(Number(item.quantity || 0) * Number(item.unit_price || 0) - Number(item.discount_amount || 0), 0);
    const tax = base * Number(item.tax_rate || 0) / 100;
    return { subtotal: acc.subtotal + base, tax: acc.tax + tax, total: acc.total + base + tax };
  }, { subtotal: 0, tax: 0, total: 0 }), [items]);

  const discountBase = totals.subtotal;
  const headerDiscount = Math.min(Math.max(Number(discountMode === 'percent' ? discountBase * Number(discountValue || 0) / 100 : discountValue || 0), 0), discountBase);

  const partyOptions = useMemo(() => parties.map((p) => ({
    value: p.party_id || p.id,
    label: `${p.customer_code ? `${p.customer_code} · ` : ''}${p.display_name || p.party_name || 'بدون نام'}`,
    description: `${p.phone || ''}${p.economic_code ? ` · کد اقتصادی ${p.economic_code}` : ''}${p.national_id ? ` · شناسه ${p.national_id}` : ''}`.trim(),
    searchText: `${p.display_name || ''} ${p.phone || ''} ${p.economic_code || ''} ${p.registration_number || ''} ${p.national_id || ''} ${p.postal_code || ''}`,
  })), [parties]);

  function updateItem(index, patch) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function selectStockItem(index, selected) {
    updateItem(index, {
      warehouse_item_code: selected?.item_code || '',
      warehouse_item_id: selected?.item_id || null,
      description_fa: selected?.item_name_fa || items[index]?.description_fa || '',
      description_en: selected?.item_name_en || items[index]?.description_en || '',
      unit: selected?.unit || items[index]?.unit || 'عدد',
      unit_price: selected?.effective_sale_price ?? selected?.unit_price_estimate ?? items[index]?.unit_price ?? 0,
      item_type: selected ? 'goods' : (items[index]?.item_type || 'service'),
      price_currency_snapshot: null,
      base_cost_price_snapshot: null,
      base_sale_price_snapshot: null,
      exchange_rate_rial_snapshot: null,
      catalog_cost_rial_snapshot: null,
      catalog_sale_rial_snapshot: null,
      price_snapshot_at: null,
    });
  }

  function submit(e) {
    e.preventDefault();
    onSubmit({ documentId: initialDocument?.id || null, document: { ...document, party_id: document.party_id || null, related_order_id: document.related_order_id || null, discount_amount: headerDiscount }, items });
  }

  return <form onSubmit={submit}>
    <div className="finance-form-grid">
      <Field label="نوع سند"><select value={document.document_type} disabled={isConfirmedEdit} title={isConfirmedEdit ? 'در اصلاح فاکتور تأییدشده، نوع سند برای جلوگیری از به‌هم‌ریختن اسناد وابسته ثابت می‌ماند.' : ''} onChange={(e) => setDocument({ ...document, document_type: e.target.value })}>{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="شخص"><SearchableSelect options={partyOptions} value={document.party_id} onChange={(value) => setDocument({ ...document, party_id: value })} placeholder="نام، تلفن، کد اقتصادی یا شناسه ملی شخص را بنویس..." emptyText="شخصی پیدا نشد." /></Field>
      <Field label="سفارش مرتبط"><select value={document.related_order_id} onChange={(e) => setDocument({ ...document, related_order_id: e.target.value })}><option value="">بدون سفارش</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name || '—'}</option>)}</select></Field>
      <Field label="تاریخ صدور شمسی"><JalaliDateInput value={document.issue_date} onChange={(value) => setDocument({ ...document, issue_date: value })} /></Field>
      <Field label="سررسید شمسی"><JalaliDateInput value={document.due_date} onChange={(value) => setDocument({ ...document, due_date: value })} /></Field>
      <Field label="نوع رسمی/غیررسمی"><select value={document.is_official ? 'true' : 'false'} onChange={(e) => setDocument({ ...document, is_official: e.target.value === 'true' })}><option value="true">رسمی</option><option value="false">غیررسمی</option></select></Field>
      <Field label="نوع تخفیف"><select value={discountMode} onChange={(e) => setDiscountMode(e.target.value)}><option value="percent">درصدی</option><option value="amount">مبلغی</option></select></Field><Field label={discountMode === "percent" ? "درصد تخفیف" : "مبلغ تخفیف ریال"}><input type="number" min="0" max={discountMode === "percent" ? 100 : undefined} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} /></Field>
      <Field label="شرح داخلی / عمومی" full><textarea value={document.description} onChange={(e) => setDocument({ ...document, description: e.target.value })} /></Field>
      <Field label="📝 جزئیات زیر فاکتور در چاپ" full><textarea value={document.print_note} onChange={(e) => setDocument({ ...document, print_note: e.target.value })} placeholder="متنی که باید پایین فاکتور/پیش‌فاکتور چاپ شود؛ مثل شرایط پرداخت، زمان تحویل، توضیحات فنی یا توضیحات رسمی..." /></Field>
    </div>

    {isConfirmedEdit && <div className="finance-note warning">این فاکتور قبلاً تأیید/ثبت شده است. اصلاح به‌صورت اتمیک ثبت می‌شود؛ رزرو/سند انبار قدیمی با سابقه قابل‌ردیابی همگام می‌شود و سند خروج محموله فیزیکی بدون لغو یا بازنویسی باقی می‌ماند.</div>}

    <div className="line-editor">
      <table>
        <thead><tr><th>کد کالا</th><th>شرح</th><th>تعداد</th><th>واحد</th><th>فی ریال</th><th>تخفیف</th><th>مالیات٪</th><th></th></tr></thead>
        <tbody>{items.map((item, index) => <tr key={index}>
          <td><ProductPicker items={stock} value={item.warehouse_item_id || item.warehouse_item_code || ''} onSelect={(selected) => selectStockItem(index, selected)} placeholder="کد یا نام کالا را بنویس..." /></td>
          <td><input value={item.description_fa} onChange={(e) => updateItem(index, { description_fa: e.target.value })} /></td>
          <td><input type="number" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} /></td>
          <td><input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} /></td>
          <td><MoneyInput value={item.unit_price} onChange={(value) => updateItem(index, { unit_price: value })} /></td>
          <td><MoneyInput value={item.discount_amount} onChange={(value) => updateItem(index, { discount_amount: value })} /></td>
          <td><input type="number" value={item.tax_rate} onChange={(e) => updateItem(index, { tax_rate: e.target.value })} /></td>
          <td><button type="button" onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}>×</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <button className="mini-btn" type="button" onClick={() => setItems((rows) => [...rows, { warehouse_item_code: '', description_fa: 'ردیف جدید', quantity: 1, unit: 'عدد', unit_price: 0, discount_amount: 0, tax_rate: 10, item_type: 'service' }])}>＋ افزودن ردیف</button>
    <div className="form-summary"><span>جمع قبل مالیات: {Math.round(totals.subtotal).toLocaleString('fa-IR')} ریال</span><span>مالیات: {Math.round(totals.tax).toLocaleString('fa-IR')} ریال</span><b>جمع کل: {Math.round(totals.total).toLocaleString('fa-IR')} ریال</b></div>
    <HiddenSubmit busy={busy} onCancel={onCancel} />
  </form>;
}

export function FinancePaymentForm({
  parties,
  documents,
  accounts,
  cashboxes = [],
  loans = [],
  categories = [],
  initialDocumentId,
  initialDirection = 'receipt',
  initialMethod = '',
  initialPayment = null,
  initialDirectLines = [],
  categoryMode = false,
  onCancel,
  onSubmit,
  busy,
}) {
  const directRevision = Boolean(initialPayment?.direct_settlement_id);
  const initialDirectMethod = initialPayment?.method === 'direct_expense_offset' || initialMethod === 'direct_expense_offset';
  const [payment, setPayment] = useState({
    direction: initialDirectMethod ? 'receipt' : (initialPayment?.direction || initialDirection),
    method: initialPayment?.method || initialMethod || 'bank_transfer',
    party_id: initialPayment?.party_id || '',
    payment_date: initialPayment?.payment_date || today(),
    amount: initialPayment?.amount || 0,
    currency: initialPayment?.currency || 'IRR',
    bank_account_id: initialPayment?.bank_account_id || accounts[0]?.id || '',
    cashbox_id: initialPayment?.cashbox_id || '',
    transfer_to_bank_account_id: initialPayment?.transfer_to_bank_account_id || '',
    description: initialPayment?.description || '',
    loan_id: initialPayment?.loan_id || '',
    category_id: initialPayment?.category_id || '',
    category_note: initialPayment?.category_note || '',
    direct_settlement_id: initialPayment?.direct_settlement_id || '',
    revision_reason: '',
  });
  const [documentId, setDocumentId] = useState(initialPayment?.document_id || initialDocumentId || '');
  const [multiMode, setMultiMode] = useState(false);
  const [paymentRows, setPaymentRows] = useState([{ amount: initialPayment?.amount || 0, description: initialPayment?.description || '' }]);
  const [directExpenseRows, setDirectExpenseRows] = useState(
    initialDirectLines.length
      ? initialDirectLines.map((line) => ({
          line_type: line.line_type === 'party_payment' ? 'party_payment' : 'expense',
          category_id: line.category_id || '',
          target_party_id: line.target_party_id || '',
          amount: line.line_amount ?? line.amount ?? 0,
          description: line.line_description ?? line.description ?? '',
        }))
      : [{ line_type: 'expense', category_id: '', target_party_id: '', amount: 0, description: '' }]
  );
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() || `direct-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const isDirectExpense = payment.method === 'direct_expense_offset';
  const payableDocs = useMemo(() => documents.filter((doc) => {
    if (payment.party_id && doc.party_id !== payment.party_id) return false;
    if (isDirectExpense && !['sales_invoice', 'debit_note', 'purchase_return'].includes(doc.document_type)) return false;
    const revisionRestoredAmount = directRevision && doc.id === initialPayment?.document_id ? Number(initialPayment?.amount || 0) : 0;
    return Number(doc.balance_amount || 0) + revisionRestoredAmount > 0 && !['void', 'cancelled', 'draft', 'pending_approval'].includes(doc.status);
  }), [documents, payment.party_id, isDirectExpense, directRevision, initialPayment?.document_id, initialPayment?.amount]);
  const selectedDoc = payableDocs.find((doc) => doc.id === documentId) || documents.find((doc) => doc.id === documentId);
  const selectedParty = parties.find((party) => (party.party_id || party.id) === payment.party_id);
  const selectedLoan = loans.find((loan) => loan.id === payment.loan_id);
  const categoryType = isDirectExpense ? 'expense' : (payment.direction === 'receipt' ? 'income' : 'expense');
  const categoryOptions = categories.filter((item) => item.category_type === categoryType && item.is_active !== false);
  const selectedCategory = categories.find((item) => item.id === payment.category_id);
  const directTotal = directExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const receivedAmount = Number(payment.amount || 0);
  const existingDirectAmount = directRevision && initialPayment?.party_id === payment.party_id ? Number(initialPayment?.amount || 0) : 0;
  const sourceBalanceBefore = Number(selectedParty?.balance || 0) + existingDirectAmount;
  const sourceBalanceAfter = sourceBalanceBefore - receivedAmount;
  const directDifference = receivedAmount - directTotal;
  const directRowsAreValid = directExpenseRows.length > 0 && directExpenseRows.every((row) => {
    if (Number(row.amount) <= 0) return false;
    if (row.line_type === 'party_payment') return Boolean(row.target_party_id) && row.target_party_id !== payment.party_id;
    return Boolean(row.category_id);
  });
  const totalAmount = multiMode
    ? paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    : Number(payment.amount || 0);

  function changeMethod(method) {
    if (method === 'direct_expense_offset') {
      setPayment((current) => ({
        ...current,
        method,
        direction: 'receipt',
        amount: 0,
        bank_account_id: '',
        cashbox_id: '',
        transfer_to_bank_account_id: '',
        loan_id: '',
        category_id: '',
        category_note: '',
      }));
      setMultiMode(false);
      setDocumentId('');
      return;
    }
    setPayment((current) => ({
      ...current,
      method,
      cashbox_id: method === 'cash' ? (current.cashbox_id || cashboxes[0]?.id || '') : '',
      bank_account_id: method === 'cash' ? '' : (current.bank_account_id || accounts[0]?.id || ''),
      transfer_to_bank_account_id: method === 'bank_transfer' ? current.transfer_to_bank_account_id : '',
      loan_id: method === 'loan_payment' ? current.loan_id : '',
    }));
  }

  function changeDirection(direction) {
    const wantedType = direction === 'receipt' ? 'income' : 'expense';
    const categoryStillValid = categories.some((item) => item.id === payment.category_id && item.category_type === wantedType);
    setPayment({ ...payment, direction, category_id: categoryStillValid ? payment.category_id : '' });
  }

  function updateDirectRow(index, patch) {
    setDirectExpenseRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function addDirectRow() {
    setDirectExpenseRows((rows) => [...rows, { line_type: 'expense', category_id: '', target_party_id: '', amount: 0, description: '' }]);
  }

  function removeDirectRow(index) {
    setDirectExpenseRows((rows) => rows.length === 1 ? rows : rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function submit(e) {
    e.preventDefault();
    if (isDirectExpense) {
      const relatedOrderId = selectedDoc?.related_order_id || initialPayment?.related_order_id || null;
      onSubmit({
        paymentId: null,
        payment: {
          direction: 'receipt',
          method: 'direct_expense_offset',
          party_id: payment.party_id,
          payment_date: payment.payment_date,
          amount: receivedAmount,
          currency: 'IRR',
          bank_account_id: null,
          cashbox_id: null,
          related_order_id: relatedOrderId,
          description: payment.description,
          direct_settlement_id: payment.direct_settlement_id || null,
          revision_reason: payment.revision_reason,
          idempotency_key: idempotencyKey,
        },
        allocations: documentId ? [{ document_id: documentId, amount: receivedAmount }] : [],
        directExpenseLines: directExpenseRows.map((row) => ({
          line_type: row.line_type === 'party_payment' ? 'party_payment' : 'expense',
          category_id: row.line_type === 'party_payment' ? null : row.category_id,
          target_party_id: row.line_type === 'party_payment' ? row.target_party_id : null,
          amount: Number(row.amount || 0),
          description: row.description,
        })),
        rows: [],
      });
      return;
    }

    const cleanPayment = {
      ...payment,
      loan_id: payment.method === 'loan_payment' ? payment.loan_id || null : null,
      bank_account_id: payment.method === 'cash' ? null : payment.bank_account_id || null,
      cashbox_id: payment.method === 'cash' ? payment.cashbox_id || null : null,
      transfer_to_bank_account_id: payment.method === 'bank_transfer' ? payment.transfer_to_bank_account_id || null : null,
      category_id: payment.category_id || null,
      category_note: payment.category_note || null,
      amount: totalAmount,
    };
    onSubmit({
      paymentId: initialPayment?.id || null,
      payment: cleanPayment,
      allocations: documentId ? [{ document_id: documentId, amount: totalAmount }] : [],
      rows: multiMode ? paymentRows : [],
    });
  }

  const targetRequired = payment.method === 'cash' ? payment.cashbox_id : payment.bank_account_id;
  const transferIsValid = payment.method !== 'bank_transfer'
    || !payment.transfer_to_bank_account_id
    || payment.transfer_to_bank_account_id !== payment.bank_account_id;
  const loanIsValid = payment.method !== 'loan_payment' || payment.loan_id;
  const categoryIsValid = !categoryMode || payment.category_id;
  const selectedDocumentAvailable = selectedDoc
    ? Number(selectedDoc.balance_amount || 0) + (directRevision && selectedDoc.id === initialPayment?.document_id ? Number(initialPayment?.amount || 0) : 0)
    : null;
  const directIsValid = !isDirectExpense || (
    payment.party_id
    && receivedAmount > 0
    && directRowsAreValid
    && Math.abs(directDifference) < 0.005
    && (!directRevision || payment.revision_reason.trim())
  );
  const canSubmit = isDirectExpense
    ? directIsValid
    : (totalAmount > 0 && targetRequired && transferIsValid && loanIsValid && categoryIsValid);

  return (
    <form className="finance-form" onSubmit={submit}>
      {directRevision && (
        <div className="finance-alert direct-expense-revision-note">
          این ویرایش، نسخه قبلی را حذف نمی‌کند؛ سند قبلی با دلیل ثبت‌شده باطل و یک نسخه جایگزین ایجاد می‌شود.
        </div>
      )}
      {isDirectExpense && (
        <div className="finance-alert direct-expense-info">
          <b>حواله مستقیم؛ دریافت از یک شخص و تخصیص دقیق پرداخت‌ها</b>
          <span>مبلغ از شخص مبدأ به‌صورت غیرنقدی دریافت و میان هزینه‌های شرکت یا پرداخت به اشخاص دیگر تقسیم می‌شود. هیچ بانک، کارت یا صندوقی درگیر نیست.</span>
        </div>
      )}

      <div className="finance-form-grid">
        {!categoryMode && !isDirectExpense && <Field label="نوع"><select value={payment.direction} onChange={(e) => changeDirection(e.target.value)}><option value="receipt">دریافت</option><option value="payment">پرداخت</option></select></Field>}
        {isDirectExpense && <Field label="نوع اثر حسابداری"><input readOnly value="دریافت از مبدأ + هزینه / پرداخت به شخص" /></Field>}
        <Field label="روش">
          <select value={payment.method} disabled={isDirectExpense || directRevision} onChange={(e) => changeMethod(e.target.value)}>
            {isDirectExpense && <option value="direct_expense_offset">حواله مستقیم (غیرنقدی)</option>}
            {!isDirectExpense && <>
              <option value="bank_transfer">واریز / انتقال بانکی</option>
              <option value="card">کارت</option>
              <option value="pos">کارت‌خوان</option>
              <option value="cash">نقدی / صندوق</option>
              <option value="check">چک</option>
              <option value="offset">تهاتر</option>
              {payment.direction === 'payment' && !categoryMode && <option value="loan_payment">پرداخت وام</option>}
              <option value="other">سایر</option>
            </>}
          </select>
        </Field>

        {categoryMode && !isDirectExpense && <Field label={payment.direction === 'receipt' ? 'دسته درآمد' : 'دسته هزینه'}><select value={payment.category_id} onChange={(e) => setPayment({ ...payment, category_id: e.target.value })}><option value="">انتخاب دسته</option>{categoryOptions.map((item) => <option key={item.id} value={item.id}>{item.parent_name_fa ? `${item.parent_name_fa} / ` : ''}{item.name_fa}</option>)}</select></Field>}
        {categoryMode && !isDirectExpense && <Field label="نوع عملیات"><select value={payment.direction} onChange={(e) => changeDirection(e.target.value)}><option value="payment">ثبت هزینه</option><option value="receipt">ثبت درآمد</option></select></Field>}

        <Field label={isDirectExpense ? 'شخص مبدأ' : 'شخص'}>
          <SearchableSelect
            value={payment.party_id}
            onChange={(value) => { setPayment({ ...payment, party_id: value }); setDocumentId(''); }}
            options={parties.map((party) => {
              const balance = Number(party.balance || 0);
              return {
                value: party.party_id || party.id,
                label: isDirectExpense
                  ? `${party.display_name} · ${new Intl.NumberFormat('fa-IR').format(Math.abs(balance))} ریال ${balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'تسویه'}`
                  : party.display_name,
                searchText: `${party.display_name || ''} ${party.phone || ''} ${party.national_id || ''}`,
              };
            })}
            placeholder={isDirectExpense ? 'جست‌وجو و انتخاب شخص مبدأ' : 'جست‌وجو و انتخاب شخص'}
            emptyText="شخصی یافت نشد"
          />
        </Field>
        <Field label="تاریخ"><JalaliDateInput value={payment.payment_date} onChange={(value) => setPayment({ ...payment, payment_date: value })} /></Field>
        {isDirectExpense && <Field label="مبلغ دریافتی"><MoneyInput value={payment.amount} onChange={(value) => setPayment({ ...payment, amount: value })} /></Field>}

        {isDirectExpense && (
          <Field label="فاکتور مرتبط (اختیاری)" full>
            <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">بدون تخصیص به فاکتور</option>
              {payableDocs.map((doc) => { const restored = directRevision && doc.id === initialPayment?.document_id ? Number(initialPayment?.amount || 0) : 0; return <option key={doc.id} value={doc.id}>{doc.doc_number} · مانده قابل تخصیص {new Intl.NumberFormat('fa-IR').format(Number(doc.balance_amount || 0) + restored)} ریال{doc.order_code ? ` · سفارش ${doc.order_code}` : ''}</option>; })}
            </select>
          </Field>
        )}

        {!isDirectExpense && payment.method === 'loan_payment' && <Field label="وام"><select value={payment.loan_id} onChange={(e) => { const loanId = e.target.value; const loan = loans.find((item) => item.id === loanId); setPayment({ ...payment, loan_id: loanId, amount: Number(loan?.remaining_debt || payment.amount || 0) }); }}><option value="">انتخاب وام</option>{loans.filter((loan) => !['closed', 'cancelled', 'archived'].includes(loan.status)).map((loan) => <option key={loan.id} value={loan.id}>{loan.loan_number} · {loan.title_fa} · مانده {Number(loan.remaining_debt || 0).toLocaleString('fa-IR')} ریال</option>)}</select>{selectedLoan && <small className="field-help">پرداخت از اولین قسط باز وام اعمال می‌شود.</small>}</Field>}
        {!isDirectExpense && payment.method === 'cash'
          ? <Field label="صندوق"><select value={payment.cashbox_id} onChange={(e) => setPayment({ ...payment, cashbox_id: e.target.value })}><option value="">انتخاب صندوق</option>{cashboxes.map((cashbox) => <option key={cashbox.id} value={cashbox.id}>{cashbox.name}</option>)}</select></Field>
          : !isDirectExpense && <Field label="حساب بانک / کارت"><select value={payment.bank_account_id} onChange={(e) => setPayment({ ...payment, bank_account_id: e.target.value })}><option value="">انتخاب حساب/کارت</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} · {account.bank_name || ''}{account.card_number ? ` · ${account.card_number}` : ''}</option>)}</select></Field>}
        {!isDirectExpense && payment.method === 'bank_transfer' && <Field label="حساب مقصد انتقال (اختیاری)"><select value={payment.transfer_to_bank_account_id} onChange={(e) => setPayment({ ...payment, transfer_to_bank_account_id: e.target.value })}><option value="">انتقال داخلی نیست / بدون مقصد</option>{accounts.filter((account) => account.id !== payment.bank_account_id).map((account) => <option key={account.id} value={account.id}>{account.account_name} · {account.bank_name || ''}</option>)}</select></Field>}

        {!isDirectExpense && !multiMode && <Field label="مبلغ"><MoneyInput value={payment.amount} onChange={(value) => setPayment({ ...payment, amount: value })} /></Field>}
        {!isDirectExpense && !categoryMode && <Field label="تخصیص به فاکتور"><select value={documentId} onChange={(e) => { const value = e.target.value; setDocumentId(value); const doc = payableDocs.find((item) => item.id === value); if (doc && !multiMode) setPayment({ ...payment, party_id: doc.party_id, amount: doc.balance_amount }); }}><option value="">بدون تخصیص</option>{payableDocs.map((doc) => <option key={doc.id} value={doc.id}>{doc.doc_number} · {Number(doc.balance_amount).toLocaleString('fa-IR')} ریال</option>)}</select></Field>}
        {!isDirectExpense && <Field label="ارز"><select value={payment.currency} onChange={(e) => setPayment({ ...payment, currency: e.target.value })}><option value="IRR">ریال</option><option value="USD">دلار</option><option value="EUR">یورو</option><option value="AED">درهم</option></select></Field>}
        {!isDirectExpense && categoryMode && <Field label="جزئیات دسته" full><input value={payment.category_note} onChange={(e) => setPayment({ ...payment, category_note: e.target.value })} placeholder={selectedCategory ? `جزئیات ${selectedCategory.name_fa}` : 'مثلاً شماره رسید، نام فروشنده یا علت هزینه'} /></Field>}
        <Field label={isDirectExpense ? 'شرح کلی حواله' : 'شرح'} full><textarea value={payment.description} onChange={(e) => setPayment({ ...payment, description: e.target.value })} placeholder={isDirectExpense ? 'توضیح درباره دریافت از شخص مبدأ و نحوه تخصیص پرداخت‌ها' : ''} /></Field>
        {directRevision && <Field label="دلیل اصلاح نسخه‌دار" full><textarea value={payment.revision_reason} onChange={(e) => setPayment({ ...payment, revision_reason: e.target.value })} placeholder="دلیل تغییر مبلغ، ردیف‌ها یا اطلاعات سند را دقیق بنویسید" required /></Field>}
      </div>

      {isDirectExpense && (
        <section className="direct-expense-lines-editor direct-transfer-lines-editor">
          <div className="payment-rows-header">
            <div><b>ردیف‌های پرداخت حواله</b><small>هر ردیف «هزینه» یا «پرداخت به شخص» است و جمع همه ردیف‌ها باید دقیقاً برابر مبلغ دریافتی باشد.</small></div>
            <button type="button" className="mini-btn" onClick={addDirectRow}>＋ افزودن ردیف پرداخت</button>
          </div>
          <div className="direct-expense-lines-head direct-transfer-lines-head" aria-hidden="true"><span>ردیف</span><span>نوع</span><span>دسته هزینه / شخص مقصد</span><span>مبلغ ریال</span><span>شرح ردیف</span><span>عملیات</span></div>
          {directExpenseRows.map((row, index) => (
            <div className="direct-expense-line direct-transfer-line" key={`direct-transfer-${index}`}>
              <span className="direct-expense-line-number">{new Intl.NumberFormat('fa-IR').format(index + 1)}</span>
              <select
                value={row.line_type || 'expense'}
                onChange={(event) => updateDirectRow(index, {
                  line_type: event.target.value,
                  category_id: '',
                  target_party_id: '',
                })}
              >
                <option value="expense">هزینه</option>
                <option value="party_payment">پرداخت به شخص</option>
              </select>
              {row.line_type === 'party_payment' ? (
                <SearchableSelect
                  value={row.target_party_id}
                  onChange={(value) => updateDirectRow(index, { target_party_id: value })}
                  options={parties.filter((party) => (party.party_id || party.id) !== payment.party_id).map((party) => {
                    const balance = Number(party.balance || 0);
                    return {
                      value: party.party_id || party.id,
                      label: `${party.display_name} · ${new Intl.NumberFormat('fa-IR').format(Math.abs(balance))} ریال ${balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'تسویه'}`,
                      searchText: `${party.display_name || ''} ${party.phone || ''} ${party.national_id || ''}`,
                    };
                  })}
                  placeholder="انتخاب شخص مقصد"
                  emptyText="شخص مقصدی یافت نشد"
                />
              ) : (
                <SearchableSelect
                  value={row.category_id}
                  onChange={(value) => updateDirectRow(index, { category_id: value })}
                  options={categoryOptions.map((item) => ({
                    value: item.id,
                    label: `${item.parent_name_fa ? `${item.parent_name_fa} / ` : ''}${item.name_fa}`,
                    searchText: `${item.name_fa || ''} ${item.parent_name_fa || ''} ${item.code || ''}`,
                  }))}
                  placeholder="انتخاب دسته هزینه"
                  emptyText="دسته هزینه‌ای یافت نشد"
                />
              )}
              <MoneyInput value={row.amount} onChange={(value) => updateDirectRow(index, { amount: value })} />
              <input value={row.description} onChange={(e) => updateDirectRow(index, { description: e.target.value })} placeholder={row.line_type === 'party_payment' ? 'شرح پرداخت به شخص' : 'شرح هزینه'} />
              <button type="button" className="mini-btn danger" disabled={directExpenseRows.length === 1} onClick={() => removeDirectRow(index)}>حذف</button>
            </div>
          ))}
          <div className="direct-expense-summary direct-transfer-summary">
            <div><span>مانده مبدأ پیش از این نسخه</span><b>{new Intl.NumberFormat('fa-IR').format(Math.abs(sourceBalanceBefore))} ریال · {sourceBalanceBefore > 0 ? 'بدهکار' : sourceBalanceBefore < 0 ? 'بستانکار' : 'تسویه'}</b></div>
            <div className="primary"><span>مبلغ دریافتی</span><b>{new Intl.NumberFormat('fa-IR').format(receivedAmount)} ریال</b></div>
            <div><span>جمع ردیف‌های پرداخت</span><b>{new Intl.NumberFormat('fa-IR').format(directTotal)} ریال</b></div>
            <div className={Math.abs(directDifference) >= 0.005 ? 'danger' : 'balanced'}><span>اختلاف دریافت و پرداخت</span><b>{Math.abs(directDifference) < 0.005 ? 'تراز کامل' : `${new Intl.NumberFormat('fa-IR').format(Math.abs(directDifference))} ریال`}</b></div>
            <div><span>مانده مبدأ پس از ثبت</span><b>{new Intl.NumberFormat('fa-IR').format(Math.abs(sourceBalanceAfter))} ریال · {sourceBalanceAfter > 0 ? 'بدهکار' : sourceBalanceAfter < 0 ? 'بستانکار' : 'تسویه'}</b></div>
          </div>
          {selectedDocumentAvailable !== null && receivedAmount > selectedDocumentAvailable && <div className="finance-note warning">از مبلغ دریافتی، فقط {new Intl.NumberFormat('fa-IR').format(selectedDocumentAvailable)} ریال به مانده فاکتور تخصیص می‌یابد و مازاد، شخص مبدأ را بستانکارتر می‌کند؛ مبلغ حواله محدود نمی‌شود.</div>}
          <div className="finance-note">اثر سند فقط در صورت‌حساب اشخاص و هزینه‌های واقعی ثبت می‌شود: دریافت، مانده شخص مبدأ را کم می‌کند؛ ردیف هزینه، هزینه شرکت را ثبت می‌کند؛ ردیف پرداخت به شخص، طلب شخص مقصد از شرکت را کم می‌کند. مبلغ مبدأ به مانده بدهکار محدود نیست و می‌تواند او را بستانکار کند. هیچ گردش بانک یا صندوق ساخته نمی‌شود.</div>
        </section>
      )}

      {!isDirectExpense && (
        <div className="payment-rows-editor">
          <label className="checkbox-row"><input type="checkbox" checked={multiMode} disabled={Boolean(initialPayment)} onChange={(e) => setMultiMode(e.target.checked)} /> ثبت چند دریافت/پرداخت مستقل با تاریخ، حساب و شخص مشترک</label>
          {multiMode && paymentRows.map((row, index) => <div className="payment-row" key={index}><MoneyInput value={row.amount} onChange={(value) => setPaymentRows(paymentRows.map((item, rowIndex) => rowIndex === index ? { ...item, amount: value } : item))} /><input value={row.description} placeholder="شرح ردیف" onChange={(e) => setPaymentRows(paymentRows.map((item, rowIndex) => rowIndex === index ? { ...item, description: e.target.value } : item))} /><button type="button" className="mini-btn" onClick={() => setPaymentRows(paymentRows.length === 1 ? paymentRows : paymentRows.filter((_, rowIndex) => rowIndex !== index))}>حذف</button></div>)}
          {multiMode && <button type="button" className="mini-btn" onClick={() => setPaymentRows([...paymentRows, { amount: 0, description: '' }])}>＋ ردیف جدید</button>}
        </div>
      )}

      <div className="finance-form-actions">
        <button type="button" onClick={onCancel}>انصراف</button>
        <button type="submit" disabled={busy || !canSubmit}>
          {busy ? 'در حال ثبت...' : directRevision ? 'ثبت نسخه اصلاح‌شده حواله' : isDirectExpense ? 'ثبت حواله مستقیم' : initialPayment ? 'ذخیره ویرایش دریافت/پرداخت' : categoryMode ? (payment.direction === 'receipt' ? 'ثبت درآمد' : 'ثبت هزینه') : 'ثبت و صدور سند حسابداری'}
        </button>
      </div>
    </form>
  );
}

export function FinanceCheckForm({ parties, onCancel, onSubmit, busy }) {
  const [check, setCheck] = useState({ check_type: 'received', party_id: parties[0]?.party_id || '', check_number: '', bank_name: '', branch_name: '', owner_name: '', issue_date: today(), due_date: addDays(7), amount: '', description: '' });
  function submit(e) {
    e.preventDefault();
    onSubmit({ ...check, party_id: check.party_id || null, status: check.check_type === 'received' ? 'in_hand' : 'issued', amount: Number(check.amount || 0) });
  }
  return <form onSubmit={submit}><div className="finance-form-grid">
    <Field label="نوع"><select value={check.check_type} onChange={(e) => setCheck({ ...check, check_type: e.target.value })}><option value="received">چک دریافتی</option><option value="issued">چک پرداختی</option></select></Field>
    <Field label="شخص"><select value={check.party_id} onChange={(e) => setCheck({ ...check, party_id: e.target.value })}><option value="">بدون شخص</option>{parties.map((p) => <option key={p.party_id} value={p.party_id}>{p.display_name}</option>)}</select></Field>
    <Field label="شماره چک"><input value={check.check_number} onChange={(e) => setCheck({ ...check, check_number: e.target.value })} required /></Field>
    <Field label="بانک"><input value={check.bank_name} onChange={(e) => setCheck({ ...check, bank_name: e.target.value })} /></Field>
    <Field label="شعبه"><input value={check.branch_name} onChange={(e) => setCheck({ ...check, branch_name: e.target.value })} /></Field>
    <Field label="صاحب چک"><input value={check.owner_name} onChange={(e) => setCheck({ ...check, owner_name: e.target.value })} /></Field>
    <Field label="تاریخ صدور شمسی"><JalaliDateInput value={check.issue_date} onChange={(value) => setCheck({ ...check, issue_date: value })} /></Field>
    <Field label="تاریخ وصول/سررسید شمسی"><JalaliDateInput value={check.due_date} onChange={(value) => setCheck({ ...check, due_date: value })} /></Field>
    <Field label="مبلغ ریال"><MoneyInput value={check.amount} onChange={(value) => setCheck({ ...check, amount: value })} required /></Field>
    <Field label="شرح" full><textarea value={check.description} onChange={(e) => setCheck({ ...check, description: e.target.value })} /></Field>
  </div><HiddenSubmit busy={busy} onCancel={onCancel} /></form>;
}

export function FinanceReferralForm({ documents, initialDocumentId, onCancel, onSubmit, busy }) {
  const initialDoc = documents.find((d) => d.id === initialDocumentId);
  const [form, setForm] = useState({
    source_module: 'accounting',
    target_module: 'sales',
    referral_type: 'request',
    priority: 2,
    title_fa: initialDoc ? `پیگیری سند ${initialDoc.doc_number}` : '',
    due_date: addDays(3),
    related_document_id: initialDocumentId || '',
  });
  function submit(e) {
    e.preventDefault();
    onSubmit({ ...form, related_document_id: form.related_document_id || null, priority: Number(form.priority), status: 'open' });
  }
  return <form onSubmit={submit}><div className="finance-form-grid">
    <Field label="مبدأ"><select value={form.source_module} onChange={(e) => setForm({ ...form, source_module: e.target.value })}><option value="accounting">مالی</option><option value="sales">فروش</option><option value="warehouse">انبار</option><option value="production">تولید</option><option value="rnd">R&D</option></select></Field>
    <Field label="مقصد"><select value={form.target_module} onChange={(e) => setForm({ ...form, target_module: e.target.value })}><option value="sales">فروش</option><option value="accounting">مالی</option><option value="warehouse">انبار</option><option value="production">تولید</option><option value="admin">مدیریت</option></select></Field>
    <Field label="اولویت"><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value={1}>فوری</option><option value={2}>عادی</option><option value={3}>کم‌اهمیت</option></select></Field>
    <Field label="موعد شمسی"><JalaliDateInput value={form.due_date} onChange={(value) => setForm({ ...form, due_date: value })} /></Field>
    <Field label="سند مرتبط"><select value={form.related_document_id} onChange={(e) => setForm({ ...form, related_document_id: e.target.value })}><option value="">بدون سند</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.doc_number} · {d.party_name || '—'}</option>)}</select></Field>
    <Field label="عنوان" full><input value={form.title_fa} onChange={(e) => setForm({ ...form, title_fa: e.target.value })} required /></Field>
  </div><HiddenSubmit busy={busy} onCancel={onCancel} /></form>;
}

function HiddenSubmit({ busy, onCancel, label = 'ثبت' }) {
  return <div className="finance-form-actions"><button type="button" onClick={onCancel}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ثبت...' : label}</button></div>;
}

export function OrderInvoiceForm({ orders = [], onCancel, onSubmit, busy }) {
  const invoiceableOrders = orders.filter((o) => !o.is_cancelled);
  const [orderId, setOrderId] = useState(invoiceableOrders[0]?.id || '');

  function submit(e) {
    e.preventDefault();
    if (!orderId) return;
    onSubmit(orderId);
  }

  return <form onSubmit={submit}>
    <div className="finance-form-grid">
      <Field label="سفارش"><select value={orderId} onChange={(e) => setOrderId(e.target.value)} required><option value="">انتخاب سفارش</option>{invoiceableOrders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name || 'بدون مشتری'} · {o.stage_name_fa || o.current_stage}</option>)}</select></Field>
      <Field label="توضیح" full><textarea readOnly value="با ثبت این فرم، اقلام سفارش به فاکتور فروش منتقل می‌شوند و شماره فاکتور به‌صورت خودکار از تنظیمات شماره‌گذاری ساخته می‌شود." /></Field>
    </div>
    <HiddenSubmit busy={busy} onCancel={onCancel} />
  </form>;
}
