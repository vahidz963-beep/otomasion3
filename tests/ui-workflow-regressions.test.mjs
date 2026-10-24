import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

function filesUnder(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}

const sourceFiles = filesUnder(join(root, 'src')).filter((path) => /\.(jsx?|tsx?)$/.test(path));
const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.equal(/type\s*=\s*["'](?:date|month)["']/.test(source), false, 'native date/month inputs bypass the shared Jalali mask');

const accounting = read('src/modules/accounting/AccountingModule.jsx');
assert.match(accounting, /function financeDocumentMatchesSearch/);
assert.match(accounting, /document\.customer_code/);
assert.match(accounting, /document\.order_code/);
assert.match(accounting, /document\.total_amount/);
assert.match(accounting, /document\.balance_amount/);
assert.match(accounting, /document\.item_search_text/);
assert.equal((accounting.match(/<DocumentsCard title=/g) || []).length >= 3, true);
assert.equal((accounting.match(/<JalaliMonthInput/g) || []).length >= 2, true);
assert.match(accounting, /function statementMoneyHtml/);
assert.match(accounting, /class=\"official-table statement-table\"/);
assert.match(accounting, /<colgroup><col class=\"col-row\">/);
assert.match(accounting, /statementMoneyHtml\(Math\.abs\(balance\)\)/);
assert.match(accounting, /statement-money-unit/);

const financePrint = read('src/lib/financeApi.js');
assert.match(financePrint, /\.statement-table col\.col-description/);
assert.match(financePrint, /\.statement-money-cell\{[^}]*overflow:hidden!important/);
assert.match(financePrint, /\.statement-money-unit\{/);
assert.match(financePrint, /\.statement-money\.fit-xxs \.statement-money-value,\.statement-money-value\.force-wrap\{[^}]*overflow-wrap:anywhere/);
assert.match(financePrint, /function fitStatementMoneyCells\(\)/);
assert.match(financePrint, /while\(value\.scrollWidth>available&&size>6\.4\)/);
assert.match(financePrint, /window\.addEventListener\('beforeprint',fitStatementMoneyCells\)/);

const sharedStyles = read('src/styles.css');
const productPicker = read('src/components/ProductPicker.jsx');
const searchableSelect = read('src/components/SearchableSelect.jsx');
assert.match(sharedStyles, /\.product-picker-clear,\.searchable-select-clear\{left:7px!important;right:auto!important/);
assert.match(sharedStyles, /\.product-picker input,\.searchable-select input\{padding-left:38px!important;padding-right:12px!important/);
assert.match(productPicker, /className=\"product-picker-clear\" aria-label=\"پاک کردن انتخاب کالا\"/);
assert.match(searchableSelect, /className=\"searchable-select-clear\" aria-label=\"پاک کردن انتخاب\"/);

const warehouse = read('src/modules/warehouse/WarehouseModule.jsx');
const syncStart = warehouse.indexOf('function SyncSection');
const syncEnd = warehouse.indexOf('function SimpleSyncTable', syncStart);
const syncSection = warehouse.slice(syncStart, syncEnd);
assert.ok(syncSection.indexOf('<CurrencyPricingSection') < syncSection.indexOf('<div className="warehouse-grid sync-grid">'), 'currency pricing must be first');
assert.match(warehouse, /function warehouseDocumentMatchesSearch/);
assert.match(warehouse, /warehouse-document-search/);
assert.match(warehouse, /edited_registered/);

const warehouseHook = read('src/hooks/useWarehouseData.js');
assert.equal((warehouseHook.match(/\.limit\(3000\)/g) || []).length >= 4, true, 'status/document lists must not be truncated to a few rows');

const migration = read('supabase/migrations/127_ui_search_order_and_safe_finance_warehouse_edit.sql');
assert.match(migration, /add column if not exists line_no integer/);
assert.match(migration, /order by oi\.line_no/);
assert.match(migration, /fn_update_confirmed_finance_document/);
assert.match(migration, /fn_sync_warehouse_after_finance_edit/);
assert.match(migration, /protected_physical_shipment/);
assert.match(migration, /legacy_final_adjusted/);
const editSyncStart = migration.indexOf('create or replace function public.fn_sync_warehouse_after_finance_edit');
const editSyncEnd = migration.indexOf('grant execute on function public.fn_sync_warehouse_after_finance_edit', editSyncStart);
const editSyncSql = migration.slice(editSyncStart, editSyncEnd);
assert.doesNotMatch(editSyncSql, /set\s+status\s*=\s*'cancelled'/i, 'finance edit must never cancel a warehouse document');
const voidStart = migration.indexOf('create or replace function public.fn_void_finance_document');
const voidEnd = migration.indexOf('grant execute on function public.fn_void_finance_document', voidStart);
const voidSql = migration.slice(voidStart, voidEnd);
assert.match(voidSql, /cancelled_after_finance_void/);
assert.match(voidSql, /status\s*=\s*'cancelled'/i, 'legacy warehouse cancellation belongs only to real finance void');

const financeApi = read('src/lib/financeApi.js');
assert.match(financeApi, /fn_update_confirmed_finance_document/);
assert.match(financeApi, /if \(syncLinkedDocuments\)/);

const orderHook = read('src/hooks/useOrdersData.js');
assert.equal((orderHook.match(/\.order\('line_no'/g) || []).length, 3);
assert.match(orderHook, /v_customer_credit_control/);
assert.match(orderHook, /order_revision_snapshots/);

const orderUi = read('src/modules/orders/OrdersModule.jsx');
assert.match(orderUi, /ویرایش Stage-safe/);
assert.match(orderUi, /دلیل ویرایش \(الزامی\)/);
assert.match(orderUi, /ثبت نسخه جدید و همگام‌سازی/);
assert.match(orderUi, /نسخه‌های ویرایش سفارش/);
assert.match(orderUi, /کنترل اعتبار فروش/);
assert.match(orderUi, /disabled=\{isEdit\}/);

const orderApi = read('src/lib/orderApi.js');
assert.match(orderApi, /fn_update_order_stage_safe/);
assert.match(orderApi, /fn_app_create_order_idempotent/);
assert.match(orderApi, /p_expected_revision/);

const accountingUi = read('src/modules/accounting/AccountingModule.jsx');
assert.match(accountingUi, /دارایی از قبل موجود/);
assert.match(accountingUi, /فروش فقط به‌صورت کامل/);
assert.match(accountingUi, /فاکتور خرید تاریخی نیازمند تطبیق انبار/);
assert.match(accountingUi, /احتمال رسید دستی/);

const financeApiNew = read('src/lib/financeApi.js');
assert.match(financeApiNew, /fn_purchase_finance_investment/);
assert.match(financeApiNew, /fn_sell_finance_investment_full/);
assert.match(financeApiNew, /fn_sync_purchase_invoice_inventory/);

const backupUi = read('src/modules/backup/BackupCenter.jsx');
assert.match(backupUi, /انتخاب پوشه و بکاپ کامل/);
assert.match(backupUi, /هیچ آرشیو دائمی روی سرور/);
assert.match(backupUi, /بکاپ ایمنی محلی و اجرای بازیابی/);
assert.match(backupUi, /localMaxVersions/);
const backupService = read('netlify/backupService.js');
assert.match(backupService, /aes-256-gcm/);
assert.match(backupService, /replace_business/);
assert.match(backupService, /storageMode: 'local_only'/);
assert.match(backupService, /بکاپ کامل ساخته نشد/);
assert.doesNotMatch(backupService, /sha256|SHA-256/i, 'SHA-256 must not be generated unless explicitly requested');
const netlifyConfig = read('netlify.toml');
assert.doesNotMatch(netlifyConfig, /scheduled-system-backup/);
assert.match(netlifyConfig, /scheduled-backup-cleanup/);

console.log('UI_WORKFLOW_REGRESSIONS_OK');
