import { useEffect, useState } from 'react';
import { ROLES, roleLabel, callAdminUsersFunction } from '../../lib/supabaseClient';
import { getFriendlyErrorMessage } from '../../lib/errorMessages';
import './AdminUserPanel.css';

const COPY = {
  fa: {
    title: 'مدیریت کاربران', subtitle: 'افزودن، تغییر نقش و فعال/غیرفعال‌کردن کاربران سیستم',
    newUser: '+ کاربر جدید', name: 'نام و نام‌خانوادگی', email: 'ایمیل', password: 'رمز عبور اولیه', role: 'نقش',
    create: 'ایجاد کاربر', cancel: 'انصراف', colName: 'نام', colEmail: 'ایمیل', colRole: 'نقش', colStatus: 'وضعیت', colActions: 'عملیات',
    active: 'فعال', inactive: 'غیرفعال', deactivate: 'غیرفعال کردن', activate: 'فعال کردن', remove: 'حذف', resetPassword: 'تغییر رمز عبور',
    confirmRemoveTitle: 'تأیید حذف کاربر', confirmRemove: 'این کاربر از سیستم احراز هویت و جدول کاربران حذف می‌شود. آیا مطمئن هستید؟',
    resetPasswordTitle: 'تغییر رمز عبور کاربر', promptNewPassword: 'رمز عبور جدید را وارد کنید. رمز باید حداقل ۸ کاراکتر باشد.',
    confirm: 'تأیید', close: 'بستن', retry: 'بارگذاری مجدد', empty: 'هنوز کاربری برای نمایش وجود ندارد.',
    loading: 'در حال بارگذاری...', saved: 'ذخیره شد', error: 'خطا', passwordTooShort: 'رمز عبور باید حداقل ۸ کاراکتر باشد.',
  },
  en: {
    title: 'User Management', subtitle: 'Add, change role, and activate/deactivate system users',
    newUser: '+ New user', name: 'Full name', email: 'Email', password: 'Initial password', role: 'Role',
    create: 'Create user', cancel: 'Cancel', colName: 'Name', colEmail: 'Email', colRole: 'Role', colStatus: 'Status', colActions: 'Actions',
    active: 'Active', inactive: 'Inactive', deactivate: 'Deactivate', activate: 'Activate', remove: 'Remove', resetPassword: 'Reset password',
    confirmRemoveTitle: 'Confirm user deletion', confirmRemove: 'This user will be removed from Auth and the users table. Are you sure?',
    resetPasswordTitle: 'Reset user password', promptNewPassword: 'Enter a new password. It must be at least 8 characters.',
    confirm: 'Confirm', close: 'Close', retry: 'Reload', empty: 'No users to show yet.',
    loading: 'Loading...', saved: 'Saved', error: 'Error', passwordTooShort: 'Password must be at least 8 characters.',
  },
};

const initialForm = { full_name: '', email: '', password: '', role: 'sales', roles: ['sales'] };

