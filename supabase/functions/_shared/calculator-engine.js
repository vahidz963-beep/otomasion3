export const CALCULATOR_ENGINE_VERSION = 'calculator-engine-1.0.0';

const COLORS = ['#3976e8', '#0b9c91', '#9c5bd6', '#ef8b3c', '#d84e68', '#4c9e52', '#4c7c9e', '#a66b32', '#a44a9b', '#227da3', '#7d6d39', '#b24343'];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((finite(value) + Number.EPSILON) * factor) / factor;
}

function roundTo(value, step = 1) {
  const safeStep = Math.max(1, finite(step, 1));
  return Math.round(finite(value) / safeStep) * safeStep;
}

function asId(value) {
  return value === null || value === undefined ? '' : String(value);
}

function pushError(errors, code, message, line = null) {
  errors.push({ code, message, ...(line === null ? {} : { line }) });
}

export function parsePins(value) {
  if (typeof value === 'object' && value) {
    const left = Math.trunc(finite(value.left ?? value.pins_left));
    const right = Math.trunc(finite(value.right ?? value.pins_right));
    return left > 0 && right > 0 ? { left, right, total: left + right } : null;
  }
  const match = /^\s*(\d+)\s*\+\s*(\d+)\s*$/.exec(String(value || ''));
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[2]);
  return left > 0 && right > 0 ? { left, right, total: left + right } : null;
}

