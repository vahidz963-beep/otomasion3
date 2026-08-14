-- =====================================================================
-- 032_SYSTEM_HEALTH_REPORT
-- A safer health report for the automation app.
-- Checks core tables/views/RPCs/grants and returns a JSONB report.
-- =====================================================================

create or replace function public.fn_system_health_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables text[] := array[
    'profiles','customers','orders','order_items','automation_referrals','warehouse_items','warehouse_documents','warehouse_document_lines','warehouse_transactions',
    'finance_documents','finance_document_items','finance_payments','finance_checks','finance_parties','finance_bank_accounts','finance_cashboxes',
    'production_orders','production_order_stages','production_workflow_templates','production_workflow_steps','production_boms','production_bom_items',
    'rnd_projects','rnd_project_stages','rnd_workflow_templates','rnd_workflow_steps','shared_files'
  ];
  v_views text[] := array[
    'v_order_lifecycle_overview','v_crm_customer_overview','v_sales_stock_overview','v_warehouse_current_stock','v_warehouse_kardex','v_warehouse_documents_summary',
    'v_finance_dashboard','v_finance_document_summary','v_party_balances','v_party_statement','v_order_profitability','v_finance_account_turnover','v_finance_payment_ledger',
    'v_production_incoming_orders','v_production_order_overview','v_production_bom_summary',
    'v_rnd_incoming_orders','v_rnd_project_overview','v_rnd_cost_summary'
  ];
  v_functions text[] := array[
    'fn_get_deploy_health()','fn_system_health_report()','fn_app_create_order(jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean)',
    'fn_create_crm_followup(uuid,text,timestamp with time zone,text,crm_activity_type,crm_contact_channel,uuid,uuid)',
    'fn_record_stock_movement(uuid,text,numeric,text,text)','fn_finalize_document(uuid)','fn_cancel_warehouse_document(uuid,text)','fn_reactivate_item(uuid)',
    'fn_void_finance_document(uuid,text)','fn_convert_finance_proforma_to_invoice(uuid)','fn_finance_settle_check(uuid,uuid,text,text)',
    'fn_production_accept_order(uuid,uuid,text,numeric,text)','fn_production_save_plan(uuid,date,date,numeric,numeric,numeric,numeric,text)',
    'fn_production_publish_bom_to_warehouse(uuid,text)','fn_rnd_accept_order(uuid,uuid,text,text,text)','fn_rnd_create_internal_project(text,uuid,text,text,text)'
  ];
  v_missing_tables text[] := array[]::text[];
  v_missing_views text[] := array[]::text[];
  v_missing_functions text[] := array[]::text[];
  v_table text;
  v_view text;
  v_fn text;
  v_rls_disabled text[] := array[]::text[];
  v_no_auth_grant text[] := array[]::text[];
  v_policies int;
  v_storage_bucket boolean;
  v_result jsonb;
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      v_missing_tables := array_append(v_missing_tables, v_table);
    else
      if not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || v_table)), false) then
        v_rls_disabled := array_append(v_rls_disabled, v_table);
      end if;

      if not exists (
        select 1
        from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name = v_table
          and g.grantee = 'authenticated'
          and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
      ) then
        v_no_auth_grant := array_append(v_no_auth_grant, v_table);
      end if;
    end if;
  end loop;

  foreach v_view in array v_views loop
    if to_regclass('public.' || v_view) is null then
      v_missing_views := array_append(v_missing_views, v_view);
    end if;
  end loop;

  foreach v_fn in array v_functions loop
    if to_regprocedure('public.' || v_fn) is null then
      v_missing_functions := array_append(v_missing_functions, v_fn);
    end if;
  end loop;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public';

  select exists(select 1 from storage.buckets where id = 'automation-shared-files') into v_storage_bucket;

  v_result := jsonb_build_object(
    'ok', cardinality(v_missing_tables) = 0 and cardinality(v_missing_views) = 0 and cardinality(v_missing_functions) = 0,
    'checked_at', now(),
    'database', jsonb_build_object(
      'missing_tables', v_missing_tables,
      'missing_views', v_missing_views,
      'missing_functions', v_missing_functions,
      'rls_disabled_tables', v_rls_disabled,
      'tables_without_authenticated_grants', v_no_auth_grant,
      'policy_count', v_policies
    ),
    'storage', jsonb_build_object(
      'shared_files_bucket_exists', v_storage_bucket,
      'bucket', 'automation-shared-files'
    ),
    'modules', jsonb_build_object(
      'orders', to_regclass('public.orders') is not null and to_regclass('public.v_order_lifecycle_overview') is not null,
      'crm', to_regclass('public.crm_followups') is not null and to_regclass('public.v_crm_customer_overview') is not null,
      'warehouse', to_regclass('public.warehouse_documents') is not null and to_regclass('public.v_warehouse_current_stock') is not null,
      'finance', to_regclass('public.finance_documents') is not null and to_regclass('public.v_finance_dashboard') is not null,
      'production', to_regclass('public.production_orders') is not null and to_regclass('public.v_production_order_overview') is not null,
      'rnd', to_regclass('public.rnd_projects') is not null and to_regclass('public.v_rnd_project_overview') is not null,
      'shared_files', to_regclass('public.shared_files') is not null and v_storage_bucket
    )
  );

  return v_result;
end;
$$;

revoke all on function public.fn_system_health_report() from public;
grant execute on function public.fn_system_health_report() to authenticated;

notify pgrst, 'reload schema';
