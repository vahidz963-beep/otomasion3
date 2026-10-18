const faNumber = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 });
const faDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function number(value, digits = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(parsed);
}

function toman(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${faNumber.format(Math.round(parsed / 10))} تومان` : '—';
}

function valueOrDash(value, suffix = '') {
  return value === null || value === undefined || value === '' ? '—' : `${esc(value)}${suffix}`;
}

function wireLabel(row) {
  return `${number(row?.wire_diameter_mm ?? row?.diameter_mm)} mm${row?.awg ? ` (AWG ${number(row.awg, 0)})` : ''}`;
}

function availabilityText(row, internal) {
  if (!row) return 'اطلاعات موجودی ثبت نشده';
  const sufficient = row.sufficient ?? row.status === 'available';
  if (!internal) return sufficient ? 'موجود و قابل تأمین' : 'ناموجود / نیازمند بررسی';
  return `${sufficient ? 'کافی' : 'ناکافی'} · نیاز ${number(row.quantity_total)} ${esc(row.unit || '')} · قابل رزرو ${number(row.available_qty)} ${esc(row.unit || '')}`;
}

function roleLabel(role) {
  return role === 'core' ? 'هسته' : role === 'bobbin' ? 'بوبین' : role === 'wire' ? 'سیم مسی لاکی' : 'ماده مصرفی';
}

function reportHeader(title, subtitle, code, logoUrl, confidential = false) {
  return `<header class="report-head"><div class="brand">${logoUrl ? `<img src="${esc(logoUrl)}" alt="آریامن">` : '<b class="brand-text">ARYAMAN</b>'}<div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div><div class="doc-meta"><b class="doc-code">${esc(code || 'پیش‌نمایش')}</b><span class="badge ${confidential ? 'secret' : ''}">${confidential ? 'محرمانه کارکنان' : 'نسخه مشتری'}</span></div></header>`;
}

function sectionTitle(index, title, caption = '') {
  return `<div class="section-title"><i>${number(index, 0)}</i><div><h2>${esc(title)}</h2>${caption ? `<p>${esc(caption)}</p>` : ''}</div></div>`;
}

function footer(code, page, total) {
  return `<footer class="report-footer"><span>${esc(code || 'PREVIEW')}</span><span>مرکز طراحی و تولید آریامن</span><span>صفحه ${number(page, 0)} از ${number(total, 0)}</span></footer>`;
}

function pairRows(rows) {
  return rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`).join('');
}

function pricingRows(pricing) {
  if (!pricing) return '';
  const wires = (pricing.wire_cost_lines || []).map((row) => `<tr><td>سیم ${esc(row.label || '')}</td><td>${number(row.quantity_per_unit_g)} گرم × ${toman(row.unit_cost_rial_per_g)}</td><td>${toman(row.amount_rial)}</td></tr>`).join('');
  const operations = (pricing.operation_breakdown || []).map((row) => `<tr><td>${esc(row.label)}</td><td>هزینه عملیات هر عدد</td><td>${toman(row.amount_rial)}</td></tr>`).join('');
  return `<tr><td>هسته</td><td>۱ عدد برای هر ترانس</td><td>${toman(pricing.core_cost_rial)}</td></tr><tr><td>بوبین</td><td>۱ عدد برای هر ترانس</td><td>${toman(pricing.bobbin_cost_rial)}</td></tr>${wires}<tr><td>دستمزد</td><td>${number(pricing.labor_minutes)} دقیقه · نرخ ساعتی ${toman(pricing.labor_hour_rial)}</td><td>${toman(pricing.labor_cost_rial)}</td></tr>${operations}<tr class="subtotal"><td>بهای مستقیم</td><td>قطعات + کار + عملیات</td><td>${toman(pricing.direct_cost_rial)}</td></tr><tr><td>سربار</td><td>${number(pricing.overhead_percent)}٪</td><td>${toman(pricing.overhead_cost_rial)}</td></tr><tr class="subtotal"><td>بهای تمام‌شده</td><td>مبنای قیمت‌گذاری</td><td>${toman(pricing.total_cost_rial)}</td></tr><tr><td>سود افزایشی</td><td>${number(pricing.profit_percent)}٪</td><td>${toman(pricing.profit_amount_rial)}</td></tr><tr><td>قیمت عادی هر عدد</td><td>پس از گردکردن</td><td>${toman(pricing.regular_unit_sale_rial)}</td></tr><tr><td>افزایش سفارش نمونه</td><td>ضریب ${number(pricing.sample_multiplier)}</td><td>${toman(pricing.sample_surcharge_rial)}</td></tr><tr><td>ستاپ سفارش</td><td>یک‌بار برای سفارش</td><td>${toman(pricing.setup_fee_rial)}</td></tr><tr class="grand"><td>مبلغ نهایی سفارش</td><td>${number(pricing.quantity, 0)} عدد</td><td>${toman(pricing.total_sale_rial)}</td></tr>`;
}

