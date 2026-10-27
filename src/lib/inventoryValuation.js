function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

export function calculateWarehouseValuation(stock = [], usdRial = 0) {
  let totalCostRial = 0;
  let totalSaleRial = 0;
  let pricedItemCount = 0;
  let unpricedItemCount = 0;
  let salePricedItemCount = 0;
  let unpricedSaleItemCount = 0;
  let negativeStockCount = 0;

  for (const item of Array.isArray(stock) ? stock : []) {
    const quantity = finiteNumber(item?.current_qty);
    const costRial = Math.max(0, firstFinite(item?.current_cost_rial, item?.unit_price_estimate));
    const saleRial = Math.max(0, firstFinite(
      item?.current_sale_rial,
      item?.effective_sale_price,
      item?.unit_sale_price_estimate,
    ));

    totalCostRial += quantity * costRial;
    totalSaleRial += quantity * saleRial;
    if (quantity < 0) negativeStockCount += 1;
    if (quantity !== 0) {
      if (costRial > 0) pricedItemCount += 1;
      else unpricedItemCount += 1;
      if (saleRial > 0) salePricedItemCount += 1;
      else unpricedSaleItemCount += 1;
    }
  }

  const normalizedUsdRial = Math.max(0, finiteNumber(usdRial));
  return {
    totalCostRial,
    totalCostToman: totalCostRial / 10,
    totalCostUsd: normalizedUsdRial > 0 ? totalCostRial / normalizedUsdRial : null,
    totalSaleRial,
    totalSaleToman: totalSaleRial / 10,
    totalSaleUsd: normalizedUsdRial > 0 ? totalSaleRial / normalizedUsdRial : null,
    pricedItemCount,
    unpricedItemCount,
    salePricedItemCount,
    unpricedSaleItemCount,
    negativeStockCount,
    usdRial: normalizedUsdRial,
    usdToman: normalizedUsdRial > 0 ? normalizedUsdRial / 10 : 0,
  };
}
