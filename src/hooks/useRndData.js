import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = { loading: true, error: null, incomingOrders: [], projects: [], stages: [], templates: [], templateSteps: [], costs: [], costSummary: [], tests: [], referrals: [], stock: [] };
function firstError(results) { return results.find((r) => r?.error)?.error || null; }

export function useRndData() {
  const [state, setState] = useState(initialState);
  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const [incomingRes, projectsRes, stagesRes, templatesRes, stepsRes, costsRes, costSummaryRes, testsRes, refsRes, stockRes] = await Promise.all([
      supabase.from('v_rnd_incoming_orders').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('v_rnd_project_overview').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('rnd_project_stages').select('id, rnd_project_id, stage_template_id, order_index, status, assigned_to, is_custom, custom_stage_type, custom_name_fa, custom_name_en, started_at, completed_at, notes, created_at').order('order_index', { ascending: true }).limit(1000),
      supabase.from('rnd_workflow_templates').select('*').order('created_at', { ascending: true }).limit(100),
      supabase.from('rnd_workflow_steps').select('*').order('stage_order', { ascending: true }).limit(1000),
      supabase.from('rnd_cost_items').select('*, warehouse_items:warehouse_item_id(item_code,item_name_fa,unit)').order('created_at', { ascending: false }).limit(1000),
      supabase.from('v_rnd_cost_summary').select('*').limit(200),
      supabase.from('rnd_test_records').select('*').order('tested_at', { ascending: false }).limit(300),
      supabase.from('automation_referrals').select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, source_record_id, related_order_id, created_at').or('source_module.eq.rnd,target_module.eq.rnd').order('created_at', { ascending: false }).limit(120),
      supabase.from('v_app_inventory_catalog').select('item_id,item_code,item_name_fa,item_group_label,is_produced_item,unit,current_qty,unit_price_estimate,effective_sale_price,available_for_sale_qty').order('item_code', { ascending: true }).limit(500),
    ]);
    setState({ loading: false, error: firstError([incomingRes, projectsRes, stagesRes, templatesRes, stepsRes, costsRes, costSummaryRes, testsRes, refsRes, stockRes]), incomingOrders: incomingRes.data || [], projects: projectsRes.data || [], stages: stagesRes.data || [], templates: templatesRes.data || [], templateSteps: stepsRes.data || [], costs: costsRes.data || [], costSummary: costSummaryRes.data || [], tests: testsRes.data || [], referrals: refsRes.data || [], stock: stockRes.data || [] });
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);
  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}
