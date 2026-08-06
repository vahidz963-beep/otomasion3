import { useMemo, useState } from 'react';

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
  const [document, setDocument] = useState({
    document_type: initialDocument?.document_type || 'sales_invoice',
    party_id: initialDocument?.party_id || parties[0]?.party_id || '',
    issue_date: initialDocument?.issue_date || today(),
    due_date: initialDocument?.due_date || addDays(7),
    is_official: initialDocument?.is_official ?? true,
    related_order_id: initialDocument?.related_order_id || '',
    description: initialDocument?.description || '',
  });
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
        }))
      : [{ description_fa: 'شرح کالا / خدمت', quantity: 1, unit: 'عدد', unit_price: 0, discount_amount: 0, tax_rate: 10, item_type: 'service' }]
  );

  const totals = useMemo(() => items.reduce((acc, item) => {
    const base = Math.max(Number(item.quantity || 0) * Number(item.unit_price || 0) - Number(item.discount_amount || 0), 0);
    const tax = base * Number(item.tax_rate || 0) / 100;
    return { subtotal: acc.subtotal + base, tax: acc.tax + tax, total: acc.total + base + tax };
  }, { subtotal: 0, tax: 0, total: 0 }), [items]);

  function updateItem(index, patch) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function selectStockItem(index, itemCode) {
    const item = stock.find((s) => s.item_code === itemCode);
    updateItem(index, {
      warehouse_item_code: itemCode,
      warehouse_item_id: item?.item_id || null,
      description_fa: item?.item_name_fa || items[index]?.description_fa || '',
      description_en: item?.item_name_en || items[index]?.description_en || '',
      unit: item?.unit || items[index]?.unit || 'عدد',
      unit_price: item?.unit_price_estimate ?? items[index]?.unit_price ?? 0,
    });
  }

  function submit(e) {
    e.preventDefault();
    onSubmit({ documentId: initialDocument?.id || null, document: { ...document, party_id: document.party_id || null, related_order_id: document.related_order_id || null }, items });
  }

  return <form onSubmit={submit}>
    <div className="finance-form-grid">
      <Field label="نوع سند"><select value={document.document_type} onChange={(e) => setDocument({ ...document, document_type: e.target.value })}>{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="شخص"><select value={document.party_id} onChange={(e) => setDocument({ ...document, party_id: e.target.value })}><option value="">بدون شخص</option>{parties.map((p) => <option key={p.party_id} value={p.party_id}>{p.display_name}</option>)}</select></Field>
      <Field label="سفارش مرتبط"><select value={document.related_order_id} onChange={(e) => setDocument({ ...document, related_order_id: e.target.value })}><option value="">بدون سفارش</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.customer_name || '—'}</option>)}</select></Field>
      <Field label="تاریخ صدور"><input type="date" value={document.issue_date} onChange={(e) => setDocument({ ...document, issue_date: e.target.value })} /></Field>
      <Field label="سررسید"><input type="date" value={document.due_date} onChange={(e) => setDocument({ ...document, due_date: e.target.value })} /></Field>
      <Field label="نوع رسمی/غیررسمی"><select value={document.is_official ? 'true' : 'false'} onChange={(e) => setDocument({ ...document, is_official: e.target.value === 'true' })}><option value="true">رسمی</option><option value="false">غیررسمی</option></select></Field>
      <Field label="شرح" full><textarea value={document.description} onChange={(e) => setDocument({ ...document, description: e.target.value })} /></Field>
    </div>

    <datalist id="finance-stock-items">
      {stock.map((s) => <option key={s.item_id} value={s.item_code}>{s.item_name_fa} · قابل فروش {s.available_for_sale_qty}</option>)}
    </datalist>
    <div className="line-editor">
      <table>
        <thead><tr><th>کد کالا</th><th>شرح</th><th>تعداد</th><th>واحد</th><th>فی ریال</th><th>تخفیف</th><th>مالیات٪</th><th></th></tr></thead>
        <tbody>{items.map((item, index) => <tr key={index}>
          <td><input list="finance-stock-items" value={item.warehouse_item_code || ''} onChange={(e) => selectStockItem(index, e.target.value)} placeholder="جست‌وجوی کالا" /></td>
          <td><input value={item.description_fa} onChange={(e) => updateItem(index, { description_fa: e.target.value })} /></td>
          <td><input type="number" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} /></td>
          <td><input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} /></td>
          <td><input type="number" value={item.unit_price} onChange={(e) => updateItem(index, { unit_price: e.target.value })} /></td>
          <td><input type="number" value={item.discount_amount} onChange={(e) => updateItem(index, { discount_amount: e.target.value })} /></td>
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

