-- =====================================================================
-- 066_PERFORMANCE_FULL_SYSTEM_INDEXES
-- Safe full-system performance pass for Accounting, Orders/CRM, Dashboard,
-- Warehouse, Production, R&D, Payroll and reporting views.
-- All indexes are conditional and can be run more than once.
-- =====================================================================

-- Finance / Accounting -------------------------------------------------
do $$
begin
  if to_regclass('public.finance_documents') is not null then
    execute 'create index if not exists idx_perf_fin_docs_status_issue on public.finance_documents (status, issue_date desc, id)';
    execute 'create index if not exists idx_perf_fin_docs_party_status_issue on public.finance_documents (party_id, status, issue_date desc)';
    execute 'create index if not exists idx_perf_fin_docs_order_type_status on public.finance_documents (related_order_id, document_type, status)';
    execute 'create index if not exists idx_perf_fin_docs_type_status_issue on public.finance_documents (document_type, status, issue_date desc)';
  end if;

  if to_regclass('public.finance_document_items') is not null then
    execute 'create index if not exists idx_perf_fin_doc_items_doc_line on public.finance_document_items (document_id, line_no)';
    execute 'create index if not exists idx_perf_fin_doc_items_warehouse_doc on public.finance_document_items (warehouse_item_id, document_id)';
    execute 'create index if not exists idx_perf_fin_doc_items_order_item on public.finance_document_items (order_item_id)';
  end if;

  if to_regclass('public.finance_payments') is not null then
    execute 'create index if not exists idx_perf_fin_payments_status_date_id on public.finance_payments (status, payment_date desc, id)';
    execute 'create index if not exists idx_perf_fin_payments_party_status_date on public.finance_payments (party_id, status, payment_date desc)';
    execute 'create index if not exists idx_perf_fin_payments_order_status_date on public.finance_payments (related_order_id, status, payment_date desc)';
    execute 'create index if not exists idx_perf_fin_payments_source on public.finance_payments (source_module, source_record_id)';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_payments' and column_name = 'category_id') then
      execute 'create index if not exists idx_perf_fin_payments_category_status_date on public.finance_payments (category_id, status, payment_date desc)';
    end if;
  end if;

  if to_regclass('public.finance_payment_allocations') is not null then
    execute 'create index if not exists idx_perf_fin_payment_alloc_payment_doc on public.finance_payment_allocations (payment_id, document_id)';
    execute 'create index if not exists idx_perf_fin_payment_alloc_doc_payment on public.finance_payment_allocations (document_id, payment_id)';
  end if;

  if to_regclass('public.finance_checks') is not null then
    execute 'create index if not exists idx_perf_fin_checks_status_due on public.finance_checks (status, due_date)';
    execute 'create index if not exists idx_perf_fin_checks_party_due on public.finance_checks (party_id, due_date desc)';
    execute 'create index if not exists idx_perf_fin_checks_related_payment on public.finance_checks (related_payment_id)';
  end if;

  if to_regclass('public.finance_journal_entries') is not null then
    execute 'create index if not exists idx_perf_fin_journal_status_date on public.finance_journal_entries (status, entry_date desc, id)';
    execute 'create index if not exists idx_perf_fin_journal_doc_status on public.finance_journal_entries (related_document_id, status)';
    execute 'create index if not exists idx_perf_fin_journal_payment_status on public.finance_journal_entries (related_payment_id, status)';
  end if;

  if to_regclass('public.finance_journal_lines') is not null then
    execute 'create index if not exists idx_perf_fin_journal_lines_entry_account on public.finance_journal_lines (entry_id, account_id)';
    execute 'create index if not exists idx_perf_fin_journal_lines_party on public.finance_journal_lines (party_id)';
    execute 'create index if not exists idx_perf_fin_journal_lines_order on public.finance_journal_lines (related_order_id)';
  end if;

  if to_regclass('public.finance_parties') is not null then
    execute 'create index if not exists idx_perf_fin_parties_type_active_name on public.finance_parties (party_type, is_active, display_name)';
    execute 'create index if not exists idx_perf_fin_parties_linked_customer on public.finance_parties (linked_customer_id)';
    execute 'create index if not exists idx_perf_fin_parties_phone on public.finance_parties (phone) where phone is not null';
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_parties' and column_name = 'economic_code') then
      execute 'create index if not exists idx_perf_fin_parties_economic_code on public.finance_parties (economic_code) where economic_code is not null';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_parties' and column_name = 'national_id') then
      execute 'create index if not exists idx_perf_fin_parties_national_id on public.finance_parties (national_id) where national_id is not null';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_parties' and column_name = 'registration_number') then
      execute 'create index if not exists idx_perf_fin_parties_registration on public.finance_parties (registration_number) where registration_number is not null';
    end if;
  end if;

  if to_regclass('public.finance_bank_accounts') is not null then
    execute 'create index if not exists idx_perf_fin_bank_accounts_active_usage on public.finance_bank_accounts (is_active, account_usage, account_name)';
  end if;

  if to_regclass('public.finance_cashboxes') is not null then
    execute 'create index if not exists idx_perf_fin_cashboxes_active_name on public.finance_cashboxes (is_active, name)';
  end if;
