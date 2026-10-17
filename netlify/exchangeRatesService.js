import { createClient } from '@supabase/supabase-js';

const RATE_SOURCES = {
  USD: [
    {
      name: 'tgju',
      url: 'https://www.tgju.org/profile/price_dollar_rl',
      parse(body) {
        const match = body.match(/data-col="info\.last_trade\.PDrCotVal">([\d,]+)/);
        return match ? Number(match[1].replace(/,/g, '')) : null;
      },
    },
    {
      name: 'alanchand',
      url: 'https://alanchand.com/en/currencies-price/usd',
      parse(body) {
        const match = body.match(/"price":"(\d+)"/);
        return match ? Number(match[1]) : null;
      },
    },
    {
      name: 'priceto.day',
      url: 'https://api.priceto.day/v1/latest/irr/usd',
      parse(body) {
        const data = JSON.parse(body);
        return data?.success && data?.price ? Number(data.price) : null;
      },
    },
  ],
  CNY: [
    {
      name: 'tgju',
      url: 'https://www.tgju.org/profile/price_cny',
      parse(body) {
        const match = body.match(/data-col="info\.last_trade\.PDrCotVal">([\d,]+)/);
        return match ? Number(match[1].replace(/,/g, '')) : null;
      },
    },
    {
      name: 'alanchand',
      url: 'https://alanchand.com/en/currencies-price/cny',
      parse(body) {
        const match = body.match(/"price":"(\d+)"/);
        return match ? Number(match[1]) : null;
      },
    },
    {
      name: 'priceto.day',
      url: 'https://api.priceto.day/v1/latest/irr/cny',
      parse(body) {
        const data = JSON.parse(body);
        return data?.success && data?.price ? Number(data.price) : null;
      },
    },
  ],
};

const RATE_BOUNDS = {
  USD: { min: 500_000, max: 20_000_000 },
  CNY: { min: 50_000, max: 5_000_000 },
};

async function fetchSource(currency, source) {
  const startedAt = Date.now();
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AryamanAutomationRateBot/2.0)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { source: source.name, ok: false, error: `HTTP ${response.status}`, ms: Date.now() - startedAt };
    }
    const body = await response.text();
    const rial = source.parse(body);
    const bounds = RATE_BOUNDS[currency];
    if (!Number.isFinite(rial) || rial < bounds.min || rial > bounds.max) {
      return { source: source.name, ok: false, error: 'invalid_or_missing_rate', raw: rial ?? null, ms: Date.now() - startedAt };
    }
    return { source: source.name, ok: true, rial, ms: Date.now() - startedAt };
  } catch (error) {
    return { source: source.name, ok: false, error: String(error?.message || error), ms: Date.now() - startedAt };
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function decideRate(currency, results) {
  const valid = results.filter((result) => result.ok);
  if (!valid.length) {
    return {
      currency,
      status: 'no_data',
      rial: null,
      toman: null,
      valid_count: 0,
      sources_used: [],
      spread_pct: null,
      results,
      fetched_at: new Date().toISOString(),
    };
  }

  // With three sources, remove only clear outliers. The median itself always
  // remains. With two or one valid source, use every available rate as required.
  const firstMedian = median(valid.map((result) => result.rial));
  const kept = valid.length >= 3
    ? valid.filter((result) => Math.abs(result.rial - firstMedian) / firstMedian * 100 <= 3)
    : valid;
  const usable = kept.length ? kept : valid;
  const finalRial = median(usable.map((result) => result.rial));
  const values = usable.map((result) => result.rial);
  const spreadPct = values.length > 1
    ? (Math.max(...values) - Math.min(...values)) / Math.min(...values) * 100
    : 0;

  return {
    currency,
    status: usable.length === 1 ? 'updated_single_source' : 'updated',
    rial: Math.round(finalRial),
    toman: finalRial / 10,
    valid_count: usable.length,
    received_count: valid.length,
    sources_used: usable.map((result) => result.source),
    outliers: valid.filter((result) => !usable.includes(result)).map((result) => result.source),
    spread_pct: Number(spreadPct.toFixed(2)),
    results,
    fetched_at: new Date().toISOString(),
  };
}

export async function fetchCurrencyRates() {
  const [usdResults, cnyResults] = await Promise.all([
    Promise.all(RATE_SOURCES.USD.map((source) => fetchSource('USD', source))),
    Promise.all(RATE_SOURCES.CNY.map((source) => fetchSource('CNY', source))),
  ]);
  return {
    USD: decideRate('USD', usdResults),
    CNY: decideRate('CNY', cnyResults),
  };
}

export async function runExchangeRateSync({ triggerSource = 'scheduled' } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in Netlify.');
  }

  const rates = await fetchCurrencyRates();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('fn_apply_warehouse_exchange_rates', {
    p_usd_rial: rates.USD.rial,
    p_cny_rial: rates.CNY.rial,
    p_usd_meta: rates.USD,
    p_cny_meta: rates.CNY,
    p_trigger_source: triggerSource,
  });
  if (error) throw new Error(error.message || 'Failed to persist exchange rates.');

  return { rates, stored: data };
}

export { RATE_SOURCES, decideRate };
