import { ARYAMAN_FONT_FAMILY_CSS, buildAryamanFontFaceCss, getAryamanFontBaseUrl } from '../../lib/typography.js';

const faNumber = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 });
const enNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const enInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const enJalaliDate = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' });

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function number(value, digits = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(parsed);
}

function en(value, digits = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(parsed);
}

function toman(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${faNumber.format(Math.round(parsed / 10))} تومان` : '—';
}

function irr(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? `${enInt.format(Math.round(parsed))} IRR` : '—';
}

function valueOrDash(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '—' : `${esc(value)}${suffix}`;
}

function reportHeader(title, subtitle, docCode, logoUrl, confidential = false) {
  return `<header class="ds-head"><div class="ds-title"><h1>${esc(title)}</h1><p>Model: <b>${esc(docCode.model || 'AM')}</b> &nbsp;|&nbsp; Document ID: <b>${esc(docCode.doc)}</b>${confidential ? ' &nbsp;|&nbsp; <b class="secret">Staff Only</b>' : ''}</p></div><div class="ds-logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="ARYAMAN">` : '<div class="logo-text"><b>U<span>S</span></b><i>aryaman</i></div>'}</div></header>`;
}

function sectionTitle(index, title, caption = '') {
  return `<div class="ds-sec"><i>${esc(index)}</i><h2>${esc(title)}</h2><span class="line"></span></div>${caption ? `<div class="ds-sec-cap">${esc(caption)}</div>` : ''}`;
}

function footer(docCode, page, total) {
  return `<footer class="ds-foot"><b>${esc(docCode)}</b><span>|</span><span>Page ${en(page, 0)} / ${en(total, 0)}</span></footer>`;
}

function infoTable(rows) {
  return `<div class="ds-wrap"><table class="ds-info"><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody>${rows.map(([k, v, auto]) => `<tr><td class="k">${esc(k)}</td><td class="v"${auto ? ' dir="auto"' : ''}>${v}</td></tr>`).join('')}</tbody></table></div>`;
}

function windingsTableRows(engineering) {
  const rows = engineering?.rows || [];
  const wraps = Number(engineering?.insulation_wraps_per_layer ?? 3);
  return rows.map((row) => `<tr><td class="name">N${en(row.line_no, 0)} · ${esc(row.name || '')}</td><td>${en(row.start_pin, 0)}</td><td>${en(row.end_pin, 0)}</td><td>${en(row.turns, 0)}</td><td>${en(row.wire_diameter_mm, 2)}${row.awg ? ` (AWG ${en(row.awg, 0)})` : ''}</td><td>${en(row.strands, 0)}</td><td>${en(row.calculated_layers, 0)}</td><td><span class="dir">${row.direction === 'ccw' ? 'CCW' : 'CW'}</span></td><td>${en(wraps, 0)}</td></tr>`).join('');
}

function optionalSections(testData) {
  const t = testData || {};
  const indFilled = [t.ind_primary, t.ind_leakage, t.ind_secondary].some((v) => String(v || '').trim());
  const testFilled = [t.turns_ratio, t.hipot, t.dcr_primary, t.dcr_secondary, t.dcr_auxiliary].some((v) => String(v || '').trim());
  let html = '';
  if (indFilled) {
    html += `<div class="ds-opt">${sectionTitle(5, 'Inductance', 'Optional — provided by the customer')}<div class="ds-wrap half"><table class="ds-qc"><thead><tr><th>Inductance</th><th>Measurement</th><th>Value</th></tr></thead><tbody>
      <tr><td>Primary</td><td>${esc(t.ind_primary_condition || '10 kHz · 1V')}</td><td>${esc(t.ind_primary || '—')}</td></tr>
      <tr><td>Leakage</td><td>${esc(t.ind_leakage_condition || '—')}</td><td>${esc(t.ind_leakage || '—')}</td></tr>
      <tr><td>Secondary</td><td>${esc(t.ind_secondary_condition || '—')}</td><td>${esc(t.ind_secondary || '—')}</td></tr>
    </tbody></table></div></div>`;
  }
  if (testFilled) {
    html += `<div class="ds-opt">${sectionTitle('5.1', 'Electrical Test', 'Optional — provided by the customer')}<div class="ds-wrap half"><table class="ds-qc"><thead><tr><th>Item</th><th>Value</th><th>Test Condition</th></tr></thead><tbody>
      <tr><td>Turns Ratio</td><td>${esc(t.turns_ratio || '—')}</td><td>${esc(t.turns_ratio_condition || '—')}</td></tr>
      <tr><td>Hi-Pot (Insulation Test)</td><td>${esc(t.hipot || '—')}</td><td>${esc(t.hipot_condition || '—')}</td></tr>
      <tr><td>DCR – Primary</td><td>${esc(t.dcr_primary || '—')}</td><td>${esc(t.dcr_primary_condition || '—')}</td></tr>
      <tr><td>DCR – Secondary</td><td>${esc(t.dcr_secondary || '—')}</td><td>${esc(t.dcr_secondary_condition || '—')}</td></tr>
      <tr><td>DCR – Auxiliary</td><td>${esc(t.dcr_auxiliary || '—')}</td><td>${esc(t.dcr_auxiliary_condition || '—')}</td></tr>
    </tbody></table></div></div>`;
  }
  return html;
}

