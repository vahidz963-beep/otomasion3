import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
// @ts-ignore — shared JS is intentionally consumed by both Deno and Vite tests.
import { CALCULATOR_ENGINE_VERSION, calculateBoardEstimate, calculateTransformerQuote } from '../_shared/calculator-engine.js';
// @ts-ignore — pure action policy is shared with Node tests.
import { shouldPersistTransformerAction, transformerActionPolicy } from '../_shared/calculator-policy.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const WORDPRESS_SHARED_SECRET = Deno.env.get('WORDPRESS_SHARED_SECRET') || '';
const MAX_BODY_BYTES = 64 * 1024;
const INTERNAL_ROLES = new Set(['admin', 'sales', 'sales_manager', 'production', 'warehouse']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aryaman-timestamp, x-aryaman-signature, x-aryaman-event-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function cleanText(value: unknown, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function assertConfirmationMetadata(raw: Record<string, unknown>) {
  if (!cleanText(raw.customer_name, 160) || !cleanText(raw.customer_phone, 40) || !cleanText(raw.project_title, 200)) {
    throw new Error('برای تأیید نهایی، نام مشتری، شماره تماس و عنوان پروژه الزامی است');
  }
}

function safeUuid(value: unknown) {
  const text = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizePayload(raw: Record<string, unknown>) {
  const windings = Array.isArray(raw.windings) ? raw.windings.slice(0, 12).map((row: any, index) => ({
    name: cleanText(row?.name || `سیم‌پیچ ${index + 1}`, 80),
    start_pin: Math.trunc(number(row?.start_pin ?? row?.startPin)),
    end_pin: Math.trunc(number(row?.end_pin ?? row?.endPin)),
    turns: Math.trunc(number(row?.turns)),
    wire_id: safeUuid(row?.wire_id ?? row?.wireId),
    strands: Math.trunc(number(row?.strands, 1)),
    arrangement: row?.arrangement === 'bundle' ? 'bundle' : 'side',
    layer_mode: row?.layer_mode === 'manual' || row?.layerMode === 'manual' ? 'manual' : 'auto',
    requested_layers: Math.trunc(number(row?.requested_layers ?? row?.layers, 1)),
    direction: row?.direction === 'ccw' ? 'ccw' : 'cw',
  })) : [];
  return {
    id: safeUuid(raw.id),
    core_id: safeUuid(raw.core_id),
    bobbin_id: safeUuid(raw.bobbin_id),
    order_type: raw.order_type === 'production' ? 'production' : 'sample',
    quantity: Math.max(1, Math.trunc(number(raw.quantity, 1))),
    customer_name: cleanText(raw.customer_name, 160),
    customer_phone: cleanText(raw.customer_phone, 40),
    customer_email: cleanText(raw.customer_email, 160),
    project_title: cleanText(raw.project_title, 200),
    has_gap: Boolean(raw.has_gap),
    site_order_id: cleanText(raw.site_order_id, 120),
    windings,
  };
}

async function internalIdentity(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('نشست کاربر معتبر نیست');
  const token = authorization.slice(7);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new Error('نشست کاربر معتبر نیست');
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id,role,additional_roles,is_active')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) throw new Error('حساب کاربری فعال نیست');
  const roles = new Set([profile.role, ...(profile.additional_roles || [])].filter(Boolean));
  if (![...roles].some((role) => INTERNAL_ROLES.has(role))) throw new Error('دسترسی به مرکز محاسبه مجاز نیست');
  return { user: userData.user, profile, roles, client };
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function verifyWordPress(req: Request, rawBody: string) {
  if (!WORDPRESS_SHARED_SECRET || WORDPRESS_SHARED_SECRET.length < 32) throw new Error('اتصال WordPress روی سرور پیکربندی نشده است');
  const timestamp = req.headers.get('x-aryaman-timestamp') || '';
  const signature = (req.headers.get('x-aryaman-signature') || '').replace(/^v1=/, '').toLowerCase();
  const eventId = req.headers.get('x-aryaman-event-id') || '';
  const unix = Number(timestamp);
  if (!eventId || !Number.isFinite(unix) || Math.abs(Date.now() / 1000 - unix) > 300) throw new Error('زمان یا شناسه درخواست سایت معتبر نیست');
  const expected = await hmacHex(WORDPRESS_SHARED_SECRET, `${timestamp}.${eventId}.${rawBody}`);
  if (!/^[a-f0-9]{64}$/.test(signature) || !constantTimeEqual(expected, signature)) throw new Error('امضای درخواست سایت معتبر نیست');
  const ip = cleanText(req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown', 80);
  const { data: allowed, error } = await service.rpc('fn_calculator_rate_limit', { p_bucket_key: `wordpress:${ip}`, p_limit: 60, p_window_seconds: 60 });
  if (error || !allowed) throw new Error('تعداد درخواست‌های سایت بیش از حد مجاز است');
  return { eventId };
}

async function publicEnabled() {
  const { data, error } = await service.rpc('fn_calculator_public_status');
  if (error) throw error;
  return Boolean(data?.enabled && data?.calibrated);
}

async function getContext(payload: ReturnType<typeof sanitizePayload>) {
  if (!payload.core_id || !payload.bobbin_id || payload.windings.some((row) => !row.wire_id)) throw new Error('شناسه هسته، بوبین یا سیم معتبر نیست');
  const wireIds = [...new Set(payload.windings.map((row) => row.wire_id))];
  const { data, error } = await service.rpc('fn_calculator_get_context', {
    p_core_id: payload.core_id,
    p_bobbin_id: payload.bobbin_id,
    p_wire_ids: wireIds,
  });
  if (error) throw error;
  if (!data?.core || !data?.bobbin) throw new Error('هسته یا بوبین معتبر و سازگار یافت نشد');
  if ((data.wires || []).length !== wireIds.length) throw new Error('یکی از سیم‌های انتخاب‌شده معتبر نیست');
  return data;
}

async function calculateAndMaybeSave(raw: Record<string, unknown>, actorId: string | null, source: 'internal' | 'wordpress' | 'api', shouldSave = true) {
  const payload = sanitizePayload(raw);
  const context = await getContext(payload);
  if (context.formula?.engine_version !== CALCULATOR_ENGINE_VERSION) throw new Error('نسخه موتور و فرمول هم‌خوان نیست؛ استقرار را کامل کنید');
  const result = calculateTransformerQuote({
    core: context.core,
    bobbin: context.bobbin,
    wires: context.wires,
    windings: payload.windings,
    settings: context.formula.config,
    orderType: payload.order_type,
    quantity: payload.quantity,
    hasGap: payload.has_gap,
  });
  if (!result.valid || !shouldSave) return { saved: null, payload, context, result };
  const inputSnapshot = {
    core_id: payload.core_id,
    core_model: context.core.model_code,
    core: {
      id: context.core.id, model_code: context.core.model_code, family: context.core.family, material: context.core.material,
      effective_area_mm2: context.core.effective_area_mm2, center_leg_mm: context.core.center_leg_mm, weight_g: context.core.weight_g,
      assembly_time_seconds: context.core.assembly_time_seconds, assembly_method: context.core.assembly_method,
      warehouse_code: context.core.warehouse_code, warehouse_name: context.core.warehouse_name,
    },
    bobbin_id: payload.bobbin_id,
    bobbin_label: `${context.bobbin.pins_left}+${context.bobbin.pins_right} · ${context.bobbin.mount_orientation}`,
    bobbin: {
      id: context.bobbin.id, core_id: context.bobbin.core_id, pins_left: context.bobbin.pins_left, pins_right: context.bobbin.pins_right,
      mount_orientation: context.bobbin.mount_orientation, window_width_mm: context.bobbin.window_width_mm,
      window_height_mm: context.bobbin.window_height_mm, mean_turn_length_mm: context.bobbin.mean_turn_length_mm,
      flange_length_mm: context.bobbin.flange_length_mm, flange_width_mm: context.bobbin.flange_width_mm, weight_g: context.bobbin.weight_g,
      warehouse_code: context.bobbin.warehouse_code, warehouse_name: context.bobbin.warehouse_name,
    },
    order_type: payload.order_type,
    quantity: payload.quantity,
    has_gap: payload.has_gap,
    formula_version_code: context.formula.version_code,
    pricing_breakdown_visible: Boolean(context.formula.config?.show_internal_pricing_breakdown),
    windings: payload.windings,
  };
  const quotePayload = {
    id: payload.id,
    actor_id: actorId,
    calculator_type: 'transformer',
    source,
    order_type: payload.order_type,
    quantity: payload.quantity,
    customer_name: payload.customer_name,
    customer_phone: payload.customer_phone,
    customer_email: payload.customer_email,
    project_title: payload.project_title,
    site_order_id: payload.site_order_id || null,
    formula_version_id: context.formula.id,
    input_snapshot: inputSnapshot,
    engineering_snapshot: result.engineering,
    pricing_snapshot: result.pricing,
    public_result_snapshot: result.publicResult,
    inventory_snapshot: result.inventorySnapshot,
    windings: result.engineering.rows,
    requirements: result.requirements,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const { data: saved, error } = await service.rpc('fn_calculator_save_quote', { p_payload: quotePayload });
  if (error) throw error;
  return { saved, payload, context, result };
}

async function calculateAndSaveBoard(raw: Record<string, unknown>, actorId: string) {
  const model = {
    project_title: cleanText(raw.project_title, 200),
    width_mm: Math.max(1, number(raw.width_mm, 100)),
    height_mm: Math.max(1, number(raw.height_mm, 80)),
    power_w: Math.max(1, number(raw.power_w, 100)),
    complexity: ['basic', 'medium', 'advanced'].includes(String(raw.complexity)) ? String(raw.complexity) : 'medium',
    layers: [2, 4, 6, 8].includes(Number(raw.layers)) ? Number(raw.layers) : 2,
    features: Array.isArray(raw.features) ? raw.features.map((item) => cleanText(item, 40)).slice(0, 12) : [],
  };
  const { data: formula, error: formulaError } = await service.rpc('fn_calculator_get_board_context');
  if (formulaError) throw formulaError;
  if (formula.engine_version !== CALCULATOR_ENGINE_VERSION) throw new Error('نسخه موتور و فرمول هم‌خوان نیست؛ استقرار را کامل کنید');
  const result = calculateBoardEstimate(model, formula.config);
  const { data: saved, error } = await service.rpc('fn_calculator_save_quote', { p_payload: {
    actor_id: actorId,
    calculator_type: 'board',
    source: 'internal',
    order_type: null,
    quantity: 1,
    project_title: model.project_title,
    formula_version_id: formula.id,
    input_snapshot: model,
    engineering_snapshot: { area_cm2: result.area_cm2, lines: result.lines },
    pricing_snapshot: { currency: 'IRR', total_sale_rial: result.total_rial },
    public_result_snapshot: { currency: 'IRR', total_sale_rial: result.total_rial, status: 'estimate' },
    inventory_snapshot: [],
    windings: [],
    requirements: [],
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  } });
  if (error) throw error;
  return { model, result, saved };
}

function safePublicEngineering(engineering: any) {
  return {
    occupancy_percent: engineering?.occupancy_percent,
    area_percent: engineering?.area_percent,
    radial_percent: engineering?.radial_percent,
    total_length_m: engineering?.total_length_m,
    copper_weight_per_unit_g: engineering?.copper_weight_per_unit_g,
    total_build_mm: engineering?.total_build_mm,
    insulation_mm: engineering?.insulation_mm,
    rows: (engineering?.rows || []).map((row: any) => ({
      line_no: row.line_no, name: row.name, start_pin: row.start_pin, end_pin: row.end_pin,
      turns: row.turns, wire_diameter_mm: row.wire_diameter_mm, awg: row.awg,
      strands: row.strands, calculated_layers: row.calculated_layers, direction: row.direction,
      window_share_percent: row.window_share_percent,
    })),
  };
}

function internalComponents(context: any) {
  return {
    core: {
      model_code: context.core?.model_code, family: context.core?.family, material: context.core?.material,
      effective_area_mm2: context.core?.effective_area_mm2, center_leg_mm: context.core?.center_leg_mm, weight_g: context.core?.weight_g,
      assembly_method: context.core?.assembly_method, warehouse_code: context.core?.warehouse_code,
      available_qty: context.core?.available_qty, unit: context.core?.unit,
    },
    bobbin: {
      pins_left: context.bobbin?.pins_left, pins_right: context.bobbin?.pins_right, mount_orientation: context.bobbin?.mount_orientation,
      window_width_mm: context.bobbin?.window_width_mm, window_height_mm: context.bobbin?.window_height_mm,
      mean_turn_length_mm: context.bobbin?.mean_turn_length_mm, flange_length_mm: context.bobbin?.flange_length_mm,
      flange_width_mm: context.bobbin?.flange_width_mm, weight_g: context.bobbin?.weight_g,
      warehouse_code: context.bobbin?.warehouse_code, available_qty: context.bobbin?.available_qty, unit: context.bobbin?.unit,
    },
    wires: (context.wires || []).map((wire: any) => ({
      id: wire.id, diameter_mm: wire.diameter_mm, awg: wire.awg, wire_type: wire.wire_type,
      warehouse_code: wire.warehouse_code, available_qty: wire.available_qty, unit: wire.unit,
    })),
  };
}

function safePublicComponents(context: any) {
  return {
    core: {
      model_code: context.core?.model_code, family: context.core?.family, material: context.core?.material,
      effective_area_mm2: context.core?.effective_area_mm2,
      available: Number(context.core?.available_qty) > 0,
    },
    bobbin: {
      pins: `${context.bobbin?.pins_left || '—'}+${context.bobbin?.pins_right || '—'}`,
      mount_orientation: context.bobbin?.mount_orientation, window_width_mm: context.bobbin?.window_width_mm,
      window_height_mm: context.bobbin?.window_height_mm, mean_turn_length_mm: context.bobbin?.mean_turn_length_mm,
      available: Number(context.bobbin?.available_qty) > 0,
    },
    wires: (context.wires || []).map((wire: any) => ({
      diameter_mm: wire.diameter_mm, awg: wire.awg, available: Number(wire.available_qty) > 0,
    })),
  };
}

function safePublicInventory(inventory: any[]) {
  return (inventory || []).map((row: any) => ({
    component_role: row.component_role,
    label: row.label,
    unit: row.unit,
    status: row.sufficient ? 'available' : 'unavailable',
  }));
}

function safeCatalog(catalog: any) {
  const mappedCoreIds = new Set((catalog.bobbins || []).filter((row: any) => row.calculable).map((row: any) => row.core_id));
  return {
    cores: (catalog.cores || []).map((row: any) => ({ id: row.id, model_code: row.model_code, family: row.family, available: row.calculable && mappedCoreIds.has(row.id) && Number(row.available_qty) > 0, calculable: row.calculable && mappedCoreIds.has(row.id) })),
    bobbins: (catalog.bobbins || []).filter((row: any) => row.calculable).map((row: any) => ({ id: row.id, core_id: row.core_id, pins: `${row.pins_left}+${row.pins_right}`, mount_orientation: row.mount_orientation, available: Number(row.available_qty) > 0 })),
    wires: (catalog.wires || []).filter((row: any) => row.calculable).map((row: any) => ({ id: row.id, diameter_mm: row.diameter_mm, awg: row.awg, available: Number(row.available_qty) > 0 })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  let publicRequest = false;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return response({ error: 'حجم درخواست بیش از حد مجاز است' }, 413);
    let body: any;
    try { body = JSON.parse(rawBody || '{}'); } catch { return response({ error: 'JSON معتبر نیست' }, 400); }
    const action = cleanText(body.action, 50);

    if (['public_catalog', 'public_quote', 'public_quote_preview', 'public_quote_confirm', 'site_event'].includes(action)) {
      publicRequest = true;
      const { eventId } = await verifyWordPress(req, rawBody);
      if (action !== 'site_event' && !(await publicEnabled())) return response({ error: 'محاسبه و قیمت عمومی تا پایان کالیبراسیون غیرفعال است', code: 'PUBLIC_QUOTE_DISABLED' }, 503);
      if (action === 'public_catalog') {
        const { data, error } = await service.rpc('fn_calculator_get_catalog');
        if (error) throw error;
        return response({ catalog: safeCatalog(data) });
      }
      if (action === 'public_quote_preview') {
        const output = await calculateAndMaybeSave(body.payload || {}, null, 'wordpress', shouldPersistTransformerAction(action));
        if (!output.result.valid) return response({ valid: false, errors: output.result.errors, warnings: output.result.warnings, engineering: safePublicEngineering(output.result.engineering), components: safePublicComponents(output.context), inventory: safePublicInventory(output.result.inventorySnapshot) }, 422);
        return response({ valid: true, result: output.result.publicResult, engineering: safePublicEngineering(output.result.engineering), components: safePublicComponents(output.context), inventory: safePublicInventory(output.result.inventorySnapshot), warnings: output.result.warnings });
      }
      if (action === 'public_quote' || action === 'public_quote_confirm') {
        if (action === 'public_quote_confirm') assertConfirmationMetadata(body.payload || {});
        const output = await calculateAndMaybeSave(body.payload || {}, null, 'wordpress', shouldPersistTransformerAction(action));
        if (!output.result.valid) return response({ valid: false, errors: output.result.errors, warnings: output.result.warnings }, 422);
        return response({ valid: true, quote_id: output.saved.id, quote_code: output.saved.public_code, result: output.result.publicResult, engineering: safePublicEngineering(output.result.engineering), components: safePublicComponents(output.context), inventory: safePublicInventory(output.result.inventorySnapshot) });
      }
      const eventType = cleanText(body.event_type, 50);
      if (!['payment_confirmed', 'order_approved', 'order_cancelled'].includes(eventType)) return response({ error: 'نوع رویداد سایت مجاز نیست' }, 400);
      const quoteId = safeUuid(body.quote_id);
      if (!quoteId) return response({ error: 'شناسه محاسبه معتبر نیست' }, 400);
      const hash = await sha256Hex(rawBody);
      const { data, error } = await service.rpc('fn_calculator_process_site_event', {
        p_event_key: eventId,
        p_event_type: eventType,
        p_site_order_id: cleanText(body.site_order_id, 120),
        p_quote_id: quoteId,
        p_payload: { reason: cleanText(body.reason, 300), status: cleanText(body.status, 50) },
        p_payload_hash: hash,
      });
      if (error) throw error;
      return response({ ok: true, result: data });
    }

    const identity = await internalIdentity(req);
    const actionPolicy = transformerActionPolicy(action);
    if (actionPolicy?.scope === 'internal' && actionPolicy.response === 'fill') {
      const output = await calculateAndMaybeSave(body.payload || {}, identity.user.id, 'internal', actionPolicy.persist);
      return response({
        occupancy_percent: output.result.engineering?.occupancy_percent ?? null,
        radial_percent: output.result.engineering?.radial_percent ?? null,
        valid: output.result.valid,
        errors: output.result.errors,
      });
    }
    if (actionPolicy?.scope === 'internal' && actionPolicy.response === 'full') {
      if (action === 'confirm_transformer') assertConfirmationMetadata(body.payload || {});
      const output = await calculateAndMaybeSave(body.payload || {}, identity.user.id, 'internal', actionPolicy.persist);
      const isAdmin = identity.roles.has('admin');
      const showPricingBreakdown = isAdmin || Boolean(output.context.formula?.config?.show_internal_pricing_breakdown);
      return response({
        valid: output.result.valid,
        errors: output.result.errors,
        warnings: output.result.warnings,
        engineering: output.result.engineering,
        public_result: output.result.publicResult,
        inventory: output.result.inventorySnapshot,
        components: internalComponents(output.context),
        formula_version: output.context.formula?.version_code || null,
        pricing_breakdown_visible: showPricingBreakdown,
        quote: output.saved ? { id: output.saved.id, public_code: output.saved.public_code, status: output.saved.status } : null,
        ...(showPricingBreakdown ? { pricing: output.result.pricing } : {}),
      });
    }
    if (action === 'calculate_board') {
      const output = await calculateAndSaveBoard(body.payload || {}, identity.user.id);
      return response({ valid: true, quote: { id: output.saved.id, public_code: output.saved.public_code, status: output.saved.status }, result: output.result });
    }
    if (action === 'workflow') {
      const quoteId = safeUuid(body.quote_id);
      if (!quoteId) return response({ error: 'شناسه محاسبه معتبر نیست' }, 400);
      const operation = cleanText(body.operation, 30);
      const calls: Record<string, [string, Record<string, unknown>]> = {
        reserve: ['fn_calculator_reserve_quote', { p_quote_id: quoteId, p_idempotency_key: `internal:${crypto.randomUUID()}` }],
        release: ['fn_calculator_release_quote', { p_quote_id: quoteId, p_reason: cleanText(body.reason, 300) }],
        consume: ['fn_calculator_consume_quote', { p_quote_id: quoteId, p_production_order_id: safeUuid(body.production_order_id) }],
        promote: ['fn_calculator_promote_quote_to_order', { p_quote_id: quoteId, p_actor_id: identity.user.id }],
      };
      if (!calls[operation]) return response({ error: 'عملیات گردش کار معتبر نیست' }, 400);
      const [name, args] = calls[operation];
      const { data, error } = await identity.client.rpc(name, args);
      if (error) throw error;
      return response({ ok: true, result: data });
    }
    return response({ error: 'عملیات ناشناخته است' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'خطای پیش‌بینی‌نشده';
    console.error('calculator-api', { message });
    const status = /دسترسی|نشست|حساب کاربری|امضا/.test(message) ? 403 : 400;
    return response({ error: publicRequest ? 'پردازش امن درخواست سایت ناموفق بود.' : message }, status);
  }
});