export function buildTransformerReportHtml(data = {}) {
  const internal = data.kind === 'internal';
  const engineering = data.engineering || {};
  const rows = engineering.rows || data.windings || [];
  const core = data.core || {};
  const bobbin = data.bobbin || {};
  const publicResult = data.publicResult || {};
  const inventory = data.inventory || [];
  const pricing = internal ? data.pricing : null;
  const code = data.code || data.quote?.public_code || 'پیش‌نمایش محاسبه';
  const createdAt = data.createdAt ? faDate.format(new Date(data.createdAt)) : faDate.format(new Date());
  const totalPages = internal ? 3 : 2;
  const coreStock = inventory.find((row) => row.component_role === 'core');
  const bobbinStock = inventory.find((row) => row.component_role === 'bobbin');
  const wireStocks = inventory.filter((row) => row.component_role === 'wire');
  const orderLabel = data.orderType === 'production' ? 'سفارش تعداد' : 'سفارش نمونه ترانس';
  const windingRows = rows.map((row, index) => `<tr><td>${number(row.line_no ?? index + 1, 0)}</td><td><b>N${number(row.line_no ?? index + 1, 0)}</b> · ${esc(row.name || '—')}</td><td>${number(row.start_pin, 0)} ← ${number(row.end_pin, 0)}</td><td>${number(row.turns, 0)}</td><td class="ltr">${wireLabel(row)}</td><td>${number(row.strands, 0)}</td><td>${number(row.calculated_layers, 0)}</td><td>${row.direction === 'ccw' ? 'پادساعتگرد' : 'ساعتگرد'}</td><td>${number(row.length_m)} متر</td><td>${number(row.window_share_percent)}٪</td></tr>`).join('');
  const inventoryRows = inventory.map((row, index) => `<tr><td>${number(index + 1, 0)}</td><td>${esc(roleLabel(row.component_role))}</td><td>${esc(row.label || row.warehouse_code || '—')}</td><td>${number(row.quantity_per_unit)} ${esc(row.unit || '')}</td><td>${number(row.quantity_total)} ${esc(row.unit || '')}</td><td>${internal ? `${number(row.available_qty)} ${esc(row.unit || '')}` : 'نمایش وضعیت'}</td><td><span class="stock ${row.sufficient ?? row.status === 'available' ? 'ok' : 'bad'}">${availabilityText(row, false)}</span></td></tr>`).join('');
  const wireAvailability = wireStocks.length ? wireStocks.every((row) => row.sufficient ?? row.status === 'available') : null;
  const fillState = Number(engineering.occupancy_percent) > 100 ? 'نامجاز' : Number(engineering.occupancy_percent) >= 90 ? 'نیازمند کنترل کارگاه' : 'مجاز';
  const statusClass = Number(engineering.occupancy_percent) > 100 ? 'bad' : Number(engineering.occupancy_percent) >= 90 ? 'warn' : 'ok';
  const reportCss = `
    @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#edf1f4;color:#172f4d;font-family:Tahoma,Arial,sans-serif;direction:rtl}body{font-size:10px}.page{position:relative;width:210mm;min-height:297mm;margin:0 auto 8mm;padding:9mm 10mm 12mm;background:#fff;page-break-after:always;overflow:hidden}.page:last-child{page-break-after:auto}.report-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10mm;padding-bottom:3.5mm;border-bottom:2px solid #173b65}.brand{display:flex;align-items:center;gap:5mm}.brand img{width:26mm;height:17mm;object-fit:contain}.brand-text{font-size:18px;color:#173b65}.brand h1{margin:0 0 1.5mm;font-size:20px;line-height:1.35;color:#173b65}.brand p{margin:0;color:#697786;font-size:9px}.doc-meta{display:grid;justify-items:end;gap:2mm}.doc-code{direction:ltr;color:#a76628;font-size:12px}.badge{display:inline-flex;padding:1.6mm 3mm;border-radius:99px;background:#edf4fa;color:#173b65;font-size:8px;font-weight:700}.badge.secret{background:#fff0df;color:#8b4c16}.section-title{display:flex;align-items:center;gap:3mm;margin:3.4mm 0 2mm;padding-bottom:1.7mm;border-bottom:1px solid #8ba0b8}.section-title i{display:grid;place-items:center;width:7mm;height:7mm;border-radius:2mm;background:#173b65;color:#fff;font-style:normal;font-weight:700}.section-title h2{margin:0;font-size:12px;color:#173b65}.section-title p{margin:1mm 0 0;color:#778493;font-size:7.5px}.identity-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2mm}.identity-card{padding:2.3mm;border:1px solid #d5dce3;border-radius:2mm;background:#fafbfc}.identity-card span{display:block;margin-bottom:1mm;color:#788594;font-size:7.5px}.identity-card b{font-size:10px}.dual{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.panel{min-width:0;border:1px solid #ccd5dd;border-radius:2.5mm;overflow:hidden}.panel h3{margin:0;padding:2mm 2.6mm;background:#173b65;color:#fff;font-size:10px}.panel table,.data-table{width:100%;border-collapse:collapse}.panel th,.panel td{padding:1.55mm 2.2mm;border-bottom:1px solid #e0e5e9;text-align:right}.panel tr:last-child th,.panel tr:last-child td{border-bottom:0}.panel th{width:38%;color:#5e6d7b;background:#f5f7f8;font-weight:600}.status-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.status-card{padding:2.3mm;border:1px solid #d3dce4;border-radius:2.2mm;background:#fafbfc}.status-card span{display:block;color:#788594;font-size:7.3px;margin-bottom:1.3mm}.status-card b{font-size:10px}.status-card.accent{background:#173b65;color:#fff}.status-card.accent span{color:#cbd7e1}.status-card.accent b{color:#ffd35c}.stock{display:inline-block;border-radius:99px;padding:1mm 2mm;font-weight:700;font-size:7.5px}.stock.ok{background:#e8f6ee;color:#1f7049}.stock.bad{background:#fff0ef;color:#9b403a}.stock.warn{background:#fff7df;color:#805c14}.data-table{table-layout:fixed}.data-table th,.data-table td{border:1px solid #cfd7df;padding:1.55mm 1.5mm;text-align:center;vertical-align:middle;overflow-wrap:anywhere}.data-table thead th{background:#173b65;color:#fff;font-size:7.8px}.data-table tbody tr:nth-child(even){background:#f3f5f6}.data-table td{font-size:7.6px}.data-table .ltr,.ltr{direction:ltr}.diagram-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;align-items:start}.diagram{min-width:0;border:1px solid #cdd6de;border-radius:2.5mm;padding:2.5mm;background:#fff;break-inside:avoid}.diagram h3{margin:0 0 2mm;color:#173b65;font-size:10px}.diagram svg{display:block;width:100%;height:auto;max-height:91mm}.diagram-note{margin:2mm 0 0;color:#73808d;font-size:7.2px;line-height:1.7}.confidential{border:2px solid #b86f2e}.confidential h3{background:#9c5a24}.price-table th,.price-table td{padding-top:1.25mm;padding-bottom:1.25mm}.price-table td:first-child{font-weight:700}.price-table td:last-child{direction:rtl;font-weight:700}.price-table tr.subtotal{background:#eef3f7!important}.price-table tr.grand{background:#173b65!important;color:#fff}.price-table tr.grand td:last-child{color:#ffd35c;font-size:9px}.formula-box{padding:2.2mm;border:1px dashed #b6c1cb;background:#f8fafb;line-height:1.9;color:#516170}.qc-grid{display:grid;grid-template-columns:1fr 1fr;gap:2mm}.qc-item{display:flex;justify-content:space-between;padding:1.6mm 2mm;border:1px solid #d6dde4;background:#fafbfc}.report-footer{position:absolute;right:10mm;left:10mm;bottom:5mm;display:flex;justify-content:space-between;padding-top:2mm;border-top:1px solid #bdc8d2;color:#6b7885;font-size:7px}.notice{margin-top:2mm;padding:2mm 2.5mm;border-right:3px solid #d5a11e;background:#fff9e8;color:#69551f;line-height:1.8}.no-break{break-inside:avoid}@media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
  `;
  const page1 = `<section class="page">${reportHeader(internal ? 'برگه ساخت و محاسبات ترانس' : 'گزارش فنی و تجاری ترانس', `${orderLabel} · صادرشده در ${createdAt}`, code, data.logoUrl, internal)}${sectionTitle(1, 'اطلاعات پایه و درخواست', 'شناسه سند، مشتری و مشخصات سفارش')}<div class="identity-grid"><div class="identity-card"><span>مشتری</span><b>${esc(data.customerName || '—')}</b></div><div class="identity-card"><span>شماره تماس</span><b class="ltr">${esc(data.customerPhone || '—')}</b></div><div class="identity-card"><span>عنوان پروژه</span><b>${esc(data.projectTitle || '—')}</b></div><div class="identity-card"><span>نوع سفارش</span><b>${orderLabel}</b></div><div class="identity-card"><span>تعداد</span><b>${number(data.quantity, 0)} عدد</b></div><div class="identity-card"><span>نسخه فرمول</span><b>${internal ? esc(data.formulaVersion || '—') : 'نسخه کنترل‌شده آریامن'}</b></div></div>${sectionTitle(2, 'مشخصات هسته و بوبین', 'اطلاعات فنی واقعی؛ مقدار ناموجود حدس زده نمی‌شود')}<div class="dual"><article class="panel"><h3>هسته</h3><table><tbody>${pairRows([['مدل', valueOrDash(core.model_code)],['خانواده', valueOrDash(core.family)],['جنس', valueOrDash(core.material)],['سطح مؤثر Ae', core.effective_area_mm2 ? `${number(core.effective_area_mm2)} mm²` : '—'],['پایه مرکزی', core.center_leg_mm ? `${number(core.center_leg_mm)} mm` : '—'],['وزن', core.weight_g ? `${number(core.weight_g)} گرم` : '—'],['گپ', data.hasGap ? 'دارد' : 'ندارد'],['موجودی', `<span class="stock ${coreStock?.sufficient ? 'ok' : 'bad'}">${availabilityText(coreStock, internal)}</span>`]])}</tbody></table></article><article class="panel"><h3>بوبین</h3><table><tbody>${pairRows([['پایه‌ها', `${number(bobbin.pins_left, 0)}+${number(bobbin.pins_right, 0)}`],['جهت نصب', valueOrDash(bobbin.mount_orientation)],['عرض پنجره BW', bobbin.window_width_mm ? `${number(bobbin.window_width_mm)} mm` : '—'],['ارتفاع پنجره HW', bobbin.window_height_mm ? `${number(bobbin.window_height_mm)} mm` : '—'],['طول متوسط دور MLT', bobbin.mean_turn_length_mm ? `${number(bobbin.mean_turn_length_mm)} mm` : '—'],['وزن', bobbin.weight_g ? `${number(bobbin.weight_g)} گرم` : '—'],['موجودی', `<span class="stock ${bobbinStock?.sufficient ? 'ok' : 'bad'}">${availabilityText(bobbinStock, internal)}</span>`]])}</tbody></table></article></div>${sectionTitle(3, 'خلاصه امکان ساخت، موجودی و قیمت', 'نتیجه قابل ارائه پیش از تأیید نهایی')}<div class="status-grid"><div class="status-card"><span>اشغال نهایی پنجره</span><b>${number(engineering.occupancy_percent)}٪</b></div><div class="status-card"><span>وضعیت ساخت</span><b><span class="stock ${statusClass}">${fillState}</span></b></div><div class="status-card"><span>موجودی سیم‌ها</span><b><span class="stock ${wireAvailability === false ? 'bad' : 'ok'}">${wireAvailability === false ? 'ناکافی' : 'کافی'}</span></b></div><div class="status-card"><span>وزن مس هر عدد</span><b>${number(engineering.copper_weight_per_unit_g)} گرم</b></div><div class="status-card"><span>قیمت هر عدد</span><b>${toman(publicResult.unit_sale_rial)}</b></div><div class="status-card"><span>هزینه ستاپ</span><b>${toman(publicResult.setup_fee_rial)}</b></div><div class="status-card"><span>تعداد سفارش</span><b>${number(data.quantity, 0)} عدد</b></div><div class="status-card accent"><span>مبلغ نهایی</span><b>${toman(publicResult.total_sale_rial)}</b></div></div>${sectionTitle(4, 'فهرست مواد و وضعیت تأمین', internal ? 'مقادیر Snapshot موجودی زمان محاسبه' : 'برای مشتری فقط وضعیت تأمین نمایش داده می‌شود')}<table class="data-table"><thead><tr><th>ردیف</th><th>نوع</th><th>شرح</th><th>مصرف هر عدد</th><th>نیاز سفارش</th><th>${internal ? 'قابل رزرو' : 'موجودی'}</th><th>وضعیت</th></tr></thead><tbody>${inventoryRows || '<tr><td colspan="7">اطلاعات موجودی ثبت نشده است.</td></tr>'}</tbody></table><div class="notice">${data.confirmed ? 'این سند از Snapshot ثبت‌شده تولید شده و تغییر بعدی نرخ یا موجودی، مقادیر آن را تغییر نمی‌دهد.' : 'این خروجی پیش‌نمایش است؛ قیمت و موجودی هنگام تأیید نهایی دوباره در سرور کنترل می‌شوند.'}</div>${footer(code, 1, totalPages)}</section>`;
  const page2 = `<section class="page">${reportHeader('پرونده فنی و نقشه‌های ترانس', 'مشخصات سیم‌پیچی و نقشه‌های مهندسی', code, data.logoUrl, internal)}${sectionTitle(5, 'جدول مشخصات سیم‌پیچی', 'ساختار مرتب‌شده بر اساس ترتیب اجرا')}<table class="data-table winding-table"><thead><tr><th>ردیف</th><th>سیم‌پیچ</th><th>پین</th><th>دور</th><th>سیم</th><th>رشته</th><th>لایه</th><th>جهت</th><th>طول</th><th>سهم پنجره</th></tr></thead><tbody>${windingRows}</tbody></table>${sectionTitle(6, 'نقشه‌های مهندسی', 'نقشه پرشدگی و نمای بالای پایه‌ها به‌صورت مجزا')}<div class="diagram-grid"><article class="diagram"><h3>تصویر ۱ — پرشدگی سیم‌پیچ‌ها</h3>${data.fillSvg || '<p>نقشه موجود نیست.</p>'}<p class="diagram-note">هر سطح رنگی یک سیم‌پیچ یک‌تکه است و نوار طلایی عایق بین سیم‌پیچ‌ها را نشان می‌دهد.</p></article><article class="diagram"><h3>تصویر ۲ — نمای بالای پایه و سیم‌پیچی</h3>${data.pinSvg || '<p>نقشه موجود نیست.</p>'}<p class="diagram-note">شماره پایه، نام سیم‌پیچ و تعداد دور مطابق جدول بالا کنترل شود.</p></article></div>${sectionTitle(7, 'جمع‌بندی فنی', 'مقادیر محاسبه‌شده موتور امن')}<div class="status-grid"><div class="status-card"><span>طول کل سیم هر عدد</span><b>${number(engineering.total_length_m)} متر</b></div><div class="status-card"><span>Build کل</span><b>${number(engineering.total_build_mm)} mm</b></div><div class="status-card"><span>کنترل سطح مقطع</span><b>${number(engineering.area_percent)}٪</b></div><div class="status-card"><span>کنترل شعاعی</span><b>${number(engineering.radial_percent)}٪</b></div></div>${footer(code, 2, totalPages)}</section>`;
  const page3 = internal ? `<section class="page">${reportHeader('ریز محاسبات و قیمت‌گذاری', 'ویژه کارکنان مجاز — انتشار برای مشتری ممنوع', code, data.logoUrl, true)}${sectionTitle(8, 'ریز مالی محرمانه', 'تمام اجزای بهای تمام‌شده و قیمت فروش')}<div class="panel confidential"><h3>جدول محاسبات قیمت</h3>${pricing ? `<table class="data-table price-table"><thead><tr><th>عنوان</th><th>مبنای محاسبه</th><th>مبلغ هر عدد / سفارش</th></tr></thead><tbody>${pricingRows(pricing)}</tbody></table>` : '<div class="formula-box">نمایش ریز قیمت‌گذاری در تنظیمات مدیر غیرفعال است یا این Snapshot قدیمی فاقد ریز محاسبات است.</div>'}</div>${sectionTitle(9, 'پارامترهای محاسبه و تولید', 'داده‌های لازم برای بازبینی کارکنان')}<div class="dual"><article class="panel"><h3>هندسه و سیم</h3><table><tbody>${pairRows([['ضریب پرشدگی', number(engineering.packing_factor)],['عایق ثابت', `${number(engineering.insulation_mm)} mm`],['دور کل', number(engineering.total_turns, 0)],['طول سیم', `${number(engineering.total_length_m)} متر`],['وزن مس', `${number(engineering.copper_weight_per_unit_g)} گرم`]])}</tbody></table></article><article class="panel"><h3>زمان و قیمت</h3><table><tbody>${pairRows([['زمان سیم‌پیچی', pricing ? `${number(pricing.winding_minutes)} دقیقه` : '—'],['زمان مونتاژ', pricing ? `${number(pricing.assembly_minutes)} دقیقه` : '—'],['زمان کل کار', pricing ? `${number(pricing.labor_minutes)} دقیقه` : '—'],['سود نسخه', pricing ? `${number(pricing.profit_percent)}٪` : '—'],['نسخه فرمول', valueOrDash(data.formulaVersion)]])}</tbody></table></article></div>${sectionTitle(10, 'چک‌لیست کنترل کیفیت', 'پس از ساخت نمونه توسط واحد تولید/کنترل کیفیت تکمیل شود')}<div class="qc-grid">${['تطبیق پین‌ها و جهت سیم‌پیچی','کنترل تعداد دور و لایه‌ها','اندازه‌گیری اندوکتانس اولیه','اندازه‌گیری نشتی','آزمون Hi-Pot عایقی','اندازه‌گیری DCR سیم‌پیچ‌ها','بازرسی ظاهری و شارلاک','ثبت تأیید نهایی تولید'].map((label) => `<div class="qc-item"><span>${label}</span><b>□ تأیید&nbsp;&nbsp; □ رد</b></div>`).join('')}</div><div class="formula-box" style="margin-top:4mm">نام بازرس: ........................................ &nbsp;&nbsp;&nbsp; تاریخ: ........................ &nbsp;&nbsp;&nbsp; امضا: ........................</div>${footer(code, 3, totalPages)}</section>` : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(internal ? `برگه ساخت ${code}` : `گزارش مشتری ${code}`)}</title><style>${reportCss}</style></head><body>${page1}${page2}${page3}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script></body></html>`;
}

export function openTransformerPdfReport(data) {
  const logoUrl = typeof window !== 'undefined' ? new URL('/assets/aryaman-report-logo.png', window.location.origin).href : '';
  const html = buildTransformerReportHtml({ ...data, logoUrl });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const reportWindow = window.open(url, '_blank');
  if (!reportWindow) {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.kind === 'internal' ? 'staff' : 'customer'}-${data.code || 'preview'}.html`;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}
