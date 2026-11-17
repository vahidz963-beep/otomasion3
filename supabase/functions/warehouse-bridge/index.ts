// Edge Function: warehouse-bridge — پل دوطرفهٔ انبار
// مسیر ۱ (سایت → انبار): دریافت رویدادهای ووکامرس (order_reserve / order_release) با امضای
//   HMAC-SHA256 روی timestamp.eventId.body (هم‌الگوریتم calculator-api)، ثبت idempotent در
//   public.warehouse_bridge_events و سپس «پردازش فوری» با fn_warehouse_bridge_process_event
//   تا رزرو/آزادسازی همان لحظه انجام شود (رویدادهای ناتمام با pg_cron دوباره تلاش می‌شوند).
// مسیر ۲ (انبار → سایت): شاخهٔ push_stock_to_site فقط برای کاربران واردشدهٔ اتوماسیون با نقش
//   admin/warehouse — موجودی قابل‌فروش اقلام خوانده و با همان امضا به endpoint ووکامرس پشتیبانی
//   می‌شود؛ نتیجه در warehouse_bridge_events (stock_push_out) ثبت می‌گردد.
//
// استقرار: Dashboard → Edge Functions → warehouse-bridge → Deploy
// Secretهای لازم: WORDPRESS_SHARED_SECRET (مشترک با پل ووکامرس)، WOOCOMMERCE_SITE_URL (آدرس سایت، بدون اسلش)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim();
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
const ANON_KEY = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
const WORDPRESS_SHARED_SECRET = (Deno.env.get('WORDPRESS_SHARED_SECRET') || '').trim();
const WOOCOMMERCE_SITE_URL = (Deno.env.get('WOOCOMMERCE_SITE_URL') || '').trim().replace(/\/+$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aryaman-timestamp, x-aryaman-signature, x-aryaman-event-id, x-aryaman-event',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_EVENTS = new Set(['order_reserve', 'order_release', 'stock_update', 'push_stock_to_site']);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'فقط POST مجاز است' }, 405);

  try {
    if (!WORDPRESS_SHARED_SECRET || WORDPRESS_SHARED_SECRET.length < 32) {
      throw new Error('راز مشترک WordPress روی سرور پیکربندی نشده است');
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = JSON.parse(await req.text() || '{}');
    const event = (body.event || '').toString();
    if (!ALLOWED_EVENTS.has(event)) return json({ error: 'نوع رویداد مجاز نیست' }, 400);

    /* ================================================================
       مسیر ۲ — پوش موجودی از اتوماسیون به سایت (کاربر داخلی)
       ================================================================ */
    if (event === 'push_stock_to_site') {
      const authorization = req.headers.get('authorization') || '';
      if (!authorization.startsWith('Bearer ')) return json({ error: 'نشست کاربر معتبر نیست' }, 401);
      const anon = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authorization } },
      });
      const { data: userData, error: userError } = await anon.auth.getUser(authorization.slice(7));
      if (userError || !userData.user) return json({ error: 'نشست کاربر معتبر نیست' }, 401);
      const { data: profile } = await admin.from('profiles')
        .select('id,role,additional_roles,is_active').eq('id', userData.user.id).maybeSingle();
      const roles = [profile?.role, ...((profile?.additional_roles as string[]) || [])].filter(Boolean);
      if (!profile?.is_active || !roles.some((r) => ['admin', 'warehouse'].includes(String(r)))) {
        return json({ error: 'دسترسی انبار مجاز نیست' }, 403);
      }
      if (!WOOCOMMERCE_SITE_URL) return json({ error: 'WOOCOMMERCE_SITE_URL روی سرور تنظیم نشده است' }, 500);

      const codes = Array.isArray(body.item_codes) ? body.item_codes.map((c: any) => String(c).trim()).filter(Boolean).slice(0, 200) : [];
      if (!codes.length) return json({ error: 'فهرست کدهای کالا خالی است' }, 400);

      const { data: stock, error: stockError } = await admin
        .from('v_app_inventory_catalog')
        .select('item_code, available_for_sale_qty')
        .in('item_code', codes);
      if (stockError) throw stockError;
      const items = (stock || []).map((row: any) => ({
        item_code: row.item_code,
        available: Math.trunc(Number(row.available_for_sale_qty || 0)),
      }));

      const eventId = crypto.randomUUID();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({ event: 'stock_update', items });
      const signature = await hmacHex(WORDPRESS_SHARED_SECRET, `${timestamp}.${eventId}.${payload}`);
      const target = `${WOOCOMMERCE_SITE_URL}/wp-json/aryaman-bridge/v1/stock-update`;
      const res = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Aryaman-Timestamp': timestamp,
          'X-Aryaman-Event-Id': eventId,
          'X-Aryaman-Signature': signature,
        },
        body: payload,
      });
      const resText = await res.text();

      await admin.from('warehouse_bridge_events').insert({
        event_id: eventId,
        event: 'stock_push_out',
        wc_order: null,
        quote_id: null,
        items: items,
        status: res.ok ? 'processed' : 'failed',
        processed_at: new Date().toISOString(),
        note: `push to site: ${res.status} ${resText.slice(0, 200)}`,
      });

      if (!res.ok) return json({ error: `ارسال به سایت ناموفق بود (${res.status})`, detail: resText.slice(0, 300) }, 502);
      return json({ ok: true, pushed: items.length });
    }

    /* ================================================================
       مسیر ۱ — رویدادهای امضاشدهٔ ووکامرس (order_reserve / order_release)
       ================================================================ */
    const timestamp = (req.headers.get('x-aryaman-timestamp') || '').trim();
    const eventId = (req.headers.get('x-aryaman-event-id') || '').trim();
    const signature = (req.headers.get('x-aryaman-signature') || '').replace(/^v1=/i, '').trim().toLowerCase();
    const rawBody = await req.text();

    if (!timestamp || !eventId || !signature) return json({ error: 'هدرهای امضا ناقص است' }, 401);
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) {
      return json({ error: 'زمان درخواست خارج از پنجرهٔ مجاز است' }, 400);
    }
    const expected = await hmacHex(WORDPRESS_SHARED_SECRET, `${timestamp}.${eventId}.${rawBody}`);
    if (!/^[a-f0-9]{64}$/.test(signature) || !constantTimeEqual(expected, signature)) {
      console.error('bridge-signature-mismatch', { eventId, receivedPrefix: signature.slice(0, 8) });
      return json({ error: 'امضای درخواست نامعتبر است' }, 403);
    }

    if (!['order_reserve', 'order_release', 'stock_update'].includes(event)) {
      return json({ error: 'نوع رویداد ورودی مجاز نیست' }, 400);
    }
    const items = Array.isArray(body.items) ? body.items.slice(0, 200).map((it: any) => ({
      item_code: String(it?.item_code || '').trim(),
      qty: Math.max(0, Math.trunc(Number(it?.qty ?? 0))),
      available: it?.available !== undefined ? Math.trunc(Number(it.available)) : undefined,
    })).filter((it: any) => it.item_code) : [];
    if (!items.length) return json({ error: 'اقلام رویداد خالی است' }, 400);

    const { error: insertError } = await admin.from('warehouse_bridge_events').insert({
      event_id: eventId,
      event: event,
      wc_order: body.wc_order ? String(body.wc_order).slice(0, 60) : null,
      quote_id: body.quote_id ? String(body.quote_id).slice(0, 60) : null,
      items: items,
      status: 'received',
    });
    if (insertError) {
      if ((insertError as any).code === '23505') {
        return json({ ok: true, deduplicated: true }); // رویداد تکراری — بی‌اثر
      }
      throw insertError;
    }

    // پردازش فوری — همان لحظه رزرو/آزادسازی شود
    let processed: any = null;
    try {
      const { data, error: rpcError } = await admin.rpc('fn_warehouse_bridge_process_event', { p_event_id: eventId });
      if (rpcError) throw rpcError;
      processed = data;
    } catch (procError) {
      console.error('bridge-process-error', procError); // رویداد «received» می‌ماند؛ pg_cron دوباره تلاش می‌کند
    }

    return json({
      ok: true,
      event,
      event_id: eventId,
      items: items.length,
      processed: processed ? (processed as any).status : 'queued',
      note: processed ? (processed as any).note ?? (processed as any).error ?? null : null,
    });
  } catch (error) {
    console.error('warehouse-bridge', error);
    return json({ error: error instanceof Error ? error.message : 'خطای ناشناخته' }, 500);
  }
});
