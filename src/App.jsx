import React, { useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './auth/LoginPage';
import ResetPasswordPage from './auth/ResetPasswordPage';
import Dashboard from './modules/dashboard/Dashboard';
import RnDModule from './modules/rnd/RnDModule';
import OrdersModule from './modules/orders/OrdersModule';
import WarehouseModule from './modules/warehouse/WarehouseModule';
import AdminUserPanel from './components/admin/AdminUserPanel';
import AuditLogPanel from './components/admin/AuditLogPanel';
import PlaceholderModule from './modules/placeholder/PlaceholderModule';
import AccountingModule from './modules/accounting/AccountingModule';
import { roleLabel } from './lib/supabaseClient';

function AppShell() {
  const { user, profile, loading, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');

  const lang = profile?.preferred_language || 'fa';
  const isResetRoute = window.location.pathname === '/reset-password';

  const modules = useMemo(() => [
    { key: 'dashboard', labelFa: 'داشبورد', labelEn: 'Dashboard', roles: ['admin', 'sales', 'rnd', 'production', 'warehouse', 'accountant', 'office_admin'], Component: Dashboard },
    { key: 'orders', labelFa: 'سفارش‌ها', labelEn: 'Orders', roles: ['admin', 'sales', 'rnd', 'production', 'warehouse', 'accountant'], Component: OrdersModule },
    { key: 'rnd', labelFa: 'R&D', labelEn: 'R&D', roles: ['admin', 'rnd', 'sales', 'accountant'], Component: RnDModule },
    { key: 'production', labelFa: 'تولید', labelEn: 'Production', roles: ['admin', 'production', 'warehouse', 'accountant'], Component: (props) => <PlaceholderModule title={props.lang === 'fa' ? 'تولید' : 'Production'} {...props} /> },
    { key: 'warehouse', labelFa: 'انبار', labelEn: 'Warehouse', roles: ['admin', 'warehouse', 'production', 'sales', 'accountant'], Component: WarehouseModule },
    { key: 'accounting', labelFa: 'مالی/حسابداری', labelEn: 'Accounting', roles: ['admin', 'accountant'], Component: AccountingModule },
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

  const visibleModules = modules.filter((m) => m.roles.includes(profile.role));
  const current = visibleModules.find((m) => m.key === activeModule) || visibleModules[0];

  const CurrentComponent = current?.Component;

  return (
    <div dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <nav className="app-nav">
        {visibleModules.map((m) => (
          <button key={m.key} onClick={() => setActiveModule(m.key)} className={`nav-button ${current?.key === m.key ? 'active' : ''}`}>
            {lang === 'fa' ? m.labelFa : m.labelEn}
          </button>
        ))}
        <div className="nav-profile">
          <span>{profile.full_name || profile.email} · {roleLabel(profile.role, lang)}</span>
          <button onClick={signOut} className="nav-logout">{lang === 'fa' ? 'خروج' : 'Sign out'}</button>
        </div>
      </nav>
      <main className="page-shell">
        {CurrentComponent ? <CurrentComponent lang={lang} /> : <div style={{ padding: 40 }}>هیچ ماژولی برای نقش شما فعال نیست.</div>}
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
