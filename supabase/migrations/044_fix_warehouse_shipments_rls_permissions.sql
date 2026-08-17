-- =====================================================================
-- 044_FIX_WAREHOUSE_SHIPMENTS_RLS_PERMISSIONS
-- Fixes permission denied / RLS error for manual shipment registration.
-- Safe to run after 041/043. Does not change business data.
-- =====================================================================

-- Make sure table exists for environments where 041 has already been run.
do $$
begin
  if to_regclass('public.warehouse_shipments') is null then
    raise exception 'warehouse_shipments table does not exist. Run migration 041 first.';
  end if;
end $$;

alter table public.warehouse_shipments enable row level security;

-- Grants for authenticated users. RLS policies below still restrict real access.
grant select, insert, update on public.warehouse_shipments to authenticated;
grant select on public.v_warehouse_shipment_overview to authenticated;

drop policy if exists warehouse_shipments_select on public.warehouse_shipments;
create policy warehouse_shipments_select on public.warehouse_shipments
for select
using (
  public.has_role(array['admin','warehouse','accountant','sales','sales_manager','production','rnd','office_admin'])
);

drop policy if exists warehouse_shipments_insert on public.warehouse_shipments;
create policy warehouse_shipments_insert on public.warehouse_shipments
for insert
with check (
  public.has_role(array['admin','warehouse'])
);

drop policy if exists warehouse_shipments_update on public.warehouse_shipments;
create policy warehouse_shipments_update on public.warehouse_shipments
for update
using (
  public.has_role(array['admin','warehouse'])
)
with check (
  public.has_role(array['admin','warehouse'])
);

-- Ensure manual insert has created_by even if frontend does not send it.
create or replace function public.fn_warehouse_shipments_set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.status is null or new.status = '' then
    new.status := 'ready';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_warehouse_shipments_set_created_by on public.warehouse_shipments;
create trigger trg_warehouse_shipments_set_created_by
before insert on public.warehouse_shipments
for each row execute function public.fn_warehouse_shipments_set_created_by();

notify pgrst, 'reload schema';
