import { t } from '../../lib/i18n';

export default function FilterBar({ lang = 'fa', filters, onChange }) {
  return (
    <div className="filter-bar">
      <label>
        <span>{t(lang, 'dateFrom')}</span>
        <input type="date" value={filters.dateFrom} onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })} />
      </label>
      <label>
        <span>{t(lang, 'dateTo')}</span>
        <input type="date" value={filters.dateTo} onChange={(e) => onChange({ ...filters, dateTo: e.target.value })} />
      </label>
      <label>
        <span>{t(lang, 'salesPath')}</span>
        <select value={filters.salesPath || ''} onChange={(e) => onChange({ ...filters, salesPath: e.target.value || null })}>
          <option value="">{t(lang, 'all')}</option>
          <option value="trading">{t(lang, 'trading')}</option>
          <option value="rnd">{t(lang, 'rnd')}</option>
          <option value="production">{t(lang, 'production')}</option>
        </select>
      </label>
    </div>
  );
}
