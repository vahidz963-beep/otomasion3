import { supabase } from './supabaseClient';

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
    address: input.address || null,
    preferred_contact_channel: input.preferred_contact_channel || null,
    acquisition_source: input.acquisition_source || null,
    crm_status: input.crm_status || 'lead',
    lead_score: Number(input.lead_score || 50),
    next_follow_up_at: input.next_follow_up_at || null,
    created_by: userId,
    assigned_sales_id: userId,
  };

  if (input.id) {
    const res = await supabase.from('customers').update(payload).eq('id', input.id).select('id').single();
    assertNoError(res, 'خطا در ویرایش مشتری');
    return res.data.id;
  }

  const res = await supabase.from('customers').insert(payload).select('id').single();
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
