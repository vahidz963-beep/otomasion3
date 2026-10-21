import { calculateTransformerQuote } from '../supabase/functions/_shared/calculator-engine.js';
import { buildWindowFillSvg, buildPinDiagramSvg } from '../src/modules/calculator/calculatorVisuals.js';

export function buildReportFixture() {
  const core = { id: 'core-ee25', model_code: 'EE25/10/5', family: 'EE', material: 'Pc44', effective_area_mm2: 40, center_leg_mm: 5.2, weight_g: 18, assembly_time_seconds: 50, assembly_method: 'گیره و چسب', warehouse_item_id: 'wh-core', warehouse_code: 'CORE-EE25', unit: 'عدد', current_cost_rial: 180000, available_qty: 240 };
  const bobbin = { id: 'bobbin-ee25', core_id: core.id, pins_left: 5, pins_right: 5, mount_orientation: 'عمودی', window_width_mm: 11, window_height_mm: 5.2, mean_turn_length_mm: 32, weight_g: 4.5, warehouse_item_id: 'wh-bobbin', warehouse_code: 'BOB-EE25-V', unit: 'عدد', current_cost_rial: 95000, available_qty: 180 };
  const wires = [
    { id: 'w025', diameter_mm: 0.25, awg: 30, warehouse_item_id: 'wh-w025', warehouse_code: 'WIRE-025', unit: 'گرم', current_cost_rial: 35000, available_qty: 12000 },
    { id: 'w04', diameter_mm: 0.4, awg: 26, warehouse_item_id: 'wh-w04', warehouse_code: 'WIRE-040', unit: 'گرم', current_cost_rial: 37000, available_qty: 8500 },
    { id: 'w02', diameter_mm: 0.2, awg: 32, warehouse_item_id: 'wh-w02', warehouse_code: 'WIRE-020', unit: 'گرم', current_cost_rial: 34000, available_qty: 15000 },
  ];
  const windings = [
    { name: 'اولیه ۱', start_pin: 1, end_pin: 2, turns: 50, wire_id: 'w025', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' },
    { name: 'ثانویه', start_pin: 2, end_pin: 5, turns: 40, wire_id: 'w025', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' },
    { name: 'اولیه ۲', start_pin: 6, end_pin: 10, turns: 15, wire_id: 'w04', strands: 2, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'ccw' },
    { name: 'کمکی', start_pin: 7, end_pin: 8, turns: 28, wire_id: 'w02', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' },
  ];
  const settings = { packing_factor: 0.35, inter_winding_insulation_mm: 0.05, copper_density_g_cm3: 8.96, minimum_production_quantity: 100, maximum_sample_quantity: 99, profit_percent: 30, sample_multiplier: 2, sample_setup_rial: 10000000, winding_speed_turns_per_minute: 120, setup_minutes_per_winding: 0.5, labor_hour_rial: 1800000, overhead_percent: 12, solder_cost_rial: 15000, varnish_cost_rial: 25000, test_cost_rial: 18000, packaging_cost_rial: 12000, gap_cost_rial: 0, price_rounding_rial: 10000, show_internal_pricing_breakdown: true };
  const result = calculateTransformerQuote({ core, bobbin, wires, windings, settings, orderType: 'sample', quantity: 30, hasGap: false });
  return {
    kind: 'customer', code: 'CALC-DEMO-133', confirmed: true,
    customerName: 'شرکت نمونه آریا', customerPhone: '09120000000', projectTitle: 'ترانس منبع تغذیه سوئیچینگ',
    orderType: 'sample', quantity: 30, hasGap: false, core, bobbin,
    engineering: result.engineering, publicResult: result.publicResult, inventory: result.inventorySnapshot,
    pricing: result.pricing, formulaVersion: 'TR-0.1.0-R133',
    fontBaseUrl: new URL('../public/assets/fonts/vazirmatn/', import.meta.url).href,
    fillSvg: buildWindowFillSvg(bobbin, result.engineering), pinSvg: buildPinDiagramSvg(bobbin, result.engineering),
  };
}
