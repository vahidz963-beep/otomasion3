import { useEffect, useRef, useState } from 'react';
import {
  formatJalaliMonthTyping,
  isCompleteJalaliMonth,
  normalizeJalaliMonth,
  toEnglishDateDigits,
} from '../lib/jalaliInput';
import { toPersianDigits } from '../lib/formatters';

export default function JalaliMonthInput({
  value,
  onChange,
  placeholder = '۱۴۰۵/۰۵',
  className = '',
  required = false,
  ...props
}) {
  const [text, setText] = useState(() => (value ? toPersianDigits(value) : ''));
  const lastEmittedRef = useRef(value || '');

  useEffect(() => {
    const safeValue = value || '';
    if (safeValue === lastEmittedRef.current) return;
    lastEmittedRef.current = safeValue;
    setText(safeValue ? toPersianDigits(safeValue) : '');
  }, [value]);

  const digits = toEnglishDateDigits(text).replace(/\D/g, '');
  const complete = isCompleteJalaliMonth(text);
  const invalid = Boolean(text) && (digits.length >= 6 ? !complete : false);

  function handleChange(event) {
    const next = formatJalaliMonthTyping(event.target.value, text);
    setText(next);
    lastEmittedRef.current = next;
    onChange?.(next);
  }

  function handleBlur(event) {
    const normalized = normalizeJalaliMonth(text);
    if (normalized) {
      lastEmittedRef.current = normalized;
      setText(toPersianDigits(normalized));
      onChange?.(normalized);
    }
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
      pattern="[۰-۹٠-٩0-9]{4}/[۰-۹٠-٩0-9]{1,2}"
      placeholder={placeholder}
      className={`${className} jalali-month-input ${invalid ? 'invalid' : ''}`.trim()}
      onChange={handleChange}
      onBlur={handleBlur}
      aria-invalid={invalid || undefined}
      title={invalid ? 'سال و ماه شمسی معتبر وارد کنید؛ نمونه: ۱۴۰۵/۰۵' : props.title}
    />
  );
}
