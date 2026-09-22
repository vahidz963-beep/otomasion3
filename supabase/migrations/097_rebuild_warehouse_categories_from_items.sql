-- 097 rebuild warehouse categories from the real warehouse item data.
-- This is intentionally limited to the category catalog requested by the user.
-- No stock, document, transaction, invoice or accounting row is deleted.

begin;

-- Every active/inactive item must belong to a visible category.
update public.warehouse_items
set category = 'بدون دسته‌بندی', updated_at = now()
where category is null or btrim(category) = '';

-- Remove obsolete catalog-only categories. The item rows are the source of truth.
delete from public.warehouse_item_categories;

insert into public.warehouse_item_categories (name_fa, code, sort_order, is_active)
select
  c.category,
  'WH-' || row_number() over (order by c.category),
  row_number() over (order by c.category) * 10,
  true
from (
  select distinct btrim(category) as category
  from public.warehouse_items
  where category is not null and btrim(category) <> ''
) c
order by c.category;

commit;
notify pgrst, 'reload schema';