end $$;

-- Customers / Orders / CRM --------------------------------------------
do $$
begin
  if to_regclass('public.customers') is not null then
    execute 'create index if not exists idx_perf_customers_active_status_name on public.customers (is_active, crm_status, company_name)';
    execute 'create index if not exists idx_perf_customers_phone on public.customers (contact_phone) where contact_phone is not null';
    execute 'create index if not exists idx_perf_customers_assigned_status on public.customers (assigned_sales_id, crm_status)';
    execute 'create index if not exists idx_perf_customers_next_followup on public.customers (next_follow_up_at) where next_follow_up_at is not null';
    execute 'create index if not exists idx_perf_customers_updated on public.customers (updated_at desc)';
  end if;

  if to_regclass('public.orders') is not null then
    execute 'create index if not exists idx_perf_orders_registered on public.orders (registered_at desc, id)';
    execute 'create index if not exists idx_perf_orders_updated on public.orders (updated_at desc, id)';
    execute 'create index if not exists idx_perf_orders_customer_registered on public.orders (customer_id, registered_at desc)';
    execute 'create index if not exists idx_perf_orders_active_path_stage on public.orders (is_cancelled, sales_path, current_stage)';
    execute 'create index if not exists idx_perf_orders_expected_delivery on public.orders (expected_delivery_date) where expected_delivery_date is not null';
  end if;

  if to_regclass('public.order_items') is not null then
    execute 'create index if not exists idx_perf_order_items_order on public.order_items (order_id)';
    execute 'create index if not exists idx_perf_order_items_warehouse_code on public.order_items (warehouse_item_code) where warehouse_item_code is not null';
  end if;

  if to_regclass('public.order_stage_instances') is not null then
    execute 'create index if not exists idx_perf_order_stage_instances_order_order on public.order_stage_instances (order_id, stage_order desc)';
    execute 'create index if not exists idx_perf_order_stage_instances_status on public.order_stage_instances (status, order_id)';
  end if;

  if to_regclass('public.order_events') is not null then
    execute 'create index if not exists idx_perf_order_events_order_created on public.order_events (order_id, created_at desc)';
  end if;

  if to_regclass('public.crm_followups') is not null then
    execute 'create index if not exists idx_perf_crm_followups_done_due on public.crm_followups (is_done, due_at)';
    execute 'create index if not exists idx_perf_crm_followups_customer_due on public.crm_followups (customer_id, due_at desc)';
  end if;

  if to_regclass('public.crm_interactions') is not null then
    execute 'create index if not exists idx_perf_crm_interactions_customer_activity on public.crm_interactions (customer_id, activity_at desc)';
  end if;

  if to_regclass('public.crm_opportunities') is not null then
    execute 'create index if not exists idx_perf_crm_opportunities_customer_updated on public.crm_opportunities (customer_id, updated_at desc)';
  end if;
end $$;

