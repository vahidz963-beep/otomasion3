import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTransformerGeometry, calculateTransformerQuote, CALCULATOR_ENGINE_VERSION } from '../supabase/functions/_shared/calculator-engine.js';
import { buildPinDiagramSvg, buildWindowFillSvg, countWindingBands } from '../src/modules/calculator/calculatorVisuals.js';
import { shouldPersistTransformerAction, transformerActionPolicy } from '../supabase/functions/_shared/calculator-policy.js';
import { buildTransformerReportHtml } from '../src/modules/calculator/calculatorReports.js';
import { buildReportFixture } from './calculator-report-fixture.mjs';

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
assert.equal(shouldPersistTransformerAction('preview_transformer_fill'), false, 'live fill must never persist');
assert.equal(shouldPersistTransformerAction('preview_transformer'), false, 'internal preview must never persist');
assert.equal(shouldPersistTransformerAction('public_quote_preview'), false, 'public preview must never persist');
assert.equal(shouldPersistTransformerAction('confirm_transformer'), true, 'internal confirmation persists');
assert.equal(shouldPersistTransformerAction('public_quote_confirm'), true, 'public confirmation persists');
assert.equal(shouldPersistTransformerAction('calculate_transformer'), true, 'legacy internal action remains compatible');
assert.equal(transformerActionPolicy('unknown_action'), null);
const geometry = calculateTransformerGeometry({ core, bobbin, wires, windings, settings, orderType: 'sample', quantity: 1 });
assert.equal(geometry.rows.length, windings.length, 'one engineering row per winding');
assert.ok(geometry.rows.every((row) => row.calculated_layers >= 1));
assert.ok(geometry.rows.every((row) => row.window_share_percent > 0));
assert.ok(geometry.rows.every((row) => row.weight_g > 0));
assert.ok(geometry.copper_weight_per_unit_g > 0);
assert.ok(geometry.wire_usage.every((row) => row.required_g > 0 && row.available_g >= row.required_g));
assert.ok(geometry.area_percent > 0 && geometry.radial_percent > 0);
assert.equal(geometry.rows[0].turns_per_layer, 36, 'outer enamel diameter drives physical turns per layer');
assert.equal(geometry.rows[0].calculated_layers, 3);
assert.equal(geometry.rows[0].build_mm, 1);
assert.equal(geometry.rows[1].separator_before_mm, 0.05, 'fixed inter-winding insulation');
assert.equal(geometry.total_build_mm, 1.55);
assert.equal(geometry.total_length_m, 4.299929);
assert.equal(geometry.copper_weight_per_unit_g, 3.627883);
assert.equal(geometry.area_percent, 63.1647);
assert.equal(geometry.radial_percent, 29.8077);
assert.equal(geometry.occupancy_percent, 63.1647);

