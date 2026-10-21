import TransformerDiagram from './transformerDiagramEngine.js';

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const format = (value, digits = 1) => new Intl.NumberFormat('fa-IR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: digits,
}).format(Number(value || 0));

/**
 * Image 1 product contract:
 * - exactly one solid colored rectangle for each winding,
 * - no internal stripe, highlight, texture or white divider,
 * - colored-band heights remain proportional to physical winding build,
 * - a deliberately thicker gold insulation separator is drawn between windings,
 * - overfill saturates the complete window instead of shrinking the drawing.
 */
export function buildWindowFillSvg(bobbin, engineering) {
  const rows = engineering?.rows || [];
  const width = 820;
  const height = 430;
  const frame = { x: 120, y: 72, width: 580, height: 278 };
  const fontFamily = "'Aryaman Vazirmatn',Vazirmatn,Tahoma,Arial,sans-serif";
  if (!bobbin || !rows.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="نقشه پرشدگی"><rect width="100%" height="100%" rx="20" fill="#fbfaf6"/><text x="410" y="215" text-anchor="middle" font-family="${fontFamily}" font-size="16" fill="#5b6670">برای رسم نقشه، محاسبه معتبر لازم است.</text></svg>`;
  }

  const rowShareTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.window_share_percent || 0)), 0);
  const radialPercent = Number.isFinite(Number(engineering?.radial_percent))
    ? Math.max(0, Number(engineering.radial_percent))
    : rowShareTotal;
  const displayedPercent = Math.min(100, radialPercent);
  const consumedHeight = frame.height * displayedPercent / 100;
  const separatorCount = Math.max(0, rows.length - 1);
  // The separator is a visual production aid. Keep it clearly readable while
  // preserving at least two pixels for every winding in very small drawings.
  const availableForSeparators = Math.max(0, consumedHeight - rows.length * 2);
  const separator = separatorCount ? Math.min(8, availableForSeparators / separatorCount) : 0;
  const bandSpace = Math.max(0, consumedHeight - separator * separatorCount);
  const weights = rows.map((row) => {
    const build = Number(row.build_mm);
    if (Number.isFinite(build) && build > 0) return build;
    const allocated = Number(row.allocated_build_mm);
    const before = Number(row.separator_before_mm || 0);
    if (Number.isFinite(allocated) && allocated > before) return allocated - before;
    return Math.max(0, Number(row.window_share_percent || 0));
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = frame.y + frame.height;
  const bands = [];

  rows.forEach((row, index) => {
    const bandHeight = bandSpace * weights[index] / weightTotal;
    cursor -= bandHeight;
    bands.push(`<rect class="winding-band" data-winding-index="${index + 1}" data-winding-name="${escapeXml(row.name)}" x="${frame.x}" y="${cursor.toFixed(3)}" width="${frame.width}" height="${bandHeight.toFixed(3)}" fill="${escapeXml(row.color || '#3976e8')}"/>`);
    if (index < rows.length - 1) {
      cursor -= separator;
      bands.push(`<rect class="insulation-separator" data-insulation-mm="${escapeXml(engineering.insulation_mm || '')}" x="${frame.x}" y="${cursor.toFixed(3)}" width="${frame.width}" height="${separator.toFixed(3)}" rx="2" fill="#f5c542" stroke="#a97712" stroke-width="1"/>`);
    }
  });

  const freeHeight = Math.max(0, cursor - frame.y);
  const freeLabel = freeHeight >= 38
    ? `<text x="410" y="${(frame.y + freeHeight / 2 + 5).toFixed(2)}" text-anchor="middle" font-family="${fontFamily}" font-size="13" fill="#758390">فضای آزاد پنجره</text>`
    : '';
  const overfillBoundary = radialPercent > 100
    ? `<line class="overfill-boundary" x1="${frame.x}" y1="${frame.y + 2}" x2="${frame.x + frame.width}" y2="${frame.y + 2}" stroke="#a5453f" stroke-width="4" stroke-dasharray="12 6"/>`
    : '';
  const radialLabel = radialPercent > 100 ? `بیش‌ازحد مجاز · ${format(radialPercent, 1)}٪` : `${format(radialPercent, 1)}٪`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="نقشه پرشدگی سیم‌پیچ‌ها" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" rx="20" fill="#fbfaf6"/><text x="410" y="34" text-anchor="middle" font-family="${fontFamily}" font-size="17" font-weight="700" fill="#16325c">نقشه پرشدگی سیم‌پیچ‌ها</text><rect x="94" y="50" width="632" height="22" rx="7" fill="#25374e"/><rect x="94" y="350" width="632" height="22" rx="7" fill="#25374e"/><rect x="96" y="66" width="24" height="290" rx="7" fill="#354a63"/><rect x="700" y="66" width="24" height="290" rx="7" fill="#354a63"/><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="#edf2f5" stroke="#8e9ba8" stroke-width="2"/>${freeLabel}${bands.join('')}${overfillBoundary}<g font-family="${fontFamily}"><text x="120" y="402" font-size="12" fill="#5b6670">هر نوار یک سیم‌پیچ یک‌تکه است؛ نوار طلایی عایق بین سیم‌پیچ‌هاست.</text><text x="700" y="402" text-anchor="end" font-size="14" font-weight="700" fill="${radialPercent > 100 ? '#a5453f' : '#16325c'}">پرشدگی شعاعی ${radialLabel}</text></g></svg>`;
}

/** Image 2: fixed top view, enlarged, with no embedded specification table. */
export function buildPinDiagramSvg(bobbin, engineering) {
  const rows = engineering?.rows || [];
  if (!bobbin || !rows.length) return '';
  const scene = TransformerDiagram.buildScene({
    left: Number(bobbin.pins_left),
    right: Number(bobbin.pins_right),
    view: 'top',
    allowCrossSide: true,
    windings: rows.map((row) => ({
      name: row.name,
      start: Number(row.start_pin),
      end: Number(row.end_pin),
      turns: Number(row.turns),
      wire: Number(row.wire_diameter_mm).toFixed(2),
      strand: Number(row.strands),
      layer: Number(row.calculated_layers),
      direction: row.direction === 'ccw' ? 'CCW' : 'CW',
      insulation: `${format(engineering.insulation_mm, 2)} mm`,
    })),
  });
  if (!scene.width) return '';
  return TransformerDiagram.toSVG(scene)
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace('<svg ', '<svg role="img" aria-label="نمای بالای پایه و سیم‌پیچی" preserveAspectRatio="xMidYMin meet" ');
}

export function countWindingBands(svg) {
  return (String(svg || '').match(/class="winding-band"/g) || []).length;
}
