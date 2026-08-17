import { supabase } from './supabaseClient';
import { brandedExcelTableHtml, brandedReportShell, escapeHtml } from './reporting';

function assertNoError({ error }, fallbackMessage) { if (error) throw new Error(error.message || fallbackMessage); }
async function currentUserId() { const { data, error } = await supabase.auth.getUser(); if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.'); return data.user.id; }

export async function acceptRndOrder({ orderId, templateId, titleFa, requesterName, notes }) {
  const res = await supabase.rpc('fn_rnd_accept_order', { p_order_id: orderId, p_template_id: templateId || null, p_title_fa: titleFa || null, p_requester_name: requesterName || null, p_notes: notes || null });
  assertNoError(res, 'خطا در تأیید سفارش R&D'); return res.data;
}
export async function createInternalRndProject({ titleFa, templateId, requesterName, requirements, notes }) {
  const res = await supabase.rpc('fn_rnd_create_internal_project', { p_title_fa: titleFa, p_template_id: templateId || null, p_requester_name: requesterName || null, p_requirements: requirements || null, p_notes: notes || null });
  assertNoError(res, 'خطا در ثبت پروژه داخلی R&D'); return res.data;
}
export async function setRndStage(stageId, status, note = '') {
  const res = await supabase.rpc('fn_rnd_set_stage', { p_stage_id: stageId, p_status: status, p_note: note || null });
  assertNoError(res, 'خطا در تغییر مرحله R&D'); return res.data;
}
export async function createRndTemplate({ nameFa, projectType, stageCount }) {
  const res = await supabase.rpc('fn_rnd_create_template', { p_name_fa: nameFa, p_project_type: projectType || 'custom', p_stage_count: Number(stageCount || 6) });
  assertNoError(res, 'خطا در ساخت قالب R&D'); return res.data;
}
export async function updateRndTemplate(templateId, patch) { const res = await supabase.from('rnd_workflow_templates').update(patch).eq('id', templateId).select('id').single(); assertNoError(res, 'خطا در ویرایش قالب R&D'); return res.data; }
export async function updateRndStep(stepId, patch) { const res = await supabase.from('rnd_workflow_steps').update(patch).eq('id', stepId).select('id').single(); assertNoError(res, 'خطا در ویرایش مرحله R&D'); return res.data; }
export async function createRndStep(payload) { const res = await supabase.from('rnd_workflow_steps').insert(payload).select('id').single(); assertNoError(res, 'خطا در افزودن مرحله R&D'); return res.data; }

export async function saveRndCost({ projectId, item }) {
  const userId = await currentUserId();
  const res = await supabase.from('rnd_cost_items').insert({ rnd_project_id: projectId, cost_type: item.cost_type || 'labor', warehouse_item_id: item.warehouse_item_id || null, title_fa: item.title_fa, quantity: Number(item.quantity || 1), unit: item.unit || 'عدد', unit_cost: Number(item.unit_cost || 0), hours: item.hours ? Number(item.hours) : null, note: item.note || null, created_by: userId }).select('id').single();
  assertNoError(res, 'خطا در ثبت هزینه R&D');
  await supabase.rpc('fn_rnd_recalc_costs', { p_project_id: projectId });
  return res.data;
}
export async function deleteRndCost(costId, projectId) { const res = await supabase.from('rnd_cost_items').delete().eq('id', costId); assertNoError(res, 'خطا در حذف هزینه'); if (projectId) await supabase.rpc('fn_rnd_recalc_costs', { p_project_id: projectId }); return true; }

export async function archiveRndProject(projectId, reason = '') {
  const res = await supabase
    .from('rnd_projects')
    .update({
      status: 'archived',
      notes: reason ? `بایگانی/حذف از هزینه‌ها: ${reason}` : 'بایگانی/حذف از هزینه‌ها',
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .select('id')
    .single();
  assertNoError(res, 'خطا در حذف/بایگانی پروژه R&D از هزینه‌ها');
  return res.data;
}

export async function saveRndTest(payload) { const userId = await currentUserId(); const res = await supabase.from('rnd_test_records').insert({ rnd_project_id: payload.rnd_project_id, stage_id: payload.stage_id || null, test_title: payload.test_title, test_type: payload.test_type || null, result: payload.result || 'pending', quantity_tested: payload.quantity_tested ? Number(payload.quantity_tested) : null, test_duration_hours: payload.test_duration_hours ? Number(payload.test_duration_hours) : null, test_conditions: payload.test_conditions || null, result_notes: payload.result_notes || null, tested_by: userId }).select('id').single(); assertNoError(res, 'خطا در ثبت تست R&D'); return res.data; }

export function downloadRndExcel(filename, headers, rows, title = 'گزارش R&D') { const html = brandedExcelTableHtml(title, headers, rows); const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
export function openRndPrintable(title, html) { const doc = brandedReportShell({ title, body: html, subtitle: 'گزارش رسمی R&D' }); const blob = new Blob([doc], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const win = window.open(url, '_blank'); if (!win) { const a = document.createElement('a'); a.href = url; a.download = `${title}.html`; a.click(); } }
export function rndSafe(value) { return escapeHtml(value); }
