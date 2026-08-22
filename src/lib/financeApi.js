import { supabase } from './supabaseClient';
import { ARYAMAN_BRAND_FA, ARYAMAN_LOGO_DATA_URI, brandedExcelTableHtml } from './reporting';

const FINANCE_LEGAL_NAME_FA = 'پیشرو الکترونیک آریامن پارس';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

function isMissingRpc(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('does not exist');
}

function isMissingColumn(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.code || ''}`.toLowerCase();
  return text.includes('column') && (text.includes('does not exist') || text.includes('could not find') || text.includes('schema cache') || text.includes('42703') || text.includes('pgrst204'));
}

async function issueInventoryForApprovedInvoice(documentId) {
  if (!documentId) return null;
  const res = await supabase.rpc('fn_finance_issue_inventory_for_document', { p_document_id: documentId });
  if (res.error && !isMissingRpc(res.error)) throw new Error(res.error.message || 'خطا در ثبت خروج انبار فاکتور');
  return res.data || null;
}


async function reissueInventoryForEditedDocument(documentId, reason) {
  if (!documentId) return null;
  const res = await supabase.rpc('fn_finance_reissue_inventory_for_document', {
    p_document_id: documentId,
    p_reason: reason || null,
  });
  if (res.error) {
    if (isMissingRpc(res.error)) return issueInventoryForApprovedInvoice(documentId);
    throw new Error(res.error.message || 'خطا در همگام‌سازی اسناد انبار فاکتور');
  }
  return res.data || null;
}

async function repostFinanceDocumentAfterEdit(documentId, reason) {
  if (!documentId) return null;
  const res = await supabase.rpc('fn_finance_repost_document_after_edit', {
    p_document_id: documentId,
    p_reason: reason || null,
  });
  if (!res.error) return res.data || null;
  if (!isMissingRpc(res.error)) throw new Error(res.error.message || 'خطا در اصلاح سند حسابداری فاکتور');

  // Backward-compatible fallback until SQL 050 is applied: void old posted journal
  // entries for this invoice, then create a fresh posted journal from edited totals.
  const voidRes = await supabase
    .from('finance_journal_entries')
    .update({
      status: 'void',
      description: reason ? `ابطال و جایگزینی به دلیل اصلاح فاکتور: ${reason}` : 'ابطال و جایگزینی به دلیل اصلاح فاکتور',
      updated_at: new Date().toISOString(),
    })
    .eq('related_document_id', documentId)
    .eq('status', 'posted');
  assertNoError(voidRes, 'خطا در ابطال سند حسابداری قبلی فاکتور');
  return postFinanceDocument(documentId);
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
  const defaultStatus = document.status || (document.document_type === 'sales_proforma' ? 'sent' : 'approved');
  const docRes = await supabase
    .from('finance_documents')
    .insert({ doc_number: null, ...document, status: defaultStatus })
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

  if (document.document_type === 'sales_invoice' && ['approved', 'partially_paid', 'paid'].includes(defaultStatus)) {
    await issueInventoryForApprovedInvoice(documentId);
  }

  return docRes.data;
}

export async function updateFinanceDocument(documentId, { document, items, syncLinkedDocuments = false, edit_reason = '' }) {
  const docRes = await supabase
    .from('finance_documents')
    .update(document)
    .eq('id', documentId)
    .select('id, doc_number, document_type, status')
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

  if (syncLinkedDocuments && docRes.data.document_type !== 'sales_proforma' && !['draft', 'pending_approval', 'cancelled', 'void'].includes(docRes.data.status)) {
    await repostFinanceDocumentAfterEdit(documentId, edit_reason);
  }

  if (docRes.data.document_type === 'sales_invoice' && ['approved', 'partially_paid', 'paid'].includes(docRes.data.status)) {
    if (syncLinkedDocuments) await reissueInventoryForEditedDocument(documentId, edit_reason);
    else await issueInventoryForApprovedInvoice(documentId);
  }

  return docRes.data;
}

export async function postFinanceDocument(documentId) {
  const res = await supabase.rpc('fn_post_finance_document', { p_document_id: documentId });
  assertNoError(res, 'خطا در ثبت سند حسابداری فاکتور');
  await issueInventoryForApprovedInvoice(documentId);
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


export async function createFinanceBankAccount(payload) {
  const res = await supabase.from('finance_bank_accounts').insert({
    account_name: payload.account_name,
    bank_name: payload.bank_name || null,
    account_number: payload.account_number || null,
    iban: payload.iban || null,
    card_number: payload.card_number || null,
    branch_name: payload.branch_name || null,
    account_holder_name: payload.account_holder_name || null,
    notes: payload.notes || null,
    currency: payload.currency || 'IRR',
    account_usage: payload.account_usage || 'official',
    opening_balance: Number(payload.opening_balance || 0),
    is_active: payload.is_active !== false,
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت حساب/کارت بانکی');
  return res.data;
}

export async function updateFinanceBankAccount(id, payload) {
  const res = await supabase.from('finance_bank_accounts').update({
    account_name: payload.account_name,
    bank_name: payload.bank_name || null,
    account_number: payload.account_number || null,
    iban: payload.iban || null,
    card_number: payload.card_number || null,
    branch_name: payload.branch_name || null,
    account_holder_name: payload.account_holder_name || null,
    notes: payload.notes || null,
    currency: payload.currency || 'IRR',
    account_usage: payload.account_usage || 'official',
    opening_balance: Number(payload.opening_balance || 0),
    is_active: payload.is_active !== false,
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در ویرایش حساب/کارت بانکی');
  return res.data;
}


export async function archiveFinanceBankAccount(id, reason = '') {
  const res = await supabase.from('finance_bank_accounts').update({
    is_active: false,
    notes: reason ? `حذف/غیرفعال‌سازی توسط مدیر: ${reason}` : 'حذف/غیرفعال‌سازی توسط مدیر',
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در حذف/غیرفعال‌سازی حساب/کارت بانکی');
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


export const FINANCE_PRINT_SETTINGS_STORAGE_KEY = 'aryaman_finance_print_settings_v1';

export const DEFAULT_FINANCE_PRINT_SETTINGS = {
  marginMm: 10,
  fontScale: 1,
  numberScale: 1,
  invoiceOrientation: 'landscape',
  statementOrientation: 'portrait',
  showFooter: true,
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getFinancePrintSettings() {
  if (typeof window === 'undefined') return DEFAULT_FINANCE_PRINT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(FINANCE_PRINT_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_FINANCE_PRINT_SETTINGS,
      ...parsed,
      marginMm: clampNumber(parsed.marginMm, 5, 20, DEFAULT_FINANCE_PRINT_SETTINGS.marginMm),
      fontScale: clampNumber(parsed.fontScale, 0.85, 1.45, DEFAULT_FINANCE_PRINT_SETTINGS.fontScale),
      numberScale: clampNumber(parsed.numberScale, 0.85, 1.6, DEFAULT_FINANCE_PRINT_SETTINGS.numberScale),
      invoiceOrientation: ['landscape', 'portrait'].includes(parsed.invoiceOrientation) ? parsed.invoiceOrientation : DEFAULT_FINANCE_PRINT_SETTINGS.invoiceOrientation,
      statementOrientation: ['landscape', 'portrait'].includes(parsed.statementOrientation) ? parsed.statementOrientation : DEFAULT_FINANCE_PRINT_SETTINGS.statementOrientation,
      showFooter: parsed.showFooter !== false,
    };
  } catch {
    return DEFAULT_FINANCE_PRINT_SETTINGS;
  }
}

export function saveFinancePrintSettings(settings = {}) {
  const next = {
    ...DEFAULT_FINANCE_PRINT_SETTINGS,
    ...settings,
    marginMm: clampNumber(settings.marginMm, 5, 20, DEFAULT_FINANCE_PRINT_SETTINGS.marginMm),
    fontScale: clampNumber(settings.fontScale, 0.85, 1.45, DEFAULT_FINANCE_PRINT_SETTINGS.fontScale),
    numberScale: clampNumber(settings.numberScale, 0.85, 1.6, DEFAULT_FINANCE_PRINT_SETTINGS.numberScale),
    invoiceOrientation: ['landscape', 'portrait'].includes(settings.invoiceOrientation) ? settings.invoiceOrientation : DEFAULT_FINANCE_PRINT_SETTINGS.invoiceOrientation,
    statementOrientation: ['landscape', 'portrait'].includes(settings.statementOrientation) ? settings.statementOrientation : DEFAULT_FINANCE_PRINT_SETTINGS.statementOrientation,
    showFooter: settings.showFooter !== false,
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FINANCE_PRINT_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}


export function openOfficialFinancePrint({ title, subtitle = '', body, reportLabel = '', orientation = 'portrait', layout = 'standard', meta = {} }) {
  const safeTitle = escapeHtml(title);
  const printSettings = getFinancePrintSettings();
  const finalOrientation = layout === 'invoice'
    ? (printSettings.invoiceOrientation || orientation)
    : layout === 'statement'
      ? (printSettings.statementOrientation || orientation)
      : orientation;
  const isLandscape = finalOrientation === 'landscape';
  const isInvoice = layout === 'invoice';
  const marginMm = clampNumber(printSettings.marginMm, 5, 20, 10);
  const fontScale = clampNumber(printSettings.fontScale, 0.85, 1.45, 1);
  const numberScale = clampNumber(printSettings.numberScale, 0.85, 1.6, 1);
  const pageSize = isLandscape ? 'A4 landscape' : 'A4 portrait';
  const sheetWidth = `${(isLandscape ? 297 : 210) - (marginMm * 2)}mm`;
  const sheetMinHeight = `${(isLandscape ? 210 : 297) - (marginMm * 2)}mm`;
  const printMinHeight = sheetMinHeight;
  const fs = (value) => `${(Number(value) * fontScale).toFixed(2)}px`;
  const ns = (value) => `${(Number(value) * numberScale).toFixed(2)}px`;
  const css = `
    @page{size:${pageSize};margin:${marginMm}mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#eef1f4;color:#050505;direction:rtl;font-family:"B Nazanin","Vazirmatn","IRANSansX","IRANSans","Segoe UI",Tahoma,Arial,sans-serif;padding:${marginMm}mm;font-size:${fs(14)}}
    .print-btn{margin:0 auto 3mm;display:flex;align-items:center;justify-content:center;background:#10243d;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(16,36,61,.20)}
    .official-sheet{width:100%;max-width:${sheetWidth};min-height:${sheetMinHeight};margin:0 auto;background:#fff;border:1.6px solid #151515;padding:0;position:relative;box-shadow:0 12px 34px rgba(15,23,32,.16);overflow:hidden}
    .official-inner{padding:0 0 7mm;min-height:inherit;position:relative}
    .official-top{direction:ltr;display:grid;grid-template-columns:38mm 1fr 42mm;align-items:start;gap:4mm;border-bottom:1.6px solid #151515;padding:3mm 4mm 4mm;min-height:${isInvoice ? '12mm' : '34mm'}}
    .official-top.invoice-top{display:block;min-height:12mm;padding:1.8mm 4mm 2.4mm;position:relative;text-align:center;direction:rtl}.invoice-top .invoice-meta{position:absolute;left:4mm;top:1.6mm;text-align:right;line-height:1.9;font-size:13.5px;font-weight:850}.invoice-top .invoice-title{font-size:22px;font-weight:950;margin:0;text-decoration:underline;text-underline-offset:2px}.invoice-top .invoice-subtitle{font-size:12.5px;color:#444;margin-top:.8mm}.invoice-top .logo-mini{position:absolute;right:4mm;top:1.6mm;width:28mm;height:13mm;object-fit:contain}
    .page-no{grid-column:1;text-align:left;direction:rtl;font-size:14px;font-weight:850;color:#111;white-space:nowrap;padding-top:1mm}.brand-center{grid-column:2;text-align:center;direction:rtl;padding-top:1mm}.brand-center h1{font-size:18px;margin:0 0 2mm;font-weight:950}.brand-center h2{font-size:24px;margin:0 0 2.5mm;font-weight:950;letter-spacing:-.02em}.brand-center p{font-size:14px;margin:0;line-height:1.75;font-weight:750}.brand-logo{grid-column:3;text-align:center;direction:ltr}.brand-logo img{width:32mm;height:21mm;object-fit:contain;display:block;margin:0 auto .5mm}.brand-logo span{display:block;font-size:14px;margin-top:0;color:#333;letter-spacing:.03em}
    .section-label{display:block;text-align:center;background:#dddddd;border-top:1.25px solid #151515;border-bottom:1.25px solid #151515;padding:1.8mm 4mm;font-size:16px;font-weight:950;line-height:1.1;color:#111;margin:0}.box-row{border-bottom:1.45px solid #151515;padding:3mm 4mm;min-height:${isInvoice ? '24mm' : '22mm'}}.compact-box{border-bottom:1.45px solid #151515;padding:2mm 4mm}.box-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.4mm 5mm}.box-grid.two{grid-template-columns:1fr 1fr}.box-grid.four{grid-template-columns:repeat(4,1fr)}.info-grid{display:grid;grid-template-columns:${isLandscape ? '1.15fr 1fr 1fr 1fr' : '1fr 1fr'};gap:.7mm 4mm;align-items:center}.field{font-size:15px;line-height:2;min-height:6mm}.compact-box .field{line-height:1.55;min-height:5mm}.field.full{grid-column:1/-1}.field b{font-weight:950;color:#111}.field span[dir="ltr"],.field[dir="ltr"]{font-family:"B Nazanin","Vazirmatn","IRANSansX",Tahoma,Arial,sans-serif;font-weight:850;font-variant-numeric:tabular-nums}.highlight-number span,.highlight-number{font-size:17px;font-weight:950;color:#111}
    .official-table{width:100%;border-collapse:collapse;margin:0;font-size:${isLandscape ? '13.6px' : '14px'};table-layout:fixed}.official-table thead{display:table-header-group}.official-table tfoot{display:table-footer-group}.official-table tr{page-break-inside:avoid}.official-table th,.official-table td{border:1.15px solid #151515;padding:${isLandscape ? '1.6mm 1.25mm' : '2.1mm 1.5mm'};text-align:center;vertical-align:middle;line-height:1.65;word-break:break-word}.official-table th{background:#d9d9d9!important;color:#111;font-weight:950}.official-table td.desc{text-align:right}.official-table tbody tr:nth-child(even) td,.official-table tr.alt td{background:#f7f7f7!important}.official-table .money,.money{direction:ltr;text-align:left;font-family:"B Nazanin","Vazirmatn","IRANSansX",Tahoma,Arial,sans-serif!important;font-weight:850;white-space:nowrap;font-variant-numeric:tabular-nums}.rial-word{font-family:"Vazirmatn",Tahoma,Arial,sans-serif;font-weight:800;margin-right:2px}.official-table.compact th,.official-table.compact td{padding:1.6mm 1.25mm;font-size:13.5px}
    .totals-wrap{direction:ltr;display:grid;grid-template-columns:${isLandscape ? '58mm' : '50mm'} 1fr;gap:0;border-bottom:1.6px solid #151515;min-height:${isLandscape ? '25mm' : '34mm'}}.totals-table{direction:rtl;width:${isLandscape ? '58mm' : '50mm'};border-collapse:collapse;font-size:14px;margin:0}.totals-table td{border:1.15px solid #151515;padding:2mm;line-height:1.5}.totals-table td:first-child{font-weight:950;background:#eeeeee;color:#111}.totals-table td.money{direction:ltr;text-align:left;font-family:"B Nazanin","Vazirmatn","IRANSansX",Tahoma,Arial,sans-serif;font-weight:950;font-size:16px;font-variant-numeric:tabular-nums}.amount-words{direction:rtl;border:1.15px solid #151515;border-left:0;padding:3.5mm 4mm;font-size:15px;line-height:2.05;display:flex;flex-direction:column;justify-content:center}.amount-words b{font-weight:950}.notes-box{border-bottom:1.6px solid #151515;min-height:${isLandscape ? '15mm' : '18mm'};padding:3.5mm 4mm;font-size:15px;line-height:2}.notes-box b{font-weight:950}.statement-title{text-align:center;border-bottom:1.6px solid #151515;padding:4mm;margin:0}.statement-title h1{font-size:19px;margin:0 0 2mm;font-weight:950}.statement-title h2{font-size:14px;margin:0;font-weight:900}.statement-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-bottom:1.6px solid #151515}.statement-summary div{border-left:1.15px solid #151515;padding:3mm;font-size:14px;min-height:18mm}.statement-summary div:nth-child(even){background:#f7f7f7}.statement-summary span{display:block;color:#4b5563;font-weight:800}.statement-summary strong{display:block;margin-top:1.5mm;font-size:16px;color:#111;font-weight:950}.status-cell{font-weight:950}.continued{text-align:left;font-size:13px;padding:2mm 4mm;color:#555}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:14mm;min-height:${isLandscape ? '28mm' : '48mm'};align-items:end;padding:${isLandscape ? '12mm 14mm 8mm' : '18mm 12mm 9mm'};text-align:center;font-size:15px;page-break-inside:avoid}.signatures span{display:block;font-weight:850}.footer-line{position:absolute;left:4mm;right:4mm;bottom:1.8mm;border-top:1px solid #777;padding:1.5mm 0 0;font-size:11px;text-align:center;color:#444;display:${printSettings.showFooter === false ? 'none' : 'block'}}.soft-row{background:#f7f7f7!important}.no-print{display:none}
    body{font-size:${fs(14)}}.invoice-top .invoice-meta{font-size:${ns(13.5)}}.invoice-top .invoice-title{font-size:${fs(22)}}.invoice-top .invoice-subtitle{font-size:${fs(12.5)}}.page-no{font-size:${ns(14)}}.brand-center h1{font-size:${fs(18)}}.brand-center h2{font-size:${fs(24)}}.brand-center p{font-size:${fs(14)}}.section-label{font-size:${fs(16)}}.field{font-size:${fs(15)}}.official-table{font-size:${fs(isLandscape ? 13.6 : 14)}}.official-table .money,.money{font-size:${ns(15)}}.official-table.compact th,.official-table.compact td{font-size:${fs(13.5)}}.totals-table{font-size:${fs(14)}}.totals-table td.money{font-size:${ns(16)}}.amount-words,.notes-box{font-size:${fs(15)}}.statement-summary div{font-size:${fs(14)}}.statement-summary strong{font-size:${ns(16)}}.continued{font-size:${fs(13)}}.signatures{font-size:${fs(15)}}.footer-line{font-size:${fs(11)}}
    @media print{body{background:#fff;padding:0}.print-btn{display:none}.official-sheet{border:1.5px solid #151515;max-width:${sheetWidth};width:100%;min-height:${printMinHeight};box-shadow:none}.official-top{min-height:${isInvoice ? '12mm' : '31mm'}}.official-table th{background:#d9d9d9!important}.official-table tbody tr:nth-child(even) td,.official-table tr.alt td{background:#f7f7f7!important}}
  `;
  const standardHeader = `<header class="official-top"><div class="page-no">صفحه ۱ از ۱</div><div class="brand-center"><h1>${escapeHtml(reportLabel || title)}</h1><h2>${FINANCE_LEGAL_NAME_FA}</h2><p>${escapeHtml(subtitle || 'بوشهر، بهمنی، نخلج فارس، پردیس فناوری')}<br>تلفن‌های تماس: 09173742966</p></div><div class="brand-logo"><img src="${ARYAMAN_LOGO_DATA_URI}" alt="Aryaman"><span>aryaman</span></div></header>`;
  const invoiceHeader = `<header class="official-top invoice-top"><img class="logo-mini" src="${ARYAMAN_LOGO_DATA_URI}" alt="Aryaman"><div class="invoice-meta"><div>شماره: ${escapeHtml(meta.number || '—')}</div><div>تاریخ: ${escapeHtml(meta.date || '—')}</div></div><h1 class="invoice-title">${escapeHtml(reportLabel || title)}</h1>${subtitle ? `<div class="invoice-subtitle">${escapeHtml(subtitle)}</div>` : ''}</header>`;
  const html = `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${css}</style></head><body><button class="print-btn" onclick="window.print()">چاپ / ذخیره PDF</button><main class="official-sheet"><section class="official-inner">${isInvoice ? invoiceHeader : standardHeader}${body}<div class="footer-line">این برگه توسط سامانه اتوماسیون آریامن تولید شده است.</div></section></main></body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle.replace(/[\\/:*?"<>|\s]+/g, '_')}.html`;
    a.click();
  }
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

export async function settleFinanceCheck({ checkId, bankAccountId, status = 'cleared', note, clearedDate }) {
  const res = await supabase.rpc('fn_finance_settle_check', {
    p_check_id: checkId,
    p_bank_account_id: bankAccountId || null,
    p_status: status,
    p_note: note || null,
    p_cleared_date: clearedDate || new Date().toISOString().slice(0, 10),
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

async function currentFinanceUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}


async function updateFinancePartyOfficialFields(partyId, payload = {}) {
  if (!partyId) return;
  const patch = {
    national_id: payload.national_id || null,
    economic_code: payload.economic_code || null,
    registration_number: payload.registration_number || null,
    postal_code: payload.postal_code || null,
  };
  const hasPatch = Object.values(patch).some((value) => value !== null && value !== '');
  if (!hasPatch) return;
  const res = await supabase.from('finance_parties').update(patch).eq('id', partyId);
  if (res.error && !isMissingColumn(res.error)) throw new Error(res.error.message || 'خطا در ثبت اطلاعات رسمی شخص');
}


export async function createFinanceParty(payload) {
  const rpcRes = await supabase.rpc('fn_finance_create_party_and_customer', {
    p_display_name: payload.display_name,
    p_party_type: payload.party_type || 'customer',
    p_phone: payload.phone || null,
    p_email: null,
    p_address: payload.address || null,
    p_opening_balance: Number(payload.opening_balance || 0),
    p_notes: payload.notes || null,
  });
  if (!rpcRes.error) {
    await updateFinancePartyOfficialFields(rpcRes.data, payload);
    return rpcRes.data;
  }

  const userId = await currentFinanceUserId();
  const insertPayload = {
    party_type: payload.party_type || 'customer',
    display_name: payload.display_name,
    phone: payload.phone || null,
    email: null,
    address: payload.address || null,
    national_id: payload.national_id || null,
    economic_code: payload.economic_code || null,
    registration_number: payload.registration_number || null,
    postal_code: payload.postal_code || null,
    opening_balance: Number(payload.opening_balance || 0),
    notes: payload.notes || null,
    created_by: userId,
  };
  let res = await supabase.from('finance_parties').insert(insertPayload).select('id').single();
  if (res.error && isMissingColumn(res.error)) {
    const { registration_number, postal_code, ...fallbackPayload } = insertPayload;
    res = await supabase.from('finance_parties').insert(fallbackPayload).select('id').single();
  }
  assertNoError(res, 'خطا در ثبت شخص مالی');
  return res.data;
}


export async function updateFinanceParty(partyId, payload) {
  const patch = {
    party_type: payload.party_type || 'customer',
    display_name: payload.display_name,
    phone: payload.phone || null,
    email: null,
    address: payload.address || null,
    national_id: payload.national_id || null,
    economic_code: payload.economic_code || null,
    registration_number: payload.registration_number || null,
    postal_code: payload.postal_code || null,
    opening_balance: Number(payload.opening_balance || 0),
    notes: payload.notes || null,
    is_active: payload.is_active !== false,
  };
  let res = await supabase.from('finance_parties').update(patch).eq('id', partyId).select('id').single();
  if (res.error && isMissingColumn(res.error)) {
    const { registration_number, postal_code, ...fallbackPatch } = patch;
    res = await supabase.from('finance_parties').update(fallbackPatch).eq('id', partyId).select('id').single();
  }
  assertNoError(res, 'خطا در ویرایش شخص مالی');
  return res.data;
}

export async function archiveFinanceParty(partyId, reason = '') {
  const res = await supabase.from('finance_parties').update({
    is_active: false,
    notes: reason ? `حذف/غیرفعال‌سازی شخص: ${reason}` : 'حذف/غیرفعال‌سازی شخص',
  }).eq('id', partyId).select('id').single();
  assertNoError(res, 'خطا در حذف/غیرفعال‌سازی شخص مالی');
  return res.data;
}


export async function createFinancePartiesBulk(rows = []) {
  const cleanRows = (rows || []).filter((row) => String(row.display_name || '').trim());
  const results = [];
  for (let i = 0; i < cleanRows.length; i += 1) {
    try {
      const data = await createFinanceParty(cleanRows[i]);
      results.push(data);
    } catch (error) {
      throw new Error(`خطا در ثبت ردیف ${i + 1}: ${error.message || 'خطای نامشخص'}`);
    }
  }
  return { count: results.length, rows: results };
}


function addMonthsIso(date, months) {
  const d = new Date(date || new Date());
  d.setMonth(d.getMonth() + Number(months || 0));
  return d.toISOString().slice(0, 10);
}

export async function createFinanceLoan({ loan, installments = [] }) {
  const userId = await currentFinanceUserId();
  const principal = Number(loan.principal_amount || 0);
  const total = Number(loan.total_payable_amount || principal);
  const count = Number(loan.installment_count || installments.length || 1);
  const monthly = count > 0 ? Math.round(total / count) : total;
  const loanRes = await supabase.from('finance_loans').insert({
    title_fa: loan.title_fa,
    lender_name: loan.lender_name,
    lender_type: loan.lender_type || 'bank',
    bank_name: loan.bank_name || null,
    principal_amount: principal,
    total_payable_amount: total,
    installment_count: count,
    installment_interval_months: Number(loan.installment_interval_months || 1),
    interest_rate: Number(loan.interest_rate || 0),
    received_date: loan.received_date || new Date().toISOString().slice(0, 10),
    first_due_date: loan.first_due_date || new Date().toISOString().slice(0, 10),
    status: loan.status || 'active',
    notes: loan.notes || null,
    created_by: userId,
  }).select('id, loan_number').single();
  assertNoError(loanRes, 'خطا در ثبت وام');

  const loanId = loanRes.data.id;
  const cleanInstallments = (installments.length ? installments : Array.from({ length: count }).map((_, i) => ({
    installment_no: i + 1,
    due_date: addMonthsIso(loan.first_due_date || new Date(), i * Number(loan.installment_interval_months || 1)),
    amount_due: i === count - 1 ? total - monthly * (count - 1) : monthly,
  }))).map((item, index) => ({
    loan_id: loanId,
    installment_no: Number(item.installment_no || index + 1),
    due_date: item.due_date,
    principal_amount: Number(item.principal_amount || item.amount_due || 0),
    interest_amount: Number(item.interest_amount || 0),
    fee_amount: Number(item.fee_amount || 0),
    amount_due: Number(item.amount_due || 0),
    status: item.status || 'pending',
    notes: item.notes || null,
  }));

  if (cleanInstallments.length > 0) {
    const insRes = await supabase.from('finance_loan_installments').insert(cleanInstallments);
    assertNoError(insRes, 'خطا در ثبت اقساط وام');
  }
  return loanRes.data;
}


export async function updateFinanceLoan(loanId, { loan, regenerateInstallments = true }) {
  const rpcRes = await supabase.rpc('fn_finance_update_loan', {
    p_loan_id: loanId,
    p_loan: loan || {},
    p_regenerate_installments: regenerateInstallments,
  });
  if (!rpcRes.error) return rpcRes.data;
  if (!isMissingRpc(rpcRes.error)) throw new Error(rpcRes.error.message || 'خطا در ویرایش وام');

  // Fallback until SQL 053 is applied: edit loan header only. Installment rebuild
  // is handled by the RPC after migration is installed.
  const res = await supabase.from('finance_loans').update({
    title_fa: loan.title_fa,
    lender_name: loan.lender_name,
    lender_type: loan.lender_type || 'bank',
    bank_name: loan.bank_name || null,
    principal_amount: Number(loan.principal_amount || 0),
    total_payable_amount: Number(loan.total_payable_amount || loan.principal_amount || 0),
    installment_count: Number(loan.installment_count || 1),
    installment_interval_months: Number(loan.installment_interval_months || 1),
    interest_rate: Number(loan.interest_rate || 0),
    received_date: loan.received_date || new Date().toISOString().slice(0, 10),
    first_due_date: loan.first_due_date || new Date().toISOString().slice(0, 10),
    status: loan.status || 'active',
    notes: loan.notes || null,
  }).eq('id', loanId).select('id').single();
  assertNoError(res, 'خطا در ویرایش وام');
  return res.data;
}

export async function archiveFinanceLoan(loanId, reason = '') {
  const rpcRes = await supabase.rpc('fn_finance_archive_loan', {
    p_loan_id: loanId,
    p_reason: reason || null,
  });
  if (!rpcRes.error) return rpcRes.data;
  if (!isMissingRpc(rpcRes.error)) throw new Error(rpcRes.error.message || 'خطا در حذف/بایگانی وام');

  const loanRes = await supabase.from('finance_loans').update({
    status: 'archived',
    notes: reason ? `حذف/بایگانی وام: ${reason}` : 'حذف/بایگانی وام',
  }).eq('id', loanId).select('id').single();
  assertNoError(loanRes, 'خطا در حذف/بایگانی وام');
  await supabase.from('finance_loan_installments').update({ status: 'cancelled' }).eq('loan_id', loanId).neq('status', 'paid');
  return loanRes.data;
}


export async function markFinanceLoanInstallmentPaid({ installmentId, paymentId, paidAmount, paidAt, notes }) {
  const res = await supabase.rpc('fn_finance_mark_loan_installment_paid', {
    p_installment_id: installmentId,
    p_payment_id: paymentId || null,
    p_paid_amount: paidAmount ? Number(paidAmount) : null,
    p_paid_at: paidAt || new Date().toISOString().slice(0, 10),
    p_notes: notes || null,
  });
  assertNoError(res, 'خطا در ثبت پرداخت قسط وام');
  return res.data;
}

export async function createFinanceOrderCost(payload) {
  const userId = await currentFinanceUserId();
  const res = await supabase.from('finance_order_costs').insert({
    related_order_id: payload.related_order_id || null,
    related_rnd_project_id: payload.related_rnd_project_id || null,
    related_production_order_id: payload.related_production_order_id || null,
    cost_type: payload.cost_type || 'other',
    amount: Number(payload.amount || 0),
    document_id: payload.document_id || null,
    source_module: payload.source_module || 'accounting',
    notes: payload.notes || null,
    created_by: userId,
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت هزینه سفارش');
  return res.data;
}

// -----------------------------------------------------------------------------
// Payroll / حقوق و دستمزد
// -----------------------------------------------------------------------------
function payrollTotalsFromLines(baseSalary = 0, lines = [], paidAmount = 0) {
  const benefits = (lines || []).filter((l) => l.line_type === 'earning').reduce((s, l) => s + Number(l.amount || 0), 0);
  const carried = (lines || []).filter((l) => l.line_type === 'carry').reduce((s, l) => s + Number(l.amount || 0), 0);
  const deductions = (lines || []).filter((l) => l.line_type === 'deduction').reduce((s, l) => s + Number(l.amount || 0), 0);
  const gross = Number(baseSalary || 0) + benefits + carried;
  const net = gross - deductions;
  const paid = Number(paidAmount || 0);
  return { benefits, carried, deductions, gross, net, paid, remaining: net - paid };
}

export async function createFinancePayrollEmployee(payload) {
  const userId = await currentFinanceUserId();
  const res = await supabase.from('finance_payroll_employees').insert({
    employee_code: payload.employee_code || null,
    display_name: payload.display_name,
    role_title: payload.role_title || null,
    department: payload.department || null,
    national_id: payload.national_id || null,
    phone: payload.phone || null,
    bank_account_number: payload.bank_account_number || null,
    bank_iban: payload.bank_iban || null,
    base_salary: Number(payload.base_salary || 0),
    notes: payload.notes || null,
    is_active: payload.is_active !== false,
    created_by: userId,
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت کارمند حقوق و دستمزد');
  return res.data;
}

export async function updateFinancePayrollEmployee(id, payload) {
  const res = await supabase.from('finance_payroll_employees').update({
    employee_code: payload.employee_code || null,
    display_name: payload.display_name,
    role_title: payload.role_title || null,
    department: payload.department || null,
    national_id: payload.national_id || null,
    phone: payload.phone || null,
    bank_account_number: payload.bank_account_number || null,
    bank_iban: payload.bank_iban || null,
    base_salary: Number(payload.base_salary || 0),
    notes: payload.notes || null,
    is_active: payload.is_active !== false,
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در ویرایش کارمند حقوق و دستمزد');
  return res.data;
}

export async function archiveFinancePayrollEmployee(id, reason = '') {
  const res = await supabase.from('finance_payroll_employees').update({
    is_active: false,
    notes: reason ? `حذف/غیرفعال‌سازی کارمند: ${reason}` : 'حذف/غیرفعال‌سازی کارمند',
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در حذف/غیرفعال‌سازی کارمند');
  return res.data;
}

export async function saveFinancePayrollSlip({ slip, lines = [] }) {
  const userId = await currentFinanceUserId();
  const cleanLines = (lines || [])
    .filter((line) => line.title_fa || Number(line.amount || 0) !== 0)
    .map((line, index) => ({
      line_no: index + 1,
      line_type: line.line_type || 'earning',
      title_fa: line.title_fa || 'ردیف حقوق',
      amount: Number(line.amount || 0),
      notes: line.notes || null,
    }));
  const totals = payrollTotalsFromLines(slip.base_salary, cleanLines, slip.paid_amount);
  const payload = {
    employee_id: slip.employee_id,
    payroll_month: slip.payroll_month,
    issue_date: slip.issue_date || new Date().toISOString().slice(0, 10),
    base_salary: Number(slip.base_salary || 0),
    carried_balance: totals.carried,
    benefits_total: totals.benefits,
    deductions_total: totals.deductions,
    gross_amount: totals.gross,
    net_payable: totals.net,
    paid_amount: totals.paid,
    remaining_balance: totals.remaining,
    status: slip.status || (totals.remaining <= 0 ? 'paid' : 'approved'),
    notes: slip.notes || null,
    created_by: userId,
  };

  let slipId = slip.id;
  if (slipId) {
    const updateRes = await supabase.from('finance_payroll_slips').update(payload).eq('id', slipId).select('id').single();
    assertNoError(updateRes, 'خطا در ویرایش فیش حقوقی');
    const delRes = await supabase.from('finance_payroll_lines').delete().eq('slip_id', slipId);
    assertNoError(delRes, 'خطا در پاکسازی ردیف‌های قبلی فیش');
  } else {
    const insertRes = await supabase.from('finance_payroll_slips').insert(payload).select('id').single();
    assertNoError(insertRes, 'خطا در ثبت فیش حقوقی');
    slipId = insertRes.data.id;
  }

  if (cleanLines.length > 0) {
    const lineRes = await supabase.from('finance_payroll_lines').insert(cleanLines.map((line) => ({ ...line, slip_id: slipId })));
    assertNoError(lineRes, 'خطا در ثبت ردیف‌های فیش حقوقی');
  }
  return { id: slipId };
}

export async function archiveFinancePayrollSlip(id, reason = '') {
  const res = await supabase.from('finance_payroll_slips').update({
    status: 'archived',
    notes: reason ? `حذف/بایگانی فیش حقوقی: ${reason}` : 'حذف/بایگانی فیش حقوقی',
  }).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در حذف/بایگانی فیش حقوقی');
  return res.data;
}

export async function registerFinancePayrollPayment({ slipId, paidAmount, paidAt, bankAccountId, cashboxId, notes }) {
  const res = await supabase.rpc('fn_finance_register_payroll_payment', {
    p_slip_id: slipId,
    p_paid_amount: Number(paidAmount || 0),
    p_paid_at: paidAt || new Date().toISOString().slice(0, 10),
    p_bank_account_id: bankAccountId || null,
    p_cashbox_id: cashboxId || null,
    p_notes: notes || null,
  });
  assertNoError(res, 'خطا در ثبت سند پرداخت حقوق');
  return res.data;
}
