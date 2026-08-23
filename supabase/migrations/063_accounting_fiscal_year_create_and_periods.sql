-- =====================================================================
-- 063_ACCOUNTING_FISCAL_YEAR_CREATE_AND_PERIODS
-- Adds a safe RPC for creating a fiscal year with all 12 fiscal periods.
-- Also makes reopening a fiscal year reopen all months of that year.
-- =====================================================================

create or replace function public.fn_create_finance_fiscal_year_with_periods(
  p_title text,
  p_start_date date,
  p_end_date date,
  p_periods jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_item jsonb;
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role(array['admin','accountant']) then
    raise exception 'Only accountant/admin can create fiscal years';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Fiscal year title is required';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid fiscal year date range';
  end if;

  if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
    raise exception 'Fiscal periods must be a JSON array';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_periods);
  if v_count <> 12 then
    raise exception 'A fiscal year must contain exactly 12 periods';
  end if;

  if exists (
    select 1
    from public.finance_fiscal_years fy
    where daterange(fy.start_date, fy.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    raise exception 'بازه این سال مالی با سال مالی دیگری تداخل دارد یا قبلاً ثبت شده است';
  end if;

  insert into public.finance_fiscal_years (title, start_date, end_date, is_closed)
  values (btrim(p_title), p_start_date, p_end_date, false)
  returning id into v_year_id;

  for v_item in select * from jsonb_array_elements(p_periods) loop
    insert into public.finance_fiscal_periods (
      fiscal_year_id,
      period_no,
      title_fa,
      title_en,
      start_date,
      end_date,
      is_closed
    ) values (
      v_year_id,
      (v_item->>'period_no')::int,
      coalesce(nullif(v_item->>'title_fa', ''), 'ماه ' || (v_item->>'period_no')),
      nullif(v_item->>'title_en', ''),
      (v_item->>'start_date')::date,
      (v_item->>'end_date')::date,
      false
    );
  end loop;

  return v_year_id;
end;
$$;

create or replace function public.fn_reopen_fiscal_year(p_fiscal_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Only admin can reopen fiscal years';
  end if;

  update public.finance_fiscal_years
  set is_closed = false,
      closed_by = null,
      closed_at = null
  where id = p_fiscal_year_id;

  update public.finance_fiscal_periods
  set is_closed = false,
      closed_by = null,
      closed_at = null
  where fiscal_year_id = p_fiscal_year_id;
end;
$$;

grant usage on schema public to authenticated, service_role;
grant select, insert, update on table public.finance_fiscal_years to authenticated, service_role;
grant select, insert, update on table public.finance_fiscal_periods to authenticated, service_role;
grant execute on function public.fn_create_finance_fiscal_year_with_periods(text, date, date, jsonb) to authenticated, service_role;
grant execute on function public.fn_reopen_fiscal_year(uuid) to authenticated, service_role;
grant execute on function public.fn_close_fiscal_year(uuid) to authenticated, service_role;
grant execute on function public.fn_close_fiscal_period(uuid) to authenticated, service_role;
grant execute on function public.fn_reopen_fiscal_period(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
