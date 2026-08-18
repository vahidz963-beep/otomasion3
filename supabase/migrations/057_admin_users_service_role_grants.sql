-- =====================================================================
-- 057_ADMIN_USERS_SERVICE_ROLE_GRANTS
-- Restores the database grants needed by the Netlify admin-users function.
-- This does not expose data to anonymous users; it only ensures service_role
-- and authenticated roles have the expected privileges on admin user tables
-- and helper functions.
-- =====================================================================

grant usage on schema public to service_role;
grant usage on schema public to authenticated;

-- Admin users function reads/writes these with service_role.
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.audit_log to service_role;

-- App users still need normal authenticated access; RLS policies restrict them.
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.audit_log to authenticated;

-- Helper functions used by policies and admin checks.
grant execute on function public.current_role_names() to service_role, authenticated;
grant execute on function public.has_role(text[]) to service_role, authenticated;
grant execute on function public.is_admin() to service_role, authenticated;
grant execute on function public.is_active_user() to service_role, authenticated;

-- Recreate admin-aware policies in case they were overwritten by older SQL.
alter table public.profiles enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_admin_only on public.profiles;
create policy profiles_insert_admin_only on public.profiles
for insert with check (public.is_admin());

drop policy if exists profiles_delete_admin_only on public.profiles;
create policy profiles_delete_admin_only on public.profiles
for delete using (public.is_admin());

drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
for select using (public.is_admin());

drop policy if exists audit_insert_admin on public.audit_log;
create policy audit_insert_admin on public.audit_log
for insert with check (public.is_admin());

notify pgrst, 'reload schema';
