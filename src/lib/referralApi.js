import { supabase } from './supabaseClient';

export const MODULE_LABELS_FA = {
  orders: 'سفارش‌ها',
  sales: 'فروش',
  accounting: 'مالی',
  warehouse: 'انبار',
  production: 'تولید',
  rnd: 'R&D',
  admin: 'مدیر کل',
  office: 'اداری',
};

export const TARGET_ROLE_BY_MODULE = {
  orders: 'sales',
  sales: 'sales',
  accounting: 'accountant',
  warehouse: 'warehouse',
  production: 'production',
  rnd: 'rnd',
  admin: 'admin',
  office: 'office_admin',
};

function assertNoError({ error }, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('نشست کاربر معتبر نیست.');
  return data.user.id;
}

export async function fetchModuleReferrals({ module, relatedOrderId, relatedDocumentId, status = 'active' }) {
  let query = supabase
    .from('automation_referrals')
    .select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, title_en, description_fa, description_en, source_record_id, related_order_id, related_document_id, assigned_to, created_by, due_date, response_fa, response_en, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (relatedOrderId) query = query.eq('related_order_id', relatedOrderId);
  else if (relatedDocumentId) query = query.eq('related_document_id', relatedDocumentId);
  else if (module) query = query.or(`source_module.eq.${module},target_module.eq.${module}`);

  if (status === 'active') query = query.in('status', ['open', 'in_progress', 'answered']);
  if (status === 'done') query = query.eq('status', 'done');
  if (status === 'cancelled') query = query.eq('status', 'cancelled');

  const res = await query;
  assertNoError(res, 'خطا در دریافت ارجاعات');
  return res.data || [];
}

export async function createReferral({
  sourceModule,
  targetModule,
  title,
  description,
  referralType = 'request',
  priority = 2,
  dueDate,
  relatedOrderId,
  relatedDocumentId,
  sourceRecordId,
  assignedTo,
}) {
  const userId = await currentUserId();
  const targetRole = TARGET_ROLE_BY_MODULE[targetModule] || null;
  const payload = {
    referral_number: null,
    source_module: sourceModule,
    target_module: targetModule,
    target_role: targetRole,
    referral_type: referralType,
    priority: Number(priority || 2),
    status: 'open',
    title_fa: title,
    description_fa: description || null,
    source_record_id: sourceRecordId || null,
    related_order_id: relatedOrderId || null,
    related_document_id: relatedDocumentId || null,
    assigned_to: assignedTo || null,
    created_by: userId,
    due_date: dueDate || null,
  };

  const res = await supabase
    .from('automation_referrals')
    .insert(payload)
    .select('id, referral_number')
    .single();
  assertNoError(res, 'خطا در ثبت ارجاع');
  return res.data;
}

export async function updateReferralStatus(id, status, response) {
  const patch = { status };
  if (response !== undefined) patch.response_fa = response || null;
  const res = await supabase
    .from('automation_referrals')
    .update(patch)
    .eq('id', id)
    .select('id')
    .single();
  assertNoError(res, 'خطا در تغییر وضعیت ارجاع');
  return res.data;
}

export async function fetchReferralMessages(referralId) {
  const res = await supabase
    .from('automation_referral_messages')
    .select('id, referral_id, message_fa, message_type, created_by, created_at, profiles:created_by(full_name, role)')
    .eq('referral_id', referralId)
    .order('created_at', { ascending: true });
  assertNoError(res, 'خطا در دریافت گفتگوهای ارجاع');
  return res.data || [];
}

export async function addReferralMessage(referralId, message, messageType = 'reply') {
  const userId = await currentUserId();
  const res = await supabase
    .from('automation_referral_messages')
    .insert({ referral_id: referralId, message_fa: message, message_type: messageType, created_by: userId })
    .select('id')
    .single();
  assertNoError(res, 'خطا در ثبت پاسخ ارجاع');
  await supabase.from('automation_referrals').update({ status: 'answered', response_fa: message }).eq('id', referralId);
  return res.data;
}
