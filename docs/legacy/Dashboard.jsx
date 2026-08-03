import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { useDashboardData } from '../hooks/useDashboardData';
import { t } from '../lib/i18n';
import KPICard from './KPICard';
import FilterBar from './FilterBar';

function defaultFilters() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    salesPath: null,
  };
}

export default function Dashboard({ lang = 'fa' }) {
  const [filters, setFilters] = useState(defaultFilters());
  const { kpis, ordersTrend, revenueTrend, loading, error, refetch } = useDashboardData(filters);
  const dir = lang === 'fa' ? 'rtl' : 'ltr';

  return (
    <div dir={dir} className="min-h-screen bg-slate-50 p-4 md:p-6" lang={lang}>
      <div className="mx-auto max-w-6xl space-y-5">
        <h1 className="text-xl font-bold text-slate-900">{t(lang, 'dashboardTitle')}</h1>

        <FilterBar lang={lang} filters={filters} onChange={setFilters} />

        {loading && (
          <div className="rounded-xl bg-white p-8 text-center text-slate-500 shadow-sm">
            {t(lang, 'loading')}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <p className="mb-3 text-rose-600">{t(lang, 'error')}</p>
            <button
              onClick={refetch}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
            >
              {t(lang, 'retry')}
            </button>
          </div>
        )}

        {!loading && !error && kpis && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <KPICard label={t(lang, 'activeOrders')} value={kpis.active_orders} accent="amber" />
              <KPICard label={t(lang, 'completedOrders')} value={kpis.completed_orders} accent="emerald" />
              <KPICard label={t(lang, 'cancelledOrders')} value={kpis.cancelled_orders} accent="rose" />
              <KPICard
                label={t(lang, 'avgDeliveryDays')}
                value={kpis.avg_delivery_days ?? '—'}
                accent="teal"
              />
              <KPICard
                label={t(lang, 'totalIncome')}
                value={formatCurrencyMain(kpis.total_income, lang)}
                suffix={formatCurrencySub(kpis.total_income, lang)}
                accent="slate"
              />
              <KPICard
                label={t(lang, 'netRevenue')}
                value={formatCurrencyMain(kpis.net_revenue, lang)}
                suffix={formatCurrencySub(kpis.net_revenue, lang)}
                accent="slate"
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard title={t(lang, 'ordersTrend')} empty={ordersTrend.length === 0} lang={lang}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={ordersTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="orders_created"
                      name={t(lang, 'created')}
                      stroke="#0f766e"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="orders_completed"
                      name={t(lang, 'completed')}
                      stroke="#b45309"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title={t(lang, 'revenueTrend')} empty={revenueTrend.length === 0} lang={lang}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `${formatCurrencyMain(v, lang)} ${formatCurrencySub(v, lang)}`} />
                    <Legend />
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
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      {empty ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
          {t(lang, 'noData')}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// فرض: مقادیر در دیتابیس به ریال ذخیره می‌شوند (طبق ساختار فاکتور Mahak).
// ۱ تومان = ۱۰ ریال. واحد اصلی نمایش تومان است (رایج‌تر در گفتگوی روزمره)
// و ریال به‌عنوان واحد فرعی/دقیق در پرانتز می‌آید.
// Assumption: raw values are stored in Rial. 1 Toman = 10 Rial.
// Main display unit is Toman; Rial shown as the precise secondary unit.
function formatNumber(num, lang) {
  return new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(num);
}

function formatCurrencyMain(value, lang) {
  if (value === null || value === undefined) return '—';
  const toman = Number(value) / 10;
  return `${formatNumber(Math.round(toman), lang)} ${t(lang, 'tomanUnit')}`;
}

function formatCurrencySub(value, lang) {
  if (value === null || value === undefined) return '';
  const rial = Number(value);
  return `(${formatNumber(rial, lang)} ${t(lang, 'currencyUnit')})`;
}
