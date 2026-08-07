export function formatJalaliDate(value, options = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  }).format(date);
}

export function formatJalaliDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatToman(value, lang = 'fa') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const toman = Math.round(Number(value) / 10);
  return `${new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(toman)} ${lang === 'fa' ? 'تومان' : 'Toman'}`;
}

export function formatNumber(value, lang = 'fa') {
  return new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function toEnglishDigits(value = '') {
  return String(value)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

export function toPersianDigits(value = '') {
  return String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }

const JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy) {
  const breaks = JALALI_BREAKS;
  const bl = breaks.length;
  let gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm;
  let jump;

  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalali year');

  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const g = d2g(jdn);
  let jy = g.gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(g.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm;
  let jd;

  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function jalaliToGregorian(jy, jm, jd) {
  return d2g(j2d(Number(jy), Number(jm), Number(jd)));
}

export function gregorianToJalali(gy, gm, gd) {
  return d2j(g2d(Number(gy), Number(gm), Number(gd)));
}

function pad2(value) { return String(value).padStart(2, '0'); }

export function isoDateToJalaliInput(value) {
  if (!value) return '';
  const clean = String(value).slice(0, 10);
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, gy, gm, gd] = match.map(Number);
  const j = gregorianToJalali(gy, gm, gd);
  return toPersianDigits(`${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`);
}

export function jalaliInputToIsoDate(input) {
  const clean = toEnglishDigits(input).trim().replace(/[.\-\s]+/g, '/');
  if (!clean) return '';
  const parts = clean.split('/').filter(Boolean).map(Number);
  if (parts.length !== 3) return null;
  const [jy, jm, jd] = parts;
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return null;
  if (jy < 1200 || jy > 1600 || jm < 1 || jm > 12 || jd < 1) return null;
  const maxDay = jm <= 6 ? 31 : jm <= 11 ? 30 : (jalCal(jy).leap === 0 ? 30 : 29);
  if (jd > maxDay) return null;
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
