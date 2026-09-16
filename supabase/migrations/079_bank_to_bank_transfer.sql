-- 079 BANK/CASH ACCOUNT TRANSFER
-- A transfer is one balanced accounting document: source account decreases and destination increases.

alter type public.finance_payment_method add value if not exists 'account_transfer';
alter table public.finance_payments add column if not exists transfer_to_bank_account_id uuid references public.finance_bank_accounts(id) on delete set null;
