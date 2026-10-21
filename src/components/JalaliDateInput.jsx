import { useEffect, useRef, useState } from 'react';
import { isoDateToJalaliInput, jalaliInputToIsoDate } from '../lib/formatters';
import { formatJalaliDateTyping, toEnglishDateDigits } from '../lib/jalaliInput';

function isPartialValidDate(value) {
  if (!value) return true;
  const parts = toEnglishDateDigits(value).split('/');
  if (parts.length > 3 || parts[0].length > 4 || (parts[1] || '').length > 2 || (parts[2] || '').length > 2) return false;
  if (parts[0].length === 4) {
    const year = Number(parts[0]);
    if (year < 1200 || year > 1600) return false;
  }
  if (parts[1]) {
    const month = Number(parts[1]);
    if (month < 1 || month > 12) return false;
  }
  if (parts[2]) {
    const day = Number(parts[2]);
    if (day < 1 || day > 31) return false;
  }
  return true;
}

export default function JalaliDateInput({
  value,
  onChange,
  required = false,
  placeholder = '۱۴۰۵/۰۱/۰۱',
  className = '',
  style,
  ...props
}) {
  const [text, setText] = useState(() => isoDateToJalaliInput(value));
  const lastEmittedRef = useRef(value || '');

  useEffect(() => {
    const safeValue = value || '';
    if (safeValue === lastEmittedRef.current) return;
    lastEmittedRef.current = safeValue;
    setText(isoDateToJalaliInput(safeValue));
  }, [value]);

  const iso = jalaliInputToIsoDate(text);
  const invalid = Boolean(text) && (!isPartialValidDate(text) || (text.replace(/\D/g, '').length >= 8 && !iso));

  function handleChange(event) {
    const next = formatJalaliDateTyping(event.target.value, text);
    setText(next);
    if (!next) {
      lastEmittedRef.current = '';
      onChange?.('');
      return;
    }
    const parsed = jalaliInputToIsoDate(next);
    if (parsed) {
      lastEmittedRef.current = parsed;
      onChange?.(parsed);
    }
  }

  function handleBlur(event) {
    const parsed = jalaliInputToIsoDate(text);
    if (parsed) setText(isoDateToJalaliInput(parsed));
    props.onBlur?.(event);
  }

  return (
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
      aria-invalid={invalid || undefined}
      title={invalid ? 'تاریخ شمسی معتبر وارد کنید؛ نمونه: ۱۴۰۵/۰۱/۰۱' : props.title}
    />
  );
}
