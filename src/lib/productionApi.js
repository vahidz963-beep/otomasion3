import { supabase } from './supabaseClient';
import { brandedExcelTableHtml, brandedReportShell, escapeHtml } from './reporting';

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}

export async function acceptProductionOrder({ orderId, templateId, productNameFa, quantity, notes }) {
  const res = await supabase.rpc('fn_production_accept_order', {
    p_order_id: orderId,
    p_template_id: templateId || null,
    p_product_name_fa: productNameFa || null,
    p_quantity: Number(quantity || 1),
    p_notes: notes || null,
  });
  assertNoError(res, 'خطا در تأیید سفارش تولید');
  return res.data;
}

export async function setProductionStage(stageId, status, note = '') {
  const res = await supabase.rpc('fn_production_set_stage', {
    p_stage_id: stageId,
    p_status: status,
    p_note: note || null,
  });
  assertNoError(res, 'خطا در تغییر مرحله تولید');
  return res.data;
}

export async function saveProductionPlan({ productionOrderId, plannedStart, plannedEnd, workDays, laborPeople, hoursPerPerson, totalManHours, deliveryNote }) {
  const res = await supabase.rpc('fn_production_save_plan', {
    p_production_order_id: productionOrderId,
    p_planned_start: plannedStart || null,
    p_planned_end: plannedEnd || null,
    p_work_days: Number(workDays || 0),
    p_labor_people: Number(laborPeople || 0),
    p_hours_per_person: Number(hoursPerPerson || 0),
    p_total_man_hours: Number(totalManHours || 0),
    p_delivery_note: deliveryNote || null,
  });
  assertNoError(res, 'خطا در ذخیره برنامه‌ریزی تولید');
  return res.data;
}

export async function createProductionTemplate({ nameFa, productType, stageCount }) {
  const res = await supabase.rpc('fn_production_create_template', {
    p_name_fa: nameFa,
    p_product_type: productType || 'custom',
    p_stage_count: Number(stageCount || 6),
  });
  assertNoError(res, 'خطا در ساخت قالب تولید');
  return res.data;
}

export async function updateProductionTemplate(templateId, patch) {
  const res = await supabase.from('production_workflow_templates').update(patch).eq('id', templateId).select('id').single();
  assertNoError(res, 'خطا در ویرایش قالب تولید');
  return res.data;
}

export async function updateProductionStep(stepId, patch) {
  const res = await supabase.from('production_workflow_steps').update(patch).eq('id', stepId).select('id').single();
  assertNoError(res, 'خطا در ویرایش مرحله تولید');
  return res.data;
}

export async function createProductionStep(payload) {
  const res = await supabase.from('production_workflow_steps').insert(payload).select('id').single();
  assertNoError(res, 'خطا در افزودن مرحله تولید');
  return res.data;
}

export async function saveProductionBom({ bom, items }) {
  await currentUserId();
  const cleanBom = {
    warehouse_item_id: bom.warehouse_item_id || null,
    product_name_fa: bom.product_name_fa,
    product_name_en: bom.product_name_en || null,
    version_no: bom.version_no || 'v1',
    status: bom.status || 'draft',
    unit: bom.unit || 'عدد',
    notes: bom.notes || null,
  };

  let bomId = bom.id;
  if (bomId) {
    const res = await supabase.from('production_boms').update(cleanBom).eq('id', bomId).select('id').single();
    assertNoError(res, 'خطا در ویرایش فرمول تولید');
  } else {
    const res = await supabase.from('production_boms').insert(cleanBom).select('id').single();
    assertNoError(res, 'خطا در ثبت فرمول تولید');
    bomId = res.data.id;
  }

  const del = await supabase.from('production_bom_items').delete().eq('bom_id', bomId);
  assertNoError(del, 'خطا در پاکسازی ردیف‌های قبلی فرمول');

  const rows = (items || [])
    .filter((i) => i.item_name_fa && Number(i.quantity) > 0)
    .map((i) => ({
      bom_id: bomId,
      cost_type: i.cost_type || 'material',
      warehouse_item_id: i.warehouse_item_id || null,
      item_name_fa: i.item_name_fa,
      quantity: Number(i.quantity || 1),
      unit: i.unit || 'عدد',
      unit_cost: Number(i.unit_cost || 0),
      notes: i.notes || null,
    }));
  if (rows.length) {
    const ins = await supabase.from('production_bom_items').insert(rows);
    assertNoError(ins, 'خطا در ثبت ردیف‌های فرمول تولید');
  }

  const recalc = await supabase.rpc('fn_production_recalc_costs', { p_bom_id: bomId });
  assertNoError(recalc, 'خطا در محاسبه هزینه فرمول');
  return bomId;
}

export async function sendBomCostToFinance(bomId) {
  const res = await supabase.rpc('fn_production_send_bom_cost_to_finance', { p_bom_id: bomId });
  assertNoError(res, 'خطا در ارسال هزینه تولید به مالی');
  return res.data;
}

export async function createProductionQc(payload) {
  const userId = await currentUserId();
  const res = await supabase.from('production_qc_checks').insert({
    production_order_id: payload.production_order_id,
    stage_id: payload.stage_id || null,
    checked_by: userId,
    result: payload.result || 'passed',
    quantity_checked: Number(payload.quantity_checked || 0) || null,
    quantity_passed: Number(payload.quantity_passed || 0) || null,
    quantity_rejected: Number(payload.quantity_rejected || 0) || null,
    rejection_reason: payload.rejection_reason || null,
  }).select('id').single();
  assertNoError(res, 'خطا در ثبت کنترل کیفیت');
  return res.data;
}

export async function createProductionDocument(payload) {
  const userId = await currentUserId();
  const res = await supabase.from('production_documents').insert({
    production_order_id: payload.production_order_id || null,
    document_type: payload.document_type || 'instruction',
    title_fa: payload.title_fa,
    description_fa: payload.description_fa || null,
    status: payload.status || 'registered',
    created_by: userId,
  }).select('id, doc_number').single();
  assertNoError(res, 'خطا در ثبت سند تولید');
  return res.data;
}

export async function voidProductionDocument(documentId) {
  const res = await supabase.from('production_documents').update({ status: 'void' }).eq('id', documentId).select('id').single();
  assertNoError(res, 'خطا در ابطال سند تولید');
  return res.data;
}

export function downloadProductionExcel(filename, headers, rows, title = 'گزارش تولید') {
  const html = brandedExcelTableHtml(title, headers, rows);
  const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openProductionPrintable(title, html) {
  const doc = brandedReportShell({ title, body: html, subtitle: 'گزارش رسمی تولید' });
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

export function productionSafe(value) {
  return escapeHtml(value);
}
