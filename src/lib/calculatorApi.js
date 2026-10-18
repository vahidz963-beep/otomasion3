import { supabase } from './supabaseClient';

function extractError(error, fallback) {
  const message = error?.context?.body?.error || error?.message || fallback;
  return new Error(message);
}

async function rpc(name, args = {}, fallback = 'خطا در ارتباط با مرکز محاسبه') {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw extractError(error, fallback);
  return data;
}

export async function getCalculatorCatalog() {
  return rpc('fn_calculator_get_catalog', {}, 'دریافت فهرست قطعات ناموفق بود');
}

export async function listCalculatorQuotes(limit = 100) {
  return rpc('fn_calculator_list_quotes', { p_limit: limit }, 'دریافت محاسبات ثبت‌شده ناموفق بود');
}

export async function getCalculatorQuote(quoteId, includeCosts = false) {
  return rpc('fn_calculator_get_quote', { p_quote_id: quoteId, p_include_costs: includeCosts }, 'دریافت سند محاسبه ناموفق بود');
}

export async function saveCalculatorComponent(kind, payload, newWarehouseItem = null) {
  const functions = {
    core: 'fn_calculator_save_core',
    bobbin: 'fn_calculator_save_bobbin',
    wire: 'fn_calculator_save_wire',
  };
  if (!functions[kind]) throw new Error('نوع قطعه معتبر نیست');
  return rpc(functions[kind], { p_payload: payload, p_new_warehouse_item: newWarehouseItem }, 'ثبت قطعه ناموفق بود');
}

export async function runCalculator(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('calculator-api', {
    body: { action, ...payload },
  });
  if (error) {
    let serverMessage = '';
    try {
      const response = error.context;
      if (response?.json) serverMessage = (await response.json())?.error || '';
    } catch { /* Supabase invocation errors do not always expose a response body. */ }
    throw new Error(serverMessage || error.message || 'اجرای محاسبه امن ناموفق بود');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function calculateTransformer(payload) {
  return runCalculator('calculate_transformer', { payload });
}

export async function calculateBoard(payload) {
  return runCalculator('calculate_board', { payload });
}

export async function reserveCalculatorQuote(quoteId) {
  return runCalculator('workflow', { operation: 'reserve', quote_id: quoteId });
}

export async function releaseCalculatorQuote(quoteId, reason) {
  return runCalculator('workflow', { operation: 'release', quote_id: quoteId, reason });
}

export async function consumeCalculatorQuote(quoteId, productionOrderId = null) {
  return runCalculator('workflow', { operation: 'consume', quote_id: quoteId, production_order_id: productionOrderId });
}

export async function promoteCalculatorQuote(quoteId) {
  return runCalculator('workflow', { operation: 'promote', quote_id: quoteId });
}

export async function getCalculatorAdminSettings() {
  return rpc('fn_calculator_get_admin_settings', {}, 'دریافت تنظیمات محرمانه ناموفق بود');
}

export async function publishTransformerFormula(versionCode, config, calibrationNotes = '') {
  return rpc('fn_calculator_publish_transformer_formula', { p_version_code: versionCode, p_config: config, p_calibration_notes: calibrationNotes }, 'انتشار نسخه فرمول ناموفق بود');
}

export async function setCalculatorPublicFlag(enabled, calibrated) {
  return rpc('fn_calculator_set_public_flag', { p_enabled: enabled, p_calibrated: calibrated }, 'تغییر وضعیت انتشار ناموفق بود');
}
