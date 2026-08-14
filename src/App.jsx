import React, { Suspense, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './auth/LoginPage';
import ResetPasswordPage from './auth/ResetPasswordPage';
import { roleLabel } from './lib/supabaseClient';

const Dashboard = React.lazy(() => import('./modules/dashboard/Dashboard'));
const RnDModule = React.lazy(() => import('./modules/rnd/RnDModule'));
const OrdersModule = React.lazy(() => import('./modules/orders/OrdersModule'));
const WarehouseModule = React.lazy(() => import('./modules/warehouse/WarehouseModule'));
const ProductionModule = React.lazy(() => import('./modules/production/ProductionModule'));
const AccountingModule = React.lazy(() => import('./modules/accounting/AccountingModule'));
const OfficeAdminModule = React.lazy(() => import('./modules/office/OfficeAdminModule'));
const AdminUserPanel = React.lazy(() => import('./components/admin/AdminUserPanel'));
const AuditLogPanel = React.lazy(() => import('./components/admin/AuditLogPanel'));

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
  render() {
    if (this.state.error) {
      return <div style={{ padding: 24, direction: 'rtl', fontFamily: 'Vazirmatn, sans-serif' }}><div style={{ background: '#fff8f7', border: '1px solid #f1c5c0', color: '#a5453f', borderRadius: 16, padding: 16 }}>خطای نمایش ماژول: {this.state.error.message || 'خطای نامشخص'}<br />صفحه را به‌روزرسانی کنید یا از منوی بالا وارد بخش دیگری شوید.</div></div>;
    }
    return this.props.children;
  }
}

function ModuleLoading() {
  return <div style={{ padding: 32, direction: 'rtl', fontFamily: 'Vazirmatn, sans-serif' }}><div style={{ background: '#fff', borderRadius: 16, padding: 18, boxShadow: '0 1px 10px rgba(20,24,28,.07)', color: '#5b6670' }}>در حال بارگذاری ماژول...</div></div>;
}

function AppShell() {
  const { user, profile, loading, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');

  const lang = profile?.preferred_language || 'fa';
  const isResetRoute = window.location.pathname === '/reset-password';

  const modules = useMemo(() => [
    { key: 'dashboard', labelFa: 'داشبورد', labelEn: 'Dashboard', roles: ['admin', 'sales', 'sales_manager', 'rnd', 'production', 'warehouse', 'accountant', 'office_admin'], Component: Dashboard },
    { key: 'orders', labelFa: 'سفارش‌ها', labelEn: 'Orders', roles: ['admin', 'sales', 'sales_manager'], Component: OrdersModule },
    { key: 'rnd', labelFa: 'R&D', labelEn: 'R&D', roles: ['admin', 'rnd'], Component: RnDModule },
    { key: 'production', labelFa: 'تولید', labelEn: 'Production', roles: ['admin', 'production'], Component: ProductionModule },
    { key: 'warehouse', labelFa: 'انبار', labelEn: 'Warehouse', roles: ['admin', 'warehouse'], Component: WarehouseModule },
    { key: 'accounting', labelFa: 'مالی/حسابداری', labelEn: 'Accounting', roles: ['admin', 'accountant'], Component: AccountingModule },
    { key: 'office', labelFa: 'اداری', labelEn: 'Office', roles: ['admin', 'office_admin'], Component: OfficeAdminModule },
    { key: 'admin_users', labelFa: 'کاربران', labelEn: 'Users', roles: ['admin'], Component: AdminUserPanel },
    { key: 'audit', labelFa: 'تاریخچه', labelEn: 'Audit', roles: ['admin'], Component: AuditLogPanel },
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
          <button key={m.key} onClick={() => setActiveModule(m.key)} className={`nav-button ${current?.key === m.key ? 'active' : ''}`}>
            {lang === 'fa' ? m.labelFa : m.labelEn}
          </button>
        ))}
        <div className="nav-profile">
          <span>{profile.full_name || profile.email} · {roleText}</span>
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
