import { supabase } from './supabaseClient';
import { ARYAMAN_BRAND_FA, ARYAMAN_LOGO_DATA_URI, brandedExcelTableHtml } from './reporting';
import { ARYAMAN_FONT_FAMILY_CSS, buildAryamanFontFaceCss } from './typography';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

export async function getWarehouseExchangeRates() {
  const res = await supabase.rpc('fn_get_warehouse_exchange_rates');
  assertNoError(res, 'خطا در دریافت نرخ ارز');
  return res.data;
}

export async function refreshWarehouseExchangeRates() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('برای به‌روزرسانی نرخ ارز دوباره وارد سامانه شوید.');

  const response = await fetch('/.netlify/functions/refresh-exchange-rates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'دریافت نرخ دلار و یوان با خطا روبه‌رو شد.');
  return body;
}

export async function setWarehouseItemCurrencyPrice({ itemId, currency, baseCostPrice, baseSalePrice }) {
  const res = await supabase.rpc('fn_set_warehouse_item_currency_price', {
    p_item_id: itemId,
    p_currency: currency,
    p_base_cost: Number(baseCostPrice),
    p_base_sale: Number(baseSalePrice),
  });
  assertNoError(res, 'خطا در ثبت قیمت ارزی کالا');
  return res.data;
}

export async function convertAllWarehouseItemCurrency(targetCurrency) {
  const res = await supabase.rpc('fn_convert_all_warehouse_item_currency', {
    p_target_currency: targetCurrency,
  });
  assertNoError(res, 'خطا در تبدیل گروهی ارز مبنای کالاها');
  return res.data;
}

export async function createWarehouseItem(payload) {
  const res = await supabase
    .from('warehouse_items')
    .insert({
      item_code: payload.item_code,
      item_name_fa: payload.item_name_fa,
      item_name_en: payload.item_name_en || null,
      category: payload.item_group || payload.category || null,
      unit: payload.unit || 'عدد',
      location: payload.location || null,
      min_stock_threshold: Number(payload.reorder_point ?? payload.min_stock_threshold ?? 0),
      unit_price_estimate: 0,
      price_currency: 'IRR',
      is_active: true,
    })
    .select('id')
    .single();
  assertNoError(res, 'خطا در ثبت کالا');

  const initialQty = Number(payload.stock_quantity || payload.initial_quantity || 0);
  if (initialQty > 0) {
    await recordStockMovement({
      itemId: res.data.id,
      direction: 'in',
      quantity: initialQty,
      reason: 'opening_balance',
      note: 'موجودی اولیه هنگام ثبت کالا',
    });
  }
  return res.data;
}

