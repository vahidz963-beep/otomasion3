import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const completedStages = new Set(['closed', 'delivered']);

function dayKey(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

function buildDailySeries(rows, dateFrom, dateTo) {
  const days = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({ day: d.toISOString().slice(0, 10), orders_created: 0, orders_completed: 0 });
  }
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  rows.forEach((r) => {
    const created = dayKey(r.created_at);
    if (byDay[created]) byDay[created].orders_created += 1;
    if (completedStages.has(r.current_stage) && r.updated_at) {
      const completed = dayKey(r.updated_at);
      if (byDay[completed]) byDay[completed].orders_completed += 1;
    }
  });
  return days;
}

export function useDashboardData(filters) {
  const [state, setState] = useState({ loading: true, error: null, kpis: null, ordersTrend: [], revenueTrend: [] });

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    let query = supabase
      .from('orders')
      .select('id, sales_path, current_stage, is_cancelled, created_at, updated_at, expected_delivery_date')
      .gte('created_at', `${filters.dateFrom}T00:00:00`)
      .lte('created_at', `${filters.dateTo}T23:59:59`)
      .order('created_at', { ascending: true });

    if (filters.salesPath) query = query.eq('sales_path', filters.salesPath);

    const { data, error } = await query;
    if (error) {
      setState({ loading: false, error, kpis: null, ordersTrend: [], revenueTrend: [] });
      return;
    }

    const rows = data || [];
    const completed = rows.filter((r) => completedStages.has(r.current_stage));
    const cancelled = rows.filter((r) => r.is_cancelled);
    const active = rows.filter((r) => !r.is_cancelled && !completedStages.has(r.current_stage));

    const deliveryDurations = completed
      .filter((r) => r.created_at && r.updated_at)
      .map((r) => (new Date(r.updated_at) - new Date(r.created_at)) / 86400000)
      .filter((v) => Number.isFinite(v) && v >= 0);

    const avgDeliveryDays = deliveryDurations.length
      ? Math.round((deliveryDurations.reduce((sum, v) => sum + v, 0) / deliveryDurations.length) * 10) / 10
      : null;

    const ordersTrend = buildDailySeries(rows, filters.dateFrom, filters.dateTo);
    const revenueTrend = ordersTrend.map((d) => ({ day: d.day, income: 0, expense: 0 }));

    setState({
      loading: false,
      error: null,
      kpis: {
        active_orders: active.length,
        completed_orders: completed.length,
        cancelled_orders: cancelled.length,
        avg_delivery_days: avgDeliveryDays,
        total_income: 0,
        net_revenue: 0,
      },
      ordersTrend,
      revenueTrend,
    });
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { ...state, refetch: fetchData };
}
