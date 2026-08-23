import { toEnglishDigits } from '../lib/formatters';
import { formatToman } from '../lib/formatters';

function cleanNumber(value) {
  const normalized = toEnglishDigits(value ?? '')
    .replace(/[٬,\s]/g, '')
    .replace(/[^0-9.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return '';
  return normalized;
}

function formatWithCommas(value) {
  const clean = cleanNumber(value);
  if (clean === '') return '';
  const negative = clean.startsWith('-');
  const unsigned = negative ? clean.slice(1) : clean;
  const [integer, decimal] = unsigned.split('.');
  const grouped = String(integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${decimal !== undefined ? `.${decimal}` : ''}`;
}

export default function MoneyInput({ value, onChange, placeholder = '0', disabled = false, showToman = true, className = '', ...props }) {
  const clean = cleanNumber(value);
  const display = formatWithCommas(clean);
  const numericValue = clean === '' ? 0 : Number(clean);

  return (
    <div className={`money-input ${className}`.trim()}>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange?.(cleanNumber(event.target.value))}
      />
      {showToman && <small className="money-input-hint">{clean === '' ? '۰ تومان' : formatToman(numericValue, 'fa')}</small>}
    </div>
  );
}

export { cleanNumber, formatWithCommas };