function orderSummary(engineering, publicResult, quantity) {
  return `<div class="ds-summary"><div class="bars">
    <div class="cell"><small>WINDOW OCCUPANCY</small><b>${en(engineering?.occupancy_percent)}%</b></div>
    <div class="cell"><small>COPPER WIRE WEIGHT</small><b>${en(engineering?.copper_weight_per_unit_g)} g / pc</b></div>
    <div class="cell"><small>ORDER QUANTITY</small><b>${enInt.format(Math.max(0, Number(quantity) || 0))} pcs</b></div>
  </div><div class="price">
    <div><small>UNIT PRICE</small><b>${irr(publicResult?.unit_sale_rial)}</b></div>
    <div><small>SETUP FEE</small><b>${Number(publicResult?.setup_fee_rial) > 0 ? irr(publicResult?.setup_fee_rial) : '—'}</b></div>
    <div class="grand"><small>TOTAL PRICE</small><b>${irr(publicResult?.total_sale_rial)}</b></div>
  </div></div>`;
}

function datasheetPage(data) {
  const docCode = { model: data.core?.model_code || 'AM', doc: data.docCode || data.code || 'PREVIEW' };
  const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  const bobbin = data.bobbin || {};
  const coreRows = [
    ['Core Type', valueOrDash(data.core?.model_code)],
    ['Family', valueOrDash(data.core?.family)],
    ['Core Material', valueOrDash(data.core?.material)],
    ['Bobbin', bobbin.pins_left ? `${en(bobbin.pins_left, 0)}+${en(bobbin.pins_right, 0)} ${esc(bobbin.mount_orientation || '')}` : valueOrDash(data.bobbinLabel)],
    ['Ae', Number(data.core?.effective_area_mm2) > 0 ? `${en(data.core.effective_area_mm2)} mm²` : '—'],
    ...(data.hasGap ? [['Air Gap', valueOrDash(data.core?.assembly_method === 'ماشینی' ? 'Yes (machine)' : 'Yes')]] : []),
  ];
  return `<section class="page ds-ltr">
    ${reportHeader('Switching Transformer Datasheet', '', docCode, data.logoUrl)}
    <div class="ds-cols">
      <div>${sectionTitle(1, 'Basic Information')}${infoTable([
        ['Document ID', esc(docCode.doc)],
        ['Project', esc(data.projectTitle || '—'), true],
        ['Customer', esc(data.customerName || '—'), true],
        ['Designer', 'aryaman'],
        ['Date', esc(enJalaliDate.format(createdAt))],
        ['Order Quantity', `${enInt.format(Math.max(0, Number(data.quantity) || 0))} pcs`],
      ])}</div>
      <div>${sectionTitle(2, 'Core Specifications')}${infoTable(coreRows)}</div>
    </div>
    ${sectionTitle(3, 'Winding Specification')}
    <div class="ds-wrap"><table class="ds-wind"><thead><tr><th>Winding</th><th>Start Pin</th><th>To Pin</th><th>Turns</th><th>Wire (mm)</th><th>Strand</th><th>Layer</th><th>Direction</th><th>Insulation</th></tr></thead><tbody>${windingsTableRows(data.engineering)}</tbody></table></div>
    ${sectionTitle(4, 'Transformer Diagrams')}
    <div class="ds-diagrams">
      <article class="ds-diagram"><h3>Figure 1 — Window Fill</h3><div class="ds-fig">${data.fillSvg || '<p class="ds-none">Diagram unavailable.</p>'}</div><div class="ds-legend">${(data.engineering?.rows || []).map((row, index) => `<span><i style="background:${row.color}"></i>N${index + 1} ${esc(row.name)} · ${en(row.turns, 0)}T · ${en(row.calculated_layers, 0)}L</span>`).join('')}<span class="gold"><i></i>Insulation strip between windings/layers</span></div><p class="ds-cap">Each colored band is one winding (band height ∝ build). Gold strips are the mylar tape layers; the labeled BW/HW edges are the bobbin window size.</p></article>
      <article class="ds-diagram"><h3>Figure 2 — Top View · Pinout &amp; Windings</h3><div class="ds-fig">${data.pinSvg || '<p class="ds-none">Diagram unavailable.</p>'}</div><p class="ds-cap">Coil sides on the bobbin with pin numbers per side; CW/CCW shows the winding direction of each winding.</p></article>
    </div>
    ${optionalSections(data.testData)}
    ${sectionTitle(6, 'Order Summary')}
    ${orderSummary(data.engineering, data.publicResult, data.quantity)}
    ${footer(docCode.doc, 1, data.internal ? 2 : 1)}
  </section>`;
}