export function calculateTransformerGeometry({ core, bobbin, wires = [], windings = [], settings = {}, orderType = 'sample', quantity = 1 } = {}) {
  const errors = [];
  const warnings = [];
  const safeQuantity = Math.max(1, Math.trunc(finite(quantity, 1)));
  const minimumProduction = Math.max(1, Math.trunc(finite(settings.minimum_production_quantity, 100)));
  const maximumSample = Math.max(1, Math.trunc(finite(settings.maximum_sample_quantity, 99)));
  const packingFactor = Math.max(0.05, finite(settings.packing_factor, 0.35));
  const insulationMm = positive(settings.inter_winding_insulation_mm ?? settings.interlayer_insulation_mm, 0.05);
  const density = positive(settings.copper_density_g_cm3, 8.96);

  if (!core) pushError(errors, 'CORE_REQUIRED', 'هسته انتخاب نشده است.');
  if (!bobbin) pushError(errors, 'BOBBIN_REQUIRED', 'بوبین سازگار انتخاب نشده است.');
  if (!windings.length) pushError(errors, 'WINDING_REQUIRED', 'حداقل یک سیم‌پیچ لازم است.');
  if (windings.length > 12) pushError(errors, 'WINDING_LIMIT', 'حداکثر ۱۲ سیم‌پیچ مجاز است.');
  if (orderType === 'production' && safeQuantity < minimumProduction) pushError(errors, 'MIN_PRODUCTION_QUANTITY', `حداقل سفارش تولید ${minimumProduction} عدد است.`);
  if (orderType === 'sample' && safeQuantity > maximumSample) pushError(errors, 'MAX_SAMPLE_QUANTITY', `سفارش نمونه حداکثر ${maximumSample} عدد است.`);
  if (!core || !bobbin) return { valid: false, errors, warnings, rows: [], quantity: safeQuantity, orderType };
  if (asId(bobbin.core_id) && asId(core.id) && asId(bobbin.core_id) !== asId(core.id)) pushError(errors, 'CORE_BOBBIN_MISMATCH', 'بوبین با هسته انتخاب‌شده سازگار نیست.');

  const widthMm = positive(bobbin.window_width_mm);
  const heightMm = positive(bobbin.window_height_mm);
  const baseMltMm = positive(bobbin.mean_turn_length_mm);
  if (!widthMm || !heightMm || !baseMltMm) pushError(errors, 'BOBBIN_GEOMETRY_INCOMPLETE', 'BW، HW و MLT واقعی بوبین باید کامل باشند.');

  const pinData = parsePins({ left: bobbin.pins_left, right: bobbin.pins_right });
  if (!pinData || pinData.left > 30 || pinData.right > 30) pushError(errors, 'BOBBIN_PINS_INVALID', 'تعداد پایه‌های بوبین معتبر نیست.');

  const wireMap = new Map(wires.map((wire) => [asId(wire.id), wire]));
  const results = [];
  const usageByWire = new Map();
  let cumulativeBuildMm = 0;
  let totalCopperAreaMm2 = 0;
  let totalInsulationAreaMm2 = 0;
  let totalLengthM = 0;
  let totalWeightKg = 0;
  let totalTurns = 0;

  windings.forEach((source, index) => {
    const line = index + 1;
    const wire = wireMap.get(asId(source.wire_id ?? source.wireId));
    const turns = Math.trunc(finite(source.turns));
    const strands = Math.max(1, Math.trunc(finite(source.strands, 1)));
    const arrangement = source.arrangement === 'bundle' ? 'bundle' : 'side';
    const layerMode = source.layer_mode === 'manual' || source.layerMode === 'manual' ? 'manual' : 'auto';
    const startPin = Math.trunc(finite(source.start_pin ?? source.startPin));
    const endPin = Math.trunc(finite(source.end_pin ?? source.endPin));

    if (!wire) {
      pushError(errors, 'WIRE_INVALID', `سیم ردیف ${line} معتبر نیست.`, line);
      return;
    }
    if (turns < 1) pushError(errors, 'TURNS_INVALID', `تعداد دور ردیف ${line} باید بیشتر از صفر باشد.`, line);
    if (strands > 20) pushError(errors, 'STRANDS_LIMIT', `تعداد رشته ردیف ${line} حداکثر ۲۰ است.`, line);
    if (!pinData || startPin < 1 || endPin < 1 || startPin > (pinData?.total || 0) || endPin > (pinData?.total || 0) || startPin === endPin) {
      pushError(errors, 'PINS_INVALID', `پایه‌های شروع و پایان ردیف ${line} معتبر نیستند.`, line);
    }

    const diameterMm = positive(wire.diameter_mm);
    if (!diameterMm) {
      pushError(errors, 'WIRE_DIAMETER_INVALID', `قطر سیم ردیف ${line} معتبر نیست.`, line);
      return;
    }
    const bundleDiameterMm = arrangement === 'bundle' ? diameterMm * Math.sqrt(strands) * 1.12 : diameterMm;
    const bundleWidthMm = arrangement === 'side' ? diameterMm * strands : bundleDiameterMm;
    const bundleHeightMm = bundleDiameterMm;
    const turnsPerLayer = Math.max(1, Math.floor(widthMm / bundleWidthMm));
    const automaticLayers = Math.max(1, Math.ceil(Math.max(0, turns) / turnsPerLayer));
    const requestedLayers = Math.max(1, Math.trunc(finite(source.requested_layers ?? source.layers, 1)));
    const calculatedLayers = layerMode === 'manual' ? requestedLayers : automaticLayers;
    if (layerMode === 'manual' && calculatedLayers < automaticLayers) {
      pushError(errors, 'LAYERS_INSUFFICIENT', `ردیف ${line}: ${calculatedLayers} لایه کافی نیست؛ حداقل ${automaticLayers} لایه لازم است.`, line);
    }

    // Diameter already includes enamel. A fixed insulation thickness is applied
    // between physical layers and once between adjacent windings.
    const separatorBeforeMm = index > 0 ? insulationMm : 0;
    const physicalLayerInsulationMm = Math.max(0, calculatedLayers - 1) * insulationMm;
    const windingBuildMm = calculatedLayers * bundleHeightMm + physicalLayerInsulationMm;
    const allocatedBuildMm = separatorBeforeMm + windingBuildMm;
    let remaining = Math.max(0, turns);
    let lengthM = 0;
    for (let layer = 0; layer < calculatedLayers && remaining > 0; layer += 1) {
      const layerTurns = Math.min(remaining, turnsPerLayer);
      const radialCenterMm = cumulativeBuildMm + separatorBeforeMm + layer * (bundleHeightMm + insulationMm) + bundleHeightMm / 2;
      const adjustedMltMm = baseMltMm + 2 * Math.PI * radialCenterMm;
      lengthM += (layerTurns * adjustedMltMm * strands) / 1000;
      remaining -= layerTurns;
    }
    const copperAreaMm2 = Math.PI * diameterMm ** 2 / 4;
    const weightKg = copperAreaMm2 * lengthM * density / 1000;
    const copperOccupiedAreaMm2 = Math.max(0, turns) * strands * copperAreaMm2;
    const insulationAreaMm2 = widthMm * (separatorBeforeMm + physicalLayerInsulationMm);
    cumulativeBuildMm += allocatedBuildMm;
    totalCopperAreaMm2 += copperOccupiedAreaMm2;
    totalInsulationAreaMm2 += insulationAreaMm2;
    totalLengthM += lengthM;
    totalWeightKg += weightKg;
    totalTurns += Math.max(0, turns);
    const wireId = asId(wire.id);
    usageByWire.set(wireId, (usageByWire.get(wireId) || 0) + weightKg * safeQuantity);

    results.push({
      line_no: line,
      name: String(source.name || `سیم‌پیچ ${line}`),
      start_pin: startPin,
      end_pin: endPin,
      turns,
      wire_id: wireId,
      wire_diameter_mm: diameterMm,
      awg: wire.awg ?? null,
      strands,
      arrangement,
      layer_mode: layerMode,
      requested_layers: layerMode === 'manual' ? requestedLayers : null,
      calculated_layers: calculatedLayers,
      direction: source.direction === 'ccw' ? 'ccw' : 'cw',
      bundle_width_mm: round(bundleWidthMm),
      bundle_height_mm: round(bundleHeightMm),
      turns_per_layer: turnsPerLayer,
      separator_before_mm: round(separatorBeforeMm),
      build_mm: round(windingBuildMm),
      allocated_build_mm: round(allocatedBuildMm),
      length_m: round(lengthM),
      weight_kg: round(weightKg, 9),
      window_share_percent: heightMm > 0 ? round(allocatedBuildMm / heightMm * 100, 4) : 0,
      color: COLORS[index % COLORS.length],
    });
  });

  const usableAreaMm2 = widthMm * heightMm * packingFactor;
  const areaPercent = usableAreaMm2 > 0 ? (totalCopperAreaMm2 + totalInsulationAreaMm2) / usableAreaMm2 * 100 : 0;
  const radialPercent = heightMm > 0 ? cumulativeBuildMm / heightMm * 100 : 0;
  const occupancyPercent = Math.max(areaPercent, radialPercent);
  if (occupancyPercent > 100) pushError(errors, 'WINDOW_OVERFLOW', 'ظرفیت پنجره کافی نیست؛ بوبین بزرگ‌تر یا اصلاح سیم‌پیچ لازم است.');
  else if (occupancyPercent >= 90) warnings.push({ code: 'WINDOW_HIGH', message: 'اشغال پنجره بین ۹۰ تا ۱۰۰ درصد است و کنترل کارگاه لازم است.' });

  const wireUsage = [...usageByWire.entries()].map(([wireId, requiredKg]) => {
    const wire = wireMap.get(wireId);
    const availableKg = positive(wire?.available_qty ?? wire?.current_qty);
    if (wire?.warehouse_item_id && requiredKg > availableKg) warnings.push({ code: 'WIRE_STOCK_LOW', message: `موجودی سیم Ø${wire.diameter_mm} کافی نیست.`, wire_id: wireId });
    return {
      wire_id: wireId,
      warehouse_item_id: wire?.warehouse_item_id || null,
      diameter_mm: positive(wire?.diameter_mm),
      required_kg: round(requiredKg, 9),
      available_kg: round(availableKg, 9),
      sufficient: availableKg >= requiredKg,
    };
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    orderType,
    quantity: safeQuantity,
    rows: results,
    total_turns: totalTurns,
    total_length_m: round(totalLengthM),
    copper_weight_per_unit_kg: round(totalWeightKg, 9),
    total_build_mm: round(cumulativeBuildMm),
    usable_area_mm2: round(usableAreaMm2),
    area_percent: round(areaPercent, 4),
    radial_percent: round(radialPercent, 4),
    occupancy_percent: round(occupancyPercent, 4),
    insulation_mm: round(insulationMm),
    packing_factor: round(packingFactor),
    wire_usage: wireUsage,
  };
}

function requireMappedAndPriced(component, label, errors) {
  if (!component?.warehouse_item_id) pushError(errors, `${label.toUpperCase()}_WAREHOUSE_UNMAPPED`, `${label === 'core' ? 'هسته' : 'بوبین'} به قلم انبار متصل نشده است.`);
  if (positive(component?.current_cost_rial) <= 0) pushError(errors, `${label.toUpperCase()}_PRICE_MISSING`, `بهای روز ${label === 'core' ? 'هسته' : 'بوبین'} در انبار ثبت نشده است.`);
}

export function calculateTransformerQuote(input = {}) {
  const geometry = calculateTransformerGeometry(input);
  const { core, bobbin, wires = [], settings = {}, orderType = 'sample' } = input;
  const errors = [...geometry.errors];
  requireMappedAndPriced(core, 'core', errors);
  requireMappedAndPriced(bobbin, 'bobbin', errors);
  const wireMap = new Map(wires.map((wire) => [asId(wire.id), wire]));

  geometry.wire_usage.forEach((usage) => {
    const wire = wireMap.get(usage.wire_id);
    if (!wire?.warehouse_item_id) pushError(errors, 'WIRE_WAREHOUSE_UNMAPPED', `سیم Ø${wire?.diameter_mm ?? '—'} به قلم انبار متصل نشده است.`);
    if (positive(wire?.current_cost_rial) <= 0) pushError(errors, 'WIRE_PRICE_MISSING', `بهای روز سیم Ø${wire?.diameter_mm ?? '—'} در انبار ثبت نشده است.`);
  });

  const coreCostRial = positive(core?.current_cost_rial);
  const bobbinCostRial = positive(bobbin?.current_cost_rial);
  const wireCostRial = geometry.wire_usage.reduce((sum, usage) => sum + usage.required_kg / geometry.quantity * positive(wireMap.get(usage.wire_id)?.current_cost_rial), 0);
  const speed = Math.max(1, positive(settings.winding_speed_turns_per_minute, 120));
  const setupMinutes = positive(settings.setup_minutes_per_winding);
  const windingMinutes = geometry.total_turns / speed + geometry.rows.length * setupMinutes;
  const assemblyMinutes = positive(core?.assembly_time_seconds) / 60;
  const laborMinutes = windingMinutes + assemblyMinutes;
  const laborCostRial = laborMinutes / 60 * positive(settings.labor_hour_rial);
  const operationCostRial = ['solder_cost_rial', 'varnish_cost_rial', 'test_cost_rial', 'packaging_cost_rial', ...(input.hasGap ? ['gap_cost_rial'] : [])]
    .reduce((sum, key) => sum + positive(settings[key]), 0);
  const directCostRial = coreCostRial + bobbinCostRial + wireCostRial + laborCostRial + operationCostRial;
  const overheadPercent = positive(settings.overhead_percent);
  const overheadCostRial = directCostRial * overheadPercent / 100;
  const totalCostRial = directCostRial + overheadCostRial;
  const profitPercent = positive(settings.profit_percent, 30);
  const rounding = Math.max(1, positive(settings.price_rounding_rial, 10000));
  const regularUnitSaleRial = roundTo(totalCostRial * (1 + profitPercent / 100), rounding);
  const sampleMultiplier = Math.max(1, positive(settings.sample_multiplier, 2));
  const unitSaleRial = orderType === 'sample' ? roundTo(regularUnitSaleRial * sampleMultiplier, rounding) : regularUnitSaleRial;
  const setupFeeRial = orderType === 'sample' ? positive(settings.sample_setup_rial) : 0;
  const totalSaleRial = unitSaleRial * geometry.quantity + setupFeeRial;

  const requirements = [];
  if (core?.warehouse_item_id) requirements.push({ component_role: 'core', warehouse_item_id: core.warehouse_item_id, quantity_per_unit: 1, quantity_total: geometry.quantity, unit: core.unit || 'عدد' });
  if (bobbin?.warehouse_item_id) requirements.push({ component_role: 'bobbin', warehouse_item_id: bobbin.warehouse_item_id, quantity_per_unit: 1, quantity_total: geometry.quantity, unit: bobbin.unit || 'عدد' });
  geometry.wire_usage.forEach((usage) => {
    if (usage.warehouse_item_id) requirements.push({ component_role: 'wire', warehouse_item_id: usage.warehouse_item_id, quantity_per_unit: round(usage.required_kg / geometry.quantity, 9), quantity_total: usage.required_kg, unit: 'کیلوگرم' });
  });

  const availability = requirements.map((requirement) => {
    let available = 0;
    if (requirement.component_role === 'core') available = positive(core?.available_qty);
    else if (requirement.component_role === 'bobbin') available = positive(bobbin?.available_qty);
    else available = positive([...wireMap.values()].find((wire) => asId(wire.warehouse_item_id) === asId(requirement.warehouse_item_id))?.available_qty);
    return { ...requirement, available_qty: round(available, 9), sufficient: available >= requirement.quantity_total };
  });
  availability.filter((row) => !row.sufficient).forEach((row) => errors.push({ code: 'STOCK_INSUFFICIENT', message: `موجودی ${row.component_role === 'core' ? 'هسته' : row.component_role === 'bobbin' ? 'بوبین' : 'سیم'} برای این تعداد کافی نیست.` }));

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    warnings: geometry.warnings,
    engineering: geometry,
    pricing: {
      currency: 'IRR',
      core_cost_rial: round(coreCostRial),
      bobbin_cost_rial: round(bobbinCostRial),
      wire_cost_rial: round(wireCostRial),
      labor_minutes: round(laborMinutes),
      labor_cost_rial: round(laborCostRial),
      operation_cost_rial: round(operationCostRial),
      direct_cost_rial: round(directCostRial),
      overhead_percent: round(overheadPercent),
      overhead_cost_rial: round(overheadCostRial),
      total_cost_rial: round(totalCostRial),
      profit_percent: round(profitPercent),
      regular_unit_sale_rial: round(regularUnitSaleRial),
      sample_multiplier: round(sampleMultiplier),
      unit_sale_rial: round(unitSaleRial),
      setup_fee_rial: round(setupFeeRial),
      total_sale_rial: round(totalSaleRial),
    },
    publicResult: {
      currency: 'IRR',
      status: valid ? 'quotable' : 'needs_review',
      order_type: orderType,
      quantity: geometry.quantity,
      unit_sale_rial: valid ? round(unitSaleRial) : null,
      setup_fee_rial: orderType === 'sample' && valid ? round(setupFeeRial) : 0,
      total_sale_rial: valid ? round(totalSaleRial) : null,
      window_occupancy_percent: round(geometry.occupancy_percent, 1),
      build_status: geometry.occupancy_percent > 100 ? 'invalid' : geometry.occupancy_percent >= 90 ? 'workshop_review' : 'valid',
      availability: availability.map(({ component_role, sufficient }) => ({ component_role, status: sufficient ? 'available' : 'unavailable' })),
    },
    requirements,
    inventorySnapshot: availability,
  };
}

