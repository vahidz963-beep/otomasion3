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
