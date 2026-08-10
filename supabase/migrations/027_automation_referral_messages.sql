-- =====================================================================
-- 027_AUTOMATION_REFERRAL_MESSAGES
-- Adds threaded messages for referrals: multiple back-and-forth responses.
-- =====================================================================

create table if not exists public.automation_referral_messages (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.automation_referrals(id) on delete cascade,
  message_fa text not null,
  message_type text not null default 'reply' check (message_type in ('reply','note','status','system')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_messages_referral on public.automation_referral_messages(referral_id, created_at);

alter table public.automation_referral_messages enable row level security;

drop policy if exists referral_messages_read on public.automation_referral_messages;
create policy referral_messages_read on public.automation_referral_messages
for select using (public.is_active_user());

drop policy if exists referral_messages_write on public.automation_referral_messages;
create policy referral_messages_write on public.automation_referral_messages
for all using (public.is_active_user()) with check (public.is_active_user());

grant select, insert, update, delete on public.automation_referral_messages to authenticated;

notify pgrst, 'reload schema';
