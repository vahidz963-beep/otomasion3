import { t } from '../../lib/i18n';
import JalaliDateInput from '../../components/JalaliDateInput';

export default function FilterBar({ lang = 'fa', filters, onChange }) {
  return (
    <div className="filter-bar">
      <label>
        <span>{t(lang, 'dateFrom')}</span>
        <JalaliDateInput value={filters.dateFrom} onChange={(value) => onChange({ ...filters, dateFrom: value })} />
      </label>
      <label>
        <span>{t(lang, 'dateTo')}</span>
        <JalaliDateInput value={filters.dateTo} onChange={(value) => onChange({ ...filters, dateTo: value })} />
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
