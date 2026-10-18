import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTransformerGeometry, calculateTransformerQuote, CALCULATOR_ENGINE_VERSION } from '../supabase/functions/_shared/calculator-engine.js';
import { buildPinDiagramSvg, buildWindowFillSvg, countWindingBands } from '../src/modules/calculator/calculatorVisuals.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = { id: 'core-1', model_code: 'EE25/10/5', warehouse_item_id: 'wh-core', current_cost_rial: 120000, current_sale_rial: 160000, current_qty: 1000, available_qty: 1000, unit: 'عدد', assembly_time_seconds: 45 };
const bobbin = { id: 'bobbin-1', core_id: 'core-1', pins_left: 5, pins_right: 5, mount_orientation: 'افقی', window_width_mm: 11, window_height_mm: 5.2, mean_turn_length_mm: 32, warehouse_item_id: 'wh-bobbin', current_cost_rial: 50000, current_sale_rial: 70000, current_qty: 1000, available_qty: 1000, unit: 'عدد' };
const wires = [
  { id: 'wire-03', diameter_mm: 0.3, awg: 28, warehouse_item_id: 'wh-wire-03', current_cost_rial: 35000, current_qty: 100000, available_qty: 100000, unit: 'گرم' },
  { id: 'wire-05', diameter_mm: 0.5, awg: 24, warehouse_item_id: 'wh-wire-05', current_cost_rial: 35000, current_qty: 100000, available_qty: 100000, unit: 'گرم' },
];
const windings = [
  { name: 'اولیه', start_pin: 1, end_pin: 2, turns: 100, wire_id: 'wire-03', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' },
  { name: 'ثانویه', start_pin: 3, end_pin: 4, turns: 20, wire_id: 'wire-05', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'ccw' },
];
const settings = {
  packing_factor: 0.35,
  inter_winding_insulation_mm: 0.05,
  profit_percent: 30,
  sample_multiplier: 2,
  sample_setup_rial: 5000000,
  winding_speed_turns_per_minute: 120,
  setup_minutes_per_winding: 0,
  labor_hour_rial: 0,
  overhead_percent: 0,
  solder_cost_rial: 0,
  varnish_cost_rial: 0,
  test_cost_rial: 0,
  packaging_cost_rial: 0,
  gap_cost_rial: 0,
  copper_density_g_cm3: 8.96,
  minimum_production_quantity: 100,
  maximum_sample_quantity: 99,
  price_rounding_rial: 10000,
};

assert.equal(CALCULATOR_ENGINE_VERSION, 'calculator-engine-1.1.0');
const geometry = calculateTransformerGeometry({ core, bobbin, wires, windings, settings, orderType: 'sample', quantity: 1 });
assert.equal(geometry.rows.length, windings.length, 'one engineering row per winding');
assert.ok(geometry.rows.every((row) => row.calculated_layers >= 1));
assert.ok(geometry.rows.every((row) => row.window_share_percent > 0));
assert.ok(geometry.rows.every((row) => row.weight_g > 0));
assert.ok(geometry.copper_weight_per_unit_g > 0);
assert.ok(geometry.wire_usage.every((row) => row.required_g > 0 && row.available_g >= row.required_g));
assert.ok(geometry.area_percent > 0 && geometry.radial_percent > 0);
assert.equal(geometry.rows[1].separator_before_mm, 0.05, 'fixed thin inter-winding insulation');

const fillSvg = buildWindowFillSvg(bobbin, geometry);
assert.equal(countWindingBands(fillSvg), windings.length, 'image 1 must have exactly one colored band per winding');
assert.equal((fillSvg.match(/class="insulation-separator"/g) || []).length, windings.length - 1, 'one thin separator between winding bands');
const heights = [...fillSvg.matchAll(/class="winding-band"[^>]*height="([0-9.]+)"/g)].map((match) => Number(match[1]));
assert.equal(heights.length, windings.length);
const visualRatio = heights[0] / heights[1];
const shareRatio = geometry.rows[0].window_share_percent / geometry.rows[1].window_share_percent;
assert.ok(Math.abs(visualRatio - shareRatio) < 0.02, 'band height is proportional to winding window share');

const pinSvg = buildPinDiagramSvg(bobbin, geometry);
assert.match(pinSvg, /نمای بالا/);
assert.doesNotMatch(pinSvg, /From the bottom view|نمای پایین/);
assert.doesNotMatch(pinSvg, /Winding Specification/);

const sample = calculateTransformerQuote({ core, bobbin, wires, windings, settings, orderType: 'sample', quantity: 1 });
assert.equal(sample.valid, true);
assert.equal(sample.pricing.unit_sale_rial, sample.pricing.regular_unit_sale_rial * 2);
assert.equal(sample.pricing.setup_fee_rial, 5000000);
assert.equal(sample.requirements.find((row) => row.component_role === 'core').quantity_per_unit, 1);
assert.equal(sample.requirements.find((row) => row.component_role === 'bobbin').quantity_per_unit, 1);
assert.ok(sample.requirements.filter((row) => row.component_role === 'wire').every((row) => row.unit === 'گرم'), 'all wire inventory requirements use grams');
assert.ok(Math.abs(sample.requirements.filter((row) => row.component_role === 'wire').reduce((sum, row) => sum + row.quantity_per_unit, 0) - sample.engineering.copper_weight_per_unit_g) < 0.00001, 'wire requirement grams match engineering copper weight');
assert.equal(sample.requirements.some((row) => /terminal|lug/i.test(row.component_role)), false, 'terminal/lug is not in BOM');

const production = calculateTransformerQuote({ core, bobbin, wires, windings, settings, orderType: 'production', quantity: 100 });
assert.equal(production.valid, true);
assert.equal(production.pricing.unit_sale_rial, production.pricing.regular_unit_sale_rial);
assert.equal(production.pricing.setup_fee_rial, 0);
assert.equal(production.requirements.find((row) => row.component_role === 'core').quantity_total, 100);

const tooSmall = calculateTransformerGeometry({ core, bobbin, wires, windings, settings, orderType: 'production', quantity: 99 });
assert.ok(tooSmall.errors.some((error) => error.code === 'MIN_PRODUCTION_QUANTITY'));
const unmapped = calculateTransformerQuote({ core: { ...core, warehouse_item_id: null }, bobbin, wires, windings, settings, orderType: 'sample', quantity: 1 });
assert.ok(unmapped.errors.some((error) => error.code === 'CORE_WAREHOUSE_UNMAPPED'));
const wrongWireUnit = calculateTransformerQuote({ core, bobbin, wires: wires.map((wire) => ({ ...wire, unit: 'کیلوگرم' })), windings, settings, orderType: 'sample', quantity: 1 });
assert.ok(wrongWireUnit.errors.some((error) => error.code === 'WIRE_UNIT_INVALID'), 'wire inventory unit must be grams');

const migration = fs.readFileSync(path.join(root, 'supabase/migrations/123_calculator_center_integration.sql'), 'utf8');
assert.match(migration, /'public_quote_enabled','false'::jsonb/);
assert.match(migration, /alter table public\.order_inventory_reservations/);
assert.match(migration, /create or replace function public\.fn_reserve_order_inventory/);
assert.match(migration, /order by wi\.id for update/);
assert.match(migration, /calculator_quote_id/);
assert.match(migration, /fn_calculator_consume_quote/);
assert.match(migration, /warehouse_transaction_id/);
assert.match(migration, /insert into public\.warehouse_documents\(doc_number,type,status/);
assert.match(migration, /insert into public\.warehouse_document_lines/);
assert.match(migration, /'profit_percent',30/);
assert.match(migration, /fn_calculator_publish_transformer_formula/);
assert.match(migration, /calculator-engine-1\.1\.0/);
assert.match(migration, /واحد قلم انبار سیم باید گرم باشد/);
assert.match(migration, /'گرم','g','gr','gram','grams'/);
assert.doesNotMatch(migration, /واحد قلم انبار سیم باید کیلوگرم باشد/);
assert.match(migration, /fn_calculator_get_quote/);
assert.match(migration, /case when p_include_costs and v_admin then q\.pricing_snapshot else '\{\}'::jsonb end/);
assert.doesNotMatch(migration, /service_role[^\n]*['"][A-Za-z0-9._-]{40,}/i);

const moduleSource = fs.readFileSync(path.join(root, 'src/modules/calculator/CalculatorModule.jsx'), 'utf8');
assert.match(moduleSource, /گزارش مشتری با هر دو نقشه/);
assert.match(moduleSource, /گزارش داخلی کارکنان/);
assert.match(moduleSource, /SavedQuoteReportModal/);
assert.match(moduleSource, /showReports/);
assert.match(moduleSource, /\{bobbin\.pins_left\}\+\{bobbin\.pins_right\} پین · \{bobbin\.mount_orientation\}/);
assert.match(moduleSource, /اتصال هسته به انبار/);
assert.match(moduleSource, /واحد ثابت انبار/);
assert.match(moduleSource, /kind === 'wire' \? 'گرم' : 'عدد'/);
assert.doesNotMatch(moduleSource, /<th>آرایش<\/th>/, 'arrangement column must be removed from winding UI');
assert.doesNotMatch(moduleSource, /Ø/, 'wire labels must use mm and parenthesized AWG without the diameter symbol');
assert.match(moduleSource, /mm\$\{awg \? ` \(AWG/);
assert.doesNotMatch(moduleSource, /sample_multiplier\s*:/, 'private formula config must not be bundled in the module');

const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
assert.match(appSource, /key: 'office'[\s\S]*key: 'calculator'[\s\S]*key: 'admin_users'/, 'calculator navigation follows office');
const calculatorCss = fs.readFileSync(path.join(root, 'src/modules/calculator/CalculatorModule.css'), 'utf8');
assert.match(calculatorCss, /\.calc-hero\{[^}]*max-width:1440px[^}]*border-radius:22px/);

const edgeSource = fs.readFileSync(path.join(root, 'supabase/functions/calculator-api/index.ts'), 'utf8');
assert.match(edgeSource, /window_width_mm: context\.bobbin\.window_width_mm/);
assert.match(edgeSource, /window_height_mm: context\.bobbin\.window_height_mm/);

const plugin = fs.readFileSync(path.join(root, 'wordpress/aryaman-calculator-connector/aryaman-calculator-connector.php'), 'utf8');
assert.match(plugin, /hash_hmac\('sha256'/);
assert.match(plugin, /WORDPRESS_SHARED_SECRET/);
assert.doesNotMatch(plugin, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*=/i);
assert.match(plugin, /payment_confirmed/);
assert.match(plugin, /order_cancelled/);
const pluginJs = fs.readFileSync(path.join(root, 'wordpress/aryaman-calculator-connector/assets/calculator.js'), 'utf8');
assert.doesNotMatch(pluginJs, /Ø|data-key="arrangement"/);
assert.match(pluginJs, /mm\$\{wire\.awg \? ` \(AWG/);

console.log('calculator-engine.test.mjs: PASS');
