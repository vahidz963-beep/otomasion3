import { supabase } from './supabaseClient';
import { ARYAMAN_BRAND_FA, ARYAMAN_LOGO_DATA_URI, brandedExcelTableHtml } from './reporting';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

export async function convertProformaToInvoice(proformaId) {
  const res = await supabase.rpc('fn_convert_finance_proforma_to_invoice', {
    p_proforma_id: proformaId,
  });
  assertNoError(res, 'خطا در تبدیل پیش‌فاکتور به فاکتور');
  return res.data;
}

export async function voidFinanceDocument(documentId, reason) {
  const res = await supabase.rpc('fn_void_finance_document', {
    p_document_id: documentId,
    p_reason: reason,
  });
  assertNoError(res, 'خطا در ابطال سند');
  return res.data;
}

export async function createSalesReturnFromInvoice(invoiceId, reason) {
  const res = await supabase.rpc('fn_create_sales_return_from_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason,
  });
  assertNoError(res, 'خطا در ایجاد فاکتور برگشتی');
  return res.data;
}

export async function closeFiscalPeriod(periodId) {
  const res = await supabase.rpc('fn_close_fiscal_period', {
    p_period_id: periodId,
  });
  assertNoError(res, 'خطا در بستن ماه مالی');
  return res.data;
}

export async function reopenFiscalPeriod(periodId) {
  const res = await supabase.rpc('fn_reopen_fiscal_period', {
    p_period_id: periodId,
  });
  assertNoError(res, 'خطا در بازگشایی ماه مالی');
  return res.data;
}

export async function closeFiscalYear(fiscalYearId) {
  const res = await supabase.rpc('fn_close_fiscal_year', {
    p_fiscal_year_id: fiscalYearId,
  });
  assertNoError(res, 'خطا در بستن سال مالی');
  return res.data;
}

export async function reopenFiscalYear(fiscalYearId) {
  const res = await supabase.rpc('fn_reopen_fiscal_year', {
    p_fiscal_year_id: fiscalYearId,
  });
  assertNoError(res, 'خطا در بازگشایی سال مالی');
  return res.data;
}

function normalizeDocumentItems(documentId, items = []) {
  return items
    .filter((item) => item.description_fa && Number(item.quantity) > 0)
    .map((item, index) => ({
      document_id: documentId,
      line_no: index + 1,
      item_type: item.item_type || 'service',
      description_fa: item.description_fa,
      description_en: item.description_en || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'عدد',
      unit_price: Number(item.unit_price || 0),
      discount_amount: Number(item.discount_amount || 0),
      tax_rate: Number(item.tax_rate || 0),
      warehouse_item_id: item.warehouse_item_id || null,
      order_item_id: item.order_item_id || null,
      expense_category_id: item.expense_category_id || null,
      cost_center_id: item.cost_center_id || null,
    }));
}

export async function createSalesInvoiceFromOrder(orderId) {
  const res = await supabase.rpc('fn_create_sales_invoice_from_order', {
    p_order_id: orderId,
  });
  assertNoError(res, 'خطا در ساخت فاکتور از سفارش');
  return res.data;
}

export async function createFinanceDocument({ document, items }) {
  const docRes = await supabase
    .from('finance_documents')
    .insert({ doc_number: null, status: 'draft', ...document })
    .select('id, doc_number')
    .single();
  assertNoError(docRes, 'خطا در ثبت سند مالی');

  const documentId = docRes.data.id;
  const cleanItems = normalizeDocumentItems(documentId, items);

  if (cleanItems.length > 0) {
    const itemsRes = await supabase.from('finance_document_items').insert(cleanItems);
    assertNoError(itemsRes, 'خطا در ثبت اقلام سند مالی');
    const recalcRes = await supabase.rpc('fn_finance_recalculate_document_totals', { p_document_id: documentId });
    assertNoError(recalcRes, 'خطا در محاسبه جمع سند');
  }

  return docRes.data;
}