export async function updateWarehouseItem(itemId, payload) {
  const patch = {
    item_name_fa: payload.item_name_fa,
    item_name_en: payload.item_name_en || null,
    category: payload.item_group || payload.category || null,
    unit: payload.unit || 'عدد',
    location: payload.location || null,
    min_stock_threshold: Number(payload.reorder_point ?? payload.min_stock_threshold ?? 0),
  };
  // Price columns are deliberately absent: only the audited pricing RPC may
  // change canonical USD/CNY values or their current Rial caches.

  const res = await supabase
    .from('warehouse_items')
    .update(patch)
    .eq('id', itemId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در ویرایش کالا');

  if (payload.stock_quantity !== undefined && payload.stock_quantity !== '') {
    const current = Number(payload.current_qty_snapshot || 0);
    const target = Number(payload.stock_quantity || 0);
    const diff = target - current;
    if (Number.isFinite(diff) && diff !== 0) {
      await recordStockMovement({
        itemId,
        direction: diff > 0 ? 'in' : 'out',
        quantity: Math.abs(diff),
        reason: 'count_correction',
        note: 'اصلاح موجودی از فرم ویرایش کالا',
      });
    }
  }

  return res.data;
}

export async function recordStockMovement({ itemId, direction, quantity, reason, note }) {
  const res = await supabase.rpc('fn_record_stock_movement', {
    p_item_id: itemId,
    p_direction: direction,
    p_quantity: Number(quantity),
    p_reason: reason || (direction === 'in' ? 'manual_in' : 'manual_out'),
    p_note: note || null,
  });
  assertNoError(res, 'خطا در ثبت حرکت انبار');
  return res.data;
}

export async function finalizeWarehouseDocument(documentId) {
  const res = await supabase.rpc('fn_finalize_document', { p_document_id: documentId });
  assertNoError(res, 'خطا در ثبت نهایی سند');
  return res.data;
}

export async function cancelDraftWarehouseDocument(documentId) {
  const res = await supabase.rpc('fn_cancel_draft_document', { p_document_id: documentId });
  assertNoError(res, 'خطا در لغو سند موقت');
  return res.data;
}

export async function cancelWarehouseDocument(documentId, reason = 'حذف/لغو توسط کاربر') {
  const res = await supabase.rpc('fn_cancel_warehouse_document', {
    p_document_id: documentId,
    p_reason: reason || null,
  });
  assertNoError(res, 'خطا در حذف/لغو سند انبار');
  return res.data;
}

export async function updateWarehouseDocumentMeta(documentId, { customerName, customerCity, note }) {
  const rpcRes = await supabase.rpc('fn_update_warehouse_document_meta', {
    p_document_id: documentId,
    p_customer_name: customerName || null,
    p_customer_city: customerCity || null,
    p_note: note || null,
  });
  if (!rpcRes.error) return rpcRes.data;

  const res = await supabase
    .from('warehouse_documents')
    .update({ customer_name: customerName || null, customer_city: customerCity || null, note: note || null })
    .eq('id', documentId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در ذخیره اطلاعات سند');
  return res.data;
}

export async function fetchWarehouseDocumentLines(documentId) {
  const res = await supabase
    .from('warehouse_document_lines')
    .select('id, document_id, item_id, quantity, reason, note, tx_id, removed_at, created_at, warehouse_items:item_id(item_code,item_name_fa,unit)')
    .eq('document_id', documentId)
    .is('removed_at', null)
    .order('created_at', { ascending: true });
  assertNoError(res, 'خطا در دریافت ردیف‌های سند انبار');
  return res.data || [];
}

export async function updateWarehouseDocumentLine(lineId, quantity) {
  const res = await supabase.rpc('fn_update_document_line', {
    p_line_id: lineId,
    p_new_quantity: Number(quantity),
  });
  assertNoError(res, 'خطا در ویرایش ردیف سند');
  return res.data;
}

export async function removeWarehouseDocumentLine(lineId) {
  const res = await supabase.rpc('fn_remove_document_line', { p_line_id: lineId });
  assertNoError(res, 'خطا در حذف ردیف سند');
  return res.data;
}

export async function deactivateWarehouseItem(itemId) {
  const res = await supabase.rpc('fn_deactivate_item', { p_item_id: itemId });
  assertNoError(res, 'خطا در غیرفعال‌سازی کالا');
  return res.data;
}

export async function reactivateWarehouseItem(itemId) {
  const res = await supabase.rpc('fn_reactivate_item', { p_item_id: itemId });
  assertNoError(res, 'خطا در فعال‌سازی مجدد کالا');
  return res.data;
}

export async function createWarehouseReferral({ title, description, relatedOrderId, targetModule = 'accounting', targetRole = 'accountant', priority = 2, dueDate }) {
  const res = await supabase
    .from('automation_referrals')
    .insert({
      referral_number: null,
      source_module: 'warehouse',
      target_module: targetModule,
      target_role: targetRole,
      referral_type: 'request',
      priority,
      status: 'open',
      title_fa: title,
      description_fa: description || null,
      related_order_id: relatedOrderId || null,
      due_date: dueDate || null,
    })
    .select('id, referral_number')
    .single();
  assertNoError(res, 'خطا در ثبت ارجاع انبار');
  return res.data;
}

export async function createWarehouseSnapshot({ fileName, rows, notes }) {
  const normalized = (rows || [])
    .map((r) => ({
      item_code: String(r.item_code || r.code || '').trim(),
      item_name_fa: String(r.item_name_fa || r.name || r.item_name || '').trim(),
      category: String(r.item_group || r.category || '').trim() || null,
      unit: String(r.unit || 'عدد').trim(),
      location: String(r.location || '').trim() || null,
      quantity: Number(r.quantity || r.qty || 0),
      min_stock_threshold: Number(r.reorder_point || r.min_stock_threshold || 0),
    }))
    .filter((r) => r.item_code && Number.isFinite(r.quantity));

  const itemUpserts = normalized
    .filter((r) => r.item_name_fa)
    .map((r) => ({
      item_code: r.item_code,
      item_name_fa: r.item_name_fa,
      category: r.category,
      unit: r.unit,
      location: r.location,
      min_stock_threshold: r.min_stock_threshold,
      // Currency prices are intentionally not overwritten by stock snapshots.
      is_active: true,
    }));

  if (itemUpserts.length > 0) {
    const upsertRes = await supabase.from('warehouse_items').upsert(itemUpserts, { onConflict: 'item_code' });
    assertNoError(upsertRes, 'خطا در ثبت/به‌روزرسانی کالاهای فایل اکسل');
  }

  const snap = await supabase
    .from('warehouse_snapshots')
    .insert({ file_name: fileName || 'manual-import.csv', row_count: normalized.length, notes: notes || null })
    .select('id')
    .single();
  assertNoError(snap, 'خطا در ثبت Snapshot');

  const items = normalized.map((r) => ({
    snapshot_id: snap.data.id,
    item_code: r.item_code,
    quantity: r.quantity,
    unit: r.unit || null,
  }));
  if (items.length) {
    const res = await supabase.from('warehouse_snapshot_items').insert(items);
    assertNoError(res, 'خطا در ثبت ردیف‌های Snapshot');
  }

  const openingDocumentRes = await supabase.rpc('fn_materialize_warehouse_opening_document', {
    p_snapshot_id: snap.data.id,
  });
  assertNoError(openingDocumentRes, 'خطا در ثبت سند اصلاحی موجودی اول دوره');

  return { ...snap.data, opening_document_id: openingDocumentRes.data };
}


export async function createWarehouseShipment(payload) {
  if (!payload.customer_name?.trim()) throw new Error('نام مشتری/مقصد در ثبت دستی الزامی است.');
  if (!payload.item_summary?.trim()) throw new Error('شرح متنی اقلام در ثبت دستی الزامی است.');
  if (Number(payload.total_quantity || 0) <= 0) throw new Error('تعداد کل ثبت دستی باید بیشتر از صفر باشد.');

  const res = await supabase.from('warehouse_shipments').insert({
    source_type: 'manual',
    model_version: 2,
    customer_name: payload.customer_name.trim(),
    customer_city: payload.customer_city?.trim() || null,
    shipment_date: payload.shipment_date || new Date().toISOString().slice(0, 10),
    item_summary: payload.item_summary.trim(),
    total_quantity: Number(payload.total_quantity),
    carton_count: Math.max(0, Number(payload.carton_count || 0)),
    total_value: Math.max(0, Number(payload.total_value || 0)),
    carrier_name: payload.carrier_name?.trim() || null,
    tracking_code: payload.tracking_code?.trim() || null,
    receiver_name: payload.receiver_name?.trim() || null,
    status: payload.status || 'ready',
    notes: payload.notes?.trim() || null,
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت ارسال دستی');
  return res.data;
}

export async function archiveWarehouseShipment(id, reason = 'بایگانی ارسال از فهرست ارسال‌ها') {
  const res = await supabase.rpc('fn_archive_warehouse_shipment', {
    p_shipment_id: id,
    p_reason: reason,
  });
  assertNoError(res, 'خطا در بایگانی ارسال');
  return res.data;
}

export async function reverseWarehouseShipment(id, reason) {
  if (!reason?.trim()) throw new Error('ثبت دلیل برگشت ارسال الزامی است.');
  const res = await supabase.rpc('fn_reverse_order_shipment', {
    p_shipment_id: id,
    p_reason: reason.trim(),
  });
  assertNoError(res, 'خطا در برگشت ارسال و اصلاح موجودی');
  return res.data;
}

export async function updateWarehouseShipment(id, payload) {
  const isStructured = Boolean(payload.related_order_id || payload.warehouse_document_id || (!payload.is_manual_record && payload.source_type !== 'manual'));
  const patch = {
    carton_count: Math.max(0, Number(payload.carton_count || 0)),
    carrier_name: payload.carrier_name?.trim() || null,
    tracking_code: payload.tracking_code?.trim() || null,
    receiver_name: payload.receiver_name?.trim() || null,
    notes: payload.notes?.trim() || null,
  };

  if (!isStructured) Object.assign(patch, {
    customer_name: payload.customer_name?.trim() || null,
    customer_city: payload.customer_city?.trim() || null,
    shipment_date: payload.shipment_date || new Date().toISOString().slice(0, 10),
    item_summary: payload.item_summary?.trim() || null,
    total_quantity: Math.max(0, Number(payload.total_quantity || 0)),
    total_value: Math.max(0, Number(payload.total_value || 0)),
    status: payload.status || 'ready',
  });

  const res = await supabase.from('warehouse_shipments').update(patch).eq('id', id).select('id').single();
  assertNoError(res, 'خطا در ویرایش اطلاعات ارسال');
  return res.data;
}

export function parseCsvText(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function brandedReportShell(title, body) {
  const css = `${buildAryamanFontFaceCss()}@page{size:A4;margin:12mm}body{margin:0;background:#f3f5f6;color:#1b2126;direction:rtl;font-family:${ARYAMAN_FONT_FAMILY_CSS};font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;padding:22px}.report{background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e7eaec;box-shadow:0 8px 28px rgba(16,36,61,.10)}.brand-head{background:linear-gradient(135deg,#10243d,#1b365d);color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand-title{display:flex;align-items:center;gap:12px}.brand-title img{width:54px;height:54px;object-fit:contain;border-radius:14px;background:#fff;padding:5px}.brand-title h1{margin:0;font-size:20px}.brand-title span{display:block;color:#f8d348;font-size:12px;margin-top:4px}.report-date{color:#d8dee3;font-size:12px}.report-body{padding:20px}.report-body h1{margin:0 0 14px;color:#10243d;font-size:20px}table{width:100%;border-collapse:separate;border-spacing:0;margin-top:12px;overflow:hidden;border:1px solid #e7eaec;border-radius:14px}th{background:#10243d;color:#fff;font-weight:800}td,th{padding:10px;border-bottom:1px solid #edf0f2;text-align:right;font-size:12px}tr:nth-child(even) td{background:#fafafa}.print-btn{margin:0 0 12px;background:#a8672e;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;cursor:pointer}@media print{body{background:#fff;padding:0}.print-btn{display:none}.report{box-shadow:none;border-radius:0}}`;
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><button class="print-btn" onclick="window.print()">چاپ / ذخیره PDF</button><main class="report"><header class="brand-head"><div class="brand-title"><img src="${ARYAMAN_LOGO_DATA_URI}" alt="Aryaman"><div><h1>${escapeHtml(title)}</h1><span>${ARYAMAN_BRAND_FA}</span></div></div><div class="report-date">گزارش رسمی انبار</div></header><section class="report-body">${body}</section></main></body></html>`;
}

export function downloadCsv(filename, rows) {
  const csv = `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')}`;
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

export function downloadWordHtml(filename, title, html) {
  const doc = brandedReportShell(title, html);
  const blob = new Blob([`\ufeff${doc}`], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintable(title, html) {
  const doc = brandedReportShell(title, html);
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.html`;
    a.click();
  }
}
