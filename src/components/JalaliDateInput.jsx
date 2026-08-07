import { useEffect, useState } from 'react';
import { isoDateToJalaliInput, jalaliInputToIsoDate } from '../lib/formatters';

export default function JalaliDateInput({ value, onChange, required = false, placeholder = '۱۴۰۵/۰۵/۱۷', className = '', style, ...props }) {
  const [text, setText] = useState(isoDateToJalaliInput(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(isoDateToJalaliInput(value));
    setInvalid(false);
  }, [value]);

  function handleChange(e) {
    const next = e.target.value;
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
      setInvalid(true);
    }
  }

  function handleBlur() {
    const iso = jalaliInputToIsoDate(text);
    if (iso) {
      setText(isoDateToJalaliInput(iso));
      setInvalid(false);
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
        {invalid ? 'فرمت تاریخ باید شمسی باشد؛ مثال: ۱۴۰۵/۰۵/۱۷' : 'تاریخ را شمسی وارد کن؛ مثال: ۱۴۰۵/۰۵/۱۷'}
      </small>
    </>
  );
}
