import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = {
  loading: true,
  error: null,
  orders: [],
  customers: [],
  dueFollowups: [],
  stock: [],
  templates: [],
  templateSteps: [],
  referrals: [],
  crmInteractions: [],
  crmOpportunities: [],
  production: [],
  rnd: [],
  productionStages: [],
  rndStages: [],
};

function firstError(results) {
  return results.find((r) => r?.error)?.error || null;
}

function isMissingRelation(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.code || ''}`.toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache') || text.includes('could not find the function') || text.includes('pgrst') || text.includes('42p01') || text.includes('42703');
}

async function fetchAllRows(queryFactory, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const response = await queryFactory().range(from, from + pageSize - 1);
    if (response.error) return { data: all, error: response.error };
    all.push(...(response.data || []));
    if (!response.data || response.data.length < pageSize) break;
  }
  return { data: all, error: null };
}

function scheduleIdle(callback) {
  if (typeof window !== 'undefined' && window.requestIdleCallback) return window.requestIdleCallback(callback, { timeout: 2500 });
  return setTimeout(callback, 300);
}

async function fetchOrdersOverview({ dateFrom = null, dateTo = null, salesPath = null, limit = 200 } = {}) {
  const rpcRes = await supabase.rpc('fn_orders_fast_overview', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_sales_path: salesPath,
    p_limit: limit,
  });
  if (!rpcRes.error) return { data: rpcRes.data || [], error: null };
  if (!isMissingRelation(rpcRes.error)) return rpcRes;

  let query = supabase
    .from('v_order_lifecycle_overview')
    .select('id, order_code, customer_id, customer_name, contact_phone, customer_city, preferred_contact_channel, acquisition_source, sales_path, current_stage, current_stage_name_fa, workflow_template_id, workflow_template_name, total_stages, done_stages, progress_percent, registered_at, expected_delivery_date, days_to_delivery, delivery_status, stock_short_items, stock_unknown_items, stock_status, proforma_count, invoice_count, invoiced_amount, paid_amount, balance_amount, financial_status')
    .order('registered_at', { ascending: false })
    .limit(limit);
  if (dateFrom) query = query.gte('registered_at', dateFrom);
  if (dateTo) query = query.lte('registered_at', dateTo);
  if (salesPath) query = query.eq('sales_path', salesPath);
  return query;
}

async function fetchCustomerContacts({ detailed = false } = {}) {
  const fastColumns = 'id, company_name, contact_person_name, contact_phone, contact_email, address, city, preferred_contact_channel, acquisition_source, crm_status, lead_score, assigned_sales_id, assigned_sales_name, last_contacted_at, next_follow_up_at, total_orders, total_sales_amount, last_order_at, due_followups, finance_party_id, finance_party_type, customer_code, economic_code, registration_number, national_id, postal_code, opening_balance, finance_notes';
  if (detailed) {
    const fullRes = await fetchAllRows(() => supabase
      .from('v_customer_accounting_contacts')
      .select(fastColumns)
      .order('company_name', { ascending: true }));
    if (!fullRes.error) return fullRes;
    if (!isMissingRelation(fullRes.error)) return fullRes;
  }

  const fastRes = await fetchAllRows(() => supabase
    .from('v_customer_accounting_contacts_fast')
    .select(fastColumns)
    .order('company_name', { ascending: true }));
  if (!fastRes.error) return fastRes;
  if (!isMissingRelation(fastRes.error)) return fastRes;

  return fetchAllRows(() => supabase
    .from('v_crm_customer_overview')
    .select('id, company_name, contact_person_name, contact_phone, contact_email, city, preferred_contact_channel, acquisition_source, crm_status, lead_score, assigned_sales_id, assigned_sales_name, last_contacted_at, next_follow_up_at, total_orders, total_sales_amount, last_order_at, due_followups')
    .order('company_name', { ascending: true }));
}

export function useOrdersData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async (options = {}) => {
    const { silent = false } = options || {};
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));

    // مرحله اول: فقط داده‌های ضروری تا صفحه سفارش‌ها سریع باز شود.
    const [ordersRes, customersRes, followupsRes, templatesRes, stepsRes] = await Promise.all([
      fetchOrdersOverview({ limit: 200 }),
      fetchCustomerContacts({ detailed: false }),
      supabase
        .from('v_crm_due_followups')
        .select('id, customer_id, company_name, contact_phone, preferred_contact_channel, related_order_id, order_code, title, due_at, is_done, assigned_to, assigned_to_name, is_overdue')
        .order('due_at', { ascending: true })
        .limit(80),
      supabase
        .from('order_workflow_templates')
        .select('id, template_key, name_fa, name_en, sales_path, is_default, is_active, created_at')
        .order('sales_path', { ascending: true })
        .order('name_fa', { ascending: true }),
      supabase
        .from('order_workflow_template_steps')
        .select('id, template_id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, notify_role_on_enter, is_required, is_terminal, is_active')
        .order('stage_order', { ascending: true }),
    ]);

    const customerRows = customersRes.error ? [] : (customersRes.data || []);
    const customerCodeById = Object.fromEntries(customerRows.map((row) => [row.id, row.customer_code]).filter(([, code]) => code));
    const orders = (ordersRes.error ? [] : (ordersRes.data || [])).map((order) => ({
      ...order,
      customer_code: order.customer_code || customerCodeById[order.customer_id] || null,
    }));
    const criticalError = ordersRes.error && orders.length === 0 ? ordersRes.error : null;

    setState((previous) => ({
      ...previous,
      loading: false,
      error: criticalError,
      orders,
      customers: customersRes.error ? previous.customers : (customersRes.data || []),
      dueFollowups: followupsRes.error ? previous.dueFollowups : (followupsRes.data || []),
      templates: templatesRes.error ? previous.templates : (templatesRes.data || []),
      templateSteps: stepsRes.error ? previous.templateSteps : (stepsRes.data || []),
    }));

    // مرحله دوم: CRM کامل، موجودی، ارجاعات، تولید و R&D در پس‌زمینه.
    scheduleIdle(async () => {
      const [customersFullRes, interactionsRes, opportunitiesRes, stockRes, referralsRes] = await Promise.all([
        fetchCustomerContacts({ detailed: true }),
        supabase
          .from('crm_interactions')
          .select('id, customer_id, related_order_id, activity_type, contact_channel, title, description, activity_at, created_at, created_by')
          .order('activity_at', { ascending: false })
          .limit(100),
        supabase
          .from('crm_opportunities')
          .select('id, customer_id, related_order_id, title, stage, estimated_amount, probability_percent, expected_close_date, assigned_to, source, lost_reason, created_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('v_app_inventory_catalog')
          .select('item_id, item_code, item_name_fa, item_name_en, unit, category, item_group, item_group_label, is_produced_item, current_qty, min_stock_threshold, reserved_qty, available_for_sale_qty, is_low_stock, last_synced_at, unit_price_estimate, effective_sale_price')
          .order('item_name_fa', { ascending: true })
          .limit(1000),
        supabase
          .from('automation_referrals')
          .select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, related_order_id, related_document_id, created_at')
          .eq('source_module', 'orders')
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const orderIds = orders.map((o) => o.id).filter(Boolean);
      let productionRes = { data: [], error: null };
      let rndRes = { data: [], error: null };
      let productionStagesRes = { data: [], error: null };
      let rndStagesRes = { data: [], error: null };

      if (orderIds.length > 0) {
        [productionRes, rndRes] = await Promise.all([
          supabase
            .from('v_production_order_overview')
            .select('id, code, source_order_id, product_name_fa, status, progress_percent, current_stage_name_fa, delivery_status, days_to_delivery, planned_end, updated_at')
            .in('source_order_id', orderIds)
            .order('updated_at', { ascending: false })
            .limit(200),
          supabase
            .from('v_rnd_project_overview')
            .select('id, code, source_order_id, title_fa, status, progress_percent, current_stage_name_fa, delivery_status, days_to_delivery, updated_at')
            .in('source_order_id', orderIds)
            .order('updated_at', { ascending: false })
            .limit(200),
        ]);

        const productionIds = (productionRes.data || []).map((p) => p.id).filter(Boolean);
        const rndIds = (rndRes.data || []).map((r) => r.id).filter(Boolean);

        if (productionIds.length > 0) {
          productionStagesRes = await supabase
            .from('production_order_stages')
            .select('id, production_order_id, order_index, status, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes')
            .in('production_order_id', productionIds)
            .order('order_index', { ascending: true })
            .limit(800);
        }

        if (rndIds.length > 0) {
          rndStagesRes = await supabase
            .from('rnd_project_stages')
            .select('id, rnd_project_id, order_index, status, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes')
            .in('rnd_project_id', rndIds)
            .order('order_index', { ascending: true })
            .limit(800);
        }
      }

      setState((previous) => ({
        ...previous,
        customers: customersFullRes.error ? previous.customers : (customersFullRes.data || previous.customers),
        crmInteractions: interactionsRes.error ? previous.crmInteractions : (interactionsRes.data || []),
        crmOpportunities: opportunitiesRes.error ? previous.crmOpportunities : (opportunitiesRes.data || []),
        stock: stockRes.error ? previous.stock : (stockRes.data || []),
        referrals: referralsRes.error ? previous.referrals : (referralsRes.data || []),
        production: productionRes.error ? previous.production : (productionRes.data || []),
        rnd: rndRes.error ? previous.rnd : (rndRes.data || []),
        productionStages: productionStagesRes.error ? previous.productionStages : (productionStagesRes.data || []),
        rndStages: rndStagesRes.error ? previous.rndStages : (rndStagesRes.data || []),
      }));
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    let timer;
    const scheduleRefetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchData({ silent: true }), 900);
    };
    const channel = supabase
      .channel('orders-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_parties' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_stages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_projects' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_project_stages' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}

export function useOrderDetails(orderId) {
  const [state, setState] = useState({ loading: false, error: null, stages: [], events: [], stock: [], documents: [], referrals: [], production: [], rnd: [], productionStages: [], rndStages: [] });

  const fetchDetails = useCallback(async () => {
    if (!orderId) {
      setState({ loading: false, error: null, stages: [], events: [], stock: [], documents: [], referrals: [], production: [], rnd: [], productionStages: [], rndStages: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));

    const [stagesRes, eventsRes, stockRes, docsRes, referralsRes, productionRes, rndRes] = await Promise.all([
      supabase.from('order_stage_instances').select('id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, status, started_at, completed_at, notes').eq('order_id', orderId).order('stage_order', { ascending: true }),
      supabase.from('order_events').select('id, event_type, title, description, old_stage, new_stage, metadata, created_at').eq('order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('v_order_stock_status').select('order_item_id, item_name_fa, warehouse_item_code, warehouse_item_id, requested_qty, available_for_sale_qty, current_qty, reserved_qty, stock_unit, stock_status').eq('order_id', orderId),
      supabase.from('v_finance_document_summary').select('id, doc_number, document_type, status, issue_date, due_date, total_amount, paid_amount, balance_amount').eq('related_order_id', orderId).order('issue_date', { ascending: false }),
      supabase.from('automation_referrals').select('id, referral_number, source_module, target_module, priority, status, title_fa, due_date, created_at').eq('related_order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('v_production_order_overview').select('*').eq('source_order_id', orderId).order('updated_at', { ascending: false }),
      supabase.from('v_rnd_project_overview').select('id, code, title_fa, status, progress_percent, current_stage_name_fa, actual_total_cost, updated_at').eq('source_order_id', orderId).order('updated_at', { ascending: false }),
    ]);

    const productionRows = productionRes.error ? [] : (productionRes.data || []);
    const rndRows = rndRes.error ? [] : (rndRes.data || []);
    const productionIds = productionRows.map((p) => p.id).filter(Boolean);
    const rndIds = rndRows.map((r) => r.id).filter(Boolean);

    let productionStagesRes = { data: [], error: null };
    let rndStagesRes = { data: [], error: null };
    if (productionIds.length > 0) {
      productionStagesRes = await supabase
        .from('production_order_stages')
        .select('id, production_order_id, order_index, status, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes')
        .in('production_order_id', productionIds)
        .order('order_index', { ascending: true });
    }
    if (rndIds.length > 0) {
      rndStagesRes = await supabase
        .from('rnd_project_stages')
        .select('id, rnd_project_id, order_index, status, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes')
        .in('rnd_project_id', rndIds)
        .order('order_index', { ascending: true });
    }

    setState({
      loading: false,
      error: firstError([stagesRes, eventsRes, stockRes, docsRes, referralsRes, productionRes, rndRes, productionStagesRes, rndStagesRes]),
      stages: stagesRes.data || [],
      events: eventsRes.data || [],
      stock: stockRes.data || [],
      documents: docsRes.data || [],
      referrals: referralsRes.data || [],
      production: productionRows,
      rnd: rndRows,
      productionStages: productionStagesRes.error ? [] : (productionStagesRes.data || []),
      rndStages: rndStagesRes.error ? [] : (rndStagesRes.data || []),
    });
  }, [orderId]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  useEffect(() => {
    if (!orderId) return undefined;
    let timer;
    const scheduleRefetch = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchDetails, 400);
    };
    const channel = supabase
      .channel(`order-detail-live-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_stages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_projects' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_project_stages' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [orderId, fetchDetails]);

  return useMemo(() => ({ ...state, refetch: fetchDetails }), [state, fetchDetails]);
}
