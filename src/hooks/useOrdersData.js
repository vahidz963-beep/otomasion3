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
};

function firstError(results) {
  return results.find((r) => r?.error)?.error || null;
}

export function useOrdersData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [ordersRes, customersRes, followupsRes, interactionsRes, opportunitiesRes, stockRes, templatesRes, stepsRes, referralsRes] = await Promise.all([
      supabase
        .from('v_order_lifecycle_overview')
        .select('id, order_code, customer_id, customer_name, contact_phone, customer_city, preferred_contact_channel, acquisition_source, sales_path, current_stage, current_stage_name_fa, workflow_template_id, workflow_template_name, total_stages, done_stages, progress_percent, registered_at, expected_delivery_date, days_to_delivery, delivery_status, stock_short_items, stock_unknown_items, stock_status, proforma_count, invoice_count, invoiced_amount, paid_amount, balance_amount, financial_status')
        .order('registered_at', { ascending: false })
        .limit(200),
      supabase
        .from('v_crm_customer_overview')
        .select('id, company_name, contact_person_name, contact_phone, contact_email, city, preferred_contact_channel, acquisition_source, crm_status, lead_score, assigned_sales_id, assigned_sales_name, last_contacted_at, next_follow_up_at, total_orders, total_sales_amount, last_order_at, due_followups')
        .order('company_name', { ascending: true })
        .limit(200),
      supabase
        .from('v_crm_due_followups')
        .select('id, customer_id, company_name, contact_phone, preferred_contact_channel, related_order_id, order_code, title, due_at, is_done, assigned_to, assigned_to_name, is_overdue')
        .order('due_at', { ascending: true })
        .limit(80),
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
        .from('v_sales_stock_overview')
        .select('item_id, item_code, item_name_fa, item_name_en, unit, category, current_qty, min_stock_threshold, reserved_qty, available_for_sale_qty, is_low_stock, last_synced_at')
        .order('item_name_fa', { ascending: true })
        .limit(200),
      supabase
        .from('order_workflow_templates')
        .select('id, template_key, name_fa, name_en, sales_path, is_default, is_active, created_at')
        .order('sales_path', { ascending: true })
        .order('name_fa', { ascending: true }),
      supabase
        .from('order_workflow_template_steps')
        .select('id, template_id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, notify_role_on_enter, is_required, is_terminal, is_active')
        .order('stage_order', { ascending: true }),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, related_order_id, related_document_id, created_at')
        .eq('source_module', 'orders')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    setState({
      loading: false,
      error: firstError([ordersRes, customersRes, followupsRes, interactionsRes, opportunitiesRes, stockRes, templatesRes, stepsRes, referralsRes]),
      orders: ordersRes.data || [],
      customers: customersRes.data || [],
      dueFollowups: followupsRes.data || [],
      crmInteractions: interactionsRes.data || [],
      crmOpportunities: opportunitiesRes.data || [],
      stock: stockRes.data || [],
      templates: templatesRes.data || [],
      templateSteps: stepsRes.data || [],
      referrals: referralsRes.data || [],
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}

export function useOrderDetails(orderId) {
  const [state, setState] = useState({ loading: false, error: null, stages: [], events: [], stock: [], documents: [], referrals: [] });

  const fetchDetails = useCallback(async () => {
    if (!orderId) {
      setState({ loading: false, error: null, stages: [], events: [], stock: [], documents: [], referrals: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));

    const [stagesRes, eventsRes, stockRes, docsRes, referralsRes] = await Promise.all([
      supabase.from('order_stage_instances').select('id, stage_key, stage_order, stage_name_fa, stage_name_en, responsible_role, status, started_at, completed_at, notes').eq('order_id', orderId).order('stage_order', { ascending: true }),
      supabase.from('order_events').select('id, event_type, title, description, old_stage, new_stage, metadata, created_at').eq('order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('v_order_stock_status').select('order_item_id, item_name_fa, warehouse_item_code, warehouse_item_id, requested_qty, available_for_sale_qty, current_qty, reserved_qty, stock_unit, stock_status').eq('order_id', orderId),
      supabase.from('v_finance_document_summary').select('id, doc_number, document_type, status, issue_date, due_date, total_amount, paid_amount, balance_amount').eq('related_order_id', orderId).order('issue_date', { ascending: false }),
      supabase.from('automation_referrals').select('id, referral_number, source_module, target_module, priority, status, title_fa, due_date, created_at').eq('related_order_id', orderId).order('created_at', { ascending: false }),
    ]);

    setState({
      loading: false,
      error: firstError([stagesRes, eventsRes, stockRes, docsRes, referralsRes]),
      stages: stagesRes.data || [],
      events: eventsRes.data || [],
      stock: stockRes.data || [],
      documents: docsRes.data || [],
      referrals: referralsRes.data || [],
    });
  }, [orderId]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  return useMemo(() => ({ ...state, refetch: fetchDetails }), [state, fetchDetails]);
}
