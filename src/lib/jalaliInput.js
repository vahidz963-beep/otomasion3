const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toEnglishDateDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

function cleanDateInput(value) {
  return toEnglishDateDigits(value)
    .replace(/[.\\_-]+/g, '/')
    .replace(/[^0-9/]/g, '')
    .replace(/\/{2,}/g, '/');
}

function deletingGeneratedSeparator(raw, previous, separatorDigits) {
  const oldValue = cleanDateInput(previous);
  if (!oldValue.endsWith('/') || `${raw}/` !== oldValue) return null;
  const digits = raw.replace(/\D/g, '');
  if (!separatorDigits.includes(digits.length) || digits.length === 0) return null;
  return digits.slice(0, -1);
}

function formatDigits(digits, mode) {
  const maxLength = mode === 'month' ? 6 : 8;
  const safe = digits.slice(0, maxLength);
  if (safe.length <= 3) return safe;
  if (safe.length === 4) return `${safe}/`;
  if (safe.length === 5) return `${safe.slice(0, 4)}/${safe.slice(4)}`;
  if (mode === 'month') return `${safe.slice(0, 4)}/${safe.slice(4, 6)}`;
  if (safe.length === 6) return `${safe.slice(0, 4)}/${safe.slice(4, 6)}/`;
  return `${safe.slice(0, 4)}/${safe.slice(4, 6)}/${safe.slice(6, 8)}`;
}

/**
 * Formats a Jalali date while the user is typing.
 * Separators are generated immediately after YYYY and MM, but no zero/digit is
 * ever generated. Persian and Arabic digits are accepted.
 */
export function formatJalaliDateTyping(value, previous = '') {
  const raw = cleanDateInput(value).slice(0, 10);
  const deletedDigits = deletingGeneratedSeparator(raw, previous, [4, 6]);
  if (deletedDigits !== null) return formatDigits(deletedDigits, 'date');

  // Respect a separator explicitly entered after a one-digit month/day.
  if (raw.includes('/')) {
    const parts = raw.split('/').slice(0, 3);
    const year = (parts[0] || '').slice(0, 4);
    const month = (parts[1] || '').slice(0, 2);
    const day = (parts[2] || '').slice(0, 2);
    if (year.length < 4) return year;
    if (parts.length === 1) return `${year}/`;
    if (parts.length === 2) {
      if (month.length === 2) return `${year}/${month}/`;
      return `${year}/${month}${raw.endsWith('/') && month ? '/' : ''}`;
    }
    return `${year}/${month}/${day}`;
  }

  return formatDigits(raw.replace(/\D/g, ''), 'date');
}

/** Formats a Jalali year/month value as YYYY/MM with no generated zero. */
export function formatJalaliMonthTyping(value, previous = '') {
  const raw = cleanDateInput(value).slice(0, 7);
  const deletedDigits = deletingGeneratedSeparator(raw, previous, [4]);
  if (deletedDigits !== null) return formatDigits(deletedDigits, 'month');
  return formatDigits(raw.replace(/\D/g, ''), 'month');
}

export function isCompleteJalaliMonth(value) {
  const match = toEnglishDateDigits(value).match(/^(\d{4})\/(\d{1,2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1200 && year <= 1600 && month >= 1 && month <= 12;
}

export function normalizeJalaliMonth(value) {
  if (!isCompleteJalaliMonth(value)) return '';
  const [year, month] = toEnglishDateDigits(value).split('/');
  return `${year}/${String(Number(month)).padStart(2, '0')}`;
}
