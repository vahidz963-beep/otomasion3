import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './auth/LoginPage';
import ResetPasswordPage from './auth/ResetPasswordPage';
import { roleLabel } from './lib/supabaseClient';

const moduleLoaders = {
  dashboard: () => import('./modules/dashboard/Dashboard'),
  rnd: () => import('./modules/rnd/RnDModule'),
  orders: () => import('./modules/orders/OrdersModule'),
  warehouse: () => import('./modules/warehouse/WarehouseModule'),
  production: () => import('./modules/production/ProductionModule'),
  accounting: () => import('./modules/accounting/AccountingModule'),
  office: () => import('./modules/office/OfficeAdminModule'),
  adminUsers: () => import('./components/admin/AdminUserPanel'),
  audit: () => import('./components/admin/AuditLogPanel'),
};

const Dashboard = React.lazy(moduleLoaders.dashboard);
const RnDModule = React.lazy(moduleLoaders.rnd);
const OrdersModule = React.lazy(moduleLoaders.orders);
const WarehouseModule = React.lazy(moduleLoaders.warehouse);
const ProductionModule = React.lazy(moduleLoaders.production);
const AccountingModule = React.lazy(moduleLoaders.accounting);
const OfficeAdminModule = React.lazy(moduleLoaders.office);
const AdminUserPanel = React.lazy(moduleLoaders.adminUsers);
const AuditLogPanel = React.lazy(moduleLoaders.audit);

function isAssetPreloadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('unable to preload css')
    || message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('css chunk')
    || message.includes('/assets/');
}

class ModuleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  componentDidCatch(error) {
    if (!isAssetPreloadError(error)) return;
    const key = 'aryaman_asset_reload_once';
    if (window.sessionStorage.getItem(key) === '1') return;
    window.sessionStorage.setItem(key, '1');
    window.location.reload();
  }
  render() {
    if (this.state.error) {
      const assetError = isAssetPreloadError(this.state.error);
      return <div style={{ padding: 24, direction: 'rtl', fontFamily: 'Vazirmatn, sans-serif' }}><div style={{ background: '#fff8f7', border: '1px solid #f1c5c0', color: '#a5453f', borderRadius: 16, padding: 16, lineHeight: 1.9 }}>
        <b>خطای نمایش ماژول:</b> {this.state.error.message || 'خطای نامشخص'}<br />
        {assetError ? 'نسخه جدید سایت Deploy شده ولی مرورگر هنوز فایل قدیمی را از Cache می‌خواهد. یک بار به‌روزرسانی کامل انجام دهید.' : 'صفحه را به‌روزرسانی کنید یا از منوی بالا وارد بخش دیگری شوید.'}
        <br />
        <button type="button" onClick={() => { window.sessionStorage.removeItem('aryaman_asset_reload_once'); window.location.reload(); }} style={{ marginTop: 10, border: 0, borderRadius: 10, background: '#10243d', color: '#fff', padding: '8px 12px', cursor: 'pointer', fontWeight: 800 }}>به‌روزرسانی کامل صفحه</button>
      </div></div>;
    }
    return this.props.children;
  }
}