const fillSvg = buildWindowFillSvg(bobbin, geometry);
assert.equal(countWindingBands(fillSvg), windings.length, 'image 1 must have exactly one colored band per winding');
assert.equal((fillSvg.match(/class="insulation-separator"/g) || []).length, windings.length - 1, 'one clearly visible separator between winding bands');
const windingRects = [...fillSvg.matchAll(/<rect class="winding-band"[^>]*>/g)].map((match) => match[0]);
assert.equal(windingRects.length, windings.length);
assert.ok(windingRects.every((rect) => !/stroke=/.test(rect)), 'winding bands have no white/internal stroke');
assert.doesNotMatch(fillSvg, /<pattern|stroke="#fff|stroke="#ffffff|stroke="white/i, 'image 1 contains no internal white texture');
const separatorHeights = [...fillSvg.matchAll(/class="insulation-separator"[^>]*height="([0-9.]+)"/g)].map((match) => Number(match[1]));
assert.ok(separatorHeights.every((height) => height >= 6), 'visual insulation separator is intentionally thicker and readable');
const heights = [...fillSvg.matchAll(/class="winding-band"[^>]*height="([0-9.]+)"/g)].map((match) => Number(match[1]));
const visualRatio = heights[0] / heights[1];
const shareRatio = geometry.rows[0].build_mm / geometry.rows[1].build_mm;
assert.ok(Math.abs(visualRatio - shareRatio) < 0.02, 'band height is proportional to physical winding build');
const overfillSvg = buildWindowFillSvg(bobbin, {
  ...geometry,
  total_build_mm: 10,
  radial_percent: 192.3077,
  occupancy_percent: 192.3077,
  rows: [{ ...geometry.rows[0], build_mm: 10, allocated_build_mm: 10, separator_before_mm: 0 }],
});
const overfillHeight = Number(overfillSvg.match(/class="winding-band"[^>]*height="([0-9.]+)"/)?.[1]);
assert.equal(overfillHeight, 278, 'overfill drawing saturates the complete window instead of shrinking');
assert.match(overfillSvg, /class="overfill-boundary"/);

const pinSvg = buildPinDiagramSvg(bobbin, geometry);
assert.match(pinSvg, /نمای بالا/);
assert.doesNotMatch(pinSvg, /From the bottom view|نمای پایین/);
assert.doesNotMatch(pinSvg, /Winding Specification/);

const sample = calculateTransformerQuote({ core, bobbin, wires, windings, settings, orderType: 'sample', quantity: 1 });
assert.equal(sample.valid, true);
assert.equal(sample.pricing.unit_sale_rial, sample.pricing.regular_unit_sale_rial * 2);
assert.equal(sample.pricing.setup_fee_rial, 5000000);
assert.equal(sample.pricing.wire_cost_lines.length, 2, 'pricing snapshot includes one auditable line per used wire');
assert.equal(sample.pricing.operation_breakdown.length, 4, 'operation costs remain individually reportable');
assert.ok(Math.abs(sample.pricing.profit_amount_rial - (sample.pricing.regular_unit_sale_rial - sample.pricing.total_cost_rial)) < 0.001);
assert.equal(sample.pricing.sample_surcharge_rial, sample.pricing.unit_sale_rial - sample.pricing.regular_unit_sale_rial);
assert.equal(sample.pricing.quantity, 1);
assert.equal(sample.requirements.find((row) => row.component_role === 'core').quantity_per_unit, 1);
assert.equal(sample.requirements.find((row) => row.component_role === 'bobbin').quantity_per_unit, 1);
assert.equal(sample.requirements.find((row) => row.component_role === 'core').label, core.model_code);
assert.ok(sample.inventorySnapshot.every((row) => row.label), 'inventory snapshot keeps clean report labels');
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

const reportFixture = buildReportFixture();
const customerReport = buildTransformerReportHtml({ ...reportFixture, kind: 'customer', logoUrl: '/assets/aryaman-report-logo.png' });
const staffReport = buildTransformerReportHtml({ ...reportFixture, kind: 'internal', logoUrl: '/assets/aryaman-report-logo.png' });
assert.match(customerReport, /گزارش فنی و تجاری ترانس/);
assert.match(customerReport, /مشخصات هسته و بوبین/);
assert.match(customerReport, /خلاصه امکان ساخت، موجودی و قیمت/);
assert.match(customerReport, /جدول مشخصات سیم‌پیچی/);
assert.match(customerReport, /تصویر ۱ — پرشدگی سیم‌پیچ‌ها/);
assert.match(customerReport, /تصویر ۲ — نمای بالای پایه و سیم‌پیچی/);
assert.doesNotMatch(customerReport, /ریز مالی محرمانه|بهای تمام‌شده|profit_amount_rial/, 'customer PDF never contains confidential cost details');
assert.match(staffReport, /ریز مالی محرمانه/);
assert.match(staffReport, /بهای تمام‌شده/);
assert.match(staffReport, /چک‌لیست کنترل کیفیت/);
assert.equal((customerReport.match(/class="page(?: [^"]*)?"/g) || []).length, 2, 'customer PDF has two organized pages');
assert.equal((staffReport.match(/class="page(?: [^"]*)?"/g) || []).length, 3, 'staff PDF adds a confidential third page');
assert.match(customerReport, /@font-face[\s\S]*Aryaman Vazirmatn[\s\S]*vazirmatn-v16-arabic-wght-normal\.woff2/, 'customer PDF embeds the versioned local site font contract');
assert.match(staffReport, /font-family:"Aryaman Vazirmatn"/, 'staff PDF uses the same high-quality font as the site');
assert.ok(fs.existsSync(path.join(root, 'public/assets/fonts/vazirmatn/vazirmatn-v16-arabic-wght-normal.woff2')));
assert.ok(fs.existsSync(path.join(root, 'public/assets/fonts/vazirmatn/vazirmatn-v16-latin-wght-normal.woff2')));
const globalStyles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
assert.match(globalStyles, /@font-face[\s\S]*Aryaman Vazirmatn/);
assert.doesNotMatch(globalStyles, /fonts\.googleapis\.com/, 'site typography is local and does not depend on Google Fonts');

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
const migration124 = fs.readFileSync(path.join(root, 'supabase/migrations/124_calculator_reports_and_pricing_visibility.sql'), 'utf8');
assert.match(migration124, /show_internal_pricing_breakdown/);
assert.match(migration124, /v_admin or v_staff_breakdown/);
assert.match(migration124, /v_config-'show_internal_pricing_breakdown'/);
assert.match(migration124, /assembly_method/);
assert.match(migration124, /flange_length_mm/);
assert.doesNotMatch(migration124, /service_role[^\n]*['"][A-Za-z0-9._-]{40,}/i);

const moduleSource = fs.readFileSync(path.join(root, 'src/modules/calculator/CalculatorModule.jsx'), 'utf8');
assert.match(moduleSource, /خروجی PDF مشتری/);
assert.match(moduleSource, /PDF داخلی کارکنان/);
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
assert.match(moduleSource, /پرشدگی زنده پنجره/);
assert.match(moduleSource, /aria-valuemin="1"[\s\S]*aria-valuemax="100"/);
assert.match(moduleSource, /خلاصه امکان ساخت، موجودی و قیمت نهایی/);
assert.match(moduleSource, /پرونده فنی، جدول‌ها و نقشه‌های پیش از تأیید/);
assert.match(moduleSource, /ریز محرمانه محاسبات و قیمت‌گذاری/);
assert.match(moduleSource, /show_internal_pricing_breakdown/);
assert.match(moduleSource, /سفارش نمونه ترانس/);
assert.match(moduleSource, /سفارش تعداد/);
assert.match(moduleSource, /موجودی قابل رزرو/);
assert.match(moduleSource, /تأیید نهایی و ثبت سفارش/);
assert.match(moduleSource, /calculationSequence\.current \+= 1;[\s\S]*setResult\(null\)/, 'all input changes invalidate any prior result');
assert.match(moduleSource, /className="calc-winding-table[\s\S]*<\/tbody><\/table>[\s\S]{0,300}className="calc-winding-footer"/, 'add-winding control is after the winding table');
const reportSource = fs.readFileSync(path.join(root, 'src/modules/calculator/calculatorReports.js'), 'utf8');
assert.match(reportSource, /@page\{size:A4;margin:0\}/);
assert.match(reportSource, /ARYAMAN|aryaman-report-logo/);
assert.match(reportSource, /internal \? data\.pricing : null/, 'pricing is structurally excluded from customer reports');

const apiSource = fs.readFileSync(path.join(root, 'src/lib/calculatorApi.js'), 'utf8');
assert.match(apiSource, /preview_transformer_fill/);
assert.match(apiSource, /preview_transformer/);
assert.match(apiSource, /confirm_transformer/);

const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
assert.match(appSource, /key: 'office'[\s\S]*key: 'calculator'[\s\S]*key: 'admin_users'/, 'calculator navigation follows office');
const calculatorCss = fs.readFileSync(path.join(root, 'src/modules/calculator/CalculatorModule.css'), 'utf8');
assert.match(calculatorCss, /\.calc-hero\{[^}]*max-width:1440px[^}]*border-radius:22px/);
assert.match(calculatorCss, /\.calc-live-fill/);
assert.match(calculatorCss, /\.calc-result-sections/);
assert.match(calculatorCss, /\.calc-confirm-box/);
assert.match(calculatorCss, /\.calc-result-category/);
assert.match(calculatorCss, /\.calc-confidential-pricing/);
assert.match(calculatorCss, /\.calc-setting-toggle/);
assert.match(calculatorCss, /font-size: clamp\(24px, 2\.3vw, 30px\)/);

const edgeSource = fs.readFileSync(path.join(root, 'supabase/functions/calculator-api/index.ts'), 'utf8');
assert.match(edgeSource, /window_width_mm: context\.bobbin\.window_width_mm/);
assert.match(edgeSource, /window_height_mm: context\.bobbin\.window_height_mm/);
const policySource = fs.readFileSync(path.join(root, 'supabase/functions/_shared/calculator-policy.js'), 'utf8');
assert.match(policySource, /preview_transformer_fill:[\s\S]*persist: false/);
assert.match(policySource, /preview_transformer:[\s\S]*persist: false/);
assert.match(policySource, /confirm_transformer:[\s\S]*persist: true/);
assert.match(edgeSource, /public_quote_preview/);
assert.match(edgeSource, /public_quote_confirm/);
assert.match(edgeSource, /if \(!result\.valid \|\| !shouldSave\) return/, 'preview exits before the save RPC');
assert.match(edgeSource, /assertConfirmationMetadata/);
assert.match(edgeSource, /safePublicEngineering/);
assert.doesNotMatch(edgeSource.match(/function safePublicEngineering[\s\S]*?\n}/)?.[0] || '', /pricing|cost|inventory|warehouse/i, 'public engineering response excludes sensitive pricing and inventory');
assert.match(edgeSource, /showPricingBreakdown = isAdmin \|\| Boolean/);
assert.match(edgeSource, /pricing_breakdown_visible: showPricingBreakdown/);
const safeInventorySource = edgeSource.match(/function safePublicInventory[\s\S]*?\n}/)?.[0] || '';
assert.doesNotMatch(safeInventorySource, /available_qty|quantity_total|warehouse_item_id|cost/i, 'public inventory exposes status only, never raw stock or cost');

const plugin = fs.readFileSync(path.join(root, 'wordpress/aryaman-calculator-connector/aryaman-calculator-connector.php'), 'utf8');
assert.match(plugin, /hash_hmac\('sha256'/);
assert.match(plugin, /WORDPRESS_SHARED_SECRET/);
assert.doesNotMatch(plugin, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*=/i);
assert.match(plugin, /payment_confirmed/);
assert.match(plugin, /order_cancelled/);
assert.match(plugin, /\/confirm/);
assert.match(plugin, /public_quote_preview/);
assert.match(plugin, /public_quote_confirm/);
const previewRouteSource = plugin.match(/public function quote_route[\s\S]*?public function confirm_route/)?.[0] || '';
assert.doesNotMatch(previewRouteSource, /set_transient|public_quote['"]/, 'public preview neither saves a cart snapshot nor calls the legacy saving action');
const pluginJs = fs.readFileSync(path.join(root, 'wordpress/aryaman-calculator-connector/assets/calculator.js'), 'utf8');
assert.doesNotMatch(pluginJs, /Ø|data-key="arrangement"/);
assert.match(pluginJs, /mm\$\{wire\.awg \? ` \(AWG/);
assert.match(pluginJs, /config\.confirmUrl/);
assert.match(pluginJs, /پرشدگی زنده پنجره/);
assert.match(pluginJs, /خلاصه امکان ساخت، موجودی و قیمت نهایی/);
assert.match(pluginJs, /پرونده فنی و جدول سیم‌پیچی/);
assert.match(pluginJs, /دریافت خروجی PDF مشتری/);
assert.match(pluginJs, /ary-stock-hint/);
assert.match(pluginJs, /سفارش نمونه ترانس/);
assert.match(pluginJs, /pendingPayload = null;[\s\S]*resultHost\.innerHTML = ''/, 'WordPress input changes invalidate the preview');
assert.match(pluginJs, /Aryaman Vazirmatn/, 'WordPress print output uses the site typography');
const pluginCss = fs.readFileSync(path.join(root, 'wordpress/aryaman-calculator-connector/assets/calculator.css'), 'utf8');
assert.match(pluginCss, /@font-face[\s\S]*Aryaman Vazirmatn/);
assert.match(pluginCss, /fonts\/vazirmatn\/vazirmatn-v16-arabic-wght-normal\.woff2/);
assert.ok(fs.existsSync(path.join(root, 'wordpress/aryaman-calculator-connector/assets/fonts/vazirmatn/OFL.txt')));

console.log('calculator-engine.test.mjs: PASS');