function staffPage(data) {
  const docCode = data.docCode || data.code || 'PREVIEW';
  const pricing = data.internal ? data.pricing : null;
  const engineering = data.engineering || {};
  const costRows = pricing ? (() => {
    const wires = (pricing.wire_cost_lines || []).map((row) => `<tr><td>سیم ${esc(row.label || '')}</td><td>${number(row.quantity_per_unit_g)} گرم × ${toman(row.unit_cost_rial_per_g)}</td><td>${toman(row.amount_rial)}</td></tr>`).join('');
    const tapeRow = Number(pricing.tape_length_per_unit_m) > 0 ? `<tr><td>نوار مایلار (چسب دوازده)</td><td>${number(pricing.tape_length_per_unit_m)} متر هر عدد × بهای متر</td><td>${toman(pricing.tape_cost_rial)}</td></tr>` : '';
    const glueRow = Number(pricing.glue_quantity_per_unit_g) > 0 ? `<tr><td>چسب هسته</td><td>${number(pricing.glue_quantity_per_unit_g)} گرم هر عدد × بهای گرم</td><td>${toman(pricing.glue_cost_rial)}</td></tr>` : '';
    const operations = (pricing.operation_breakdown || []).map((row) => `<tr><td>${esc(row.label)}</td><td>هزینه عملیات هر عدد</td><td>${toman(row.amount_rial)}</td></tr>`).join('');
    return `<tr><td>هسته</td><td>۱ عدد برای هر ترانس</td><td>${toman(pricing.core_cost_rial)}</td></tr><tr><td>بوبین</td><td>۱ عدد برای هر ترانس</td><td>${toman(pricing.bobbin_cost_rial)}</td></tr>${wires}${tapeRow}${glueRow}<tr><td>دستمزد</td><td>${number(pricing.labor_minutes)} دقیقه · نرخ ساعتی ${toman(pricing.labor_hour_rial)}</td><td>${toman(pricing.labor_cost_rial)}</td></tr>${operations}<tr class="total"><td>بهای مستقیم</td><td>قطعات + کار + عملیات</td><td>${toman(pricing.direct_cost_rial)}</td></tr><tr><td>سربار</td><td>${number(pricing.overhead_percent)}٪</td><td>${toman(pricing.overhead_cost_rial)}</td></tr><tr class="total"><td>بهای تمام‌شده</td><td>مبنای قیمت‌گذاری</td><td>${toman(pricing.total_cost_rial)}</td></tr><tr><td>سود افزایشی</td><td>${number(pricing.profit_percent)}٪</td><td>${toman(pricing.profit_amount_rial)}</td></tr><tr><td>قیمت عادی هر عدد</td><td>پس از گردکردن</td><td>${toman(pricing.regular_unit_sale_rial)}</td></tr>${Number(pricing.sample_surcharge_rial) !== 0 ? `<tr><td>افزایش سفارش نمونه</td><td>ضریب ${number(pricing.sample_multiplier)}</td><td>${toman(pricing.sample_surcharge_rial)}</td></tr>` : ''}<tr><td>ستاپ سفارش</td><td>یک‌بار برای سفارش</td><td>${toman(pricing.setup_fee_rial)}</td></tr><tr class="grand"><td>مبلغ نهایی سفارش</td><td>${number(pricing.quantity, 0)} عدد</td><td>${toman(pricing.total_sale_rial)}</td></tr>`;
  })() : '';
  const qcItems = ['تطبیق پین‌ها و جهت سیم‌پیچی', 'کنترل تعداد دور و لایه‌ها', 'اندازه‌گیری اندوکتانس اولیه', 'اندازه‌گیری نشتی', 'آزمون Hi-Pot عایقی', 'اندازه‌گیری DCR سیم‌پیچ‌ها', 'بازرسی ظاهری و شارلاک', 'ثبت تأیید نهایی تولید'];
  return `<section class="page staff-rtl">
    <header class="ds-head rtl"><div class="ds-title"><h1>ریز محاسبات و قیمت‌گذاری</h1><p>ویژه همکاران — انتشار برای مشتری ممنوع &nbsp;|&nbsp; شناسه سند: <b>${esc(docCode)}</b></p></div><div class="ds-logo">${data.logoUrl ? `<img src="${esc(data.logoUrl)}" alt="ARYAMAN">` : '<div class="logo-text"><b>U<span>S</span></b><i>aryaman</i></div>'}</div></header>
    ${sectionTitle('الف', 'جدول محاسبات قیمت', 'تمام اجزای بهای تمام‌شده — Snapshot همین سند')}
    ${pricing ? `<div class="ds-wrap"><table class="ds-fin"><thead><tr><th style="width:34%">عنوان</th><th style="width:41%">مبنای محاسبه</th><th>مبلغ هر عدد / سفارش</th></tr></thead><tbody>${costRows}</tbody></table></div>` : '<div class="ds-note">نمایش ریز قیمت‌گذاری در تنظیمات مدیر غیرفعال است یا این Snapshot قدیمی فاقد ریز محاسبات است.</div>'}
    ${sectionTitle('ب', 'پارامترهای محاسبه و تولید', 'داده‌های لازم برای بازبینی همکاران')}
    <div class="ds-cols">
      <div class="ds-wrap"><table class="ds-fin"><thead><tr><th>هندسه و سیم</th><th>مقدار</th></tr></thead><tbody>
        <tr><td>ضریب پرشدگی</td><td>${number(engineering.packing_factor)}</td></tr>
        <tr><td>عایق هر لایه (دورهای چسب)</td><td>${number(engineering.insulation_per_layer_mm ?? engineering.insulation_mm)} mm</td></tr>
        <tr><td>دور کل</td><td>${number(engineering.total_turns, 0)}</td></tr>
        <tr><td>طول سیم</td><td>${number(engineering.total_length_m)} متر</td></tr>
        <tr><td>وزن مس</td><td>${number(engineering.copper_weight_per_unit_g)} گرم</td></tr>
        <tr><td>نوار مایلار هر عدد</td><td>${number(engineering.mylar_tape_length_per_unit_m)} متر</td></tr>
        <tr><td>چسب هسته هر عدد</td><td>${number(engineering.core_glue_per_unit_g)} گرم</td></tr>
      </tbody></table></div>
      <div class="ds-wrap"><table class="ds-fin"><thead><tr><th>زمان و قیمت</th><th>مقدار</th></tr></thead><tbody>
        <tr><td>زمان سیم‌پیچی</td><td>${pricing ? `${number(pricing.winding_minutes)} دقیقه` : '—'}</td></tr>
        <tr><td>زمان مونتاژ</td><td>${pricing ? `${number(pricing.assembly_minutes)} دقیقه` : '—'}</td></tr>
        <tr><td>زمان کل کار</td><td>${pricing ? `${number(pricing.labor_minutes)} دقیقه` : '—'}</td></tr>
        <tr><td>سود نسخه</td><td>${pricing ? `${number(pricing.profit_percent)}٪` : '—'}</td></tr>
        <tr><td>نسخه فرمول</td><td>${valueOrDash(data.formulaVersion)}</td></tr>
        <tr><td>موتور محاسبه</td><td>calculator-engine-1.2.0</td></tr>
      </tbody></table></div>
    </div>
    ${sectionTitle('ج', 'چک‌لیست کنترل کیفیت', 'پس از ساخت توسط واحد تولید/کنترل کیفیت تکمیل شود')}
    <div class="ds-qc-grid">${qcItems.map((label) => `<div class="ds-qc-item"><span>${label}</span><b>□ تأیید&nbsp;&nbsp; □ رد</b></div>`).join('')}</div>
    <div class="ds-note sign">نام بازرس: ........................................ &nbsp;&nbsp;&nbsp; تاریخ: ........................ &nbsp;&nbsp;&nbsp; امضا: ........................</div>
    ${footer(docCode, 2, 2)}
  </section>`;
}

