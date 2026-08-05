import { supabase } from './supabaseClient';

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
  const snap = await supabase
    .from('warehouse_snapshots')
    .insert({ file_name: fileName || 'manual-import.csv', row_count: rows.length, notes: notes || null })
    .select('id')
    .single();
  assertNoError(snap, 'خطا در ثبت Snapshot');

  const items = rows.map((r) => ({
    snapshot_id: snap.data.id,
    item_code: r.item_code,
    quantity: Number(r.quantity || 0),
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

export function downloadExcelHtml(filename, headers, rows) {
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintable(title, html) {
  const css = `body{font-family:Tahoma,sans-serif;padding:24px;direction:rtl;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:right;font-size:12px}@media print{button{display:none}}`;
  const doc = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><button onclick="print()">چاپ / ذخیره PDF</button>${html}</body></html>`;
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
