import { supabase } from './supabaseClient';
import { ARYAMAN_BRAND_FA, ARYAMAN_LOGO_DATA_URI } from './reporting';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}

function isMissingRpc(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('does not exist');
}

export async function createOrUpdateCustomer(input) {
  const userId = await currentUserId();
  const payload = {
    company_name: input.company_name,
    contact_person_name: input.contact_person_name || null,
    contact_phone: input.contact_phone || null,
    contact_email: input.contact_email || null,
    city: input.city || null,
    preferred_contact_channel: input.preferred_contact_channel || null,
    acquisition_source: input.acquisition_source || null,
    crm_status: input.crm_status || 'lead',
    lead_score: Number(input.lead_score || 50),
    next_follow_up_at: input.next_follow_up_at || null,
  };
  if (Object.prototype.hasOwnProperty.call(input, 'address')) payload.address = input.address || null;

  if (input.id) {
    const res = await supabase.from('customers').update(payload).eq('id', input.id).select('id').single();
    assertNoError(res, 'خطا در ویرایش مشتری');
    return res.data.id;
  }

  const res = await supabase.from('customers').insert({ ...payload, created_by: userId, assigned_sales_id: userId }).select('id').single();
  assertNoError(res, 'خطا در ثبت مشتری');
  return res.data.id;
}

export async function createOrderWithItems({ order, items, options = {} }) {
  await currentUserId();

  const cleanItems = (items || [])
    .filter((item) => item.item_name_fa && Number(item.quantity) > 0)
    .map((item) => ({
      item_name_fa: item.item_name_fa,
      item_name_en: item.item_name_en || null,
      warehouse_item_code: item.warehouse_item_code || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'عدد',
      unit_price: Number(item.unit_price || 0),
      notes: item.notes || null,
    }));

  const res = await supabase.rpc('fn_app_create_order', {
    p_customer: order.customer || {},
    p_order: order || {},
    p_items: cleanItems,
    p_create_proforma: !!options.createProforma,
    p_ref_finance: !!options.refFinance,
    p_ref_warehouse: !!options.refWarehouse,
    p_ref_path: !!options.refPath,
  });
  assertNoError(res, 'خطا در ثبت سفارش');
  return res.data;
}

export async function setOrderStage(orderId, stageKey, note = '') {
  const res = await supabase.rpc('fn_set_order_stage', {
    p_order_id: orderId,
    p_stage_key: stageKey,
    p_note: note || null,
  });
  assertNoError(res, 'خطا در تغییر مرحله سفارش');
  return res.data;
}

export async function reserveOrderInventory(orderId) {
  const res = await supabase.rpc('fn_reserve_order_inventory', { p_order_id: orderId });
  assertNoError(res, 'خطا در رزرو موجودی سفارش');
  return res.data;
}

export async function releaseOrderInventory(orderId) {
  const res = await supabase.rpc('fn_release_order_inventory', { p_order_id: orderId });
  assertNoError(res, 'خطا در آزادسازی رزرو موجودی');
  return res.data;
}

export async function createSalesProformaFromOrder(orderId) {
  const res = await supabase.rpc('fn_create_sales_proforma_from_order', { p_order_id: orderId });
  assertNoError(res, 'خطا در ساخت پیش‌فاکتور از سفارش');
  return res.data;
}

export async function createSalesInvoiceFromOrder(orderId) {
  const res = await supabase.rpc('fn_create_sales_invoice_from_order', { p_order_id: orderId });
  assertNoError(res, 'خطا در ساخت فاکتور از سفارش');
  return res.data;
}

