-- =====================================================================
-- 132_DIRECT_EXPENSE_DEBT_OFFSET_METHOD
-- PostgreSQL requires a commit boundary after adding an enum value before
-- that value can be referenced by functions, views or DML. Migration 133
-- installs the atomic document workflow after this migration is committed.
-- =====================================================================

alter type public.finance_payment_method
  add value if not exists 'direct_expense_offset';

notify pgrst, 'reload schema';
