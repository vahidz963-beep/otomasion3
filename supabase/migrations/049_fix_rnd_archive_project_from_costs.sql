-- =====================================================================
-- 049_FIX_RND_ARCHIVE_PROJECT_FROM_COSTS
-- Fixes "حذف سفارش" in R&D costs.
-- The frontend must archive finished R&D projects from the costs list.
-- Previous fallback tried to update rnd_projects.notes, but this table uses
-- technical_notes. This RPC also enforces safe deletion on the database side.
-- =====================================================================

-- Make sure the archive status exists on older databases.
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rnd_project_status'
  ) then
    alter type public.rnd_project_status add value if not exists 'archived';
  end if;
end $$;

create or replace function public.fn_rnd_archive_project_from_costs(
  p_project_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record;
  v_finished boolean;
  v_note text;
begin
  if not public.has_role(array['admin','rnd']) then
    raise exception 'دسترسی R&D ندارید';
  end if;

  select * into v_project
  from public.rnd_projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'پروژه R&D یافت نشد';
  end if;

  v_finished := v_project.status::text in ('approved','sent_to_production','archived')
    or coalesce(v_project.progress_percent, 0) >= 100
    or (
      exists (select 1 from public.rnd_project_stages s where s.rnd_project_id = p_project_id)
      and not exists (
        select 1
        from public.rnd_project_stages s
        where s.rnd_project_id = p_project_id
          and s.status::text <> 'completed'
      )
    );

  if not v_finished then
    raise exception 'حذف از لیست هزینه‌ها فقط بعد از پایان پروژه R&D مجاز است';
  end if;

  v_note := 'بایگانی/حذف از هزینه‌ها'
    || case when nullif(trim(p_reason), '') is not null then ': ' || trim(p_reason) else '' end;

  -- Use dynamic SQL so this function can be created safely even when the enum
  -- value was just added earlier in this script.
  execute
    'update public.rnd_projects
       set status = $1::public.rnd_project_status,
           technical_notes = concat_ws(E''\n'', nullif(technical_notes, ''''), $2),
           updated_at = now()
     where id = $3'
  using 'archived', v_note, p_project_id;

  return p_project_id;
end;
$$;

grant execute on function public.fn_rnd_archive_project_from_costs(uuid,text) to authenticated;

notify pgrst, 'reload schema';