export default function AdminUserPanel({ lang = 'fa' }) {
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [dialog, setDialog] = useState(null);

  function formatError(error, fallback = 'خطا در اجرای عملیات') {
    const message = getFriendlyErrorMessage(error, fallback);
    return `${t.error}: ${message}`;
  }

  async function loadUsers() {
    setLoading(true);
    setMsg('');
    try {
      const res = await callAdminUsersFunction('list');
      setUsers(res.users || []);
    } catch (e) {
      setMsg(formatError(e, 'خطا در دریافت کاربران'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action, payload, idForBusy = 'global') {
    setMsg('');
    setBusyId(idForBusy);
    try {
      await callAdminUsersFunction(action, payload);
      setMsg(t.saved);
      await loadUsers();
      return true;
    } catch (e) {
      setMsg(formatError(e));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const ok = await run('create', { ...form, role: form.roles[0] || form.role }, 'create');
    if (ok) {
      setForm(initialForm);
      setShowForm(false);
    }
  }

  async function handleToggleActive(user) {
    await run('set_active', { user_id: user.id, is_active: !user.is_active }, user.id);
  }

  function handleDelete(user) {
    setDialog({ kind: 'delete', user_id: user.id, title: t.confirmRemoveTitle, body: `${t.confirmRemove}\n${user.full_name || user.email || ''}` });
  }

  function handleResetPassword(user) {
    setDialog({ kind: 'password', user_id: user.id, title: t.resetPasswordTitle, body: `${t.promptNewPassword}\n${user.full_name || user.email || ''}`, password: '' });
  }

  function toggleFormRole(role) {
    setForm((f) => {
      const exists = f.roles.includes(role);
      if (exists && f.roles.length <= 1) return f;
      let roles = exists ? f.roles.filter((r) => r !== role) : [...f.roles, role];
      roles = roles.slice(0, 3);
      return { ...f, roles, role: roles[0] || f.role };
    });
  }

  async function handleRolesChange(user, role) {
    const current = user.additional_roles?.length ? user.additional_roles : [user.role];
    const exists = current.includes(role);
    if (exists && current.length <= 1) return;
    let roles = exists ? current.filter((r) => r !== role) : [...current, role];
    roles = roles.slice(0, 3);
    if (roles.length === 0) roles = [user.role];
    await run('set_role', { user_id: user.id, role: roles[0], roles }, user.id);
  }

  async function confirmDialogAction() {
    if (!dialog) return;

    if (dialog.kind === 'delete') {
      const ok = await run('delete', { user_id: dialog.user_id }, dialog.user_id);
      if (ok) setDialog(null);
      return;
    }

    if (dialog.kind === 'password') {
      if (!dialog.password || dialog.password.length < 8) {
        setMsg(formatError(new Error(t.passwordTooShort)));
        return;
      }
      const ok = await run('reset_password', { user_id: dialog.user_id, new_password: dialog.password }, dialog.user_id);
      if (ok) setDialog(null);
    }
  }

  return (
    <div className="admin-panel" dir={dir} lang={lang}>
      <header className="admin-header">
        <div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="secondary-btn" onClick={loadUsers} disabled={loading || !!busyId}>{t.retry}</button>
          <button type="button" className="primary-btn" onClick={() => setShowForm((v) => !v)}>{showForm ? t.cancel : t.newUser}</button>
        </div>
      </header>

      {msg && <div className={msg.startsWith(t.error) ? 'admin-msg error' : 'admin-msg'}>{msg}</div>}

      {showForm && (
        <form className="user-form" onSubmit={handleCreate}>
          <input required placeholder={t.name} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input required type="email" dir="ltr" placeholder={t.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="password" dir="ltr" placeholder={t.password} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} />
          <div className="role-checks">{ROLES.filter((r) => r.value !== 'admin').map((r) => <label key={r.value}><input type="checkbox" checked={form.roles.includes(r.value)} disabled={(form.roles.includes(r.value) && form.roles.length <= 1) || (!form.roles.includes(r.value) && form.roles.length >= 3)} onChange={() => toggleFormRole(r.value)} /> <span>{lang === 'fa' ? r.labelFa : r.labelEn}</span></label>)}</div>
          <button type="submit" className="primary-btn" disabled={busyId === 'create'}>{t.create}</button>
        </form>
      )}

      {loading ? <p className="hint">{t.loading}</p> : (
        <div className="table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>{t.colName}</th><th>{t.colEmail}</th><th>{t.colRole}</th><th>{t.colStatus}</th><th>{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td className="empty-cell" colSpan={5}>{t.empty}</td></tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || '—'}</td>
                  <td dir="ltr">{u.email || '—'}</td>
                  <td>
                    <div className="role-checks inline">{ROLES.map((r) => { const userRoles = u.additional_roles?.length ? u.additional_roles : [u.role]; return <label key={r.value}><input type="checkbox" checked={userRoles.includes(r.value)} disabled={busyId === u.id || (userRoles.includes(r.value) && userRoles.length <= 1) || (!userRoles.includes(r.value) && userRoles.length >= 3)} onChange={() => handleRolesChange(u, r.value)} /> <span>{roleLabel(r.value, lang)}</span></label>; })}</div>
                  </td>
                  <td><span className={u.is_active ? 'status active' : 'status inactive'}>{u.is_active ? t.active : t.inactive}</span></td>
                  <td className="actions">
                    <button type="button" onClick={() => handleToggleActive(u)} disabled={busyId === u.id}>{u.is_active ? t.deactivate : t.activate}</button>
                    <button type="button" onClick={() => handleResetPassword(u)} disabled={busyId === u.id}>{t.resetPassword}</button>
                    <button type="button" className="danger" onClick={() => handleDelete(u)} disabled={busyId === u.id}>{t.remove}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div className="admin-modal" role="dialog" aria-modal="true" aria-label={dialog.title}>
            <button type="button" className="admin-modal-close" onClick={() => setDialog(null)}>×</button>
            <h3>{dialog.title}</h3>
            <p>{dialog.body}</p>
            {dialog.kind === 'password' && (
              <input
                autoFocus
                type="password"
                dir="ltr"
                minLength={8}
                placeholder={t.password}
                value={dialog.password || ''}
                onChange={(e) => setDialog((d) => ({ ...d, password: e.target.value }))}
              />
            )}
            <div className="admin-modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>{t.cancel}</button>
              <button type="button" className={dialog.kind === 'delete' ? 'danger-btn' : 'primary-btn'} onClick={confirmDialogAction} disabled={busyId === dialog.user_id}>{t.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
