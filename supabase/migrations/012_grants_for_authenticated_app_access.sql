-- =====================================================================
-- 012_GRANTS_FOR_AUTHENTICATED_APP_ACCESS
-- Supabase PostgREST needs database privileges in addition to RLS policies.
-- This grants authenticated users the baseline table/function privileges;
-- RLS policies still decide which rows/actions are allowed.
-- Run after all tables/views/functions are created.
-- =====================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Anonymous users should not read business tables. They only need schema usage.
-- Auth endpoints are handled by Supabase Auth, not these table grants.

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

alter default privileges in schema public
  grant execute on functions to authenticated;