const reportCss = `
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;font-family:Arial,'Aryaman Vazirmatn',Vazirmatn,Tahoma,sans-serif;color:#1c2b3a;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
.page{width:210mm;min-height:296mm;padding:9mm 9mm 7mm;background:#fff;overflow:hidden;page-break-after:always;position:relative;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}
.ds-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1d3a5f;padding-bottom:4mm;margin-bottom:3mm}
.ds-head h1{color:#1d3a5f;font-size:19pt;font-weight:800;letter-spacing:-.3px}
.ds-head p{margin-top:1.2mm;font-size:10pt;color:#4a5a6a}
.ds-head p b{color:#1d3a5f}
.ds-head p .secret{color:#a5453f}
.ds-head.rtl{direction:rtl}
.ds-head.rtl h1{font-size:14pt;font-family:${ARYAMAN_FONT_FAMILY_CSS}}
.ds-logo img{max-height:13mm}
.logo-text{text-align:center}
.logo-text b{display:block;font-size:16pt;font-weight:900;color:#1d3a5f;line-height:1}
.logo-text b span{color:#f2b705}
.logo-text i{display:block;font-size:10pt;font-weight:800;color:#1d3a5f;font-style:normal;letter-spacing:1px}
.ds-ltr{direction:ltr}
.ds-ltr .ds-sec,.ds-ltr .ds-cols,.ds-ltr .ds-diagrams{direction:ltr}
.ds-sec{display:flex;align-items:center;gap:2.2mm;margin:4mm 0 2mm}
.ds-sec i{min-width:5mm;height:5mm;border-radius:50%;background:#1d3a5f;color:#fff;font-size:8pt;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 1mm}
*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
.ds-sec h2{font-size:10.5pt;font-weight:800;color:#1d3a5f;white-space:nowrap}
.ds-sec .line{flex:1;height:.6mm;background:#d7dee8;border-radius:1mm}
.ds-sec-cap{font-size:7.5pt;color:#7a8a9a;margin:-1mm 0 1.5mm 7mm}
.ds-cols{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
.ds-wrap{border-radius:3mm;overflow:hidden;border:.35mm solid #c9d3e0}
.ds-wrap.half{max-width:150mm}
table{border-collapse:collapse}
.ds-info{width:100%;font-size:8.5pt}
.ds-info thead th{background:#1d3a5f;color:#fff;font-weight:700;padding:1.6mm 3mm;text-align:left}
.ds-info thead th+th{border-left:.3mm solid #2d4d76}
.ds-info td{border-top:.3mm solid #dde4ee;padding:1.5mm 3mm}
.ds-info tr:nth-child(even) td{background:#f4f7fb}
.ds-info td.k{width:44%;color:#44566b;font-weight:700}
.ds-info td.v{font-weight:800}
.ds-wind{width:100%;font-size:8.2pt;text-align:center}
.ds-wind thead th{background:#1d3a5f;color:#fff;padding:1.8mm 1.5mm;font-weight:700;border-left:.3mm solid #2d4d76}
.ds-wind thead th:last-child{border-left:none}
.ds-wind td{border-top:.3mm solid #dde4ee;border-left:.3mm solid #e4eaf2;padding:1.6mm 1.2mm}
.ds-wind td:last-child{border-left:none}
.ds-wind tr:nth-child(even) td{background:#f4f7fb}
.ds-wind td.name{font-weight:800;color:#1d3a5f;white-space:nowrap}
.dir{display:inline-block;min-width:8mm;border-radius:3mm;background:#e8eef7;color:#1d3a5f;font-weight:800;font-size:7.5pt;padding:.4mm 1.8mm}
.ds-diagrams{display:grid;grid-template-columns:1fr 1fr;gap:3.5mm;align-items:stretch}
.ds-diagram{border:.35mm solid #d7dee8;border-radius:3mm;background:#fbfaf6;padding:2mm;display:flex;flex-direction:column;height:72mm}
.ds-diagram h3{font-size:8.5pt;color:#1d3a5f;font-weight:800;text-align:center;margin-bottom:1.2mm}
.ds-diagram .ds-fig{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.ds-diagram svg{width:100%;height:100%;max-height:100%}
.ds-legend{display:flex;flex-wrap:wrap;gap:1mm 2.5mm;margin-top:1mm;font-size:6.8pt;color:#2c3f55;font-weight:700;justify-content:center}
.ds-legend span{display:inline-flex;align-items:center;gap:.8mm;white-space:nowrap}
.ds-legend i{width:3.2mm;height:2.4mm;border-radius:.6mm;display:inline-block}
.ds-legend span.gold i{background:#f5c542;border:.25mm solid #a97712}
.ds-cap{margin:1mm 0 0;font-size:6.6pt;color:#5f7186;line-height:1.45;text-align:center}
.ds-opt{background:#fff6dc;border:.4mm solid #e3c36a;border-radius:2.5mm;padding:1.5mm 2mm 2mm;margin-bottom:3mm}
.ds-opt .ds-sec h2{color:#7a5a10}
.ds-opt small{color:#8a6d20}
.ds-none{font-size:8pt;color:#8296ab;text-align:center;padding:6mm 0}
.ds-qc{width:100%;font-size:8.5pt;text-align:center}
.ds-qc thead th{background:#1d3a5f;color:#fff;padding:1.6mm 2.5mm;font-weight:700;border-left:.3mm solid #2d4d76}
.ds-qc thead th:first-child{border-left:none}
.ds-qc td{border-top:.3mm solid #dde4ee;border-left:.3mm solid #e4eaf2;padding:1.5mm 2.5mm}
.ds-qc td:last-child{border-left:none}
.ds-qc tr:nth-child(even) td{background:#f4f7fb}
.ds-summary{border-radius:3.5mm;overflow:hidden;border:.35mm solid #c9d3e0;margin-top:1mm}
.ds-summary .bars{display:grid;grid-template-columns:repeat(3,1fr);background:#fff}
.ds-summary .cell{padding:2.6mm 2mm;text-align:center;border-left:.3mm solid #e4eaf2}
.ds-summary .cell:last-child{border-left:none}
.ds-summary .cell small{display:block;font-size:6.8pt;color:#5a6b7d;margin-bottom:1mm;font-weight:700;letter-spacing:.4px}
.ds-summary .cell b{font-size:11pt;color:#1d3a5f;font-weight:800}
.ds-summary .price{display:grid;grid-template-columns:1fr 1fr 1.3fr;background:#1d3a5f;color:#fff}
.ds-summary .price>div{padding:2.6mm 2mm;text-align:center;border-left:.3mm solid #2d4d76}
.ds-summary .price>div:last-child{border-left:none}
.ds-summary .price small{display:block;font-size:6.8pt;opacity:.85;margin-bottom:1mm;font-weight:700;letter-spacing:.4px}
.ds-summary .price b{font-size:11pt;font-weight:800}
.ds-summary .price .grand{background:#f2b705;color:#233246}
.ds-summary .price .grand small{color:#5c4a00}
.ds-foot{margin-top:auto;border-top:.7mm solid #1d3a5f;padding-top:2mm;display:flex;justify-content:center;gap:4mm;font-size:8.5pt;color:#44566b}
.ds-foot b{color:#1d3a5f}
.staff-rtl{direction:rtl;font-family:${ARYAMAN_FONT_FAMILY_CSS}}
.staff-rtl .ds-sec{direction:rtl}
.staff-rtl .ds-sec-cap{margin-right:7mm}
.staff-rtl .ds-cols{grid-template-columns:1fr 1fr}
.ds-fin{width:100%;font-size:8pt;direction:rtl}
.ds-fin thead th{background:#1d3a5f;color:#fff;padding:1.5mm 2.5mm;text-align:right;font-weight:700}
.ds-fin td{border-top:.3mm solid #dde4ee;padding:1.2mm 2.5mm}
.ds-fin td:nth-child(2){color:#44566b}
.ds-fin td:last-child{font-weight:700;text-align:left;direction:ltr}
.ds-fin tr:nth-child(even) td{background:#f4f7fb}
.ds-fin tr.total td{background:#eef3fa;font-weight:800}
.ds-fin tr.grand td{background:#1d3a5f;color:#fff;font-weight:800}
.ds-fin tr.grand td:nth-child(2){color:#dce6f2}
.ds-qc-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.8mm}
.ds-qc-item{display:flex;justify-content:space-between;align-items:center;border:.3mm solid #dde4ee;border-radius:2.5mm;padding:1.4mm 3mm;font-size:8pt;background:#fff}
.ds-qc-item span{color:#28405c;font-weight:600}
.ds-qc-item b{color:#44566b;font-weight:700}
.ds-note{margin-top:3mm;border:.35mm dashed #b9c4d4;border-radius:2.5mm;padding:1.8mm 3.5mm;font-size:8pt;color:#44566b}
${buildAryamanFontFaceCss()}
`;

