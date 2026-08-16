import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { AlertTriangle, Banknote, ClipboardList, Database, Factory, FileWarning, Package, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useAuth } from '../../auth/AuthProvider';
import { t } from '../../lib/i18n';
import { formatJalaliDate, formatNumber, formatToman } from '../../lib/formatters';
import FilterBar from './FilterBar';
import './Dashboard.css';

function defaultFilters() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10), salesPath: null };
}

export default function Dashboard({ lang = 'fa' }) {
  const { profile } = useAuth();
  const [filters, setFilters] = useState(defaultFilters());
  const data = useDashboardData(filters);
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const roles = useMemo(() => [...new Set([profile?.role, ...(profile?.additional_roles || [])].filter(Boolean))], [profile]);
  const isAdmin = roles.includes('admin');
  const canSales = isAdmin || roles.some((r) => ['sales', 'sales_manager'].includes(r));
  const canFinance = isAdmin || roles.includes('accountant');
  const canWarehouse = isAdmin || roles.includes('warehouse');
  const canProduction = isAdmin || roles.includes('production');
  const canRnd = isAdmin || roles.includes('rnd');
  const canOffice = isAdmin || roles.includes('office_admin');

  const visibleKpis = useMemo(() => {
    const list = [];
    if (canSales) list.push({ icon: ClipboardList, title: 'سفارش‌های باز', value: data.kpis?.active_orders || 0, accent: 'blue' });
    if (canFinance) list.push({ icon: Banknote, title: 'دریافتنی', value: formatMoney(data.kpis?.receivable_total || 0), accent: 'green' }, { icon: FileWarning, title: 'پرداختنی', value: formatMoney(data.kpis?.payable_total || 0), accent: 'red' }, { icon: AlertTriangle, title: 'سررسید گذشته', value: formatMoney(data.kpis?.overdue_total || 0), accent: 'amber' });
    if (canWarehouse) list.push({ icon: Package, title: 'کم‌موجودی', value: data.kpis?.low_stock || 0, accent: 'red' });
    if (canProduction) list.push({ icon: Factory, title: 'تولید فعال', value: data.kpis?.active_production || 0, accent: 'slate' });
    if (canRnd) list.push({ icon: Users, title: 'R&D فعال', value: data.kpis?.active_rnd || 0, accent: 'violet' });
    if (canSales || canFinance || canWarehouse || canProduction || canRnd || canOffice) list.push({ icon: ClipboardList, title: 'ارجاعات باز', value: data.kpis?.open_referrals || 0, accent: 'amber' });
    return list;
  }, [data.kpis, canSales, canFinance, canWarehouse, canProduction, canRnd, canOffice]);

  const visibleTables = useMemo(() => {
    const list = [];
    if (canSales) list.push({ title: 'ارجاعات فوری', rows: data.referrals.slice(0, 10), columns: [['title_fa','عنوان'], ['source_module','مبدأ'], ['target_module','مقصد'], ['status','وضعیت'], ['due_date','موعد']] });
    if (canWarehouse) list.push({ title: 'موجودی‌های کم', rows: data.stock.filter((i) => i.is_low_stock).slice(0, 10), columns: [['item_code','کد'], ['item_name_fa','کالا'], ['current_qty','موجودی'], ['reorder_point','نقطه سفارش'], ['location','مکان']] });
    if (canProduction) list.push({ title: 'تولیدهای در جریان', rows: data.production.filter((p) => !['completed','delivered_to_warehouse','cancelled'].includes(p.status)).slice(0, 10), columns: [['code','کد'], ['product_name_fa','محصول'], ['customer_name','مشتری'], ['current_stage_name_fa','مرحله'], ['progress_percent','پیشرفت']] });
    if (canRnd) list.push({ title: 'R&D در جریان', rows: data.rnd.filter((r) => !['approved','sent_to_production','archived','rejected'].includes(r.status)).slice(0, 10), columns: [['code','کد'], ['title_fa','پروژه'], ['customer_name','مشتری'], ['current_stage_name_fa','مرحله'], ['progress_percent','پیشرفت']] });
    if (canFinance) list.push({ title: 'چک‌های نزدیک', rows: data.checks.slice(0, 10), columns: [['internal_check_code','کد'], ['check_type','نوع'], ['bank_name','بانک'], ['due_date','سررسید'], ['amount','مبلغ']] }, { title: 'آخرین گردش‌ها', rows: data.payments.slice(0, 10), columns: [['payment_number','شماره'], ['account_name','حساب'], ['party_name','شخص'], ['direction','نوع'], ['amount','مبلغ']] });
    if (canOffice && !isAdmin) list.push({ title: 'ارجاعات اداری', rows: data.referrals.filter((r) => r.target_module === 'admin' || r.source_module === 'admin').slice(0, 10), columns: [['title_fa','عنوان'], ['source_module','مبدأ'], ['target_module','مقصد'], ['status','وضعیت'], ['due_date','موعد']] });
    return list;
  }, [data, canSales, canFinance, canWarehouse, canProduction, canRnd, canOffice, isAdmin]);

  return <div dir={dir} className="dashboard-page" lang={lang}>
    <div className="dashboard-container pro">
      <header className="dashboard-hero">
        <div>
          <div className="eyebrow">Executive Automation Dashboard</div>
          <h1>{isAdmin ? 'داشبورد مدیریتی کل' : 'داشبورد کاری من'}</h1>
          <p>{isAdmin ? 'نمای یکپارچه سفارش، مالی، انبار، تولید، R&D، ارجاعات و سلامت سیستم.' : 'خلاصه وضعیت بخش‌هایی که به نقش شما مرتبط هستند.'}</p>
        </div>
        <button onClick={data.refetch}><RefreshCw size={16}/> به‌روزرسانی</button>
      </header>

      <FilterBar lang={lang} filters={filters} onChange={setFilters} />

      {data.loading && <div className="dashboard-message">{t(lang, 'loading')}</div>}
      {!data.loading && data.queryErrors.length > 0 && <div className="dashboard-message warn"><b>هشدار سلامت داده‌ها</b><p>برخی View/RPCها هنوز کامل اجرا نشده‌اند؛ داشبورد با داده‌های موجود نمایش داده می‌شود.</p><ul>{data.queryErrors.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

      {!data.loading && data.kpis && <>
        <section className="exec-kpi-grid">
          {visibleKpis.map((kpi) => <ExecKpi key={kpi.title} {...kpi} />)}
        </section>

        {isAdmin && <section className="health-card"><HealthReport health={data.health} /></section>}

        {(canSales || canFinance || isAdmin) && <>
        <section className="dashboard-main-grid">
          {canSales && <ChartCard title="روند سفارش‌ها" empty={data.ordersTrend.length === 0}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.ordersTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={formatShortDate} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={(v) => formatJalaliDate(v)} />
                <Legend />
                <Line type="monotone" dataKey="orders_created" name="ثبت‌شده" stroke="#10243d" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="orders_completed" name="تکمیل‌شده" stroke="#4c7a61" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>}
          {canFinance && <ChartCard title="روند واریز و برداشت" empty={data.revenueTrend.length === 0}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={formatShortDate} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => Math.round(Number(v || 0) / 10000000)} />
                <Tooltip labelFormatter={(v) => formatJalaliDate(v)} formatter={(v) => formatMoney(v)} />
                <Legend />
                <Bar dataKey="income" name="واریزی" fill="#4c7a61" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="برداشت" fill="#a5453f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>}
        </section>
        {(isAdmin || canFinance || canSales) && <ForecastTable rows={data.receivableForecast || []} />}
        </>}

        <section className="dashboard-tables-grid">
          {visibleTables.map((table) => <InfoTable key={table.title} {...table} />)}
        </section>
      </>}
    </div>
  </div>;
}


function ForecastTable({ rows }) {
  const total = rows.reduce((sum, row) => sum + Number(row.expected_amount || 0), 0);
  return <section className="dashboard-table-card forecast-table-card full-width"><div className="forecast-head"><div><h2>پیش‌بینی وصولی ۱۰ روز آینده</h2><p>سفارش‌ها و فاکتورهایی که در روزهای آینده احتمال واریز دارند.</p></div><strong>{formatMoney(total)}</strong></div>{rows.length === 0 ? <div className="empty-chart small">وصولی نزدیک ثبت نشده است.</div> : <div className="dash-table-wrap"><table><thead><tr><th>مشتری</th><th>سفارش</th><th>تاریخ پیش‌بینی پرداخت</th><th>مبلغ قابل وصول</th><th>مرحله / پیشرفت</th><th>وضعیت</th></tr></thead><tbody>{rows.map((r) => <tr key={r.document_id}><td>{r.customer_name || '—'}</td><td dir="ltr">{r.order_code || r.doc_number || '—'}</td><td>{formatJalaliDate(r.expected_payment_date)}</td><td>{formatMoney(r.expected_amount)}</td><td>{r.current_stage_name_fa || '—'} · {formatNumber(r.progress_percent)}٪</td><td>{r.forecast_status === 'very_near' ? 'خیلی نزدیک' : r.forecast_status === 'near' ? 'نزدیک' : 'آینده'}</td></tr>)}</tbody></table></div>}</section>;
}

function ExecKpi({ icon: Icon, title, value, accent }) {
  return <div className={`exec-kpi ${accent}`}><Icon size={20}/><span>{title}</span><b>{value}</b></div>;
}

function HealthReport({ health }) {
  if (!health) return <div className="health-title"><Database size={18}/><b>Health Check</b><span className="bad">تابع سلامت هنوز اجرا نشده یا SQL 032 نصب نیست.</span></div>;
  const missingCount = (health.database?.missing_tables?.length || 0) + (health.database?.missing_views?.length || 0) + (health.database?.missing_functions?.length || 0);
  return <>
    <div className="health-title"><ShieldCheck size={18}/><b>سلامت دیتابیس و ماژول‌ها</b><span className={health.ok ? 'good' : 'bad'}>{health.ok ? 'سالم' : `${missingCount} مورد نیازمند بررسی`}</span></div>
    <div className="health-modules">{Object.entries(health.modules || {}).map(([k, ok]) => <span key={k} className={ok ? 'ok' : 'fail'}>{moduleLabel(k)}: {ok ? 'OK' : 'خطا'}</span>)}</div>
    {!health.ok && <details><summary>جزئیات خطاها</summary><pre>{JSON.stringify(health.database, null, 2)}</pre></details>}
  </>;
}

function ChartCard({ title, children, empty }) {
  return <div className="chart-card"><h2>{title}</h2>{empty ? <div className="empty-chart">داده‌ای برای نمودار نیست.</div> : children}</div>;
}

function InfoTable({ title, rows, columns }) {
  return <section className="dashboard-table-card"><h2>{title}</h2>{rows.length === 0 ? <div className="empty-chart small">داده‌ای نیست.</div> : <div className="dash-table-wrap"><table><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map(([key]) => <td key={key}>{formatCell(row[key], key)}</td>)}</tr>)}</tbody></table></div>}</section>;
}

function formatCell(value, key) {
  if (value === null || value === undefined || value === '') return '—';
  if (key.includes('date') || key === 'due_date') return formatJalaliDate(value);
  if (key.includes('amount') || key.includes('total')) return formatMoney(value);
  if (key.includes('percent')) return `${formatNumber(value)}٪`;
  if (key === 'direction') return value === 'receipt' ? 'واریز' : value === 'payment' ? 'برداشت' : value;
  return String(value);
}
function formatMoney(value) { return formatToman(value, 'fa'); }
function formatShortDate(value) { return formatJalaliDate(value, { month: '2-digit', day: '2-digit' }); }
function moduleLabel(k) { return ({ orders: 'سفارش', crm: 'CRM', warehouse: 'انبار', finance: 'مالی', production: 'تولید', rnd: 'R&D', shared_files: 'فایل‌ها' }[k] || k); }
