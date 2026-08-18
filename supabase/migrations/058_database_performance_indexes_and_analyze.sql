-- =====================================================================
-- 058_DATABASE_PERFORMANCE_INDEXES_AND_ANALYZE
-- مرحله بهینه‌سازی سبک و کم‌ریسک دیتابیس قبل از تست داخلی
--
-- هدف:
-- - سرعت بهتر برای داشبورد، سفارش‌ها، مالی، انبار، تولید، R&D و ارجاعات
-- - کاهش فشار روی Supabase در لیست‌ها و گزارش‌های پرتکرار
-- - بدون حذف یا تغییر داده‌های شرکت
--
-- این فایل فقط Index و ANALYZE اضافه می‌کند و برای اجرا در Supabase SQL Editor امن است.
-- اگر خطا دیدید، ادامه ندهید و متن خطا را بفرستید.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Orders / CRM
-- ---------------------------------------------------------------------
create index if not exists idx_orders_updated_at_desc
  on public.orders (updated_at desc);

create index if not exists idx_orders_registered_at_desc_id
  on public.orders (registered_at desc, id);

create index if not exists idx_orders_sales_path_registered_at
  on public.orders (sales_path, registered_at desc);

create index if not exists idx_orders_cancelled_registered_at
  on public.orders (is_cancelled, registered_at desc);

create index if not exists idx_order_stage_instances_order_key
  on public.order_stage_instances (order_id, stage_key);

create index if not exists idx_order_stage_instances_order_status_order
  on public.order_stage_instances (order_id, status, stage_order);

create index if not exists idx_order_items_order_code
  on public.order_items (order_id, warehouse_item_code);

create index if not exists idx_customers_active_company
  on public.customers (is_active, company_name);

create index if not exists idx_crm_followups_customer_done_due
  on public.crm_followups (customer_id, is_done, due_at);

create index if not exists idx_crm_interactions_customer_activity
  on public.crm_interactions (customer_id, activity_at desc);

create index if not exists idx_crm_opportunities_customer_updated
  on public.crm_opportunities (customer_id, updated_at desc);

-- ---------------------------------------------------------------------
-- 2) Finance / Accounting
-- ---------------------------------------------------------------------
create index if not exists idx_finance_documents_issue_date_desc
  on public.finance_documents (issue_date desc);

create index if not exists idx_finance_documents_party_issue
  on public.finance_documents (party_id, issue_date desc);

create index if not exists idx_finance_documents_order_type_status
  on public.finance_documents (related_order_id, document_type, status);

create index if not exists idx_finance_document_items_document_item
  on public.finance_document_items (document_id, warehouse_item_id);

create index if not exists idx_finance_payments_date_status_direction
  on public.finance_payments (payment_date desc, status, direction);

create index if not exists idx_finance_payments_bank_status_date
  on public.finance_payments (bank_account_id, status, payment_date desc);

create index if not exists idx_finance_payments_cashbox_status_date
  on public.finance_payments (cashbox_id, status, payment_date desc);

create index if not exists idx_finance_payment_allocations_document_payment
  on public.finance_payment_allocations (document_id, payment_id);

create index if not exists idx_finance_journal_entries_document_status
  on public.finance_journal_entries (related_document_id, status);

create index if not exists idx_finance_journal_entries_payment_status
  on public.finance_journal_entries (related_payment_id, status);

create index if not exists idx_finance_parties_active_name
  on public.finance_parties (is_active, display_name);

create index if not exists idx_finance_order_costs_order_created
  on public.finance_order_costs (related_order_id, created_at desc);

create index if not exists idx_finance_loans_status_created
  on public.finance_loans (status, created_at desc);

create index if not exists idx_finance_loan_installments_loan_status_due
  on public.finance_loan_installments (loan_id, status, due_date);

-- ---------------------------------------------------------------------
-- 3) Warehouse
-- ---------------------------------------------------------------------
create index if not exists idx_warehouse_items_active_code
  on public.warehouse_items (is_active, item_code);