export function calculateBoardEstimate(model = {}, settings = {}) {
  const lines = [];
  const base = positive(settings.base_design_rial, 300000000);
  lines.push({ key: 'base', label: 'قیمت پایه طراحی', amount_rial: base });
  let total = base;
  const width = Math.max(1, positive(model.width_mm, 100));
  const height = Math.max(1, positive(model.height_mm, 80));
  const areaCm2 = width * height / 100;
  const areaCost = areaCm2 <= 50 ? 0 : areaCm2 <= 100 ? 30000000 : areaCm2 <= 200 ? 70000000 : 120000000;
  if (areaCost) { lines.push({ key: 'area', label: `اندازه برد (${round(areaCm2, 1)} cm²)`, amount_rial: areaCost }); total += areaCost; }
  const power = Math.max(1, positive(model.power_w, 100));
  const powerCost = power <= 100 ? 0 : power <= 300 ? 50000000 : power <= 700 ? 100000000 : 180000000;
  if (powerCost) { lines.push({ key: 'power', label: `توان ${power} وات`, amount_rial: powerCost }); total += powerCost; }
  const complexityCosts = { basic: 0, medium: 80000000, advanced: 180000000 };
  const complexityCost = complexityCosts[model.complexity] || 0;
  if (complexityCost) { lines.push({ key: 'complexity', label: 'پیچیدگی طراحی', amount_rial: complexityCost }); total += complexityCost; }
  const featureCosts = { isolation: 30000000, pfc: 70000000, digital: 80000000, communication: 50000000, protection: 40000000, emi: 50000000, thermal: 40000000 };
  [...new Set(Array.isArray(model.features) ? model.features : [])].forEach((feature) => { const amount = featureCosts[feature] || 0; if (amount) { lines.push({ key: feature, label: feature, amount_rial: amount }); total += amount; } });
  return { valid: true, engine_version: CALCULATOR_ENGINE_VERSION, area_cm2: round(areaCm2, 2), lines, total_rial: total };
}
