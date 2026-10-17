import { runExchangeRateSync } from '../exchangeRatesService.js';

export async function handler() {
  try {
    const result = await runExchangeRateSync({ triggerSource: 'scheduled_daily' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (error) {
    console.error('Daily warehouse exchange-rate sync failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: String(error?.message || error) }),
    };
  }
}
