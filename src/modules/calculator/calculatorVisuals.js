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
 * - exactly one colored band for each winding (never one per physical layer),
 * - colored-band heights stay proportional to each winding's radial window share,
 * - a thin insulation separator remains between adjacent windings.
 */
export function buildWindowFillSvg(bobbin, engineering) {
  const rows = engineering?.rows || [];
  const width = 820;
  const height = 500;
  const frame = { x: 116, y: 68, width: 584, height: 300 };
  if (!bobbin || !rows.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="نقشه پرشدگی"><rect width="100%" height="100%" rx="20" fill="#fbfaf6"/><text x="410" y="250" text-anchor="middle" font-family="Tahoma,Arial" font-size="16" fill="#5b6670">برای رسم نقشه، محاسبه معتبر لازم است.</text></svg>`;
  }
  const totalShare = rows.reduce((sum, row) => sum + Math.max(0, Number(row.window_share_percent || 0)), 0);
  const visualRange = Math.max(100, totalShare);
  const consumedHeight = frame.height * Math.min(100, totalShare) / visualRange;
  const separator = rows.length > 1 ? Math.min(3.5, consumedHeight / (rows.length * 5)) : 0;
  const bandSpace = Math.max(0, consumedHeight - separator * Math.max(0, rows.length - 1));
  const shareTotal = totalShare || 1;
  let cursor = frame.y + frame.height;
  const bands = [];
  rows.forEach((row, index) => {
    const bandHeight = bandSpace * Math.max(0, Number(row.window_share_percent || 0)) / shareTotal;
    cursor -= bandHeight;
    bands.push(`<g data-winding-index="${index + 1}" data-winding-name="${escapeXml(row.name)}"><rect class="winding-band" x="${frame.x}" y="${cursor.toFixed(3)}" width="${frame.width}" height="${bandHeight.toFixed(3)}" fill="${escapeXml(row.color || '#3976e8')}" stroke="${escapeXml(row.color || '#3976e8')}" stroke-width=".8"/><line x1="${frame.x + 8}" x2="${frame.x + frame.width - 8}" y1="${(cursor + bandHeight * 0.35).toFixed(3)}" y2="${(cursor + bandHeight * 0.35).toFixed(3)}" stroke="rgba(255,255,255,.48)"/><line x1="${frame.x + 8}" x2="${frame.x + frame.width - 8}" y1="${(cursor + bandHeight * 0.68).toFixed(3)}" y2="${(cursor + bandHeight * 0.68).toFixed(3)}" stroke="rgba(255,255,255,.48)"/>${bandHeight >= 21 ? `<text x="${frame.x + frame.width / 2}" y="${(cursor + bandHeight / 2 + 5).toFixed(3)}" text-anchor="middle" font-family="Tahoma,Arial" font-size="13" font-weight="700" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width="2" paint-order="stroke">N${index + 1} · ${escapeXml(row.name)} · ${format(row.window_share_percent, 1)}٪</text>` : ''}</g>`);
    if (index < rows.length - 1) {
      cursor -= separator;
      bands.push(`<rect class="insulation-separator" x="${frame.x}" y="${cursor.toFixed(3)}" width="${frame.width}" height="${separator.toFixed(3)}" fill="#f8d348" stroke="#b98a2e" stroke-width=".6"/>`);
    }
  });
  const freeHeight = Math.max(0, cursor - frame.y);
  const legendY = 404;
  const legendRows = rows.map((row, index) => {
    const column = index % 2;
    const line = Math.floor(index / 2);
    const x = column ? 420 : 116;
    const y = legendY + line * 28;
    return `<rect x="${x}" y="${y - 10}" width="15" height="15" rx="4" fill="${escapeXml(row.color || '#3976e8')}"/><text x="${x + 23}" y="${y + 2}" font-family="Tahoma,Arial" font-size="12" fill="#16325c">N${index + 1} · ${escapeXml(row.name)} — سهم ${format(row.window_share_percent, 2)}٪</text>`;
  }).join('');
  const calculatedHeight = Math.max(height, legendY + Math.ceil(rows.length / 2) * 28 + 25);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${calculatedHeight}" role="img" aria-label="نقشه پرشدگی سیم‌پیچ‌ها"><rect width="100%" height="100%" rx="20" fill="#fbfaf6"/><text x="410" y="32" text-anchor="middle" font-family="Tahoma,Arial" font-size="16" font-weight="700" fill="#16325c">نقشه پرشدگی سیم‌پیچ‌ها</text><rect x="92" y="48" width="632" height="24" rx="8" fill="#25374e"/><rect x="92" y="364" width="632" height="24" rx="8" fill="#25374e"/><rect x="92" y="64" width="24" height="308" rx="7" fill="#354a63"/><rect x="700" y="64" width="24" height="308" rx="7" fill="#354a63"/><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="#eef2f5" stroke="#93a1b0" stroke-width="2"/>${freeHeight > 16 ? `<text x="408" y="${(frame.y + freeHeight / 2 + 4).toFixed(2)}" text-anchor="middle" font-family="Tahoma,Arial" font-size="12" fill="#7b8793">فضای آزاد پنجره</text>` : ''}${bands.join('')}<text x="116" y="392" font-family="Tahoma,Arial" font-size="12" fill="#5b6670">هر نوار = یک سیم‌پیچ · خط زرد = عایق نازک بین سیم‌پیچ‌ها</text><text x="700" y="392" text-anchor="end" font-family="Tahoma,Arial" font-size="13" font-weight="700" fill="#16325c">اشغال کل ${format(engineering.occupancy_percent, 1)}٪</text>${legendRows}</svg>`;
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
