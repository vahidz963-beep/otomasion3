import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = {
  loading: true,
  error: null,
  incomingOrders: [],
  productionOrders: [],
  stages: [],
  plans: [],
  templates: [],
  templateSteps: [],
  stock: [],
  boms: [],
  bomItems: [],
  qc: [],
  documents: [],
  referrals: [],
  materialUsage: [],
  outputs: [],
};

function firstError(results) {
  return results.find((r) => r?.error)?.error || null;
}

export function useProductionData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [incomingRes, ordersRes, stagesRes, plansRes, templatesRes, templateStepsRes, stockRes, bomsRes, bomItemsRes, materialUsageRes, outputsRes, qcRes, docsRes, refsRes] = await Promise.all([
      supabase.from('v_production_incoming_orders').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('v_production_order_overview').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('production_order_stages').select('id, production_order_id, stage_template_id, order_index, status, assigned_to, is_custom, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes, created_at').order('order_index', { ascending: true }).limit(1000),
      supabase.from('production_plans').select('*').order('updated_at', { ascending: false }).limit(200),
      supabase.from('production_workflow_templates').select('*').order('created_at', { ascending: true }).limit(100),
      supabase.from('production_workflow_steps').select('*').order('stage_order', { ascending: true }).limit(1000),
      supabase.from('v_app_inventory_catalog').select('item_id, item_code, item_name_fa, item_name_en, item_group, category, item_group_label, is_produced_item, unit, location, current_qty, unit_price_estimate, effective_sale_price, available_for_sale_qty, is_low_stock').order('item_code', { ascending: true }).limit(500),
      supabase.from('v_production_bom_summary').select('*').order('updated_at', { ascending: false }).limit(150),
      supabase.from('production_bom_items').select('*').order('created_at', { ascending: true }).limit(1000),
      supabase.from('v_production_material_usage_overview').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('production_output').select('id, production_order_id, warehouse_item_id, quantity, registered_at, warehouse_items:warehouse_item_id(item_code,item_name_fa,unit,category)').order('registered_at', { ascending: false }).limit(500),
      supabase.from('production_qc_checks').select('id, production_order_id, stage_id, checked_by, result, quantity_checked, quantity_passed, quantity_rejected, rejection_reason, checked_at').order('checked_at', { ascending: false }).limit(200),
      supabase.from('production_documents').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('automation_referrals').select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, source_record_id, related_order_id, created_at').or('source_module.eq.production,target_module.eq.production').order('created_at', { ascending: false }).limit(120),
    ]);

    setState({
      loading: false,
      error: firstError([incomingRes, ordersRes, stagesRes, plansRes, templatesRes, templateStepsRes, stockRes, bomsRes, bomItemsRes, materialUsageRes, outputsRes, qcRes, docsRes, refsRes]),
      incomingOrders: incomingRes.data || [],
      productionOrders: ordersRes.data || [],
      stages: stagesRes.data || [],
      plans: plansRes.data || [],
      templates: templatesRes.data || [],
      templateSteps: templateStepsRes.data || [],
      stock: stockRes.data || [],
      boms: bomsRes.data || [],
      bomItems: bomItemsRes.data || [],
      materialUsage: materialUsageRes.error ? [] : (materialUsageRes.data || []),
      outputs: outputsRes.error ? [] : (outputsRes.data || []),
      qc: qcRes.data || [],
      documents: docsRes.data || [],
      referrals: refsRes.data || [],
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    let timer;
    const scheduleRefetch = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchData, 500);
    };
    const channel = supabase
      .channel('production-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_order_stages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_boms' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_bom_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_material_usage' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_output' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_document_lines' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}
