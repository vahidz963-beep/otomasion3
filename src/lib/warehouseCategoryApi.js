import { supabase } from './supabaseClient';
function ok(res, message) { if (res.error) throw new Error(res.error.message || message); return res.data; }
export async function createWarehouseCategory(payload) {
  return ok(await supabase.from('warehouse_item_categories').insert({ name_fa: payload.name_fa, name_en: payload.name_en || null, code: payload.code || null, sort_order: Number(payload.sort_order || 0), is_active: true }).select('id').single(), 'خطا در ثبت دسته‌بندی');
}
export async function updateWarehouseCategory(id, payload) {
  if (String(id).startsWith('derived-')) {
    const res = await supabase.from('warehouse_items').update({ category: payload.name_fa }).eq('category', payload.old_name || id.slice(8));
    return ok({ data: { id }, error: res.error }, 'خطا در ویرایش دسته‌بندی کالاها');
  }
  return ok(await supabase.from('warehouse_item_categories').update({ name_fa: payload.name_fa, name_en: payload.name_en || null, code: payload.code || null, sort_order: Number(payload.sort_order || 0) }).eq('id', id).select('id').single(), 'خطا در ویرایش دسته‌بندی');
}
export async function archiveWarehouseCategory(id) {
  return ok(await supabase.from('warehouse_item_categories').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select('id').single(), 'خطا در بایگانی دسته‌بندی');
}
