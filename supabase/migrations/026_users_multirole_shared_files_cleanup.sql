-- =====================================================================
-- 026_USERS_MULTIROLE_SHARED_FILES_CLEANUP
-- Adds multi-role support and shared-file cleanup compatibility.
-- =====================================================================

alter type public.user_role add value if not exists 'sales_manager';

alter table public.profiles
  add column if not exists additional_roles text[] not null default array[]::text[];

update public.profiles
set additional_roles = array[role::text]
where additional_roles is null or array_length(additional_roles, 1) is null;

create or replace function public.has_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active
      and (
        role::text = any(roles)
        or coalesce(additional_roles, array[]::text[]) && roles
      )
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select is_active and (role::text = 'admin' or 'admin' = any(coalesce(additional_roles, array[]::text[])))
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

-- Let sales_manager read order-related app data like sales.
grant select, update on public.profiles to authenticated;

notify pgrst, 'reload schema';
