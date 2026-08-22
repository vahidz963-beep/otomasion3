import { useEffect, useMemo, useRef, useState } from 'react';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .trim();
}

export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  placeholder = 'جست‌وجو و انتخاب...',
  disabled = false,
  className = '',
  emptyText = 'موردی پیدا نشد.',
  minChars = 0,
  maxItems = 30,
}) {
  const wrapperRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => options.find((item) => item.value === value) || null, [options, value]);

  useEffect(() => {
    setQuery(selected?.label || '');
  }, [selected]);

  useEffect(() => {
    function handleClick(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (q.length < minChars) return options.slice(0, maxItems);
    return options
      .filter((item) => normalize(`${item.label || ''} ${item.description || ''} ${item.searchText || ''}`).includes(q))
      .slice(0, maxItems);
  }, [options, query, minChars, maxItems]);

  function choose(item) {
    setQuery(item.label || '');
    setOpen(false);
    onChange?.(item.value, item);
  }

  function clear() {
    setQuery('');
    setOpen(false);
    onChange?.('', null);
  }

  return (
    <div className={`searchable-select ${className}`.trim()} ref={wrapperRef}>
      <div className="searchable-select-input-wrap">
        <input
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!event.target.value.trim()) onChange?.('', null);
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
        {query && !disabled && <button type="button" className="searchable-select-clear" onClick={clear}>×</button>}
      </div>
      {open && !disabled && (
        <div className="searchable-select-menu">
          {filtered.length === 0 ? <div className="searchable-select-empty">{emptyText}</div> : filtered.map((item) => (
            <button type="button" key={item.value} onClick={() => choose(item)}>
              <span>
                <strong>{item.label}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
