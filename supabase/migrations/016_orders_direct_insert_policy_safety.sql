-- =====================================================================
-- 016_ORDERS_DIRECT_INSERT_POLICY_SAFETY
-- Safety net for the React app: even if a browser has an older bundle that
-- inserts directly into orders/order_items instead of fn_app_create_order,
-- admin/sales can still create orders while RLS remains active.
-- Run after 002 and 009/013.
-- =====================================================================

drop policy if exists orders_insert_sales_admin on public.orders;
create policy orders_insert_sales_admin on public.orders
for insert with check (
  public.has_role(array['admin','sales'])
);

drop policy if exists orders_update_authorized on public.orders;
create policy orders_update_authorized on public.orders
for update using (
  public.is_admin()
  or (public.current_role_name() = 'sales'::public.user_role and public.is_active_user())
  or (public.current_role_name() = 'rnd'::public.user_role and public.is_active_user() and sales_path = 'rnd')
  or (public.current_role_name() = 'production'::public.user_role and public.is_active_user() and sales_path = 'production')
  or (public.current_role_name() = 'warehouse'::public.user_role and public.is_active_user())
  or (public.current_role_name() = 'accountant'::public.user_role and public.is_active_user())
)
with check (
  public.is_admin()
  or public.has_role(array['sales','rnd','production','warehouse','accountant'])
);

drop policy if exists order_items_write_sales_admin on public.order_items;
create policy order_items_write_sales_admin on public.order_items
for all using (
  public.fn_user_can_access_order(order_id)
  and public.has_role(array['admin','sales'])
)
with check (
  public.fn_user_can_access_order(order_id)
  and public.has_role(array['admin','sales'])
);

notify pgrst, 'reload schema';
