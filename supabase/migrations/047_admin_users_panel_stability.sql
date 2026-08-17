-- =====================================================================
-- 047_ADMIN_USERS_PANEL_STABILITY
-- Fixes Users/Admin panel lockout and schema drift:
-- - adds sales_manager to user_role enum if it is missing
-- - ensures profiles.additional_roles exists and is populated
-- - recreates multi-role helpers used by RLS and the Netlify admin-users API
-- - makes profile privilege protection include additional_roles
-- - refreshes grants/policies needed by authenticated app users
--
-- IMPORTANT:
-- Run this whole file once in Supabase SQL Editor.
-- If it errors, stop and send the exact error text/screenshot.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Role enum compatibility
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    alter type public.user_role add value if not exists 'sales_manager';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Profiles: multi-role column and backfill
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists additional_roles text[] not null default array[]::text[];

update public.profiles
set additional_roles = array[role::text]
where additional_roles is null or array_length(additional_roles, 1) is null;

update public.profiles
set additional_roles = array(
  select distinct role_name
  from unnest(array_append(coalesce(additional_roles, array[]::text[]), role::text)) as r(role_name)
  where role_name is not null and role_name <> ''
)
where not (role::text = any(coalesce(additional_roles, array[]::text[])));

-- If an Auth user exists without a profile row, create a safe active sales profile for it.
-- Admin users should still be explicitly promoted by updating profiles.role/additional_roles.
insert into public.profiles (id, email, full_name, role, preferred_language, is_active, additional_roles)
select
  u.id,
  u.email,
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), u.email, ''),
  case
    when u.raw_user_meta_data->>'role' in ('admin','sales','rnd','production','warehouse','accountant','office_admin')
      then (u.raw_user_meta_data->>'role')::public.user_role
    else 'sales'::public.user_role
  end,
  case when u.raw_user_meta_data->>'preferred_language' in ('fa','en') then u.raw_user_meta_data->>'preferred_language' else 'fa' end,
  true,
  coalesce(
    (
      select array_agg(distinct role_name)
      from unnest(array[
        case when u.raw_user_meta_data->>'role' in ('admin','sales','sales_manager','rnd','production','warehouse','accountant','office_admin') then u.raw_user_meta_data->>'role' else null end
      ]::text[]) as r(role_name)
      where role_name is not null and role_name <> ''
    ),
    array['sales']::text[]
  )
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ---------------------------------------------------------------------
-- 3) Security helpers: all access checks must understand additional_roles
-- ---------------------------------------------------------------------
create or replace function public.current_role_names()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array(
        select distinct role_name
        from unnest(array_append(coalesce(p.additional_roles, array[]::text[]), p.role::text)) as r(role_name)
        where role_name is not null and role_name <> ''
      )
      from public.profiles p
      where p.id = auth.uid() and p.is_active
    ),
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

-- ---------------------------------------------------------------------
-- 4) Auth trigger: create complete profile rows for new users
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_role_text text;
  v_roles text[];
begin
  v_role_text := new.raw_user_meta_data->>'role';

  if v_role_text in ('admin','sales','sales_manager','rnd','production','warehouse','accountant','office_admin') then
    v_role := v_role_text::public.user_role;
  else
    v_role := 'sales'::public.user_role;
  end if;

  if jsonb_typeof(new.raw_user_meta_data->'roles') = 'array' then
    select array_agg(distinct role_name)
    into v_roles
    from jsonb_array_elements_text(new.raw_user_meta_data->'roles') as r(role_name)
    where role_name in ('admin','sales','sales_manager','rnd','production','warehouse','accountant','office_admin');
  else
    v_roles := array[]::text[];
  end if;

  v_roles := array(
    select distinct role_name
    from unnest(array_append(coalesce(v_roles, array[]::text[]), v_role::text)) as r(role_name)
    where role_name is not null and role_name <> ''
    limit 3
  );

  if array_length(v_roles, 1) is null then
    v_roles := array[v_role::text];
  end if;

  insert into public.profiles (id, email, full_name, full_name_en, role, additional_roles, preferred_language, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email, ''),
    nullif(new.raw_user_meta_data->>'full_name_en', ''),
    v_role,
    v_roles,
    case when new.raw_user_meta_data->>'preferred_language' in ('fa','en') then new.raw_user_meta_data->>'preferred_language' else 'fa' end,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    full_name_en = excluded.full_name_en,
    role = excluded.role,
    additional_roles = excluded.additional_roles,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 5) Protect role/is_active/additional_roles from non-admin self edits
-- ---------------------------------------------------------------------
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (
      new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or coalesce(new.additional_roles, array[]::text[]) is distinct from coalesce(old.additional_roles, array[]::text[])
     )
     and not public.is_admin() then
    raise exception 'Only admin can change role, additional roles, or active status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
before update on public.profiles
for each row execute function public.prevent_profile_privilege_escalation();

-- ---------------------------------------------------------------------
-- 6) RLS policies and grants for Admin Users / Audit panels
-- ---------------------------------------------------------------------
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

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.audit_log to authenticated;
grant execute on function public.current_role_names() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Emergency note:
-- If after running this file the logged-in owner is still not admin, run ONLY
-- this one line after replacing YOUR_EMAIL with the owner's login email:
--
-- update public.profiles
-- set role = 'admin'::public.user_role,
--     additional_roles = array['admin']::text[],
--     is_active = true,
--     updated_at = now()
-- where lower(email) = lower('YOUR_EMAIL');
-- ---------------------------------------------------------------------
