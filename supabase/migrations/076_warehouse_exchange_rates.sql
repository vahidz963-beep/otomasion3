-- 076 WAREHOUSE EXCHANGE RATES
-- Persistent system-wide USD/CNY rates for warehouse valuation.

create table if not exists public.warehouse_exchange_rates (
  id boolean primary key default true check (id = true),
  usd_toman numeric not null default 180000 check (usd_toman > 0),
  cny_toman numeric not null default 26000 check (cny_toman > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.warehouse_exchange_rates (id, usd_toman, cny_toman)
values (true, 180000, 26000)
on conflict (id) do nothing;

alter table public.warehouse_exchange_rates enable row level security;
drop policy if exists warehouse_exchange_rates_select on public.warehouse_exchange_rates;
create policy warehouse_exchange_rates_select on public.warehouse_exchange_rates
for select to authenticated using (true);
drop policy if exists warehouse_exchange_rates_write on public.warehouse_exchange_rates;
create policy warehouse_exchange_rates_write on public.warehouse_exchange_rates
for all to authenticated using (public.has_role(array['admin','accountant'])) with check (public.has_role(array['admin','accountant']));

grant select, insert, update on public.warehouse_exchange_rates to authenticated;

create or replace function public.fn_get_warehouse_exchange_rates()
returns public.warehouse_exchange_rates
language sql stable security invoker
as $$ select * from public.warehouse_exchange_rates where id = true $$;

grant execute on function public.fn_get_warehouse_exchange_rates() to authenticated;

create or replace function public.fn_set_warehouse_exchange_rates(p_usd_toman numeric, p_cny_toman numeric)
returns public.warehouse_exchange_rates
language plpgsql security definer set search_path = public
as $$
declare v_row public.warehouse_exchange_rates;
begin
  if not public.has_role(array['admin','accountant']) then raise exception 'دسترسی تغییر نرخ ارز ندارید'; end if;
  if p_usd_toman <= 0 or p_cny_toman <= 0 then raise exception 'نرخ ارز باید بزرگ‌تر از صفر باشد'; end if;
  update public.warehouse_exchange_rates
  set usd_toman=p_usd_toman, cny_toman=p_cny_toman, updated_at=now(), updated_by=auth.uid()
  where id=true returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.fn_set_warehouse_exchange_rates(numeric,numeric) to authenticated;
notify pgrst, 'reload schema';
