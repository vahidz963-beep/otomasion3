import { useEffect, useMemo, useRef, useState } from 'react';
import { formatToman, formatNumber } from '../lib/formatters';

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').trim();
}

function itemLabel(item) {
  if (!item) return '';
  return `${item.item_code || ''} · ${item.item_name_fa || item.item_name_en || ''}`.trim();
}

export default function ProductPicker({
  items = [],
  value = '',
  onSelect,
  placeholder = 'کد یا نام کالا را جست‌وجو کن...',
  minChars = 2,
  className = '',
  disabled = false,
}) {
  const wrapperRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    return items.find((item) => item.item_id === value || item.id === value || item.item_code === value) || null;
  }, [items, value]);

  useEffect(() => {
    setQuery(selectedItem ? itemLabel(selectedItem) : (value || ''));
  }, [selectedItem, value]);

  useEffect(() => {
    function handleClick(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (q.length < minChars) return [];
    return items
      .filter((item) => normalize(`${item.item_code || ''} ${item.item_name_fa || ''} ${item.item_name_en || ''} ${item.category || ''} ${item.item_group || ''} ${item.item_group_label || ''}`).includes(q))
      .slice(0, 18);
  }, [items, query, minChars]);

  function choose(item) {
    setQuery(itemLabel(item));
    setOpen(false);
    onSelect?.(item);
  }

  function clear() {
    setQuery('');
    setOpen(false);
    onSelect?.(null);
  }

  return (
    <div className={`product-picker ${className}`.trim()} ref={wrapperRef}>
      <div className="product-picker-input-wrap">
        <input
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!event.target.value.trim()) onSelect?.(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filtered.length === 1) {
              event.preventDefault();
              choose(filtered[0]);
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {query && !disabled && <button type="button" className="product-picker-clear" onClick={clear}>×</button>}
      </div>
      {open && !disabled && (
        <div className="product-picker-menu">
          {normalize(query).length < minChars ? (
            <div className="product-picker-hint">حداقل {formatNumber(minChars)} حرف از کد یا نام کالا را بنویس تا لیست محدود شود.</div>
          ) : filtered.length === 0 ? (
            <div className="product-picker-hint">کالایی با این جست‌وجو پیدا نشد.</div>
          ) : filtered.map((item) => (
            <button type="button" key={item.item_id || item.id || item.item_code} onClick={() => choose(item)}>
              <span>
                <b dir="ltr">{item.item_code || 'بدون کد'}</b>
                <strong>{item.item_name_fa || item.item_name_en || 'کالا'}</strong>
                <small>{item.item_group_label || item.category || item.item_group || 'بدون گروه'} · موجودی {formatNumber(item.available_for_sale_qty ?? item.current_qty ?? 0)} {item.unit || ''}</small>
              </span>
              <em>{formatToman(item.effective_sale_price ?? item.unit_price_estimate ?? 0, 'fa')}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
