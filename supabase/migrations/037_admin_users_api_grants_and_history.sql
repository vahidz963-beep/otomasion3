-- =====================================================================
-- 037_ADMIN_USERS_API_GRANTS_AND_HISTORY
-- Stabilizes Users and Audit modules:
-- - grants profiles/audit_log to authenticated
-- - ensures additional_roles exists and is populated
-- - makes admin policies multi-role aware
-- =====================================================================

alter type public.user_role add value if not exists 'sales_manager';

alter table public.profiles
  add column if not exists additional_roles text[] not null default array[]::text[];

update public.profiles
set additional_roles = array[role::text]
where additional_roles is null or array_length(additional_roles, 1) is null;

create or replace function public.current_role_names()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array(select distinct unnest(array_append(coalesce(additional_roles, array[]::text[]), role::text)))
     from public.profiles
     where id = auth.uid() and is_active),
    array[]::text[]
  );
$$;

create or replace function public.has_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_names() && roles, false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce('admin' = any(public.current_role_names()), false);
$$;

-- Keep policies, but ensure admins with additional_roles can read/write.
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

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.audit_log to authenticated;
grant execute on function public.current_role_names() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;

notify pgrst, 'reload schema';
