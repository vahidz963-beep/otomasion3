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
console.log('MIGRATIONS_128_135_PGLITE_OK');
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

  // تسویه غیرنقدی بدهی با پرداخت مستقیم چند ردیف هزینه
  const directParty = (await db.query(`
    insert into public.finance_parties(party_type,display_name,created_by)
    values('customer','مشتری بدهکار تست مستقیم',$1)
    returning id
  `,[admin])).rows[0].id;
  const directDoc = (await db.query(`
    insert into public.finance_documents(
      document_type,status,party_id,subtotal_amount,total_amount,description,approved_by,approved_at,created_by
    ) values('sales_invoice','approved',$1,500000,500000,'فاکتور تست تسویه مستقیم',$2,now(),$2)
    returning id
  `,[directParty,admin])).rows[0].id;
  const expenseCategories = (await db.query(`
    select id from public.finance_income_expense_categories
    where category_type='expense' and is_active
    order by code
    limit 2
  `)).rows;
  if (expenseCategories.length < 2) throw new Error('direct expense categories fixture missing');
  const directLines = JSON.stringify([
    {category_id:expenseCategories[0].id,amount:120000,description:'هزینه حمل مستقیم'},
    {category_id:expenseCategories[1].id,amount:180000,description:'هزینه تعمیر مستقیم'},
  ]);
  const bankBalanceBeforeDirect = Number((await db.query(`
    select current_balance from public.v_finance_account_turnover
    where account_kind='bank' and account_id=$1
  `,[bank])).rows[0].current_balance);
  const directCreated = (await db.query(`
    select public.fn_create_direct_expense_offset(
      $1,current_date,$2::jsonb,'تسویه تست چندردیفی',$3,null,'direct-offset-create-1'
    ) as x
  `,[directParty,directLines,directDoc])).rows[0].x;
  if (Number(directCreated.total_amount) !== 300000 || directCreated.idempotent !== false) {
    throw new Error('direct expense offset total mismatch');
  }
  const directRepeated = (await db.query(`
    select public.fn_create_direct_expense_offset(
      $1,current_date,$2::jsonb,'تسویه تست چندردیفی',$3,null,'direct-offset-create-1'
    ) as x
  `,[directParty,directLines,directDoc])).rows[0].x;
  if (directRepeated.settlement_id !== directCreated.settlement_id || directRepeated.idempotent !== true) {
    throw new Error('direct expense offset idempotency failed');
  }
  let directState = (await db.query(`
    select s.total_amount,s.status,p.method,p.direction,p.bank_account_id,p.cashbox_id,d.paid_amount,d.balance_amount,
      (select count(*)::int from public.finance_direct_expense_offset_lines l where l.settlement_id=s.id) line_count,
      (select coalesce(sum(l.amount),0) from public.finance_direct_expense_offset_lines l where l.settlement_id=s.id) line_total,
      (select coalesce(sum(jl.debit_amount),0) from public.finance_journal_lines jl where jl.entry_id=s.journal_entry_id) journal_debit,
      (select coalesce(sum(jl.credit_amount),0) from public.finance_journal_lines jl where jl.entry_id=s.journal_entry_id) journal_credit,
      (select count(*)::int from public.finance_journal_lines jl join public.finance_accounts a on a.id=jl.account_id where jl.entry_id=s.journal_entry_id and a.code in ('1000','1010')) cash_bank_lines,
      (select count(*)::int from public.finance_journal_lines jl join public.finance_accounts a on a.id=jl.account_id where jl.entry_id=s.journal_entry_id and a.code='1100' and jl.party_id=s.party_id and jl.credit_amount=s.total_amount) receivable_credit_lines,
      (select count(*)::int from public.finance_journal_lines jl join public.finance_accounts a on a.id=jl.account_id where jl.entry_id=s.journal_entry_id and a.account_type::text in ('expense','cost_of_goods_sold') and jl.debit_amount>0) expense_debit_lines
    from public.finance_direct_expense_offsets s
    join public.finance_payments p on p.id=s.payment_id
    join public.finance_documents d on d.id=s.related_document_id
    where s.id=$1
  `,[directCreated.settlement_id])).rows[0];
  if (Number(directState.total_amount)!==300000 || Number(directState.line_total)!==300000 || Number(directState.line_count)!==2) throw new Error('direct expense line equality failed');
  if (directState.method!=='direct_expense_offset' || directState.direction!=='receipt' || directState.bank_account_id || directState.cashbox_id) throw new Error('direct expense payment is not non-cash');
  if (Number(directState.journal_debit)!==300000 || Number(directState.journal_credit)!==300000 || Number(directState.cash_bank_lines)!==0) throw new Error('direct expense journal mismatch');
  if (Number(directState.receivable_credit_lines)!==1 || Number(directState.expense_debit_lines)!==2) throw new Error('direct expense ledger accounts/party mismatch');
  if (Number(directState.paid_amount)!==300000 || Number(directState.balance_amount)!==200000) throw new Error('direct expense invoice allocation mismatch');
  let linkedInvoiceVoidBlocked = false;
  try { await db.query(`update public.finance_documents set status='void' where id=$1`,[directDoc]); } catch { linkedInvoiceVoidBlocked = true; }
  if (!linkedInvoiceVoidBlocked) throw new Error('linked invoice was voided before its direct expense offset');
  let totalMismatchBlocked = false;
  try { await db.query(`update public.finance_direct_expense_offsets set total_amount=300001 where id=$1`,[directCreated.settlement_id]); } catch { totalMismatchBlocked = true; }
  if (!totalMismatchBlocked) throw new Error('database allowed direct expense parent/line total mismatch');
  let directPaymentMutationBlocked = false;
  try { await db.query(`update public.finance_payments set amount=1,bank_account_id=$2 where id=$1`,[directCreated.payment_id,bank]); } catch { directPaymentMutationBlocked = true; }
  if (!directPaymentMutationBlocked) throw new Error('database allowed direct mutation of the non-cash finance payment');
  let directPartyBalance = Number((await db.query(`select balance from public.v_party_balances where party_id=$1`,[directParty])).rows[0].balance);
  if (directPartyBalance !== 200000) throw new Error('direct expense did not reduce party debt');
  const statementCredit = Number((await db.query(`
    select coalesce(sum(credit_amount),0) amount
    from public.v_party_statement
    where party_id=$1 and payment_id=$2
  `,[directParty,directCreated.payment_id])).rows[0].amount);
  if (statementCredit !== 300000) throw new Error('direct expense is missing from party statement');
  let reportState = (await db.query(`
    select count(*)::int line_count,coalesce(sum(amount),0) total
    from public.v_finance_income_expense_ledger
    where direct_settlement_id=$1
  `,[directCreated.settlement_id])).rows[0];
  if (Number(reportState.line_count)!==2 || Number(reportState.total)!==300000) throw new Error('direct expense report double-count/missing lines');
  let treasuryLeak = Number((await db.query(`select count(*)::int n from public.v_finance_payment_ledger where id=$1`,[directCreated.payment_id])).rows[0].n);
  const bankBalanceAfterDirect = Number((await db.query(`
    select current_balance from public.v_finance_account_turnover
    where account_kind='bank' and account_id=$1
  `,[bank])).rows[0].current_balance);
  if (treasuryLeak !== 0 || bankBalanceAfterDirect !== bankBalanceBeforeDirect) throw new Error('direct expense leaked into treasury cashflow');

  const revisedLines = JSON.stringify([
    {category_id:expenseCategories[0].id,amount:250000,description:'نسخه اصلاح‌شده هزینه مستقیم'},
  ]);
  const directRevised = (await db.query(`
    select public.fn_revise_direct_expense_offset(
      $1,$2,current_date,$3::jsonb,'اصلاح مبلغ تست','نسخه اصلاح‌شده',$4,null,'direct-offset-revise-1'
    ) as x
  `,[directCreated.settlement_id,directParty,revisedLines,directDoc])).rows[0].x;
  if (directRevised.replaces_settlement_id !== directCreated.settlement_id || Number(directRevised.total_amount)!==250000) throw new Error('direct expense safe revision failed');
  directState = (await db.query(`
    select
      (select status from public.finance_direct_expense_offsets where id=$1) old_status,
      (select replaced_by_settlement_id from public.finance_direct_expense_offsets where id=$1) replacement_id,
      (select status from public.finance_payments where id=(select payment_id from public.finance_direct_expense_offsets where id=$1)) old_payment_status,
      d.paid_amount,d.balance_amount
    from public.finance_documents d where d.id=$2
  `,[directCreated.settlement_id,directDoc])).rows[0];
  if (directState.old_status!=='void' || directState.old_payment_status!=='void' || directState.replacement_id!==directRevised.settlement_id) throw new Error('direct expense prior revision was not safely voided');
  if (Number(directState.paid_amount)!==250000 || Number(directState.balance_amount)!==250000) throw new Error('direct expense revised allocation mismatch');
  directPartyBalance = Number((await db.query(`select balance from public.v_party_balances where party_id=$1`,[directParty])).rows[0].balance);
  if (directPartyBalance !== 250000) throw new Error('direct expense revision party balance mismatch');

  await db.query(`select public.fn_void_direct_expense_offset($1,'ابطال نهایی تست')`,[directRevised.settlement_id]);
  const afterVoid = (await db.query(`
    select s.status,p.status payment_status,je.status journal_status,d.paid_amount,d.balance_amount
    from public.finance_direct_expense_offsets s
    join public.finance_payments p on p.id=s.payment_id
    join public.finance_journal_entries je on je.id=s.journal_entry_id
    join public.finance_documents d on d.id=s.related_document_id
    where s.id=$1
  `,[directRevised.settlement_id])).rows[0];
  if (afterVoid.status!=='void' || afterVoid.payment_status!=='void' || afterVoid.journal_status!=='void') throw new Error('direct expense void status mismatch');
  if (Number(afterVoid.paid_amount)!==0 || Number(afterVoid.balance_amount)!==500000) throw new Error('direct expense void did not restore document debt');
  directPartyBalance = Number((await db.query(`select balance from public.v_party_balances where party_id=$1`,[directParty])).rows[0].balance);
  if (directPartyBalance !== 500000) throw new Error('direct expense void did not restore party debt');
  reportState = (await db.query(`select count(*)::int line_count from public.v_finance_income_expense_ledger where direct_settlement_id=$1`,[directRevised.settlement_id])).rows[0];
  if (Number(reportState.line_count)!==0) throw new Error('void direct expense remained in active expense report');
  let physicalDeleteBlocked = false;
  try { await db.query(`delete from public.finance_direct_expense_offsets where id=$1`,[directRevised.settlement_id]); } catch { physicalDeleteBlocked = true; }
  if (!physicalDeleteBlocked) throw new Error('direct expense physical deletion was not blocked');
  console.log('DIRECT_EXPENSE_DEBT_OFFSET_INTEGRATION_OK');

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

  // کاتالوگ امن فروش + Viewer فقط‌خواندنی در Scope کامل سفارش (Migrationهای 134/135)
  await db.query(`update public.warehouse_items set price_currency='USD',base_cost_price=1.25,base_sale_price=2.5,unit_price_estimate=900000,unit_sale_price_estimate=1250000,pricing_updated_at=now() where id=$1`, [wi]);
  const catalog = (await db.query(`select public.fn_get_order_sales_catalog() x`)).rows[0].x;
  const catalogItem = catalog.find((item) => item.item_id === wi);
  if (!catalogItem || Number(catalogItem.effective_sale_price) !== 1250000 || Number(catalogItem.base_sale_price) !== 2.5) throw new Error('safe order sales catalog price mismatch');
  const forbiddenCatalogKeys = ['unit_price_estimate','stock_value_estimate','base_cost_price','catalog_cost_rial_snapshot','pricing_margin_pct','last_sale_unit_price'];
  if (forbiddenCatalogKeys.some((key) => JSON.stringify(catalog).includes(`"${key}"`))) throw new Error('safe order sales catalog leaked a cost field');

  const salesManager = '10000000-0000-4000-8000-000000000134';
  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values('${salesManager}','sales-manager-134@test.local','{"role":"sales_manager","full_name":"مدیر فروش تست ۱۳۴"}'::jsonb,'{}'::jsonb,now(),now());
  `);
  await db.query(`update public.orders set sales_officer_id=$2 where id=$1`, [created1.id, salesManager]);
  const unrelatedOrder = (await db.query(`
    insert into public.orders(order_code,customer_id,sales_path,current_stage,title_fa,created_by)
    values('ORD-UNRELATED-134',$1,'trading','draft','سفارش مدیر کل برای آزمون Scope کامل فروش',$2)
    returning id
  `, [customerId, admin])).rows[0].id;
  const relatedSalesDoc = (await db.query(`
    insert into public.finance_documents(document_type,status,party_id,related_order_id,issue_date,description,subtotal_amount,total_amount,created_by)
    values('sales_invoice','draft',$1,$2,current_date,'فاکتور فروش مرتبط تست ۱۳۴',2500000,2500000,$3)
    returning id
  `, [directParty, created1.id, admin])).rows[0].id;
  await db.query(`
    insert into public.finance_document_items(
      document_id,line_no,item_type,description_fa,quantity,unit,unit_price,line_total,warehouse_item_id,order_item_id,
      price_currency_snapshot,base_cost_price_snapshot,base_sale_price_snapshot,catalog_cost_rial_snapshot,catalog_sale_rial_snapshot,price_snapshot_at
    ) values($1,1,'goods','قلم فروش امن',2,'عدد',1250000,2500000,$2,$3,'USD',1.25,2.5,900000,1250000,now())
  `, [relatedSalesDoc, wi, oi.id]);
  const unrelatedSalesDoc = (await db.query(`
    insert into public.finance_documents(document_type,status,party_id,related_order_id,issue_date,description,subtotal_amount,total_amount,created_by)
    values('sales_proforma','draft',$1,$2,current_date,'پیش‌فاکتور Scope کامل تست ۱۳۴',100000,100000,$3)
    returning id
  `, [directParty, unrelatedOrder, admin])).rows[0].id;
  await db.query(`select public.fn_warehouse_add_transaction($1,'receipt',20,'orders_dispatch_test',$2,$3,'موجودی تست ارسال نقش فروش')`, [wi, created1.id, admin]);
  await db.query(`update public.finance_documents set status='approved',approved_by=$2,approved_at=now() where id=$1`, [relatedSalesDoc, admin]);

  await db.exec(`
    select set_config('request.jwt.claim.sub','${salesManager}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
  `);
  const visibleDocs = (await db.query(`select public.fn_get_accessible_order_sales_documents(1000) x`)).rows[0].x;
  if (!visibleDocs.some((item) => item.id === relatedSalesDoc) || !visibleDocs.some((item) => item.id === unrelatedSalesDoc)) throw new Error('sales manager full Orders document scope mismatch');
  const orderDocs = (await db.query(`select public.fn_get_order_sales_documents($1) x`, [created1.id])).rows[0].x;
  if (orderDocs.length !== 1 || orderDocs[0].id !== relatedSalesDoc) throw new Error('order-scoped sales document list mismatch');
  const safeBundle = (await db.query(`select public.fn_get_order_sales_document_bundle($1) x`, [relatedSalesDoc])).rows[0].x;
  if (safeBundle.document.id !== relatedSalesDoc || safeBundle.items.length !== 1 || safeBundle.access.mode !== 'sales_read_only') throw new Error('safe sales document bundle mismatch');
  if (safeBundle.access.can_edit || safeBundle.access.can_post || safeBundle.access.can_void || safeBundle.access.can_pay) throw new Error('sales document bundle exposed a finance action');
  if (safeBundle.payments.length || safeBundle.events.length || safeBundle.allocations.length || safeBundle.referrals.length || safeBundle.ioDocuments.length) throw new Error('sales document bundle exposed finance collections');
  const safeBundleText = JSON.stringify(safeBundle);
  const forbiddenBundleKeys = ['base_cost_price_snapshot','catalog_cost_rial_snapshot','journal_entry_id','cashbox_id','bank_account_id','payment_method'];
  if (forbiddenBundleKeys.some((key) => safeBundleText.includes(`"${key}"`))) throw new Error('sales document bundle leaked confidential accounting/cost data');
  const fullScopeBundle = (await db.query(`select public.fn_get_order_sales_document_bundle($1) x`, [unrelatedSalesDoc])).rows[0].x;
  if (fullScopeBundle.document.id !== unrelatedSalesDoc || fullScopeBundle.access.mode !== 'sales_read_only') throw new Error('sales manager could not open a sales document from the full Orders scope');
  if (JSON.stringify(fullScopeBundle).includes('base_cost_price_snapshot')) throw new Error('full Orders scope leaked a confidential finance snapshot');
  console.log('WAREHOUSE_SALES_CATALOG_ORDER_DOCUMENT_SECURITY_INTEGRATION_OK');

  // برابری دسترسی عملیاتی مدیر کل، مدیر فروش و فروشنده در ماژول سفارش‌ها (Migration 135)
  const managerCreated = (await db.query(`
    select public.fn_orders_full_create_order(
      'manager-full-create-135','{}'::jsonb,$1::jsonb,$2::jsonb,
      false,false,false,false
    ) x
  `, [
    JSON.stringify({customer_id:customerId,sales_path:'trading',title_fa:'ثبت سفارش توسط مدیر فروش'}),
    JSON.stringify([{item_name_fa:'قلم مدیر فروش',warehouse_item_code:'MAT-130',quantity:1,unit:'عدد',unit_price:1250000}]),
  ])).rows[0].x;
  if (!managerCreated?.id) throw new Error('sales manager could not create an order through full Orders access');
  const managerCreatedItem = (await db.query(`select * from public.order_items where order_id=$1`, [managerCreated.id])).rows[0];
  const managerEditItems = JSON.stringify([{
    id:managerCreatedItem.id,item_name_fa:managerCreatedItem.item_name_fa,
    warehouse_item_code:managerCreatedItem.warehouse_item_code,quantity:Number(managerCreatedItem.quantity),
    unit:managerCreatedItem.unit,unit_price:Number(managerCreatedItem.unit_price),discount_percent:0,discount_amount:0,
  }]);
  const managerEdit = (await db.query(`
    select public.fn_orders_full_update_stage_safe($1,$2::jsonb,$3::jsonb,'ویرایش کامل توسط مدیر فروش',0) x
  `, [managerCreated.id, JSON.stringify({title_fa:'سفارش ویرایش‌شده توسط مدیر فروش'}), managerEditItems])).rows[0].x;
  if (Number(managerEdit.revision_no) !== 1) throw new Error('sales manager could not run full Stage-safe order editing');
  const managerProforma = (await db.query(`select public.fn_orders_full_create_proforma($1) x`, [unrelatedOrder])).rows[0].x;
  if (managerProforma !== unrelatedSalesDoc) throw new Error('sales manager proforma access is not admin-equivalent/idempotent');
  const nextStage = (await db.query(`select stage_key from public.order_stage_instances where order_id=$1 order by stage_order offset 1 limit 1`, [unrelatedOrder])).rows[0]?.stage_key;
  if (!nextStage) throw new Error('order workflow fixture for full access is missing');
  await db.query(`select public.fn_orders_full_set_stage($1,$2,'تغییر مرحله توسط مدیر فروش')`, [unrelatedOrder, nextStage]);
  const changedStage = (await db.query(`select current_stage from public.orders where id=$1`, [unrelatedOrder])).rows[0].current_stage;
  if (changedStage !== nextStage) throw new Error('sales manager could not change an admin-owned order stage');
  const managerReserveResult = (await db.query(`select public.fn_orders_full_reserve_inventory($1) x`, [unrelatedOrder])).rows[0].x;
  if (Number(managerReserveResult) !== 0) throw new Error('empty manager reservation fixture returned an unexpected count');
  await db.query(`select public.fn_orders_full_release_inventory($1)`, [unrelatedOrder]);
  const creditUpdate = (await db.query(`select public.fn_orders_full_update_customer_credit($1,250000,false,'اعتبار تست مدیر فروش') x`, [customerId])).rows[0].x;
  if (Number(creditUpdate.credit_limit) !== 250000 || creditUpdate.credit_hold) throw new Error('sales manager could not update customer credit through audited Orders RPC');
  const managerReferral = (await db.query(`select public.fn_create_order_referral($1,'warehouse','ارجاع مدیر فروش',null,'warehouse',2,null) x`, [unrelatedOrder])).rows[0].x;
  const managerReferralEvent = Number((await db.query(`select count(*)::int n from public.order_events where order_id=$1 and metadata->>'referral_id'=$2`, [unrelatedOrder, managerReferral])).rows[0].n);
  if (!managerReferral || managerReferralEvent !== 1) throw new Error('sales manager referral access/audit mismatch');
  const managerInteraction = (await db.query(`
    select public.fn_orders_full_log_crm_interaction($1,'تعامل مدیر فروش',null,'follow_up'::public.crm_activity_type,null,$2) x
  `, [customerId, unrelatedOrder])).rows[0].x;
  if (!managerInteraction) throw new Error('sales manager could not log an Orders CRM interaction');
  const managerFollowup = (await db.query(`
    select public.fn_orders_full_create_crm_followup($1,'پیگیری مدیر فروش',now()+interval '2 days',null,'follow_up'::public.crm_activity_type,null,$2,$3) x
  `, [customerId, unrelatedOrder, salesManager])).rows[0].x;
  const completedManagerFollowup = (await db.query(`select public.fn_orders_full_complete_crm_followup($1,'انجام شد') x`, [managerFollowup])).rows[0].x;
  if (completedManagerFollowup !== managerFollowup) throw new Error('sales manager could not complete an Orders CRM follow-up');
  const managerCancellation = (await db.query(`select public.fn_orders_cancel_order_complete($1,'لغو کامل تست مدیر فروش') x`, [managerCreated.id])).rows[0].x;
  if (!managerCancellation.cancelled || managerCancellation.idempotent) throw new Error('sales manager could not run complete order cancellation');
  const managerAuditActions = (await db.query(`select action from public.order_module_audit_events where actor_id=$1`, [salesManager])).rows.map((row) => row.action);
  for (const action of ['order.created','order.stage_safe_updated','order.proforma_created','order.stage_changed','order.inventory_reserved','order.inventory_released','customer.credit_updated','order.crm_interaction_logged','order.crm_followup_created','order.crm_followup_completed','order.cancelled_complete']) {
    if (!managerAuditActions.includes(action)) throw new Error(`missing manager Orders audit action: ${action}`);
  }
  const roleAfterManagerDelegation = (await db.query(`select auth.role() r`)).rows[0].r;
  if (roleAfterManagerDelegation !== 'authenticated') throw new Error('Orders delegated wrapper did not restore the caller role');
  const managerShipment = (await db.query(`
    select public.fn_orders_full_dispatch_shipment(
      $1,$2::jsonb,current_date,1,'حمل تست','TRK-135-MANAGER','تحویل‌گیرنده تست','ارسال واقعی مدیر فروش','dispatch-manager-135'
    ) x
  `, [created1.id, JSON.stringify([{order_item_id:oi.id,quantity:1}])])).rows[0].x;
  const managerShipmentRow = (await db.query(`select related_order_id,status::text status,created_by from public.warehouse_shipments where id=$1`, [managerShipment])).rows[0];
  if (managerShipmentRow?.related_order_id !== created1.id || managerShipmentRow.status !== 'sent' || managerShipmentRow.created_by !== salesManager) throw new Error('sales manager atomic order dispatch failed');
  const managerDispatchAudit = (await db.query(`select actor_id from public.order_module_audit_events where action='order.shipment_dispatched' and details->>'shipment_id'=$1`, [managerShipment])).rows[0];
  if (managerDispatchAudit?.actor_id !== salesManager) throw new Error('sales manager dispatch audit missing');

  await db.exec(`
    select set_config('request.jwt.claim.sub','${admin}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
  `);
  const salesUser = '10000000-0000-4000-8000-000000000135';
  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values('${salesUser}','sales-135@test.local','{"role":"sales","full_name":"فروشنده تست ۱۳۵"}'::jsonb,'{}'::jsonb,now(),now());
  `);
  const cancellableOrder = (await db.query(`
    insert into public.orders(order_code,customer_id,sales_path,current_stage,title_fa,created_by,sales_officer_id)
    values('ORD-CANCEL-135',$1,'trading','draft','سفارش قابل لغو کامل',$2,$2)
    returning id
  `, [customerId, admin])).rows[0].id;
  const cancelItem = (await db.query(`
    insert into public.order_items(order_id,line_no,item_name_fa,warehouse_item_code,quantity,unit,unit_price)
    values($1,1,'قلم لغو کامل','MAT-130',2,'عدد',1250000)
    returning id
  `, [cancellableOrder])).rows[0].id;
  await db.query(`
    insert into public.order_inventory_reservations(order_id,order_item_id,warehouse_item_id,quantity,status,reserved_by)
    values($1,$2,$3,2,'reserved',$4)
  `, [cancellableOrder, cancelItem, wi, admin]);
  const cancelReferral = (await db.query(`select public.fn_create_order_referral($1,'warehouse','ارجاع باز تست لغو',null,'warehouse',2,null) x`, [cancellableOrder])).rows[0].x;
  const cancelFollowup = (await db.query(`
    insert into public.crm_followups(customer_id,related_order_id,title,due_at,assigned_to,created_by)
    values($1,$2,'پیگیری باز تست لغو',now()+interval '1 day',$3,$3) returning id
  `, [customerId, cancellableOrder, admin])).rows[0].id;
  const cancelOpportunity = (await db.query(`
    insert into public.crm_opportunities(customer_id,related_order_id,title,stage,created_by)
    values($1,$2,'فرصت باز تست لغو','new',$3) returning id
  `, [customerId, cancellableOrder, admin])).rows[0].id;
  const retainedFinanceDoc = (await db.query(`
    insert into public.finance_documents(document_type,status,party_id,related_order_id,description,created_by)
    values('sales_proforma','draft',$1,$2,'سند مالی باید در لغو سفارش محفوظ بماند',$3) returning id
  `, [directParty, cancellableOrder, admin])).rows[0].id;

  await db.exec(`
    select set_config('request.jwt.claim.sub','${salesUser}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
  `);
  const canSalesAccessAdminOrder = (await db.query(`select public.fn_user_can_access_order($1) x`, [cancellableOrder])).rows[0].x;
  if (!canSalesAccessAdminOrder) throw new Error('sales user cannot access an admin-owned order');
  const cancellation = (await db.query(`select public.fn_orders_cancel_order_complete($1,'لغو کامل توسط فروشنده مجاز') x`, [cancellableOrder])).rows[0].x;
  if (!cancellation.cancelled || cancellation.idempotent || Number(cancellation.released_reservations) !== 1) throw new Error('complete order cancellation result mismatch');
  const cancelledOrder = (await db.query(`select is_cancelled,cancelled_reason,cancelled_by,cancelled_at from public.orders where id=$1`, [cancellableOrder])).rows[0];
  if (!cancelledOrder.is_cancelled || cancelledOrder.cancelled_by !== salesUser || !cancelledOrder.cancelled_at) throw new Error('complete order cancellation audit mismatch');
  const activeReservationsAfterCancel = Number((await db.query(`select count(*)::int n from public.order_inventory_reservations where order_id=$1 and status='reserved'`, [cancellableOrder])).rows[0].n);
  if (activeReservationsAfterCancel !== 0) throw new Error('complete cancellation did not release reservations');
  const unfinishedStagesAfterCancel = Number((await db.query(`select count(*)::int n from public.order_stage_instances where order_id=$1 and status in ('pending','current','blocked')`, [cancellableOrder])).rows[0].n);
  if (unfinishedStagesAfterCancel !== 0) throw new Error('complete cancellation did not skip unfinished order stages');
  const referralStatus = (await db.query(`select status::text status from public.automation_referrals where id=$1`, [cancelReferral])).rows[0].status;
  const followupDone = (await db.query(`select is_done from public.crm_followups where id=$1`, [cancelFollowup])).rows[0].is_done;
  const opportunityStage = (await db.query(`select stage::text stage from public.crm_opportunities where id=$1`, [cancelOpportunity])).rows[0].stage;
  if (referralStatus !== 'cancelled' || !followupDone || opportunityStage !== 'lost') throw new Error('complete cancellation did not close open Orders-side workflows');
  const retainedStatus = (await db.query(`select status::text status from public.finance_documents where id=$1`, [retainedFinanceDoc])).rows[0].status;
  if (retainedStatus !== 'draft') throw new Error('Orders cancellation improperly mutated a finance document');
  const cancellationEvents = Number((await db.query(`select count(*)::int n from public.order_events where order_id=$1 and title='سفارش به‌طور کامل لغو شد'`, [cancellableOrder])).rows[0].n);
  if (cancellationEvents !== 1) throw new Error('complete cancellation audit event missing');
  const moduleCancellationAudit = (await db.query(`select actor_id,details from public.order_module_audit_events where order_id=$1 and action='order.cancelled_complete'`, [cancellableOrder])).rows[0];
  if (moduleCancellationAudit?.actor_id !== salesUser || Number(moduleCancellationAudit?.details?.retained_finance_documents) !== 1) throw new Error('complete cancellation module audit mismatch');
  const cancellationRetry = (await db.query(`select public.fn_orders_cancel_order_complete($1,'تلاش تکراری لغو') x`, [cancellableOrder])).rows[0].x;
  if (!cancellationRetry.idempotent) throw new Error('complete cancellation idempotency failed');

  let financeVoidBlocked = false;
  try { await db.query(`select public.fn_void_finance_document($1,'تلاش غیرمجاز فروش')`, [retainedFinanceDoc]); }
  catch (error) { financeVoidBlocked = String(error?.message || error).includes('دسترسی ابطال سند مالی ندارید'); }
  if (!financeVoidBlocked) throw new Error('full Orders access crossed the finance-void boundary');
  let shipmentReversalBlocked = false;
  try { await db.query(`select public.fn_reverse_order_shipment($1,'تلاش غیرمجاز فروش')`, [shipment]); }
  catch (error) { shipmentReversalBlocked = String(error?.message || error).includes('برگشت ارسال فقط برای مدیر یا انبار'); }
  if (!shipmentReversalBlocked) throw new Error('full Orders access crossed the shipment-reversal boundary');

  const salesShipment = (await db.query(`
    select public.fn_orders_full_dispatch_shipment(
      $1,$2::jsonb,current_date,1,'حمل تست فروش','TRK-135-SALES','تحویل‌گیرنده فروش','ارسال واقعی فروشنده','dispatch-sales-135'
    ) x
  `, [created1.id, JSON.stringify([{order_item_id:oi.id,quantity:1}])])).rows[0].x;
  const salesShipmentRow = (await db.query(`select related_order_id,status::text status,created_by from public.warehouse_shipments where id=$1`, [salesShipment])).rows[0];
  if (salesShipmentRow?.related_order_id !== created1.id || salesShipmentRow.status !== 'sent' || salesShipmentRow.created_by !== salesUser) throw new Error('sales user atomic order dispatch failed');
  const salesDispatchAudit = (await db.query(`select actor_id from public.order_module_audit_events where action='order.shipment_dispatched' and details->>'shipment_id'=$1`, [salesShipment])).rows[0];
  if (salesDispatchAudit?.actor_id !== salesUser) throw new Error('sales user dispatch audit missing');

  await db.exec(`
    select set_config('request.jwt.claim.sub','${admin}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
  `);
  console.log('ORDERS_FULL_SALES_ACCESS_COMPLETE_CANCELLATION_INTEGRATION_OK');
}
await db.close();
