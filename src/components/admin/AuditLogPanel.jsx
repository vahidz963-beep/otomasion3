import { useEffect, useState } from 'react';
import { roleLabel, callAdminUsersFunction } from '../../lib/supabaseClient';
import { formatJalaliDateTime } from '../../lib/formatters';
import './AdminUserPanel.css';
import { getFriendlyErrorMessage, getTechnicalErrorMessage } from '../../lib/errorMessages';

const COPY = {
  fa: {
    title: 'تاریخچه‌ی تغییرات کاربران', subtitle: 'چه کسی، چه زمانی، چه تغییری روی نقش/وضعیت کاربران داده',
    colWhen: 'زمان', colAction: 'رویداد', colFrom: 'از', colTo: 'به', loading: 'در حال بارگذاری...', empty: 'هنوز رویدادی ثبت نشده.',
    actions: { created: 'ایجاد کاربر', role_changed: 'تغییر نقش', activated: 'فعال شد', deactivated: 'غیرفعال شد', deleted: 'حذف شد', password_reset_by_admin: 'رمز عبور توسط مدیر تغییر کرد' },
  },
  en: {
    title: 'User Change History', subtitle: 'Who changed a user’s role or status, and when',
    colWhen: 'When', colAction: 'Event', colFrom: 'From', colTo: 'To', loading: 'Loading...', empty: 'No events recorded yet.',
    actions: { created: 'User created', role_changed: 'Role changed', activated: 'Activated', deactivated: 'Deactivated', deleted: 'Deleted', password_reset_by_admin: 'Password reset by admin' },
  },
};

export default function AuditLogPanel({ lang = 'fa' }) {
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await callAdminUsersFunction('audit');
        setRows(res.logs || []);
        setNames(Object.fromEntries((res.profiles || []).map((p) => [p.id, p.full_name || p.email])));
      } catch (e) {
        setMsg(getFriendlyErrorMessage(e, 'خطا در دریافت تاریخچه'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmtValue = (row, value) => {
    if (row.action === 'role_changed' && value) return String(value).split(',').map((v) => roleLabel(v, lang)).join('، ');
    if ((row.action === 'activated' || row.action === 'deactivated') && value != null) return value === 'true' ? t.actions.activated : t.actions.deactivated;
    return value || '—';
  };

  return (
    <div className="admin-panel" dir={dir} lang={lang}>
      <header className="admin-header"><div><h2>{t.title}</h2><p>{t.subtitle}</p></div></header>
      {msg && <div className="admin-msg error">{msg}</div>}
      {loading ? <p className="hint">{t.loading}</p> : rows.length === 0 ? <p className="hint">{t.empty}</p> : (
        <div className="table-wrap">
          <table className="user-table">
            <thead><tr><th>{t.colWhen}</th><th>{t.colAction}</th><th>{t.colFrom}</th><th>{t.colTo}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{lang === 'fa' ? formatJalaliDateTime(r.created_at) : new Date(r.created_at).toLocaleString('en-US')}</td>
                  <td>{t.actions[r.action] || r.action} — {names[r.target_user_id] || r.target_user_id}</td>
                  <td>{fmtValue(r, r.old_value)}</td>
                  <td>{fmtValue(r, r.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
