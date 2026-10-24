-- ============================================================================
-- 128_PROFESSIONAL_BACKUP_CENTER
-- Local-only encrypted backup audit, delegated permissions and restore guard.
-- Trusted Netlify functions build the complete archive, stage it briefly in the
-- private bucket for transfer, and delete it immediately after verified local save.
-- ============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

create table if not exists public.system_backup_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_create boolean not null default false,
  can_download boolean not null default false,
  can_restore boolean not null default false,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_system_backup_permissions_updated_at on public.system_backup_permissions;
create trigger trg_system_backup_permissions_updated_at
before update on public.system_backup_permissions
for each row execute function public.set_updated_at();

create table if not exists public.system_backup_jobs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null check (trigger_source in ('manual','pre_restore')),
  status text not null default 'running' check (status in ('running','completed','failed','deleted')),
  storage_path text,
  archive_version integer not null default 2,
  size_bytes bigint,
  table_count integer not null default 0,
  row_count bigint not null default 0,
  file_count integer not null default 0,
  retention_expires_at timestamptz,
  error_message text,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_system_backup_jobs_status_started
  on public.system_backup_jobs(status, started_at desc);
create index if not exists idx_system_backup_jobs_retention
  on public.system_backup_jobs(retention_expires_at)
  where status in ('running','completed') and deleted_at is null;

create table if not exists public.system_restore_sessions (
  id uuid primary key default gen_random_uuid(),
  upload_path text not null,
  confirmation_token text not null unique,
  archive_summary jsonb not null default '{}'::jsonb,
  status text not null default 'uploading' check (status in ('uploading','validated','restoring','completed','failed','expired')),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_restore_sessions_actor
  on public.system_restore_sessions(requested_by, created_at desc);
create index if not exists idx_system_restore_sessions_expiry
  on public.system_restore_sessions(expires_at)
  where status in ('uploading','validated','failed');

alter table public.system_backup_permissions enable row level security;
alter table public.system_backup_jobs enable row level security;
alter table public.system_restore_sessions enable row level security;

-- Ordinary clients can only read their effective permission. All writes and all
-- job/session mutations are made by the trusted server with service_role.
drop policy if exists system_backup_permissions_own_read on public.system_backup_permissions;
create policy system_backup_permissions_own_read
on public.system_backup_permissions for select to authenticated
using (user_id = auth.uid() or public.has_role(array['admin']));

drop policy if exists system_backup_jobs_authorized_read on public.system_backup_jobs;
create policy system_backup_jobs_authorized_read
on public.system_backup_jobs for select to authenticated
using (
  public.has_role(array['admin'])
  or exists (
    select 1 from public.system_backup_permissions bp
    where bp.user_id = auth.uid()
      and (bp.can_create or bp.can_download or bp.can_restore)
  )
);

drop policy if exists system_restore_sessions_own_read on public.system_restore_sessions;
create policy system_restore_sessions_own_read
on public.system_restore_sessions for select to authenticated
using (requested_by = auth.uid() or public.has_role(array['admin']));

revoke insert, update, delete on public.system_backup_permissions from authenticated, anon;
revoke insert, update, delete on public.system_backup_jobs from authenticated, anon;
revoke insert, update, delete on public.system_restore_sessions from authenticated, anon;
grant select on public.system_backup_permissions, public.system_backup_jobs, public.system_restore_sessions to authenticated, service_role;
grant all on public.system_backup_permissions, public.system_backup_jobs, public.system_restore_sessions to service_role;

-- The bucket is private. Downloads and restore uploads are exposed only through
-- short-lived signed URLs created after a server-side permission check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'system-backups',
  'system-backups',
  false,
  536870912,
  array['application/octet-stream','application/gzip','application/json']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No direct browser policy is created for the bucket. Signed upload/download
-- tokens generated by service_role remain the only browser access path.

comment on table public.system_backup_jobs is
  'Audit metadata only. Encrypted archives are staged briefly for local transfer and removed after verified save.';
comment on table public.system_restore_sessions is
  'Short-lived, single-use restore validations. Actual restore requires a newly verified local safety backup.';

commit;

notify pgrst, 'reload schema';
