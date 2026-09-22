-- 088 managed warehouse item categories.
create table if not exists public.warehouse_item_categories (
  id uuid primary key default gen_random_uuid(),
  name_fa text not null unique,
  name_en text,
  code text unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.warehouse_item_categories(name_fa,code,sort_order) values
 ('Bobbin','BOBBIN',10),('Core','CORE',20),('Wire','WIRE',30),('PCB','PCB',40),('Finished','FINISHED',50),('Packaging','PACKAGING',60),('Toroidal Core','TOROIDAL_CORE',70)
on conflict(name_fa) do nothing;
alter table public.warehouse_item_categories enable row level security;
grant select,insert,update on public.warehouse_item_categories to authenticated;
drop policy if exists warehouse_item_categories_read on public.warehouse_item_categories;
create policy warehouse_item_categories_read on public.warehouse_item_categories for select using (public.has_role(array['admin','accountant','warehouse','sales']));
drop policy if exists warehouse_item_categories_write on public.warehouse_item_categories;
create policy warehouse_item_categories_write on public.warehouse_item_categories for all using (public.has_role(array['admin','warehouse'])) with check (public.has_role(array['admin','warehouse']));
notify pgrst,'reload schema';
