import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getFriendlyErrorMessage } from '../lib/errorMessages';

const completedStages = new Set(['closed', 'delivered', 'completed']);

function dayKey(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDaysIso(dateLike, days) {
  const d = new Date(`${String(dateLike).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateLike;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function buildDays(dateFrom, dateTo) {
  const days = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({ day: d.toISOString().slice(0, 10), orders_created: 0, orders_completed: 0, income: 0, expense: 0 });
  }
  return days;
}

function isOrderCompleted(row, stageMaxByOrder = new Map()) {
  const currentStageOrder = Number(row?.stage_order || row?.current_stage_order || 0);
  const maxStageOrder = Number(stageMaxByOrder.get(row?.id) || stageMaxByOrder.get(row?.order_id) || 0);
  return Boolean(
    row?.is_terminal
    || completedStages.has(row?.current_stage)
    || ['closed', 'completed', 'delivered'].includes(row?.delivery_status)
    || Number(row?.progress_percent || 0) >= 100
    || (Number(row?.total_stages || 0) > 0 && Number(row?.done_stages || 0) >= Number(row?.total_stages || 0))
    || (maxStageOrder > 0 && currentStageOrder > 0 && currentStageOrder >= maxStageOrder)
  );
}

function buildTrends({ orders = [], completedOrders = [], payments = [], dateFrom, dateTo, stageMaxByOrder = new Map() }) {
  const days = buildDays(dateFrom, dateTo);
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  const completedIds = new Set();
  orders.forEach((r) => {
    const created = dayKey(r.created_at || r.registered_at);
    if (created && byDay[created]) byDay[created].orders_created += 1;
    if (isOrderCompleted(r, stageMaxByOrder) && r.updated_at) {
      const completed = dayKey(r.updated_at);
      if (completed && byDay[completed] && !completedIds.has(r.id)) {
        byDay[completed].orders_completed += 1;
        completedIds.add(r.id);
      }
    }
  });
  completedOrders.forEach((r) => {
    if (!isOrderCompleted(r, stageMaxByOrder) || completedIds.has(r.id)) return;
    const completed = dayKey(r.updated_at || r.completed_at || r.created_at);
    if (completed && byDay[completed]) {
      byDay[completed].orders_completed += 1;
      completedIds.add(r.id);
    }
  });
  payments.forEach((p) => {
    const day = dayKey(p.payment_date || p.created_at);
    if (!day || !byDay[day] || p.status !== 'confirmed') return;
    if (p.direction === 'receipt') byDay[day].income += Number(p.amount || 0);
    if (p.direction === 'payment') byDay[day].expense += Number(p.amount || 0);
  });
  return days;
}

function okArray(res) { return res?.error ? [] : (res?.data || []); }
function okObject(res, fallback = {}) { return res?.error ? fallback : (res?.data || fallback); }

export function useDashboardData(filters) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    kpis: null,
    ordersTrend: [],
    revenueTrend: [],
    orders: [],
    referrals: [],
    stock: [],
    production: [],
    rnd: [],
    checks: [],
    payments: [],
    finance: {},
    receivableForecast: [],
    health: null,
    queryErrors: [],
  });

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const dateToExclusive = addDaysIso(filters.dateTo, 1);

    const [ordersRes, completedOrdersRes, financeRes, paymentsRes, stockRes, referralsRes, productionRes, rndRes, checksRes, forecastRes, healthRes] = await Promise.all([
      supabase
        .from('v_order_lifecycle_overview')
        .select('id, order_code, customer_name, sales_path, current_stage, current_stage_name_fa, workflow_template_id, total_stages, done_stages, progress_percent, delivery_status, days_to_delivery, financial_status, stock_status, registered_at, expected_delivery_date')
        .gte('registered_at', filters.dateFrom)
        .lte('registered_at', filters.dateTo)
        .order('registered_at', { ascending: false })
        .limit(250),
      supabase
        .from('v_order_tracking')
        .select('id, order_code, current_stage, stage_name_fa, stage_order, is_terminal, is_cancelled, created_at, updated_at, expected_delivery_date')
        .gte('updated_at', filters.dateFrom)
        .lt('updated_at', dateToExclusive)
        .order('updated_at', { ascending: false })
        .limit(300),
      supabase.from('v_finance_dashboard').select('*').maybeSingle(),
      supabase
        .from('v_finance_payment_ledger')
        .select('id, payment_number, direction, method, status, party_name, payment_date, amount, account_name, bank_name, description, created_at')
        .gte('payment_date', filters.dateFrom)
        .lte('payment_date', filters.dateTo)
        .order('payment_date', { ascending: false })
        .limit(250),
      supabase
        .from('v_app_inventory_catalog')
        .select('item_id, item_code, item_name_fa, unit, current_qty, is_low_stock, reorder_point, min_stock_threshold, stock_value_estimate, location, item_group_label, is_produced_item')
        .limit(250),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, priority, status, title_fa, due_date, created_at')
        .in('status', ['open', 'in_progress', 'answered'])
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('v_production_order_overview')
        .select('id, code, source_order_id, product_name_fa, customer_name, status, progress_percent, current_stage_name_fa, delivery_status, days_to_delivery, planned_end')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('v_rnd_project_overview')
        .select('id, code, source_order_id, title_fa, customer_name, requester_name, status, progress_percent, current_stage_name_fa, delivery_status, days_to_delivery')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('finance_checks')
        .select('id, internal_check_code, check_type, status, due_date, amount, bank_name, owner_name')
        .order('due_date', { ascending: true })
        .limit(80),
      supabase
        .from('v_finance_receivable_forecast')
        .select('*')
        .limit(80),
      supabase.rpc('fn_system_health_report'),
    ]);

    const orders = okArray(ordersRes);
    const completedOrdersForTrend = okArray(completedOrdersRes).filter((o) => !o.is_cancelled);
    let stageInstancesRes = null;
    let stageMaxByOrder = new Map();
    const completedCandidateIds = [...new Set(completedOrdersForTrend.map((o) => o.id).filter(Boolean))];
    if (completedCandidateIds.length > 0) {
      stageInstancesRes = await supabase
        .from('order_stage_instances')
        .select('order_id, stage_order')
        .in('order_id', completedCandidateIds)
        .limit(Math.max(1000, completedCandidateIds.length * 40));
      if (!stageInstancesRes.error) {
        stageMaxByOrder = (stageInstancesRes.data || []).reduce((map, stage) => {
          const current = Number(map.get(stage.order_id) || 0);
          const next = Number(stage.stage_order || 0);
          if (next > current) map.set(stage.order_id, next);
          return map;
        }, new Map());
      }
    }
    const finance = okObject(financeRes, {});
    const payments = okArray(paymentsRes);
    const stock = okArray(stockRes);
    const referrals = okArray(referralsRes);
    const production = okArray(productionRes);
    const rnd = okArray(rndRes);
    const checks = okArray(checksRes);
    const forecast = forecastRes?.error ? [] : (forecastRes.data || []);
    const health = healthRes?.error ? null : healthRes.data;

    const trend = buildTrends({ orders, completedOrders: completedOrdersForTrend, payments, dateFrom: filters.dateFrom, dateTo: filters.dateTo, stageMaxByOrder });
    const cashflowTotals = payments.reduce((acc, payment) => {
      if (payment.status !== 'confirmed') return acc;
      if (payment.direction === 'receipt') acc.receipts += Number(payment.amount || 0);
      if (payment.direction === 'payment') acc.payments += Number(payment.amount || 0);
      return acc;
    }, { receipts: 0, payments: 0 });
    const activeOrders = orders.filter((o) => !['closed', 'cancelled', 'completed', 'delivered'].includes(o.delivery_status) && !isOrderCompleted(o, stageMaxByOrder));
    const productionCompletedOrderIds = new Set(production.filter((p) => ['completed','delivered_to_warehouse'].includes(p.status)).map((p) => p.source_order_id).filter(Boolean));
    const rndCompletedOrderIds = new Set(rnd.filter((r) => ['approved','sent_to_production','archived'].includes(r.status)).map((r) => r.source_order_id).filter(Boolean));
    const completedTrackingIds = new Set(completedOrdersForTrend.filter((o) => isOrderCompleted(o, stageMaxByOrder)).map((o) => o.id));
    const completedOrders = orders.filter((o) => isOrderCompleted(o, stageMaxByOrder) || productionCompletedOrderIds.has(o.id) || rndCompletedOrderIds.has(o.id) || completedTrackingIds.has(o.id));
    const cancelledOrders = orders.filter((o) => o.delivery_status === 'cancelled');
    const activeProduction = production.filter((p) => !['completed', 'delivered_to_warehouse', 'cancelled'].includes(p.status));
    const activeRnd = rnd.filter((p) => !['approved', 'sent_to_production', 'archived', 'rejected'].includes(p.status));
    const dueChecks = checks.filter((c) => !['cleared', 'cancelled'].includes(c.status) && c.due_date && new Date(c.due_date) <= new Date(Date.now() + 7 * 86400000));

    const queryErrors = [ordersRes, completedOrdersRes, stageInstancesRes, financeRes, paymentsRes, stockRes, referralsRes, productionRes, rndRes, checksRes, forecastRes, healthRes]
      .filter((r) => r?.error)
      .map((r) => getFriendlyErrorMessage(r.error, 'یکی از منابع داده داشبورد آماده نیست.'));

    setState({
      loading: false,
      error: null,
      kpis: {
        active_orders: activeOrders.length,
        completed_orders: completedOrders.length,
        cancelled_orders: cancelledOrders.length,
        total_income: cashflowTotals.receipts,
        total_payments: cashflowTotals.payments,
        net_revenue: cashflowTotals.receipts - cashflowTotals.payments,
        receivable_total: finance.receivable_total || 0,
        payable_total: finance.payable_total || 0,
        overdue_total: finance.overdue_total || 0,
        low_stock: stock.filter((i) => i.is_low_stock).length,
        active_production: activeProduction.length,
        active_rnd: activeRnd.length,
        open_referrals: referrals.length,
        due_checks: dueChecks.length,
      },
      ordersTrend: trend.map((d) => ({ day: d.day, orders_created: d.orders_created, orders_completed: d.orders_completed })),
      revenueTrend: trend.map((d) => ({ day: d.day, income: d.income, expense: d.expense })),
      orders,
      referrals,
      stock,
      production,
      rnd,
      checks,
      payments,
      finance,
      receivableForecast: forecast,
      health,
      queryErrors,
    });
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}
