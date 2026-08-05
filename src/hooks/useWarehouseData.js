import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = {
  loading: true,
  error: null,
  stock: [],
  documents: [],
  draftDocument: null,
  draftLines: [],
  snapshots: [],
  unmatched: [],
  referrals: [],
};

function firstError(results) {
  return results.find((r) => r?.error)?.error || null;
}

export function useWarehouseData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [stockRes, docsRes, snapshotsRes, unmatchedRes, referralsRes] = await Promise.all([
      supabase
        .from('v_warehouse_current_stock')
        .select('item_id, item_code, item_name_fa, item_name_en, item_group, category, unit, location, reorder_point, min_stock_threshold, unit_price_estimate, price_currency, current_qty, total_in, total_out, last_movement_at, last_synced_at, is_low_stock, stock_value_estimate')
        .order('item_code', { ascending: true }),
      supabase
        .from('v_warehouse_documents_summary')
        .select('id, doc_number, type, status, created_by, created_by_name, created_at, finalized_at, line_count, total_quantity, note')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('warehouse_snapshots')
        .select('id, file_name, imported_by, imported_at, row_count, notes')
        .order('imported_at', { ascending: false })
        .limit(20),
      supabase
        .from('warehouse_snapshot_items')
        .select('id, snapshot_id, item_code, quantity, unit, matched')
        .eq('matched', false)
        .limit(100),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, related_order_id, related_document_id, created_at')
        .or('source_module.eq.warehouse,target_module.eq.warehouse')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const draft = (docsRes.data || []).find((d) => d.type === 'out' && d.status === 'draft') || null;
    let draftLines = [];
    let draftLinesError = null;
    if (draft) {
      const linesRes = await supabase
        .from('warehouse_document_lines')
        .select('id, document_id, item_id, quantity, reason, note, tx_id, removed_at, created_at, warehouse_items:item_id(item_code,item_name_fa,unit)')
        .eq('document_id', draft.id)
        .is('removed_at', null)
        .order('created_at', { ascending: true });
      draftLines = linesRes.data || [];
      draftLinesError = linesRes.error;
    }

    setState({
      loading: false,
      error: firstError([stockRes, docsRes, snapshotsRes, unmatchedRes, referralsRes, { error: draftLinesError }]),
      stock: stockRes.data || [],
      documents: docsRes.data || [],
      draftDocument: draft,
      draftLines,
      snapshots: snapshotsRes.data || [],
      unmatched: unmatchedRes.data || [],
      referrals: referralsRes.data || [],
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}

export function useWarehouseKardex(itemId) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  const fetchKardex = useCallback(async () => {
    if (!itemId) {
      setState({ loading: false, error: null, rows: [] });
      return;
    }
    setState({ loading: true, error: null, rows: [] });
    const { data, error } = await supabase
      .from('v_warehouse_kardex')
      .select('item_id, item_code, item_name_fa, tx_id, transaction_type, direction, quantity, document_id, doc_number, document_status, reference_type, reference_id, created_by, note, created_at, running_balance')
      .eq('item_id', itemId)
      .order('created_at', { ascending: true });
    setState({ loading: false, error, rows: data || [] });
  }, [itemId]);

  useEffect(() => { fetchKardex(); }, [fetchKardex]);

  return useMemo(() => ({ ...state, refetch: fetchKardex }), [state, fetchKardex]);
}

export function useWarehouseDocumentLines(documentId) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  const fetchLines = useCallback(async () => {
    if (!documentId) {
      setState({ loading: false, error: null, rows: [] });
      return;
    }
    setState({ loading: true, error: null, rows: [] });
    const { data, error } = await supabase
      .from('warehouse_document_lines')
      .select('id, document_id, item_id, quantity, reason, note, tx_id, removed_at, created_at, warehouse_items:item_id(item_code,item_name_fa,unit)')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    setState({ loading: false, error, rows: data || [] });
  }, [documentId]);

  useEffect(() => { fetchLines(); }, [fetchLines]);

  return useMemo(() => ({ ...state, refetch: fetchLines }), [state, fetchLines]);
}
