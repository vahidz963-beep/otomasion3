-- =====================================================================
-- 025_SHARED_STORAGE_AND_PRODUCTION_BOM_PUBLISH
-- - Store shared files in Supabase Storage, module-based folders.
-- - Publish production BOM final cost as warehouse item price.
-- - Finance sees BOM cost through referrals and warehouse item final price.
-- Depends on: 021, 022
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Shared file metadata and storage bucket
-- ---------------------------------------------------------------------
alter table public.shared_files
  add column if not exists storage_bucket text not null default 'automation-shared-files',
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists deleted_at timestamptz;

-- Create private bucket for automation shared files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('automation-shared-files', 'automation-shared-files', false, 1073741824, null)
on conflict (id) do update
set public = false,
    file_size_limit = 1073741824;

-- Storage policies. Safe to re-run.
drop policy if exists shared_files_storage_read on storage.objects;
create policy shared_files_storage_read on storage.objects
for select using (
  bucket_id = 'automation-shared-files'
  and auth.role() = 'authenticated'
);

drop policy if exists shared_files_storage_insert on storage.objects;
create policy shared_files_storage_insert on storage.objects
for insert with check (
  bucket_id = 'automation-shared-files'
  and auth.role() = 'authenticated'
);

drop policy if exists shared_files_storage_update on storage.objects;
create policy shared_files_storage_update on storage.objects
for update using (
  bucket_id = 'automation-shared-files'
  and auth.role() = 'authenticated'
) with check (
  bucket_id = 'automation-shared-files'
  and auth.role() = 'authenticated'
);

drop policy if exists shared_files_storage_delete on storage.objects;
create policy shared_files_storage_delete on storage.objects
for delete using (
  bucket_id = 'automation-shared-files'
  and auth.role() = 'authenticated'
);

-- ---------------------------------------------------------------------
-- 2) Production BOM final item publish
-- ---------------------------------------------------------------------
create sequence if not exists public.production_item_code_seq;

create or replace function public.fn_production_publish_bom_to_warehouse(
  p_bom_id uuid,
  p_item_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom public.production_boms%rowtype;
  v_item_id uuid;
  v_item_code text;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  perform public.fn_production_recalc_costs(p_bom_id);
  select * into v_bom from public.production_boms where id = p_bom_id for update;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  v_item_id := v_bom.warehouse_item_id;
  v_item_code := nullif(trim(coalesce(p_item_code, '')), '');

  if v_item_id is null then
    if v_item_code is null then
      v_item_code := 'PRD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.production_item_code_seq')::text, 5, '0');
    end if;

    insert into public.warehouse_items (
      item_code,
      item_name_fa,
      item_name_en,
      category,
      unit,
      location,
      min_stock_threshold,
      unit_price_estimate,
      price_currency,
      is_active
    ) values (
      v_item_code,
      v_bom.product_name_fa,
      v_bom.product_name_en,
      'Finished',
      coalesce(v_bom.unit, 'عدد'),
      'تولید',
      0,
      coalesce(v_bom.total_estimated_cost, 0),
      'IRR',
      true
    ) returning id into v_item_id;

    update public.production_boms
    set warehouse_item_id = v_item_id,
        status = case when status = 'draft' then 'active' else status end,
        updated_at = now()
    where id = p_bom_id;
  else
    update public.warehouse_items
    set item_name_fa = v_bom.product_name_fa,
        item_name_en = v_bom.product_name_en,
        category = 'Finished',
        unit = coalesce(v_bom.unit, unit, 'عدد'),
        unit_price_estimate = coalesce(v_bom.total_estimated_cost, 0),
        price_currency = 'IRR',
        is_active = true,
        updated_at = now()
    where id = v_item_id;
  end if;

  return v_item_id;
end;
$$;

-- Update finance referral function so cost is also published to warehouse item price.
create or replace function public.fn_production_send_bom_cost_to_finance(p_bom_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom record;
  v_ref uuid;
  v_item_id uuid;
  v_item_code text;
begin
  if not public.has_role(array['admin','production']) then
    raise exception 'دسترسی تولید ندارید';
  end if;

  v_item_id := public.fn_production_publish_bom_to_warehouse(p_bom_id, null);

  select b.*, wi.item_code
  into v_bom
  from public.production_boms b
  left join public.warehouse_items wi on wi.id = b.warehouse_item_id
  where b.id = p_bom_id;
  if not found then raise exception 'فرمول تولید یافت نشد'; end if;

  insert into public.automation_referrals (
    referral_number, source_module, target_module, target_role, referral_type,
    priority, status, title_fa, description_fa, source_record_id, created_by
  ) values (
    null,
    'production',
    'accounting',
    'accountant',
    'notice',
    2,
    'open',
    'ثبت هزینه تولید کالا: ' || v_bom.product_name_fa,
    'کالا در انبار با کد ' || coalesce(v_bom.item_code, '—') || ' و قیمت نهایی ' || coalesce(v_bom.total_estimated_cost,0) || ' ریال ثبت/به‌روزرسانی شد. مواد: ' || coalesce(v_bom.total_material_cost,0) || '، نیرو/خدمات: ' || coalesce(v_bom.total_labor_cost,0) || '، سربار: ' || coalesce(v_bom.total_overhead_cost,0),
    p_bom_id,
    auth.uid()
  ) returning id into v_ref;

  insert into public.production_documents (
    production_order_id, document_type, title_fa, description_fa, status, created_by
  ) values (
    null,
    'cost',
    'ثبت هزینه تولید ' || v_bom.product_name_fa,
    'کد انبار: ' || coalesce(v_bom.item_code, '—') || '، قیمت نهایی: ' || coalesce(v_bom.total_estimated_cost,0) || ' ریال',
    'registered',
    auth.uid()
  );

  return v_ref;
end;
$$;

grant execute on function public.fn_production_publish_bom_to_warehouse(uuid,text) to authenticated;
grant execute on function public.fn_production_send_bom_cost_to_finance(uuid) to authenticated;
grant usage, select on sequence public.production_item_code_seq to authenticated;

grant select, insert, update, delete on public.shared_files to authenticated;

notify pgrst, 'reload schema';