create index if not exists idx_warehouse_items_active_name
  on public.warehouse_items (is_active, item_name_fa);

create index if not exists idx_warehouse_documents_type_status_created
  on public.warehouse_documents (type, status, created_at desc);

create index if not exists idx_warehouse_transactions_item_created
  on public.warehouse_transactions (item_id, created_at desc);

create index if not exists idx_warehouse_transactions_doc_item
  on public.warehouse_transactions (document_id, item_id);

create index if not exists idx_warehouse_shipments_status_created
  on public.warehouse_shipments (status, created_at desc);

-- ---------------------------------------------------------------------
-- 4) Production
-- ---------------------------------------------------------------------
create index if not exists idx_production_orders_source_order_updated
  on public.production_orders (source_order_id, updated_at desc);

create index if not exists idx_production_orders_status_updated
  on public.production_orders (status, updated_at desc);

create index if not exists idx_production_order_stages_order_order
  on public.production_order_stages (production_order_id, order_index);

create index if not exists idx_production_order_stages_order_status
  on public.production_order_stages (production_order_id, status);

create index if not exists idx_production_boms_related_order_status
  on public.production_boms (related_order_id, status);

create index if not exists idx_production_boms_related_production_status
  on public.production_boms (related_production_order_id, status);

create index if not exists idx_production_material_usage_order_status
  on public.production_material_usage (production_order_id, status);

-- production_output uses registered_at, not created_at.
create index if not exists idx_production_output_order_registered
  on public.production_output (production_order_id, registered_at desc);

-- ---------------------------------------------------------------------
-- 5) R&D
-- ---------------------------------------------------------------------
create index if not exists idx_rnd_projects_status_updated
  on public.rnd_projects (status, updated_at desc);

create index if not exists idx_rnd_projects_source_order_updated
  on public.rnd_projects (source_order_id, updated_at desc);

create index if not exists idx_rnd_project_stages_project_order
  on public.rnd_project_stages (rnd_project_id, order_index);

create index if not exists idx_rnd_project_stages_project_status
  on public.rnd_project_stages (rnd_project_id, status);

create index if not exists idx_rnd_cost_items_project_created
  on public.rnd_cost_items (rnd_project_id, created_at desc);

create index if not exists idx_rnd_test_records_project_tested
  on public.rnd_test_records (rnd_project_id, tested_at desc);

-- ---------------------------------------------------------------------
-- 6) Referrals / Shared Files / Users
-- ---------------------------------------------------------------------
create index if not exists idx_referrals_status_due_priority
  on public.automation_referrals (status, due_date, priority);

create index if not exists idx_referrals_source_target_created
  on public.automation_referrals (source_module, target_module, created_at desc);

create index if not exists idx_referral_messages_referral_created
  on public.automation_referral_messages (referral_id, created_at desc);

create index if not exists idx_shared_files_module_record_uploaded
  on public.shared_files (source_module, related_record_id, uploaded_at desc);

create index if not exists idx_profiles_active_role
  on public.profiles (is_active, role);

-- ---------------------------------------------------------------------
-- 7) Refresh planner statistics
-- ---------------------------------------------------------------------
analyze public.orders;
analyze public.order_stage_instances;
analyze public.order_items;
analyze public.customers;
analyze public.crm_followups;
analyze public.finance_documents;
analyze public.finance_document_items;
analyze public.finance_payments;
analyze public.finance_payment_allocations;
analyze public.finance_parties;
analyze public.finance_order_costs;
analyze public.warehouse_items;
analyze public.warehouse_documents;
analyze public.warehouse_transactions;
analyze public.production_orders;
analyze public.production_order_stages;
analyze public.production_boms;
analyze public.rnd_projects;
analyze public.rnd_project_stages;
analyze public.rnd_cost_items;
analyze public.automation_referrals;
analyze public.profiles;

notify pgrst, 'reload schema';