export function buildTransformerReportHtml(data = {}) {
  const internal = data.kind === 'internal';
  const page1 = datasheetPage({ ...data, internal });
  const page2 = internal ? staffPage({ ...data, internal }) : '';
  return `<!doctype html><html lang="${internal ? 'fa' : 'en'}" dir="${internal ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`${data.docCode || data.code || 'report'} — datasheet`)}</title><style>${reportCss}</style></head><body>${page1}${page2}</body></html>`;
}

/* Preview/print flow identical to finance invoices/statements: a gray preview
   screen with a single «چاپ / ذخیره PDF» button that opens the browser print
   dialog (Save as PDF). No auto-print, no HTML download fallback. */
export function openTransformerPdfReport(data) {
  const logoUrl = typeof window !== 'undefined' ? new URL('/assets/aryaman-report-logo.png', window.location.origin).href : '';
  const fontBaseUrl = getAryamanFontBaseUrl();
  const html = buildTransformerReportHtml({ ...data, logoUrl, fontBaseUrl });
  const toolbar = `<div class="print-bar"><button type="button" class="print-btn" onclick="window.print()">چاپ / ذخیره PDF</button><span>پیش‌نمایش ${data.kind === 'internal' ? 'گزارش داخلی کارکنان' : 'دیتاشیت مشتری'} — ${esc(data.docCode || data.code || '')}</span></div>`;
  const withToolbar = html.replace('</body>', `${toolbar}</body>`);
  const css = `<style>.print-bar{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:center;gap:12px;background:#eef1f4;padding:10px 14px;border-bottom:1px solid #d7dee8}.print-btn{background:#10243d;color:#fff;border:0;border-radius:10px;padding:9px 18px;font:inherit;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(16,36,61,.2)}.print-btn:hover{background:#1b3a5e}.print-bar span{font-size:12px;font-weight:800;color:#52626f}@media print{.print-bar{display:none!important}}</style>`;
  const finalHtml = withToolbar.replace('</head>', `${css}</head>`);
  const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}
