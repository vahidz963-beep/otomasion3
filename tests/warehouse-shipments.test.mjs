import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeShipmentStatus,
  shipmentLineText,
  shipmentLines,
  shipmentSearchText,
  shipmentSourceLabel,
  shipmentStats,
  shipmentStatusLabel,
} from '../src/lib/shipmentModel.js';

const structured = {
  id: 'shipment-1',
  shipment_number: 'SHP-1405-00001',
  source_type: 'production',
  order_sales_path: 'production',
  related_order_id: 'order-1',
  order_code: 'ORD-1001',
  customer_name: 'مشتری نمونه',
  status: 'sent',
  line_items: [
    { id: 'line-1', line_no: 1, item_code: 'TR-01', item_name: 'ترانس نمونه', quantity: 25, unit: 'عدد' },
    { id: 'line-2', line_no: 2, item_code: 'PCB-02', item_name: 'برد کنترل', quantity: 10, unit: 'عدد' },
  ],
};
const manual = { id: 'shipment-2', source_type: 'manual', is_manual_record: true, status: 'ready', item_summary: 'ارسال نمونه متنی' };
const cancelled = { id: 'shipment-3', source_type: 'trading', related_order_id: 'order-2', status: 'cancelled', line_items: '[]' };

assert.equal(normalizeShipmentStatus('pending_warehouse'), 'ready');
assert.equal(normalizeShipmentStatus('returned'), 'cancelled');
assert.equal(shipmentStatusLabel('sent'), 'ارسال‌شده');
assert.equal(shipmentSourceLabel(structured), 'سفارش تولیدی');
assert.equal(shipmentSourceLabel(manual), 'ثبت دستی متنی');
assert.equal(shipmentLines(structured).length, 2);
assert.equal(shipmentLines({ line_items: JSON.stringify(structured.line_items) }).length, 2);
assert.match(shipmentLineText(structured), /ترانس نمونه.*۲۵.*عدد/u);
assert.match(shipmentLineText(structured), /برد کنترل.*۱۰.*عدد/u);
assert.match(shipmentSearchText(structured), /ord-1001/u);
assert.match(shipmentSearchText(structured), /tr-01/u);
assert.deepEqual(shipmentStats([structured, manual, cancelled]), { total: 3, sent: 1, ready: 1, cancelled: 1, manual: 1 });

const migration = await readFile(new URL('../supabase/migrations/126_order_driven_partial_shipments.sql', import.meta.url), 'utf8');
const ordersUi = await readFile(new URL('../src/modules/orders/OrdersModule.jsx', import.meta.url), 'utf8');
const warehouseUi = await readFile(new URL('../src/modules/warehouse/WarehouseModule.jsx', import.meta.url), 'utf8');
const financeApi = await readFile(new URL('../src/lib/financeApi.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

for (const trigger of [
  'trg_warehouse_shipment_sync',
  'trg_warehouse_order_final_shipment',
  'trg_warehouse_production_final_shipment',
  'trg_warehouse_rnd_final_shipment',
  'trg_finance_issue_inventory_on_approval',
  'trg_finance_inventory_issue_after_approval',
]) {
  assert.match(migration, new RegExp(`drop trigger if exists ${trigger}`, 'u'), `legacy trigger ${trigger} must be disabled`);
}
for (const functionName of [
  'fn_dispatch_order_shipment',
  'fn_reverse_order_shipment',
  'fn_sync_order_inventory_reservations',
  'fn_sync_order_reservation_for_finance_document',
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${functionName}`, 'u'), `${functionName} must exist`);
}
assert.match(migration, /insert into public\.warehouse_transactions/u);
assert.match(migration, /insert into public\.warehouse_document_lines/u);
assert.match(migration, /insert into public\.warehouse_shipment_lines/u);
assert.match(migration, /status = 'consumed'/u);
assert.doesNotMatch(migration, /delete\s+from\s+public\.warehouse_shipments/iu, 'migration must never physically delete shipment history');

const overviewStart = migration.indexOf('create view public.v_warehouse_shipment_overview');
const progressStart = migration.indexOf('create view public.v_order_shipment_item_progress');
const overviewSql = migration.slice(overviewStart, progressStart);
assert.ok(overviewStart > 0 && progressStart > overviewStart, 'shipment overview view must be present');
assert.doesNotMatch(overviewSql, /select\s+distinct\s+on/iu, 'overview must expose each real shipment, not one row per order');
assert.match(overviewSql, /line_items/u);

assert.doesNotMatch(ordersUi, /ارسال شده و خروج از انبار/u, 'the local shipment checkbox must be removed');
assert.doesNotMatch(ordersUi, /toggleOrderShipment/u);
assert.match(ordersUi, /ثبت قطعی و خروج از انبار/u);
assert.match(ordersUi, /remaining_quantity/u);
assert.match(warehouseUi, /ثبت دستی مستقل از موجودی/u);
assert.match(warehouseUi, /اقلام دقیق ارسال‌شده/u);
assert.doesNotMatch(financeApi, /fn_finance_issue_inventory_for_document/u, 'frontend invoice approval must never call stock issue');
assert.match(financeApi, /fn_sync_order_reservation_for_finance_document/u);
assert.equal(packageJson.version, '135.0.0');

console.log('warehouse shipment model + migration/UI contracts: OK');
