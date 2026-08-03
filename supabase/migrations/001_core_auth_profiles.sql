-- =====================================================================
-- 001_CORE_AUTH_PROFILES
-- Unified Auth / Roles / Profiles / Audit foundation for Otomasion2
-- Execute first in Supabase SQL editor or via Supabase migrations.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Roles: single contract used by ALL modules.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_role') then
    create type public.user_role as enum (
      'admin',        -- مدیر کل
      'sales',        -- فروش
      'rnd',          -- تحقیق و توسعه
      'production',   -- تولید
      'warehouse',    -- انبار
      'accountant',   -- مالی/حسابداری
      'office_admin'  -- اداری
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Profiles: one row per auth.users row.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text not null default '',
  full_name_en text,
  role public.user_role not null default 'sales',
  preferred_language text not null default 'fa' check (preferred_language in ('fa','en')),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_active on public.profiles(is_active);

-- ---------------------------------------------------------------------
-- Generic updated_at trigger helper.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Security helpers. All module RLS policies must use these names.
-- ---------------------------------------------------------------------
create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin'::public.user_role and is_active from public.profiles where id = auth.uid()), false);
$$;

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
      and role::text = any(roles)
  );
$$;

-- Sales visibility can be configured without schema changes.
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value) values
  ('sales_order_visibility', '"own"'::jsonb),
  ('follow_up_threshold_days', '14'::jsonb)
on conflict (key) do nothing;

drop trigger if exists trg_system_settings_updated_at on public.system_settings;
create trigger trg_system_settings_updated_at
before update on public.system_settings
for each row execute function public.set_updated_at();

create or replace function public.sales_can_view_all_orders()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value = '"all"'::jsonb from public.system_settings where key = 'sales_order_visibility'),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- Auto profile creation after Authentication > Users creation.
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
begin
  v_role_text := new.raw_user_meta_data->>'role';
  if v_role_text in ('admin','sales','rnd','production','warehouse','accountant','office_admin') then
    v_role := v_role_text::public.user_role;
  else
    v_role := 'sales'::public.user_role;
  end if;

  insert into public.profiles (id, email, full_name, full_name_en, role, preferred_language, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email, ''),
    nullif(new.raw_user_meta_data->>'full_name_en', ''),
    v_role,
    case when new.raw_user_meta_data->>'preferred_language' in ('fa','en') then new.raw_user_meta_data->>'preferred_language' else 'fa' end,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    full_name_en = excluded.full_name_en,
    role = excluded.role,
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
-- Prevent non-admin users from changing role/is_active through self update.
-- Service role is allowed for Netlify admin function.
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

  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.is_admin() then
    raise exception 'Only admin can change role or active status';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
before update on public.profiles
for each row execute function public.prevent_profile_privilege_escalation();

-- ---------------------------------------------------------------------
-- Audit log for user administration. target_user_id intentionally has no FK
-- so delete events remain readable after the auth user is removed.
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  target_user_id uuid,
  action text not null check (action in ('created','role_changed','activated','deactivated','deleted','password_reset_by_admin')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_log_target on public.audit_log(target_user_id);

-- ---------------------------------------------------------------------
-- RLS policies.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.system_settings enable row level security;
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

drop policy if exists settings_select_active on public.system_settings;
create policy settings_select_active on public.system_settings
for select using (public.is_active_user());

drop policy if exists settings_write_admin on public.system_settings;
create policy settings_write_admin on public.system_settings
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
for select using (public.is_admin());

drop policy if exists audit_insert_admin on public.audit_log;
create policy audit_insert_admin on public.audit_log
for insert with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Bootstrap first admin manually after creating the auth user:
-- insert into public.profiles (id,email,full_name,role,is_active,preferred_language)
-- values ('AUTH-USER-UUID','admin@example.com','مدیر کل','admin',true,'fa')
-- on conflict (id) do update set role='admin', is_active=true;
-- ---------------------------------------------------------------------
