import { supabase } from './supabaseClient';
import { ARYAMAN_BRAND_FA, ARYAMAN_LOGO_DATA_URI, brandedExcelTableHtml } from './reporting';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
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
      unit_price_estimate: Number(payload.unit_price_estimate || 0),
      price_currency: payload.price_currency || 'IRR',
      is_active: true,
    })
    .select('id')
    .single();
  assertNoError(res, 'خطا در ثبت کالا');
  return res.data;
}

export async function updateWarehouseItem(itemId, payload) {
  const res = await supabase
    .from('warehouse_items')
    .update({
      item_name_fa: payload.item_name_fa,
      item_name_en: payload.item_name_en || null,
      category: payload.item_group || payload.category || null,
      unit: payload.unit || 'عدد',
      location: payload.location || null,
      min_stock_threshold: Number(payload.reorder_point ?? payload.min_stock_threshold ?? 0),
      unit_price_estimate: Number(payload.unit_price_estimate || 0),
      price_currency: payload.price_currency || 'IRR',
    })
    .eq('id', itemId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در ویرایش کالا');
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
      unit_price_estimate: Number(r.unit_price_estimate || r.price || 0),
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
      unit_price_estimate: r.unit_price_estimate,
      price_currency: 'IRR',
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
  return snap.data;
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
  const css = `@page{size:A4;margin:12mm}body{margin:0;background:#f3f5f6;color:#1b2126;direction:rtl;font-family:Vazirmatn,Tahoma,Arial,sans-serif;padding:22px}.report{background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e7eaec;box-shadow:0 8px 28px rgba(16,36,61,.10)}.brand-head{background:linear-gradient(135deg,#10243d,#1b365d);color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand-title{display:flex;align-items:center;gap:12px}.brand-title img{width:54px;height:54px;object-fit:contain;border-radius:14px;background:#fff;padding:5px}.brand-title h1{margin:0;font-size:20px}.brand-title span{display:block;color:#f8d348;font-size:12px;margin-top:4px}.report-date{color:#d8dee3;font-size:12px}.report-body{padding:20px}.report-body h1{margin:0 0 14px;color:#10243d;font-size:20px}table{width:100%;border-collapse:separate;border-spacing:0;margin-top:12px;overflow:hidden;border:1px solid #e7eaec;border-radius:14px}th{background:#10243d;color:#fff;font-weight:800}td,th{padding:10px;border-bottom:1px solid #edf0f2;text-align:right;font-size:12px}tr:nth-child(even) td{background:#fafafa}.print-btn{margin:0 0 12px;background:#a8672e;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;cursor:pointer}@media print{body{background:#fff;padding:0}.print-btn{display:none}.report{box-shadow:none;border-radius:0}}`;
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
