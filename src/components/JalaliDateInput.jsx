import { useEffect, useState } from 'react';
import { isoDateToJalaliInput, jalaliInputToIsoDate, toEnglishDigits } from '../lib/formatters';

function formatJalaliTyping(value) {
  const raw = toEnglishDigits(value).trim();
  if (!raw) return '';
  const normalized = raw.replace(/[.\-\s]+/g, '/');
  const parts = normalized.split('/');

  // If user intentionally types single-digit month/day with slash, keep it while typing.
  if (parts.length >= 2 && ((parts[1] && parts[1].length === 1) || (parts[2] && parts[2].length === 1))) {
    return normalized.slice(0, 10);
  }

  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}/${digits.slice(4)}`;
  return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
}

function isPartialJalaliInput(value) {
  const raw = toEnglishDigits(value).trim();
  if (!raw) return true;
  const normalized = raw.replace(/[.\-\s]+/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const digits = normalized.replace(/\D/g, '');
  if (parts.length < 3 && digits.length < 8) return true;
  if (digits.length > 0 && digits.length < 8 && parts.length < 3) return true;
  return false;
}

export default function JalaliDateInput({ value, onChange, required = false, placeholder = '۱۴۰۵/۰۵/۱۷', className = '', style, ...props }) {
  const [text, setText] = useState(isoDateToJalaliInput(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(isoDateToJalaliInput(value));
    setInvalid(false);
  }, [value]);

  function handleChange(e) {
    const next = formatJalaliTyping(e.target.value);
    setText(next);
    if (!next.trim()) {
      setInvalid(false);
      onChange?.('');
      return;
    }
    const iso = jalaliInputToIsoDate(next);
    if (iso) {
      setInvalid(false);
      onChange?.(iso);
    } else {
      setInvalid(!isPartialJalaliInput(next));
    }
  }

  function handleBlur() {
    const iso = jalaliInputToIsoDate(text);
    if (iso) {
      setText(isoDateToJalaliInput(iso));
      setInvalid(false);
    } else if (text.trim() && !isPartialJalaliInput(text)) {
      setInvalid(true);
    }
  }

  return (
    <>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={text}
        required={required}
        placeholder={placeholder}
        className={`${className} jalali-date-input ${invalid ? 'invalid' : ''}`.trim()}
        style={style}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={invalid ? 'true' : 'false'}
      />
      <small className={invalid ? 'date-hint invalid' : 'date-hint'}>
        {invalid ? 'فرمت تاریخ باید شمسی باشد؛ مثال: ۱۴۰۵/۰۵/۱۷' : 'عدد تاریخ را بنویس؛ مثال: ۱۴۰۵۰۵۱۷ خودش ۱۴۰۵/۰۵/۱۷ می‌شود'}
      </small>
    </>
  );
}
