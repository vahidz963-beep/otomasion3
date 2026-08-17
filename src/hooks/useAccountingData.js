import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const emptyDashboard = {
  receivable_total: 0,
  payable_total: 0,
  overdue_total: 0,
  month_sales: 0,
  month_costs: 0,
  month_profit: 0,
  open_accounting_referrals: 0,
};

const initialState = {
  loading: true,
  error: null,
  dashboard: emptyDashboard,
  documents: [],
  parties: [],
  referrals: [],
  profitability: [],
  numbering: [],
  bankAccounts: [],
  cashboxes: [],
  treasuryAccounts: [],
  paymentLedger: [],
  investments: [],
  payments: [],
  checks: [],
  fiscalYears: [],
  fiscalPeriods: [],
  ioDocuments: [],
  orders: [],
  stock: [],
  itemKardex: [],
  itemLastSales: [],
  orderCosts: [],
  loans: [],
  loanInstallments: [],
};

function softError(results) {
  return results.find((r) => r?.error)?.error || null;
}

export function useAccountingData() {
  const [state, setState] = useState(initialState);

  const fetchData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [
      dashboardRes,
      docsRes,
      partiesRes,
      referralsRes,
      profitRes,
      numberingRes,
      bankRes,
      cashboxRes,
      treasuryRes,
      ledgerRes,
      investmentRes,
      paymentsRes,
      checksRes,
      fiscalYearsRes,
      fiscalPeriodsRes,
      ioDocsRes,
      ordersRes,
      stockRes,
      itemKardexRes,
      itemLastSalesRes,
      orderCostsRes,
      loansRes,
      loanInstallmentsRes,
    ] = await Promise.all([
      supabase.from('v_finance_dashboard').select('*').maybeSingle(),
      supabase
        .from('v_finance_document_summary')
        .select('id, doc_number, document_type, status, issue_date, due_date, party_id, party_name, party_type, related_order_id, order_code, source_module, converted_from_document_id, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, balance_amount, is_overdue')
        .order('issue_date', { ascending: false })
        .limit(100),
      supabase
        .from('v_party_balances')
        .select('party_id, display_name, party_type, phone, email, balance, total_debit, total_credit')
        .order('display_name', { ascending: true })
        .limit(200),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, referral_type, priority, status, title_fa, title_en, due_date, created_at, related_order_id, related_document_id')
        .eq('target_module', 'accounting')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('v_order_profitability')
        .select('order_id, order_code, title_fa, sales_path, company_name, revenue_before_tax, cost_before_tax, gross_profit, gross_margin_pct')
        .order('gross_profit', { ascending: false })
        .limit(50),
      supabase
        .from('v_finance_numbering_overview')
        .select('rule_key, label_fa, label_en, prefix, reset_scope, padding, include_year, separator, period_key, current_counter, next_number_preview, is_active')
        .order('rule_key', { ascending: true }),
      supabase
        .from('finance_bank_accounts')
        .select('*')
        .order('account_usage', { ascending: true }),
      supabase
        .from('finance_cashboxes')
        .select('id, name, currency, opening_balance, is_active, created_at')
        .order('name', { ascending: true }),
      supabase
        .from('v_finance_account_turnover')
        .select('*')
        .order('account_kind', { ascending: true })
        .order('account_name', { ascending: true }),
      supabase
        .from('v_finance_payment_ledger')
        .select('*')
        .order('payment_date', { ascending: false })
        .limit(300),
      supabase
        .from('finance_investments')
        .select('*')
        .order('acquisition_date', { ascending: false })
        .limit(200),
      supabase
        .from('finance_payments')
        .select('id, payment_number, direction, method, status, party_id, payment_date, amount, currency, bank_account_id, cashbox_id, related_order_id, description, created_at')
        .order('payment_date', { ascending: false })
        .limit(80),
      supabase
        .from('finance_checks')
        .select('id, internal_check_code, check_type, status, party_id, related_payment_id, check_number, bank_name, branch_name, owner_name, due_date, amount, description, created_at')
        .order('due_date', { ascending: true })
        .limit(80),
      supabase
        .from('finance_fiscal_years')
        .select('id, title, start_date, end_date, is_closed, opening_entry_id, closing_entry_id, closed_by, closed_at')
        .order('start_date', { ascending: false })
        .limit(5),
      supabase
        .from('finance_fiscal_periods')
        .select('id, fiscal_year_id, period_no, title_fa, title_en, start_date, end_date, is_closed, closed_at')
        .order('period_no', { ascending: true }),
      supabase
        .from('finance_io_documents')
        .select('id, io_number, io_type, status, title_fa, source_module, target_module, party_id, related_order_id, related_document_id, registered_at, created_at')
        .order('registered_at', { ascending: false })
        .limit(80),
      supabase
        .from('v_order_tracking')
        .select('id, order_code, customer_name, sales_path, current_stage, stage_name_fa, priority, expected_delivery_date, is_cancelled, created_at')
        .order('created_at', { ascending: false })
        .limit(150),
      supabase
        .from('v_app_inventory_catalog')
        .select('item_id, item_code, item_name_fa, item_name_en, category, item_group, item_group_label, is_produced_item, unit, current_qty, available_for_sale_qty, unit_price_estimate, effective_sale_price, last_sale_unit_price')
        .order('item_name_fa', { ascending: true })
        .limit(2000),
      supabase
        .from('v_warehouse_kardex')
        .select('item_id, item_code, item_name_fa, tx_id, transaction_type, direction, quantity, doc_number, document_status, note, created_at, running_balance')
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('v_finance_item_last_sale')
        .select('*')
        .limit(500),
      supabase
        .from('finance_order_costs')
        .select('id, related_order_id, related_rnd_project_id, related_production_order_id, cost_type, amount, document_id, source_module, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('v_finance_loan_overview')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('v_finance_loan_installments')
        .select('*')
        .order('due_date', { ascending: true })
        .limit(2000),
    ]);

    const firstError = softError([
      dashboardRes,
      docsRes,
      partiesRes,
      referralsRes,
      profitRes,
      numberingRes,
      bankRes,
      cashboxRes,
      treasuryRes,
      ledgerRes,
      investmentRes,
      paymentsRes,
      checksRes,
      fiscalYearsRes,
      fiscalPeriodsRes,
      ioDocsRes,
      ordersRes,
      stockRes,
      itemKardexRes,
    ]);

    setState({
      loading: false,
      error: firstError,
      dashboard: dashboardRes.data || emptyDashboard,
      documents: docsRes.data || [],
      parties: partiesRes.data || [],
      referrals: referralsRes.data || [],
      profitability: profitRes.data || [],
      numbering: numberingRes.data || [],
      bankAccounts: bankRes.data || [],
      cashboxes: cashboxRes.data || [],
      treasuryAccounts: treasuryRes.data || [],
      paymentLedger: ledgerRes.data || [],
      investments: investmentRes.data || [],
      payments: paymentsRes.data || [],
      checks: checksRes.data || [],
      fiscalYears: fiscalYearsRes.data || [],
      fiscalPeriods: fiscalPeriodsRes.data || [],
      ioDocuments: ioDocsRes.data || [],
      orders: ordersRes.data || [],
      stock: stockRes.data || [],
      itemKardex: itemKardexRes.data || [],
      itemLastSales: itemLastSalesRes.error ? [] : (itemLastSalesRes.data || []),
      orderCosts: orderCostsRes.error ? [] : (orderCostsRes.data || []),
      loans: loansRes.error ? [] : (loansRes.data || []),
      loanInstallments: loanInstallmentsRes.error ? [] : (loanInstallmentsRes.data || []),
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
      .channel('accounting-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_document_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_payments' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_items' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_transactions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouse_documents' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_output' }, scheduleRefetch)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [fetchData]);

  return useMemo(() => ({ ...state, refetch: fetchData }), [state, fetchData]);
}

export function usePartyStatement(partyId, flowFilter = 'all') {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  useEffect(() => {
    let cancelled = false;

    async function fetchStatement() {
      if (!partyId) {
        setState({ loading: false, error: null, rows: [] });
        return;
      }
      setState({ loading: true, error: null, rows: [] });
      let query = supabase
        .from('v_party_statement')
        .select('entry_date, ref_number, entry_type, description, debit_amount, credit_amount, running_balance, related_order_id, document_id, payment_id')
        .eq('party_id', partyId)
        .order('entry_date', { ascending: true })
        .limit(200);

      if (flowFilter === 'debit') query = query.gt('debit_amount', 0);
      if (flowFilter === 'credit') query = query.gt('credit_amount', 0);

      const { data, error } = await query;
      if (!cancelled) setState({ loading: false, error, rows: data || [] });
    }

    fetchStatement();
    return () => { cancelled = true; };
  }, [partyId, flowFilter]);

  return state;
}

export function useFinanceDocumentTimeline(documentId) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  const fetchTimeline = useCallback(async () => {
    if (!documentId) {
      setState({ loading: false, error: null, rows: [] });
      return;
    }
    setState({ loading: true, error: null, rows: [] });
    const { data, error } = await supabase
      .from('v_finance_document_timeline')
      .select('id, document_id, doc_number, event_type, description, old_status, new_status, actor_name, metadata, created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });
    setState({ loading: false, error, rows: data || [] });
  }, [documentId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  return useMemo(() => ({ ...state, refetch: fetchTimeline }), [state, fetchTimeline]);
}

export function useFinanceDocumentBundle(documentId) {
  const [state, setState] = useState({
    loading: false,
    error: null,
    document: null,
    items: [],
    allocations: [],
    payments: [],
    events: [],
    referrals: [],
    ioDocuments: [],
    party: null,
    order: null,
  });

  const fetchBundle = useCallback(async () => {
    if (!documentId) {
      setState({ loading: false, error: null, document: null, items: [], allocations: [], payments: [], events: [], referrals: [], ioDocuments: [], party: null, order: null });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    const [documentRes, itemsRes, allocationsRes, eventsRes, referralsRes, ioRes] = await Promise.all([
      supabase
        .from('finance_documents')
        .select('id, doc_number, document_type, status, party_id, related_order_id, related_quotation_id, related_rnd_project_id, related_production_order_id, source_module, source_record_id, issue_date, due_date, currency, exchange_rate, description, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, balance_amount, approved_by, approved_at, converted_from_document_id, is_official, void_reason, voided_at, print_note, created_at, updated_at')
        .eq('id', documentId)
        .maybeSingle(),
      supabase
        .from('finance_document_items')
        .select('id, document_id, line_no, item_type, description_fa, description_en, quantity, unit, unit_price, discount_amount, tax_rate, tax_amount, line_total, warehouse_item_id, order_item_id, expense_category_id, cost_center_id')
        .eq('document_id', documentId)
        .order('line_no', { ascending: true }),
      supabase
        .from('finance_payment_allocations')
        .select('id, payment_id, document_id, amount, created_at')
        .eq('document_id', documentId),
      supabase
        .from('v_finance_document_timeline')
        .select('id, document_id, doc_number, event_type, description, old_status, new_status, actor_name, metadata, created_at')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false }),
      supabase
        .from('automation_referrals')
        .select('id, referral_number, source_module, target_module, referral_type, priority, status, title_fa, due_date, created_at')
        .eq('related_document_id', documentId)
        .order('created_at', { ascending: false }),
      supabase
        .from('finance_io_documents')
        .select('id, io_number, io_type, status, title_fa, source_module, target_module, registered_at, created_at')
        .eq('related_document_id', documentId)
        .order('registered_at', { ascending: false }),
    ]);

    let payments = [];
    const paymentIds = (allocationsRes.data || []).map((a) => a.payment_id).filter(Boolean);
    if (paymentIds.length > 0) {
      const paymentsRes = await supabase
        .from('finance_payments')
        .select('id, payment_number, direction, method, status, party_id, payment_date, amount, currency, bank_account_id, cashbox_id, description, created_at')
        .in('id', paymentIds);
      payments = paymentsRes.data || [];
      if (paymentsRes.error) {
        setState((s) => ({ ...s, loading: false, error: paymentsRes.error }));
        return;
      }
    }

    let party = null;
    let order = null;
    let partyError = null;
    let orderError = null;
    if (documentRes.data?.party_id) {
      const partyRes = await supabase
        .from('finance_parties')
        .select('id, display_name, party_type, phone, email, address, national_id, economic_code')
        .eq('id', documentRes.data.party_id)
        .maybeSingle();
      party = partyRes.data || null;
      partyError = partyRes.error;
    }
    if (documentRes.data?.related_order_id) {
      const orderRes = await supabase
        .from('v_order_tracking')
        .select('id, order_code, customer_name, contact_phone, customer_city, title_fa')
        .eq('id', documentRes.data.related_order_id)
        .maybeSingle();
      order = orderRes.data || null;
      orderError = orderRes.error;
    }

    const firstError = [documentRes, itemsRes, allocationsRes, eventsRes, referralsRes, ioRes, { error: partyError }, { error: orderError }].find((r) => r.error)?.error;

    setState({
      loading: false,
      error: firstError || null,
      document: documentRes.data || null,
      items: itemsRes.data || [],
      allocations: allocationsRes.data || [],
      payments,
      events: eventsRes.data || [],
      referrals: referralsRes.data || [],
      ioDocuments: ioRes.data || [],
      party,
      order,
    });
  }, [documentId]);

  useEffect(() => { fetchBundle(); }, [fetchBundle]);

  return useMemo(() => ({ ...state, refetch: fetchBundle }), [state, fetchBundle]);
}
