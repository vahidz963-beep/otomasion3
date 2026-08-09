import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const initialState = {
  loading: true,
  error: null,
  stock: [],
  documents: [],
  draftDocument: null,
  draftDocuments: [],
  draftLines: [],
  draftLinesByDocument: {},
  snapshots: [],
  matched: [],
  unmatched: [],
  inactiveItems: [],
  referrals: [],
};

function firstError(results) {
  return results.find((r) => r?.error)?.error || null;
}

export function useWarehouseData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [stockRes, docsRes, snapshotsRes, matchedRes, unmatchedRes, inactiveRes, referralsRes] = await Promise.all([
      supabase
        .from('v_warehouse_current_stock')
        .select('item_id, item_code, item_name_fa, item_name_en, item_group, category, unit, location, reorder_point, min_stock_threshold, unit_price_estimate, price_currency, current_qty, total_in, total_out, last_movement_at, last_synced_at, is_low_stock, stock_value_estimate')
        .order('item_code', { ascending: true }),
      supabase
        .from('v_warehouse_documents_summary')
        .select('id, doc_number, type, status, created_by, created_by_name, customer_name, customer_city, created_at, finalized_at, line_count, total_quantity, note, cancelled_at')
        .order('created_at', { ascending: false })
        .limit(120),
      supabase
        .from('warehouse_snapshots')
        .select('id, file_name, imported_by, imported_at, row_count, notes')
        .order('imported_at', { ascending: false })
        .limit(20),
      supabase
        .from('warehouse_snapshot_items')
        .select('id, snapshot_id, item_code, quantity, unit, matched')
        .eq('matched', true)
        .limit(100),
      supabase
        .from('warehouse_snapshot_items')
        .select('id, snapshot_id, item_code, quantity, unit, matched')
        .eq('matched', false)
        .limit(100),
      supabase
        .from('warehouse_items')
        .select('id, item_code, item_name_fa, category, unit, location, updated_at, is_active')
        .eq('is_active', false)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, target_role, referral_type, priority, status, title_fa, due_date, related_order_id, related_document_id, created_at')
        .or('source_module.eq.warehouse,target_module.eq.warehouse')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const draftDocuments = (docsRes.data || []).filter((d) => d.status === 'draft');
    let draftLines = [];
    let draftLinesError = null;
    if (draftDocuments.length) {
      const linesRes = await supabase
        .from('warehouse_document_lines')
        .select('id, document_id, item_id, quantity, reason, note, tx_id, removed_at, created_at, warehouse_items:item_id(item_code,item_name_fa,unit)')
        .in('document_id', draftDocuments.map((d) => d.id))
        .is('removed_at', null)
        .order('created_at', { ascending: true });
      draftLines = linesRes.data || [];
      draftLinesError = linesRes.error;
    }

    const draftLinesByDocument = draftLines.reduce((acc, line) => {
      if (!acc[line.document_id]) acc[line.document_id] = [];
      acc[line.document_id].push(line);
      return acc;
    }, {});

    const firstDraftWithLines = draftDocuments.find((d) => (draftLinesByDocument[d.id] || []).length > 0) || draftDocuments[0] || null;

    setState({
      loading: false,
      error: firstError([stockRes, docsRes, snapshotsRes, matchedRes, unmatchedRes, inactiveRes, referralsRes, { error: draftLinesError }]),
      stock: stockRes.data || [],
      documents: docsRes.data || [],
      draftDocument: firstDraftWithLines,
      draftDocuments,
      draftLines: firstDraftWithLines ? (draftLinesByDocument[firstDraftWithLines.id] || []) : [],
      draftLinesByDocument,
      snapshots: snapshotsRes.data || [],
      matched: matchedRes.data || [],
      unmatched: unmatchedRes.data || [],
      inactiveItems: inactiveRes.data || [],
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
