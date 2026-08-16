export function formatRial(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(value || 0)))} ریال`;
}

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد', 'میلیون میلیارد'];

function chunkToWords(num) {
  const n = Number(num || 0);
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.filter(Boolean).join(' و ');
}

export function numberToPersianWords(value) {
  let num = Math.round(Math.abs(Number(value || 0)));
  if (!num) return 'صفر';
  const chunks = [];
  while (num > 0) {
    chunks.push(num % 1000);
    num = Math.floor(num / 1000);
  }
  const words = [];
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    if (!chunks[i]) continue;
    words.push(`${chunkToWords(chunks[i])}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
  }
  return words.join(' و ');
}

export function rialToPersianWords(value) {
  return `${numberToPersianWords(value)} ریال`;
}
