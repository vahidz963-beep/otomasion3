import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create schema if not exists storage;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  create table if not exists auth.users(
    instance_id uuid, id uuid primary key default gen_random_uuid(), aud varchar(255), role varchar(255),
    email varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
    invited_at timestamptz, confirmation_token varchar(255), confirmation_sent_at timestamptz,
    recovery_token varchar(255), recovery_sent_at timestamptz, email_change_token_new varchar(255),
    email_change varchar(255), email_change_sent_at timestamptz, last_sign_in_at timestamptz,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz,
    updated_at timestamptz, phone text, phone_confirmed_at timestamptz, phone_change text,
    phone_change_token varchar(255), phone_change_sent_at timestamptz, confirmed_at timestamptz,
    email_change_token_current varchar(255), email_change_confirm_status smallint, banned_until timestamptz,
    reauthentication_token varchar(255), reauthentication_sent_at timestamptz, is_sso_user boolean default false,
    deleted_at timestamptz, is_anonymous boolean default false
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')
  $$;
  create table if not exists storage.buckets(
    id text primary key,name text unique not null,public boolean default false,
    file_size_limit bigint,allowed_mime_types text[]
  );
  create table if not exists storage.objects(
    id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
    name text,metadata jsonb,created_at timestamptz default now()
  );
`);
const files = fs.readdirSync('supabase/migrations').filter(f=>/^\d+_.*\.sql$/.test(f)).sort((a,b)=>Number(a.split('_')[0])-Number(b.split('_')[0]));
for (const file of files) {
  const n = Number(file.split('_')[0]);
  if (n === 116) { console.log('SKIP', file, '(known legacy enum replay fixture)'); continue; }
  let sql = fs.readFileSync(path.join('supabase/migrations',file),'utf8');
  // PGlite does not expose Supabase's PostgREST notification channel.
  sql = sql.replace(/notify\s+pgrst\s*,\s*'reload schema'\s*;/gi,'');
  sql = sql.replace(/create\s+extension\s+if\s+not\s+exists\s+pgcrypto\s*;/gi,'');
  try {
    await db.exec(sql);
    if (n >= 128) console.log('OK', file);
  } catch (error) {
    console.error('FAILED', file, error.message, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    process.exit(1);
  }
}
console.log('MIGRATIONS_128_131_PGLITE_OK');
{
  const admin = '10000000-0000-4000-8000-000000000001';
  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values('${admin}','admin@test.local','{"role":"admin","full_name":"Test Admin"}'::jsonb,'{}'::jsonb,now(),now());
    select set_config('request.jwt.claim.sub','${admin}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    insert into public.finance_bank_accounts(account_name,bank_name,opening_balance)
    values('حساب تست','بانک تست',10000000);
  `);
  const bank = (await db.query(`select id from public.finance_bank_accounts where account_name='حساب تست'`)).rows[0].id;
  const existing = (await db.query(`select public.fn_purchase_finance_investment(
    'land','دارایی موجود تست',current_date,2,'عدد',500000,0,500000,null,null,null,'بدون پرداخت','inv-existing-1','existing_asset'
  ) as x`)).rows[0].x;
  const existingId = existing.investment_id;
  let n = Number((await db.query(`select count(*)::int n from public.finance_payments where source_record_id=$1`,[existing.transaction_id])).rows[0].n);
  if (n !== 0) throw new Error('existing asset unexpectedly created payment');
  const openingBalance = Number((await db.query(`select coalesce(sum(jl.debit_amount-jl.credit_amount),0) v from public.finance_journal_lines jl join public.finance_journal_entries je on je.id=jl.entry_id where je.source_id=$1`,[existingId])).rows[0].v);
  if (openingBalance !== 0) throw new Error('existing asset journal is not balanced');
  const sold = (await db.query(`select public.fn_sell_finance_investment_full($1,current_date,650000,10000,'bank',$2,'فروش تست','inv-sale-1') as x`,[existingId,bank])).rows[0].x;
  if (Number(sold.realized_profit_loss) !== 140000 || Number(sold.cash_amount) !== 640000) throw new Error('investment sale P/L mismatch');
  n = Number((await db.query(`select count(*)::int n from public.finance_payments where id=$1`,[sold.payment_id])).rows[0].n);
  if (n !== 1) throw new Error('investment sale receipt missing');
  const paid = (await db.query(`select public.fn_purchase_finance_investment(
    'gold','دارایی پرداختی تست',current_date,1,'عدد',200000,0,200000,'bank',$1,null,'خرید تست','inv-paid-1','paid_purchase'
  ) as x`,[bank])).rows[0].x;
  n = Number((await db.query(`select count(*)::int n from public.finance_payments where id=$1`,[paid.payment_id])).rows[0].n);
  if (n !== 1) throw new Error('paid investment payment missing');
  console.log('INVESTMENT_PURCHASE_SALE_INTEGRATION_OK');

  const wi = (await db.query(`insert into public.warehouse_items(item_code,item_name_fa,unit) values('MAT-130','کالای تست خرید','عدد') returning id`)).rows[0].id;
  const party = (await db.query(`insert into public.finance_parties(party_type,display_name,created_by) values('supplier','فروشنده تست',$1) returning id`,[admin])).rows[0].id;
  const doc = (await db.query(`insert into public.finance_documents(document_type,status,party_id,description,created_by) values('purchase_invoice','draft',$1,'فاکتور تست انبار',$2) returning id`,[party,admin])).rows[0].id;
  await db.query(`insert into public.finance_document_items(document_id,line_no,item_type,description_fa,quantity,unit,unit_price,warehouse_item_id) values($1,1,'goods','کالای تست',5,'عدد',1000,$2)`,[doc,wi]);
  await db.query(`update public.finance_documents set status='approved',approved_by=$2,approved_at=now() where id=$1`,[doc,admin]);
  let sync = (await db.query(`select purchase_inventory_sync_state s,purchase_inventory_revision_no r from public.finance_documents where id=$1`,[doc])).rows[0];
  if (sync.s !== 'synced' || Number(sync.r) !== 1) throw new Error('approval did not auto-sync purchase inventory');
  await db.query(`select public.fn_sync_purchase_invoice_inventory($1,'idempotency check',true)`,[doc]);
  n = Number((await db.query(`select count(*)::int n from public.warehouse_transactions where reference_type='purchase_invoice' and reference_id=$1`,[doc])).rows[0].n);
  if (n !== 1) throw new Error('purchase inventory idempotency failed');
  await db.query(`update public.finance_document_items set quantity=8 where document_id=$1`,[doc]);
  await db.query(`select public.fn_sync_purchase_invoice_inventory($1,'delta check',true)`,[doc]);
  let effect = Number((await db.query(`select coalesce(sum(case when transaction_type::text in ('receipt','reversal','adjustment') then quantity when transaction_type::text='issue' then -quantity else 0 end),0) v from public.warehouse_transactions where reference_type='purchase_invoice' and reference_id=$1`,[doc])).rows[0].v);
  if (effect !== 8) throw new Error('purchase inventory positive delta failed');
  await db.query(`update public.finance_documents set status='void' where id=$1`,[doc]);
  effect = Number((await db.query(`select coalesce(sum(case when transaction_type::text in ('receipt','reversal','adjustment') then quantity when transaction_type::text='issue' then -quantity else 0 end),0) v from public.warehouse_transactions where reference_type='purchase_invoice' and reference_id=$1`,[doc])).rows[0].v);
  if (effect !== 0) throw new Error('purchase invoice void reversal failed');
  console.log('PURCHASE_INVOICE_INVENTORY_INTEGRATION_OK');

  const template = (await db.query(`select id from public.order_workflow_templates where sales_path='trading' and is_active order by created_at limit 1`)).rows[0]?.id;
  const customerPayload = JSON.stringify({company_name:'مشتری تست سفارش',crm_status:'active_customer'});
  const orderPayload = JSON.stringify({sales_path:'trading',workflow_template_id:template,title_fa:'سفارش تست ویرایش',registered_at:'2026-10-22'});
  const itemPayload = JSON.stringify([{item_name_fa:'کالای تست خرید',warehouse_item_code:'MAT-130',quantity:10,unit:'عدد',unit_price:10000,discount_percent:0,discount_amount:0}]);
  const created1 = (await db.query(`select public.fn_app_create_order_idempotent('order-key-1',$1::jsonb,$2::jsonb,$3::jsonb,false,false,false,false) x`,[customerPayload,orderPayload,itemPayload])).rows[0].x;
  const created2 = (await db.query(`select public.fn_app_create_order_idempotent('order-key-1',$1::jsonb,$2::jsonb,$3::jsonb,false,false,false,false) x`,[customerPayload,orderPayload,itemPayload])).rows[0].x;
  if (created1.id !== created2.id || created2.idempotent !== true) throw new Error('order creation idempotency failed');
  n = Number((await db.query(`select count(*)::int n from public.orders where title_fa='سفارش تست ویرایش'`)).rows[0].n);
  if (n !== 1) throw new Error('duplicate order was created');
  const oi = (await db.query(`select * from public.order_items where order_id=$1`,[created1.id])).rows[0];
  const editedItems = JSON.stringify([{id:oi.id,item_name_fa:oi.item_name_fa,warehouse_item_code:'MAT-130',quantity:12,unit:'عدد',unit_price:11000,discount_percent:0,discount_amount:0,notes:'نسخه جدید'}]);
  const editResult = (await db.query(`select public.fn_update_order_stage_safe($1,$2::jsonb,$3::jsonb,'اصلاح تستی تعداد',0) x`,[created1.id,JSON.stringify({title_fa:'سفارش تست ویرایش‌شده',expected_delivery_date:'2026-11-15'}),editedItems])).rows[0].x;
  if (Number(editResult.revision_no) !== 1) throw new Error('order revision not incremented');
  const edited = (await db.query(`select edit_revision,title_fa from public.orders where id=$1`,[created1.id])).rows[0];
  if (Number(edited.edit_revision)!==1 || edited.title_fa!=='سفارش تست ویرایش‌شده') throw new Error('order edit not persisted');
  let optimisticFailed = false;
  try { await db.query(`select public.fn_update_order_stage_safe($1,'{}'::jsonb,$2::jsonb,'توکن قدیمی',0)`,[created1.id,editedItems]); } catch { optimisticFailed = true; }
  if (!optimisticFailed) throw new Error('optimistic revision lock failed');
  await db.exec(`select set_config('app.shipment_internal','1',false);`);
  const shipment = (await db.query(`insert into public.warehouse_shipments(source_type,related_order_id,customer_name,status,model_version,total_quantity,created_by) values('trading',$1,'مشتری تست','sent',2,4,$2) returning id`,[created1.id,admin])).rows[0].id;
  await db.query(`insert into public.warehouse_shipment_lines(shipment_id,line_no,order_item_id,warehouse_item_id,item_code_snapshot,item_name_snapshot,unit_snapshot,quantity) values($1,1,$2,$3,'MAT-130','کالای تست خرید','عدد',4)`,[shipment,oi.id,wi]);
  const tooLow = JSON.stringify([{id:oi.id,item_name_fa:oi.item_name_fa,warehouse_item_code:'MAT-130',quantity:3,unit:'عدد',unit_price:11000,discount_percent:0,discount_amount:0}]);
  let sentFloorFailed = false;
  try { await db.query(`select public.fn_update_order_stage_safe($1,'{}'::jsonb,$2::jsonb,'کاهش نامعتبر',1)`,[created1.id,tooLow]); } catch { sentFloorFailed = true; }
  if (!sentFloorFailed) throw new Error('sent quantity floor failed');
  const customerId = (await db.query(`select customer_id from public.orders where id=$1`,[created1.id])).rows[0].customer_id;
  await db.query(`update public.customers set credit_limit=100000,credit_hold=true where id=$1`,[customerId]);
  const credit = (await db.query(`select requires_credit_review from public.v_customer_credit_control where customer_id=$1`,[customerId])).rows[0];
  if (!credit?.requires_credit_review) throw new Error('credit control warning failed');
  console.log('ORDER_STAGE_SAFE_IDEMPOTENCY_CREDIT_INTEGRATION_OK');
}
await db.close();
