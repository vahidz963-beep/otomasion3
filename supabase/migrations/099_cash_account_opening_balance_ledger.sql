-- 099 add the enum value only.
-- PostgreSQL requires the ALTER TYPE transaction to commit before the value
-- can be used in a view or function.
alter type public.finance_payment_method add value if not exists 'opening_balance';
notify pgrst,'reload schema';