-- Dashboard / Referrals / Warehouse / Production / R&D -----------------
do $$
begin
  if to_regclass('public.automation_referrals') is not null then
    execute 'create index if not exists idx_perf_referrals_target_status_created on public.automation_referrals (target_module, status, created_at desc)';
    execute 'create index if not exists idx_perf_referrals_source_status_created on public.automation_referrals (source_module, status, created_at desc)';
    execute 'create index if not exists idx_perf_referrals_due_status on public.automation_referrals (due_date, status) where due_date is not null';
    execute 'create index if not exists idx_perf_referrals_related_order on public.automation_referrals (related_order_id)';
    execute 'create index if not exists idx_perf_referrals_related_document on public.automation_referrals (related_document_id)';
  end if;

  if to_regclass('public.warehouse_items') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_items' and column_name = 'item_name_fa') then
      execute 'create index if not exists idx_perf_warehouse_items_name on public.warehouse_items (item_name_fa)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_items' and column_name = 'item_code') then
      execute 'create index if not exists idx_perf_warehouse_items_code on public.warehouse_items (item_code)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_items' and column_name = 'is_active') then
      execute 'create index if not exists idx_perf_warehouse_items_active on public.warehouse_items (is_active)';
    end if;
  end if;

  if to_regclass('public.warehouse_transactions') is not null then
    execute 'create index if not exists idx_perf_warehouse_tx_item_created on public.warehouse_transactions (item_id, created_at desc)';
    execute 'create index if not exists idx_perf_warehouse_tx_reference_created on public.warehouse_transactions (reference_type, reference_id, created_at desc)';
  end if;

  if to_regclass('public.warehouse_documents') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_documents' and column_name = 'status') then
      execute 'create index if not exists idx_perf_warehouse_docs_status_created on public.warehouse_documents (status, created_at desc)';
    end if;
  end if;

  if to_regclass('public.production_orders') is not null then
    execute 'create index if not exists idx_perf_production_orders_source_updated on public.production_orders (source_order_id, updated_at desc)';
    execute 'create index if not exists idx_perf_production_orders_status_updated on public.production_orders (status, updated_at desc)';
  end if;

  if to_regclass('public.production_order_stages') is not null then
    execute 'create index if not exists idx_perf_production_stages_order_index on public.production_order_stages (production_order_id, order_index)';
    execute 'create index if not exists idx_perf_production_stages_status on public.production_order_stages (status, production_order_id)';
  end if;

  if to_regclass('public.production_output') is not null then
    execute 'create index if not exists idx_perf_production_output_order_registered on public.production_output (production_order_id, registered_at desc)';
    execute 'create index if not exists idx_perf_production_output_item_registered on public.production_output (warehouse_item_id, registered_at desc)';
  end if;

  if to_regclass('public.rnd_projects') is not null then
    execute 'create index if not exists idx_perf_rnd_projects_source_updated on public.rnd_projects (source_order_id, updated_at desc)';
    execute 'create index if not exists idx_perf_rnd_projects_status_updated on public.rnd_projects (status, updated_at desc)';
  end if;

  if to_regclass('public.rnd_project_stages') is not null then
    execute 'create index if not exists idx_perf_rnd_stages_project_index on public.rnd_project_stages (rnd_project_id, order_index)';
    execute 'create index if not exists idx_perf_rnd_stages_status on public.rnd_project_stages (status, rnd_project_id)';
  end if;
end $$;

-- Loans / Payroll / Income-Expense -------------------------------------
do $$
begin
  if to_regclass('public.finance_loans') is not null then
    execute 'create index if not exists idx_perf_fin_loans_status_created on public.finance_loans (status, created_at desc)';
  end if;

  if to_regclass('public.finance_loan_installments') is not null then
    execute 'create index if not exists idx_perf_fin_loan_inst_status_due on public.finance_loan_installments (status, due_date)';
    execute 'create index if not exists idx_perf_fin_loan_inst_loan_due on public.finance_loan_installments (loan_id, due_date)';
  end if;

  if to_regclass('public.finance_payroll_employees') is not null then
    execute 'create index if not exists idx_perf_payroll_emp_active_name on public.finance_payroll_employees (is_active, display_name)';
  end if;

  if to_regclass('public.finance_payroll_slips') is not null then
    execute 'create index if not exists idx_perf_payroll_slips_month_created on public.finance_payroll_slips (payroll_month desc, created_at desc)';
    execute 'create index if not exists idx_perf_payroll_slips_employee_status on public.finance_payroll_slips (employee_id, status, payroll_month desc)';
  end if;

  if to_regclass('public.finance_payroll_lines') is not null then
    execute 'create index if not exists idx_perf_payroll_lines_slip_line on public.finance_payroll_lines (slip_id, line_no)';
  end if;

  if to_regclass('public.finance_payroll_payments') is not null then
    execute 'create index if not exists idx_perf_payroll_payments_paid_at on public.finance_payroll_payments (paid_at desc)';
    execute 'create index if not exists idx_perf_payroll_payments_slip_paid on public.finance_payroll_payments (slip_id, paid_at desc)';
  end if;

  if to_regclass('public.finance_income_expense_categories') is not null then
    execute 'create index if not exists idx_perf_income_expense_cat_type_active_name on public.finance_income_expense_categories (category_type, is_active, name_fa)';
    execute 'create index if not exists idx_perf_income_expense_cat_parent on public.finance_income_expense_categories (parent_id)';
  end if;
end $$;

-- Refresh PostgreSQL planner statistics --------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'finance_documents','finance_document_items','finance_payments','finance_payment_allocations','finance_checks','finance_journal_entries','finance_journal_lines','finance_parties','customers','orders','order_items','order_stage_instances','order_events','crm_followups','automation_referrals','warehouse_items','warehouse_transactions','warehouse_documents','production_orders','production_order_stages','production_output','rnd_projects','rnd_project_stages','finance_loans','finance_loan_installments','finance_payroll_employees','finance_payroll_slips','finance_payroll_lines','finance_payroll_payments','finance_income_expense_categories'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute 'analyze public.' || quote_ident(t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
