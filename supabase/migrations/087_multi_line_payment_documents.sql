-- 087 multi-line receipt/payment documents.
-- Each row remains an independent auditable payment record, while batch_id
-- links rows created together with the same direction/account/date.
alter table public.finance_payments add column if not exists batch_id uuid;
create index if not exists idx_finance_payments_batch_id on public.finance_payments(batch_id);
notify pgrst,'reload schema';
