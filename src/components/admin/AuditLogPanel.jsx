import { useEffect, useState } from 'react';
import { supabase, roleLabel } from '../../lib/supabaseClient';
import './AdminUserPanel.css';

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

  useEffect(() => {
    (async () => {
      const { data: logs } = await supabase
        .from('audit_log')
        .select('id, actor_id, target_user_id, action, old_value, new_value, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      const { data: profiles } = await supabase.from('profiles').select('id, full_name');
      setNames(Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name])));
      setRows(logs || []);
      setLoading(false);
    })();
  }, []);

  const fmtValue = (row, value) => {
    if (row.action === 'role_changed' && value) return roleLabel(value, lang);
    if ((row.action === 'activated' || row.action === 'deactivated') && value != null) return value === 'true' ? t.actions.activated : t.actions.deactivated;
    return value || '—';
  };

  return (
    <div className="admin-panel" dir={dir} lang={lang}>
      <header className="admin-header"><div><h2>{t.title}</h2><p>{t.subtitle}</p></div></header>
      {loading ? <p className="hint">{t.loading}</p> : rows.length === 0 ? <p className="hint">{t.empty}</p> : (
        <div className="table-wrap">
          <table className="user-table">
            <thead><tr><th>{t.colWhen}</th><th>{t.colAction}</th><th>{t.colFrom}</th><th>{t.colTo}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')}</td>
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
