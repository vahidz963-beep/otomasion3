import assert from 'node:assert/strict';
import { calculateWarehouseValuation } from '../src/lib/inventoryValuation.js';

const valuation = calculateWarehouseValuation([
  { item_id: 'priced', current_qty: 10, current_cost_rial: 100, current_sale_rial: 150 },
  { item_id: 'missing-cost', current_qty: 5, current_cost_rial: null, unit_price_estimate: null, effective_sale_price: 200 },
  { item_id: 'negative', current_qty: -2, unit_price_estimate: 50, effective_sale_price: null },
  { item_id: 'zero-stock', current_qty: 0, current_cost_rial: null, effective_sale_price: null },
], 100);

assert.equal(valuation.totalCostRial, 900, 'cost valuation must preserve the sign of negative stock');
assert.equal(valuation.totalCostToman, 90);
assert.equal(valuation.totalCostUsd, 9);
assert.equal(valuation.totalSaleRial, 2500);
assert.equal(valuation.totalSaleToman, 250);
assert.equal(valuation.totalSaleUsd, 25);
assert.equal(valuation.pricedItemCount, 2);
assert.equal(valuation.unpricedItemCount, 1, 'non-zero stock without cost must be disclosed');
assert.equal(valuation.salePricedItemCount, 2);
assert.equal(valuation.unpricedSaleItemCount, 1, 'non-zero stock without sale price must be disclosed');
assert.equal(valuation.negativeStockCount, 1);
assert.equal(valuation.usdRial, 100);
assert.equal(valuation.usdToman, 10);

const noRate = calculateWarehouseValuation([{ current_qty: 2, current_cost_rial: 500, current_sale_rial: 750 }], 0);
assert.equal(noRate.totalCostRial, 1000);
assert.equal(noRate.totalCostUsd, null, 'missing USD rate must never produce a misleading zero/Infinity value');
assert.equal(noRate.totalSaleUsd, null);
assert.equal(noRate.usdToman, 0);

const invalid = calculateWarehouseValuation(null, 'not-a-number');
assert.deepEqual(invalid, {
  totalCostRial: 0,
  totalCostToman: 0,
  totalCostUsd: null,
  totalSaleRial: 0,
  totalSaleToman: 0,
  totalSaleUsd: null,
  pricedItemCount: 0,
  unpricedItemCount: 0,
  salePricedItemCount: 0,
  unpricedSaleItemCount: 0,
  negativeStockCount: 0,
  usdRial: 0,
  usdToman: 0,
});

console.log('INVENTORY_VALUATION_TEST_OK');