export async function cancelOrder(orderId, reason = 'لغو توسط کاربر') {
  const res = await supabase
    .from('orders')
    .update({ is_cancelled: true, cancelled_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در لغو سفارش');
  return res.data;
}

export async function deactivateCustomer(customerId) {
  const res = await supabase
    .from('customers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', customerId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در غیرفعال‌سازی مشتری');
  return res.data;
}

export async function createOrderReferral({ orderId, targetModule, targetRole, title, description, priority = 2, dueDate }) {
  const res = await supabase.rpc('fn_create_order_referral', {
    p_order_id: orderId,
    p_target_module: targetModule,
    p_target_role: targetRole || null,
    p_title_fa: title,
    p_description_fa: description || null,
    p_priority: priority,
    p_due_date: dueDate || null,
  });
  assertNoError(res, 'خطا در ثبت ارجاع سفارش');
  return res.data;
}

export async function logCrmInteraction({ customerId, title, description, activityType = 'follow_up', contactChannel, orderId }) {
  const res = await supabase.rpc('fn_log_crm_interaction', {
    p_customer_id: customerId,
    p_title: title,
    p_description: description || null,
    p_activity_type: activityType,
    p_contact_channel: contactChannel || null,
    p_related_order_id: orderId || null,
  });
  assertNoError(res, 'خطا در ثبت تعامل CRM');
  return res.data;
}

export async function createCrmFollowup({
  customerId,
  orderId,
  title,
  dueAt,
  description,
  activityType = 'follow_up',
  contactChannel,
  assignedTo,
}) {
  if (!customerId) throw new Error('برای ثبت پیگیری CRM باید مشتری انتخاب شود.');
  if (!title?.trim()) throw new Error('عنوان پیگیری CRM الزامی است.');
  if (!dueAt) throw new Error('تاریخ/زمان پیگیری CRM الزامی است.');

  const userId = await currentUserId();

  const rpcRes = await supabase.rpc('fn_create_crm_followup', {
    p_customer_id: customerId,
    p_title: title.trim(),
    p_due_at: dueAt,
    p_description: description || null,
    p_activity_type: activityType || 'follow_up',
    p_contact_channel: contactChannel || null,
    p_related_order_id: orderId || null,
    p_assigned_to: assignedTo || userId,
  });

  if (!rpcRes.error) return rpcRes.data;
  if (!isMissingRpc(rpcRes.error)) assertNoError(rpcRes, 'خطا در ثبت پیگیری CRM');

  // Fallback for databases that have not run migration 018 yet.
  const insertRes = await supabase.from('crm_followups').insert({
    customer_id: customerId,
    related_order_id: orderId || null,
    title: title.trim(),
    due_at: dueAt,
    assigned_to: assignedTo || userId,
    created_by: userId,
  }).select('id').single();
  assertNoError(insertRes, 'خطا در ثبت پیگیری CRM');

  const customerPatch = {
    next_follow_up_at: dueAt,
    updated_at: new Date().toISOString(),
  };
  if (contactChannel) customerPatch.preferred_contact_channel = contactChannel;
  await supabase.from('customers').update(customerPatch).eq('id', customerId);

  try {
    await logCrmInteraction({
      customerId,
      orderId,
      title: `برنامه‌ریزی پیگیری: ${title.trim()}`,
      description,
      activityType,
      contactChannel,
    });
  } catch (_) {
    // The follow-up itself is already saved; do not fail the UI just because interaction logging failed.
  }

  return insertRes.data;
}

export async function markCrmFollowupDone(followupId, note = '') {
  const rpcRes = await supabase.rpc('fn_complete_crm_followup', {
    p_followup_id: followupId,
    p_note: note || null,
  });
  if (!rpcRes.error) return rpcRes.data;
  if (!isMissingRpc(rpcRes.error)) assertNoError(rpcRes, 'خطا در بستن پیگیری');

  const res = await supabase
    .from('crm_followups')
    .update({ is_done: true, done_at: new Date().toISOString() })
    .eq('id', followupId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در بستن پیگیری');
  return res.data;
}

export async function updateWorkflowTemplate(templateId, patch) {
  const res = await supabase.from('order_workflow_templates').update(patch).eq('id', templateId).select('id').single();
  assertNoError(res, 'خطا در ویرایش قالب مراحل');
  return res.data;
}

export async function updateWorkflowStep(stepId, patch) {
  const res = await supabase.from('order_workflow_template_steps').update(patch).eq('id', stepId).select('id').single();
  assertNoError(res, 'خطا در ویرایش مرحله');
  return res.data;
}

export async function createWorkflowStep(payload) {
  const res = await supabase.from('order_workflow_template_steps').insert(payload).select('id').single();
  assertNoError(res, 'خطا در ثبت مرحله جدید');
  return res.data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function brandedReportShell(title, body) {
  const css = `
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#f3f5f6;color:#1b2126;direction:rtl;font-family:Vazirmatn,Tahoma,Arial,sans-serif;padding:22px}.report{background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e7eaec;box-shadow:0 8px 28px rgba(16,36,61,.10)}.brand-head{background:linear-gradient(135deg,#10243d,#1b365d);color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand-title{display:flex;align-items:center;gap:12px}.brand-title img{width:54px;height:54px;object-fit:contain;border-radius:14px;background:#fff;padding:5px}.brand-title h1{margin:0;font-size:20px}.brand-title span{display:block;color:#f8d348;font-size:12px;margin-top:4px}.report-date{color:#d8dee3;font-size:12px}.report-body{padding:20px}.report-body h1{margin:0 0 14px;color:#10243d;font-size:20px}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:14px 0}.meta div{border:1px solid #edf0f2;background:#f8fafb;border-radius:12px;padding:10px}table{width:100%;border-collapse:separate;border-spacing:0;margin-top:12px;overflow:hidden;border:1px solid #e7eaec;border-radius:14px}th{background:#10243d;color:#fff;font-weight:800}td,th{padding:10px;border-bottom:1px solid #edf0f2;text-align:right;font-size:12px}tr:nth-child(even) td{background:#fafafa}.money{direction:ltr}.footer{margin-top:38px;display:flex;justify-content:space-between;gap:16px}.footer span{flex:1;border-top:1px solid #ccd3da;padding-top:10px;text-align:center;color:#5b6670}.print-btn{margin:0 0 12px;background:#a8672e;color:#fff;border:0;border-radius:12px;padding:10px 14px;font-weight:800;cursor:pointer}@media print{body{background:#fff;padding:0}.print-btn{display:none}.report{box-shadow:none;border-radius:0}}
  `;
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><button class="print-btn" onclick="window.print()">چاپ / ذخیره PDF</button><main class="report"><header class="brand-head"><div class="brand-title"><img src="${ARYAMAN_LOGO_DATA_URI}" alt="Aryaman"><div><h1>${escapeHtml(title)}</h1><span>${ARYAMAN_BRAND_FA}</span></div></div><div class="report-date">گزارش رسمی سیستم</div></header><section class="report-body">${body}</section></main></body></html>`;
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
  const table = `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = brandedReportShell(title, `<h1>${escapeHtml(title)}</h1>${table}`);
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