function ModuleLoading() {
  return <div style={{ padding: 32, direction: 'rtl', fontFamily: 'Vazirmatn, sans-serif' }}><div style={{ background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 10px rgba(20,24,28,.07)', color: '#5b6670' }}>در حال بارگذاری ماژول...</div></div>;
}

function ConnectionStatus({ lang = 'fa' }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  const label = online ? (lang === 'fa' ? 'آنلاین' : 'Online') : (lang === 'fa' ? 'آفلاین' : 'Offline');
  return <span title={online ? 'ارتباط اینترنتی برقرار است' : 'ارتباط اینترنتی قطع است؛ فرم‌ها را نبندید و بعداً دوباره تلاش کنید'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 9px', background: online ? '#e5f3eb' : '#fff1d6', color: online ? '#25694a' : '#8a5c10', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' }}><i style={{ width: 8, height: 8, borderRadius: 999, background: online ? '#22a06b' : '#c9932b', display: 'inline-block' }} />{label}</span>;
}

function AppShell() {
  const { user, profile, loading, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');

  const lang = profile?.preferred_language || 'fa';
  const isResetRoute = window.location.pathname === '/reset-password';

  const modules = useMemo(() => [
    { key: 'dashboard', labelFa: 'داشبورد', labelEn: 'Dashboard', roles: ['admin', 'sales', 'sales_manager', 'rnd', 'production', 'warehouse', 'accountant', 'office_admin'], Component: Dashboard, preload: moduleLoaders.dashboard },
    { key: 'orders', labelFa: 'سفارش‌ها', labelEn: 'Orders', roles: ['admin', 'sales', 'sales_manager'], Component: OrdersModule, preload: moduleLoaders.orders },
    { key: 'rnd', labelFa: 'R&D', labelEn: 'R&D', roles: ['admin', 'rnd'], Component: RnDModule, preload: moduleLoaders.rnd },
    { key: 'production', labelFa: 'تولید', labelEn: 'Production', roles: ['admin', 'production'], Component: ProductionModule, preload: moduleLoaders.production },
    { key: 'warehouse', labelFa: 'انبار', labelEn: 'Warehouse', roles: ['admin', 'warehouse'], Component: WarehouseModule, preload: moduleLoaders.warehouse },
    { key: 'accounting', labelFa: 'مالی/حسابداری', labelEn: 'Accounting', roles: ['admin', 'accountant'], Component: AccountingModule, preload: moduleLoaders.accounting },
    { key: 'office', labelFa: 'اداری', labelEn: 'Office', roles: ['admin', 'office_admin'], Component: OfficeAdminModule, preload: moduleLoaders.office },
    { key: 'admin_users', labelFa: 'کاربران', labelEn: 'Users', roles: ['admin'], Component: AdminUserPanel, preload: moduleLoaders.adminUsers },
    { key: 'audit', labelFa: 'تاریخچه', labelEn: 'Audit', roles: ['admin'], Component: AuditLogPanel, preload: moduleLoaders.audit },
  ], []);

  if (isResetRoute) return <ResetPasswordPage lang="fa" onDone={() => { window.location.href = '/'; }} />;
  if (loading) return <div style={{ padding: 40 }}>در حال بارگذاری...</div>;
  if (!user) return <LoginPage />;

  if (!profile || !profile.is_active) {
    return (
      <div style={{ padding: 40, fontFamily: 'Vazirmatn, sans-serif' }} dir="rtl">
        دسترسی این حساب فعال نیست. با مدیر سیستم تماس بگیرید.
        <button onClick={signOut} style={{ display: 'block', marginTop: 12 }}>خروج</button>
      </div>
    );
  }

  const userRoles = [...new Set([profile.role, ...(profile.additional_roles || [])].filter(Boolean))];
  const isAdmin = userRoles.includes('admin');
  const visibleModules = modules.filter((m) => isAdmin || m.roles.some((role) => userRoles.includes(role)));
  const current = visibleModules.find((m) => m.key === activeModule) || visibleModules[0];
  const roleText = userRoles.map((role) => roleLabel(role, lang)).join('، ');
  const CurrentComponent = current?.Component;

  return (
    <div dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <nav className="app-nav">
        <div className="app-brand">
          <img src="/assets/aryaman-logo.png" alt="Aryaman" />
          <span>{lang === 'fa' ? 'اتوماسیون آریامن' : 'Aryaman Automation'}</span>
        </div>
        {visibleModules.map((m) => (
          <button key={m.key} onMouseEnter={() => m.preload?.()} onFocus={() => m.preload?.()} onClick={() => setActiveModule(m.key)} className={`nav-button ${current?.key === m.key ? 'active' : ''}`}>
            {lang === 'fa' ? m.labelFa : m.labelEn}
          </button>
        ))}
        <div className="nav-profile">
          <ConnectionStatus lang={lang} /><span>{profile.full_name || profile.email} · {roleText}</span>
          <button onClick={signOut} className="nav-logout">{lang === 'fa' ? 'خروج' : 'Sign out'}</button>
        </div>
      </nav>
      <main className="page-shell">
        {CurrentComponent ? <ModuleErrorBoundary resetKey={current?.key}><Suspense fallback={<ModuleLoading />}><CurrentComponent lang={lang} /></Suspense></ModuleErrorBoundary> : <div style={{ padding: 40 }}>هیچ ماژولی برای نقش شما فعال نیست.</div>}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
