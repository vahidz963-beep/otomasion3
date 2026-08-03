import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { useDashboardData } from '../../hooks/useDashboardData';
import { t } from '../../lib/i18n';
import KPICard from '../../components/KPICard';
import FilterBar from './FilterBar';
import './Dashboard.css';

function defaultFilters() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10), salesPath: null };
}

export default function Dashboard({ lang = 'fa' }) {
  const [filters, setFilters] = useState(defaultFilters());
  const { kpis, ordersTrend, revenueTrend, loading, error, refetch } = useDashboardData(filters);
  const dir = lang === 'fa' ? 'rtl' : 'ltr';

  return (
    <div dir={dir} className="dashboard-page" lang={lang}>
      <div className="dashboard-container">
        <h1>{t(lang, 'dashboardTitle')}</h1>
        <FilterBar lang={lang} filters={filters} onChange={setFilters} />

        {loading && <div className="dashboard-message">{t(lang, 'loading')}</div>}

        {!loading && error && (
          <div className="dashboard-message error">
            <p>{t(lang, 'error')}: {error.message}</p>
            <button onClick={refetch}>{t(lang, 'retry')}</button>
          </div>
        )}

        {!loading && !error && kpis && (
          <>
            <div className="kpi-grid">
              <KPICard label={t(lang, 'activeOrders')} value={kpis.active_orders} accent="amber" />
              <KPICard label={t(lang, 'completedOrders')} value={kpis.completed_orders} accent="emerald" />
              <KPICard label={t(lang, 'cancelledOrders')} value={kpis.cancelled_orders} accent="rose" />
              <KPICard label={t(lang, 'avgDeliveryDays')} value={kpis.avg_delivery_days ?? '—'} accent="teal" />
              <KPICard label={t(lang, 'totalIncome')} value={formatCurrencyMain(kpis.total_income, lang)} suffix={formatCurrencySub(kpis.total_income, lang)} accent="slate" />
              <KPICard label={t(lang, 'netRevenue')} value={formatCurrencyMain(kpis.net_revenue, lang)} suffix={formatCurrencySub(kpis.net_revenue, lang)} accent="slate" />
            </div>

            <div className="chart-grid">
              <ChartCard title={t(lang, 'ordersTrend')} empty={ordersTrend.length === 0} lang={lang}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={ordersTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip /><Legend />
                    <Line type="monotone" dataKey="orders_created" name={t(lang, 'created')} stroke="#0f766e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="orders_completed" name={t(lang, 'completed')} stroke="#b45309" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title={t(lang, 'revenueTrend')} empty={revenueTrend.length === 0} lang={lang}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${formatCurrencyMain(v, lang)} ${formatCurrencySub(v, lang)}`} /><Legend />
                    <Bar dataKey="income" name={t(lang, 'income')} fill="#0f766e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name={t(lang, 'expense')} fill="#be123c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children, empty, lang }) {
  return <div className="chart-card"><h2>{title}</h2>{empty ? <div className="empty-chart">{t(lang, 'noData')}</div> : children}</div>;
}

function formatNumber(num, lang) { return new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(num); }
function formatCurrencyMain(value, lang) { if (value === null || value === undefined) return '—'; return `${formatNumber(Math.round(Number(value) / 10), lang)} ${t(lang, 'tomanUnit')}`; }
function formatCurrencySub(value, lang) { if (value === null || value === undefined) return ''; return `(${formatNumber(Number(value), lang)} ${t(lang, 'currencyUnit')})`; }