export async function updateFinanceDocument(documentId, { document, items }) {
  const docRes = await supabase
    .from('finance_documents')
    .update(document)
    .eq('id', documentId)
    .select('id, doc_number')
    .single();
  assertNoError(docRes, 'خطا در ویرایش سند مالی');

  const deleteRes = await supabase.from('finance_document_items').delete().eq('document_id', documentId);
  assertNoError(deleteRes, 'خطا در حذف اقلام قبلی سند');

  const cleanItems = normalizeDocumentItems(documentId, items);
  if (cleanItems.length > 0) {
    const itemsRes = await supabase.from('finance_document_items').insert(cleanItems);
    assertNoError(itemsRes, 'خطا در ثبت اقلام جدید سند');
  }

  const recalcRes = await supabase.rpc('fn_finance_recalculate_document_totals', { p_document_id: documentId });
  assertNoError(recalcRes, 'خطا در محاسبه جمع سند');

  return docRes.data;
}

export async function postFinanceDocument(documentId) {
  const res = await supabase.rpc('fn_post_finance_document', { p_document_id: documentId });
  assertNoError(res, 'خطا در ثبت سند حسابداری فاکتور');
  return res.data;
}

export async function postFinancePayment(paymentId) {
  const res = await supabase.rpc('fn_post_finance_payment', { p_payment_id: paymentId });
  assertNoError(res, 'خطا در ثبت سند حسابداری پرداخت');
  return res.data;
}

export async function createFinancePayment({ payment, allocations = [], post = true }) {
  const paymentRes = await supabase
    .from('finance_payments')
    .insert({ payment_number: null, status: 'draft', ...payment })
    .select('id, payment_number')
    .single();
  assertNoError(paymentRes, 'خطا در ثبت دریافت/پرداخت');

  const paymentId = paymentRes.data.id;
  const cleanAllocations = allocations
    .filter((a) => a.document_id && Number(a.amount) > 0)
    .map((a) => ({ payment_id: paymentId, document_id: a.document_id, amount: Number(a.amount) }));

  if (cleanAllocations.length > 0) {
    const allocationRes = await supabase.from('finance_payment_allocations').insert(cleanAllocations);
    assertNoError(allocationRes, 'خطا در تخصیص پرداخت به فاکتور');
  }

  if (post) await postFinancePayment(paymentId);
  return paymentRes.data;
}

export async function createFinanceCheck(payload) {
  const res = await supabase
    .from('finance_checks')
    .insert(payload)
    .select('id, internal_check_code')
    .single();
  assertNoError(res, 'خطا در ثبت چک');
  return res.data;
}