export function FinancePaymentForm({ parties, documents, accounts, initialDocumentId, onCancel, onSubmit, busy }) {
  const payableDocs = documents.filter((d) => Number(d.balance_amount) > 0 && !['void', 'cancelled'].includes(d.status));
  const initialDoc = documents.find((d) => d.id === initialDocumentId);
  const [payment, setPayment] = useState({
    direction: 'receipt',
    method: 'bank_transfer',
    party_id: initialDoc?.party_id || parties[0]?.party_id || '',
    payment_date: today(),
    amount: initialDoc?.balance_amount || '',
    bank_account_id: accounts[0]?.id || '',
    description: initialDoc ? `تسویه سند ${initialDoc.doc_number}` : '',
    document_id: initialDocumentId || '',
  });

  function selectDocument(id) {
    const doc = documents.find((d) => d.id === id);
    setPayment({ ...payment, document_id: id, party_id: doc?.party_id || payment.party_id, amount: doc?.balance_amount || payment.amount });
  }

  function submit(e) {
    e.preventDefault();
    const allocation = payment.document_id ? [{ document_id: payment.document_id, amount: Number(payment.amount || 0) }] : [];
    onSubmit({
      payment: {
        direction: payment.direction,
        method: payment.method,
        party_id: payment.party_id || null,
        payment_date: payment.payment_date,
        amount: Number(payment.amount || 0),
        bank_account_id: payment.bank_account_id || null,
        description: payment.description,
      },
      allocations: allocation,
    });
  }

  return <form onSubmit={submit}>
    <div className="finance-form-grid">
      <Field label="نوع"><select value={payment.direction} onChange={(e) => setPayment({ ...payment, direction: e.target.value })}><option value="receipt">دریافت</option><option value="payment">پرداخت</option></select></Field>
      <Field label="روش"><select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}><option value="bank_transfer">حواله بانکی</option><option value="cash">نقد</option><option value="pos">پوز</option><option value="check">چک</option><option value="offset">تهاتر</option></select></Field>
      <Field label="حساب"><select value={payment.bank_account_id} onChange={(e) => setPayment({ ...payment, bank_account_id: e.target.value })}><option value="">بدون حساب</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} - {a.bank_name}</option>)}</select></Field>
      <Field label="شخص"><select value={payment.party_id} onChange={(e) => setPayment({ ...payment, party_id: e.target.value })}><option value="">بدون شخص</option>{parties.map((p) => <option key={p.party_id} value={p.party_id}>{p.display_name}</option>)}</select></Field>
      <Field label="فاکتور مرتبط"><select value={payment.document_id} onChange={(e) => selectDocument(e.target.value)}><option value="">بدون فاکتور</option>{payableDocs.map((d) => <option key={d.id} value={d.id}>{d.doc_number} · {d.party_name} · مانده {Number(d.balance_amount).toLocaleString('fa-IR')}</option>)}</select></Field>
      <Field label="تاریخ"><input type="date" value={payment.payment_date} onChange={(e) => setPayment({ ...payment, payment_date: e.target.value })} /></Field>
      <Field label="مبلغ ریال"><input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} required /></Field>
      <Field label="شرح" full><textarea value={payment.description} onChange={(e) => setPayment({ ...payment, description: e.target.value })} /></Field>
    </div>
    <HiddenSubmit busy={busy} onCancel={onCancel} />
  </form>;
}

export function FinanceCheckForm({ parties, onCancel, onSubmit, busy }) {
  const [check, setCheck] = useState({ check_type: 'received', party_id: parties[0]?.party_id || '', check_number: '', bank_name: '', due_date: addDays(7), amount: '', description: '' });
  function submit(e) {
    e.preventDefault();
    onSubmit({ ...check, party_id: check.party_id || null, status: check.check_type === 'received' ? 'in_hand' : 'issued', amount: Number(check.amount || 0) });
  }
  return <form onSubmit={submit}><div className="finance-form-grid">
    <Field label="نوع"><select value={check.check_type} onChange={(e) => setCheck({ ...check, check_type: e.target.value })}><option value="received">چک دریافتی</option><option value="issued">چک پرداختی</option></select></Field>
    <Field label="شخص"><select value={check.party_id} onChange={(e) => setCheck({ ...check, party_id: e.target.value })}><option value="">بدون شخص</option>{parties.map((p) => <option key={p.party_id} value={p.party_id}>{p.display_name}</option>)}</select></Field>
    <Field label="شماره چک"><input value={check.check_number} onChange={(e) => setCheck({ ...check, check_number: e.target.value })} required /></Field>
    <Field label="بانک"><input value={check.bank_name} onChange={(e) => setCheck({ ...check, bank_name: e.target.value })} /></Field>
    <Field label="سررسید"><input type="date" value={check.due_date} onChange={(e) => setCheck({ ...check, due_date: e.target.value })} /></Field>
    <Field label="مبلغ ریال"><input type="number" value={check.amount} onChange={(e) => setCheck({ ...check, amount: e.target.value })} required /></Field>
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
    <Field label="موعد"><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
    <Field label="سند مرتبط"><select value={form.related_document_id} onChange={(e) => setForm({ ...form, related_document_id: e.target.value })}><option value="">بدون سند</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.doc_number} · {d.party_name || '—'}</option>)}</select></Field>
    <Field label="عنوان" full><input value={form.title_fa} onChange={(e) => setForm({ ...form, title_fa: e.target.value })} required /></Field>
  </div><HiddenSubmit busy={busy} onCancel={onCancel} /></form>;
}

function HiddenSubmit({ busy, onCancel }) {
  return <div className="finance-form-actions"><button type="button" onClick={onCancel}>انصراف</button><button type="submit" disabled={busy}>{busy ? 'در حال ثبت...' : 'ثبت'}</button></div>;
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
