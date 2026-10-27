import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = {
  loading: true,
  error: null,
  orders: [],
  customers: [],
  dueFollowups: [],
  stock: [],
  salesDocuments: [],
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

function jsonRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

async function fetchOrderSalesCatalog() {
  const rpcRes = await supabase.rpc('fn_get_order_sales_catalog');
  if (!rpcRes.error) return { data: jsonRows(rpcRes.data), error: null };
  if (!isMissingRelation(rpcRes.error)) return rpcRes;

  // Compatibility fallback until Migration 134 is deployed. Cost fields are
  // deliberately not selected even though the legacy shared view contains them.
  return supabase
    .from('v_app_inventory_catalog')
    .select('item_id, item_code, item_name_fa, item_name_en, unit, category, item_group, item_group_label, is_produced_item, current_qty, min_stock_threshold, reserved_qty, available_for_sale_qty, is_low_stock, last_synced_at, effective_sale_price, price_currency, base_sale_price, unit_sale_price_estimate, pricing_updated_at, usd_toman, cny_toman')
    .order('item_name_fa', { ascending: true })
    .limit(1000);
}

async function fetchAccessibleOrderSalesDocuments(limit = 3000) {
  const rpcRes = await supabase.rpc('fn_get_accessible_order_sales_documents', { p_limit: limit });
  if (!rpcRes.error) return { data: jsonRows(rpcRes.data), error: null };
  if (!isMissingRelation(rpcRes.error)) return rpcRes;

  return supabase
    .from('v_finance_document_summary')
    .select('id, doc_number, document_type, status, issue_date, due_date, related_order_id, order_code, party_name, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, balance_amount')
    .in('document_type', ['sales_proforma', 'sales_invoice'])
    .order('issue_date', { ascending: false })
    .limit(limit);
}

async function fetchOrderSalesDocuments(orderId) {
  const rpcRes = await supabase.rpc('fn_get_order_sales_documents', { p_order_id: orderId });
  if (!rpcRes.error) return { data: jsonRows(rpcRes.data), error: null };
  if (!isMissingRelation(rpcRes.error)) return rpcRes;

  return supabase
    .from('v_finance_document_summary')
    .select('id, doc_number, document_type, status, issue_date, due_date, related_order_id, order_code, party_name, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, balance_amount')
    .eq('related_order_id', orderId)
    .in('document_type', ['sales_proforma', 'sales_invoice'])
    .order('issue_date', { ascending: false });
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
    const [ordersRes, customersRes, customerCreditRes, followupsRes, templatesRes, stepsRes] = await Promise.all([
      fetchOrdersOverview({ limit: 200 }),
      fetchCustomerContacts({ detailed: false }),
      supabase
        .from('customers')
        .select('id, credit_limit, credit_hold, credit_control_note')
        .limit(5000),
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

    const customerCreditById = Object.fromEntries((customerCreditRes.data || []).map((row) => [row.id, row]));
    const customerRows = (customersRes.error ? [] : (customersRes.data || [])).map((row) => ({ ...row, ...(customerCreditById[row.id] || {}) }));
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
      customers: customersRes.error ? previous.customers : customerRows,
      dueFollowups: followupsRes.error ? previous.dueFollowups : (followupsRes.data || []),
      templates: templatesRes.error ? previous.templates : (templatesRes.data || []),
      templateSteps: stepsRes.error ? previous.templateSteps : (stepsRes.data || []),
    }));

    // مرحله دوم: CRM کامل، موجودی، ارجاعات، تولید و R&D در پس‌زمینه.
    scheduleIdle(async () => {
      const [customersFullRes, interactionsRes, opportunitiesRes, stockRes, salesDocumentsRes, referralsRes] = await Promise.all([
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
        fetchOrderSalesCatalog(),
        fetchAccessibleOrderSalesDocuments(3000),
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
        customers: customersFullRes.error ? previous.customers : (customersFullRes.data || previous.customers).map((row) => { const existing = previous.customers.find((item) => item.id === row.id); return { ...row, credit_limit: existing?.credit_limit ?? 0, credit_hold: existing?.credit_hold ?? false, credit_control_note: existing?.credit_control_note ?? null }; }),
        crmInteractions: interactionsRes.error ? previous.crmInteractions : (interactionsRes.data || []),
        crmOpportunities: opportunitiesRes.error ? previous.crmOpportunities : (opportunitiesRes.data || []),
        stock: stockRes.error ? previous.stock : (stockRes.data || []),
        salesDocuments: salesDocumentsRes.error ? previous.salesDocuments : (salesDocumentsRes.data || []),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_exchange_rates' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_document_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_stages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_projects' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_project_stages' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}

export function useOrderDetails(orderId, includeSalesDocuments = true) {
  const emptyDetails = { loading: false, error: null, order: null, orderItems: [], revisions: [], credit: null, stages: [], events: [], stock: [], documents: [], referrals: [], production: [], rnd: [], productionStages: [], rndStages: [], shipments: [], shipmentItems: [] };
  const [state, setState] = useState(emptyDetails);

  const fetchDetails = useCallback(async () => {
    if (!orderId) {
      setState(emptyDetails);
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));

    const [orderRes, orderItemsRes, revisionsRes, stagesRes, eventsRes, stockRes, docsRes, referralsRes, productionRes, rndRes, shipmentsRes, shipmentItemsRes] = await Promise.all([
      supabase.from('orders').select('id, order_code, customer_id, sales_path, current_stage, title_fa, title_en, description_fa, description_en, priority, expected_delivery_date, registered_at, workflow_template_id, contact_channel, customer_phone_snapshot, customer_city_snapshot, is_cancelled, edit_revision, last_edited_at, last_edit_reason, created_at, updated_at').eq('id', orderId).maybeSingle(),
      supabase.from('order_items').select('id, order_id, line_no, item_name_fa, item_name_en, warehouse_item_code, quantity, unit, unit_price, discount_percent, discount_amount, notes, created_at').eq('order_id', orderId).order('line_no', { ascending: true }),
      supabase.from('order_revision_snapshots').select('id, order_id, revision_no, reason, dependency_snapshot, sync_result, created_by, created_at').eq('order_id', orderId).order('revision_no', { ascending: false }).limit(50),
      supabase.from('order_stage_instances').select('id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, status, started_at, completed_at, notes').eq('order_id', orderId).order('stage_order', { ascending: true }),
      supabase.from('order_events').select('id, event_type, title, description, old_stage, new_stage, metadata, created_at').eq('order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('v_order_stock_status').select('order_item_id, item_name_fa, warehouse_item_code, warehouse_item_id, requested_qty, available_for_sale_qty, current_qty, reserved_qty, stock_unit, stock_status, line_no').eq('order_id', orderId).order('line_no', { ascending: true }),
      includeSalesDocuments ? fetchOrderSalesDocuments(orderId) : Promise.resolve({ data: [], error: null }),
      supabase.from('automation_referrals').select('id, referral_number, source_module, target_module, priority, status, title_fa, due_date, created_at').eq('related_order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('v_production_order_overview').select('*').eq('source_order_id', orderId).order('updated_at', { ascending: false }),
      supabase.from('v_rnd_project_overview').select('id, code, title_fa, status, progress_percent, current_stage_name_fa, actual_total_cost, updated_at').eq('source_order_id', orderId).order('updated_at', { ascending: false }),
      supabase.from('v_warehouse_shipment_overview').select('id, shipment_number, shipment_date, sent_at, status, total_quantity, carton_count, carrier_name, tracking_code, receiver_name, notes, warehouse_doc_number, reversal_warehouse_doc_number, line_items, cancellation_reason').eq('related_order_id', orderId).order('shipment_date', { ascending: false }),
      supabase.from('v_order_shipment_item_progress').select('order_item_id, item_name_fa, warehouse_item_code, warehouse_item_id, ordered_quantity, sent_quantity, remaining_quantity, reserved_quantity, current_stock_quantity, available_to_this_line, unit, is_warehouse_mapped, has_approved_invoice, line_no').eq('order_id', orderId).order('line_no', { ascending: true }),
    ]);

    let creditRes = { data: null, error: null };
    if (orderRes.data?.customer_id) {
      creditRes = await supabase.from('v_customer_credit_control').select('customer_id, company_name, credit_limit, credit_hold, credit_control_note, outstanding_amount, available_credit, requires_credit_review').eq('customer_id', orderRes.data.customer_id).maybeSingle();
    }

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
      error: firstError([orderRes, orderItemsRes, revisionsRes, creditRes, stagesRes, eventsRes, stockRes, docsRes, referralsRes, productionRes, rndRes, shipmentsRes, shipmentItemsRes, productionStagesRes, rndStagesRes]),
      order: orderRes.data || null,
      orderItems: orderItemsRes.data || [],
      revisions: revisionsRes.error ? [] : (revisionsRes.data || []),
      credit: creditRes.error ? null : (creditRes.data || null),
      stages: stagesRes.data || [],
      events: eventsRes.data || [],
      stock: stockRes.data || [],
      documents: docsRes.data || [],
      referrals: referralsRes.data || [],
      production: productionRows,
      rnd: rndRows,
      productionStages: productionStagesRes.error ? [] : (productionStagesRes.data || []),
      rndStages: rndStagesRes.error ? [] : (rndStagesRes.data || []),
      shipments: shipmentsRes.error ? [] : (shipmentsRes.data || []),
      shipmentItems: shipmentItemsRes.error ? [] : (shipmentItemsRes.data || []),
    });
  }, [orderId, includeSalesDocuments]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_revision_snapshots', filter: `order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_document_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_shipments', filter: `related_order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_shipment_lines' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_inventory_reservations', filter: `order_id=eq.${orderId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_stages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_projects' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rnd_project_stages' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [orderId, fetchDetails]);

  return useMemo(() => ({ ...state, refetch: fetchDetails }), [state, fetchDetails]);
}

const emptySalesDocumentBundle = {
  loading: false,
  error: null,
  document: null,
  items: [],
  party: null,
  order: null,
  allocations: [],
  payments: [],
  events: [],
  referrals: [],
  ioDocuments: [],
  access: { mode: 'sales_read_only', can_edit: false, can_post: false, can_void: false, can_pay: false },
};

export function useOrderSalesDocumentBundle(documentId) {
  const [state, setState] = useState(emptySalesDocumentBundle);

  const fetchBundle = useCallback(async () => {
    if (!documentId) {
      setState(emptySalesDocumentBundle);
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: null }));

    const rpcRes = await supabase.rpc('fn_get_order_sales_document_bundle', { p_document_id: documentId });
    if (!rpcRes.error) {
      const bundle = rpcRes.data || {};
      setState({
        ...emptySalesDocumentBundle,
        ...bundle,
        loading: false,
        error: null,
        items: Array.isArray(bundle.items) ? bundle.items : [],
        allocations: [],
        payments: [],
        events: [],
        referrals: [],
        ioDocuments: [],
      });
      return;
    }
    if (!isMissingRelation(rpcRes.error)) {
      setState({ ...emptySalesDocumentBundle, error: rpcRes.error });
      return;
    }

    // Safe compatibility fallback: only printable header/items/party/order are
    // loaded; payment accounts, journals, cost snapshots and finance events are
    // never requested by the Orders module.
    const [documentRes, itemsRes] = await Promise.all([
      supabase
        .from('finance_documents')
        .select('id, doc_number, document_type, status, party_id, related_order_id, issue_date, due_date, currency, exchange_rate, description, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, balance_amount, is_official, print_note, created_at, updated_at')
        .eq('id', documentId)
        .in('document_type', ['sales_proforma', 'sales_invoice'])
        .maybeSingle(),
      supabase
        .from('finance_document_items')
        .select('id, document_id, line_no, item_type, description_fa, description_en, quantity, unit, unit_price, discount_amount, tax_rate, tax_amount, line_total, warehouse_item_id, order_item_id')
        .eq('document_id', documentId)
        .order('line_no', { ascending: true }),
    ]);
    if (documentRes.error || itemsRes.error || !documentRes.data) {
      setState({ ...emptySalesDocumentBundle, error: documentRes.error || itemsRes.error || new Error('سند فروش پیدا نشد.') });
      return;
    }

    const [partyRes, orderRes] = await Promise.all([
      documentRes.data.party_id
        ? supabase.from('finance_parties').select('id, display_name, party_type, customer_code, phone, email, address, national_id, economic_code, registration_number, postal_code').eq('id', documentRes.data.party_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      documentRes.data.related_order_id
        ? supabase.from('v_order_tracking').select('id, order_code, customer_name, contact_phone, customer_city, title_fa').eq('id', documentRes.data.related_order_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    setState({
      ...emptySalesDocumentBundle,
      loading: false,
      error: partyRes.error || orderRes.error || null,
      document: documentRes.data,
      items: itemsRes.data || [],
      party: partyRes.data || null,
      order: orderRes.data || null,
    });
  }, [documentId]);

  useEffect(() => { fetchBundle(); }, [fetchBundle]);

  useEffect(() => {
    if (!documentId) return undefined;
    let timer;
    const scheduleRefetch = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchBundle, 350);
    };
    const channel = supabase
      .channel(`order-sales-document-${documentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents', filter: `id=eq.${documentId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_document_items', filter: `document_id=eq.${documentId}` }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [documentId, fetchBundle]);

  return useMemo(() => ({ ...state, refetch: fetchBundle }), [state, fetchBundle]);
}