export async function updateFinanceCheckStatus(checkId, status) {
  const res = await supabase
    .from('finance_checks')
    .update({ status })
    .eq('id', checkId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در تغییر وضعیت چک');
  return res.data;
}

export async function createAutomationReferral(payload) {
  const res = await supabase
    .from('automation_referrals')
    .insert({ referral_number: null, ...payload })
    .select('id, referral_number')
    .single();
  assertNoError(res, 'خطا در ثبت ارجاع');
  return res.data;
}

export async function createIoDocument(payload) {
  const res = await supabase.from('finance_io_documents').insert({ io_number: null, ...payload }).select('id, io_number').single();
  assertNoError(res, 'خطا در ثبت سند ورودی/خروجی');
  return res.data;
}

export async function updateNumberingRule(ruleKey, patch) {
  const res = await supabase
    .from('finance_numbering_rules')
    .update(patch)
    .eq('rule_key', ruleKey)
    .select('rule_key')
    .single();
  assertNoError(res, 'خطا در ذخیره تنظیمات شماره‌گذاری');
  return res.data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function brandedReportShell(title, body) {
  const css = `@page{size:A4;margin:12mm}body{margin:0;background:#f3f5f6;color:#1b2126;direction:rtl;font-family:Vazirmatn,Tahoma,Arial,sans-serif;padding:22px}.report{background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e7eaec;box-shadow:0 8px 28px rgba(16,36,61,.10)}.brand-head{background:linear-gradient(135deg,#10243d,#1b365d);color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand-title{display:flex;align-items:center;gap:12px}.brand-title img{width:54px;height:54px;object-fit:contain;border-radius:14px;background:#fff;padding:5px}.brand-title h1{margin:0;font-size:20px}.brand-title span{display:block;color:#f8d348;font-size:12px;margin-top:4px}.report-date{color:#d8dee3;font-size:12px}.report-body{padding:20px}.report-body h1{margin:0 0 14px;color:#10243d;font-size:20px}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0}.meta div{border:1px solid #edf0f2;background:#f8fafb;border-radius:12px;padding:10px}table{width:100%;border-collapse:separate;border-spacing:0;margin-top:12px;overflow:hidden;border:1px solid #e7eaec;border-radius:14px}th{background:#10243d;color:#fff;font-weight:800}td,th{padding:10px;border-bottom:1px solid #edf0f2;text-align:right;font-size:12px}tr:nth-child(even) td{background:#fafafa}.money{direction:ltr}.footer{margin-top:42px;display:flex;justify-content:space-between;gap:16px}.footer span{flex:1;border-top:1px solid #ccd3da;padding-top:10px;text-align:center;color:#5b6670}.print-btn{margin:0 0 12px;background:#a8672e;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;cursor:pointer}@media print{body{background:#fff;padding:0}.print-btn{display:none}.report{box-shadow:none;border-radius:0}}`;
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><button class="print-btn" onclick="window.print()">چاپ / ذخیره PDF</button><main class="report"><header class="brand-head"><div class="brand-title"><img src="${ARYAMAN_LOGO_DATA_URI}" alt="Aryaman"><div><h1>${escapeHtml(title)}</h1><span>${ARYAMAN_BRAND_FA}</span></div></div><div class="report-date">گزارش رسمی مالی</div></header><section class="report-body">${body}</section></main></body></html>`;
}

export function downloadCsv(filename, rows) {
  const csv = `\ufeff${rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadExcelHtml(filename, headers, rows, title = 'گزارش') {
  const html = brandedExcelTableHtml(title, headers, rows);
  const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintableDocument(title, html) {
  const printHtml = brandedReportShell(title, html);
  const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|\s]+/g, '_')}.html`;
    a.click();
  }
}

export async function settleFinanceCheck({ checkId, bankAccountId, status = 'cleared', note }) {
  const res = await supabase.rpc('fn_finance_settle_check', {
    p_check_id: checkId,
    p_bank_account_id: bankAccountId || null,
    p_status: status,
    p_note: note || null,
  });
  assertNoError(res, 'خطا در تسویه/وصول چک');
  return res.data;
}

export async function createFinanceInvestment(payload) {
  const res = await supabase.from('finance_investments').insert({
    asset_type: payload.asset_type || 'other',
    title_fa: payload.title_fa,
    acquisition_date: payload.acquisition_date || new Date().toISOString().slice(0, 10),
    quantity: Number(payload.quantity || 1),
    unit: payload.unit || 'عدد',
    purchase_amount: Number(payload.purchase_amount || 0),
    current_estimated_value: Number(payload.current_estimated_value || payload.purchase_amount || 0),
    location: payload.location || null,
    notes: payload.notes || null,
    status: payload.status || 'active',
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت سرمایه‌گذاری');
  return res.data;
}

export async function updateFinanceInvestment(id, payload) {
  const res = await supabase.from('finance_investments').update({
    asset_type: payload.asset_type || 'other',
    title_fa: payload.title_fa,
    acquisition_date: payload.acquisition_date || new Date().toISOString().slice(0, 10),
    quantity: Number(payload.quantity || 1),
    unit: payload.unit || 'عدد',
    purchase_amount: Number(payload.purchase_amount || 0),
    current_estimated_value: Number(payload.current_estimated_value || 0),
    location: payload.location || null,
    notes: payload.notes || null,
    status: payload.status || 'active',
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در ویرایش سرمایه‌گذاری');
  return res.data;
}

export async function archiveFinanceInvestment(id) {
  const res = await supabase.from('finance_investments').update({ status: 'archived' }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در آرشیو سرمایه‌گذاری');
  return res.data;
}
