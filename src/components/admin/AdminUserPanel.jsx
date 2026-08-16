import { useEffect, useState } from 'react';
import { ROLES, roleLabel, callAdminUsersFunction } from '../../lib/supabaseClient';
import './AdminUserPanel.css';

const COPY = {
  fa: {
    title: 'مدیریت کاربران', subtitle: 'افزودن، تغییر نقش و فعال/غیرفعال‌کردن کاربران سیستم',
    newUser: '+ کاربر جدید', name: 'نام و نام‌خانوادگی', email: 'ایمیل', password: 'رمز عبور اولیه', role: 'نقش',
    create: 'ایجاد کاربر', cancel: 'انصراف', colName: 'نام', colEmail: 'ایمیل', colRole: 'نقش', colStatus: 'وضعیت', colActions: 'عملیات',
    active: 'فعال', inactive: 'غیرفعال', deactivate: 'غیرفعال کردن', activate: 'فعال کردن', remove: 'حذف', resetPassword: 'تغییر رمز عبور',
    promptNewPassword: 'رمز عبور جدید برای این کاربر را وارد کنید (حداقل ۸ کاراکتر):', confirmRemove: 'این کاربر برای همیشه حذف شود؟',
    loading: 'در حال بارگذاری...', saved: 'ذخیره شد', error: 'خطا',
  },
  en: {
    title: 'User Management', subtitle: 'Add, change role, and activate/deactivate system users',
    newUser: '+ New user', name: 'Full name', email: 'Email', password: 'Initial password', role: 'Role',
    create: 'Create user', cancel: 'Cancel', colName: 'Name', colEmail: 'Email', colRole: 'Role', colStatus: 'Status', colActions: 'Actions',
    active: 'Active', inactive: 'Inactive', deactivate: 'Deactivate', activate: 'Activate', remove: 'Remove', resetPassword: 'Reset password',
    promptNewPassword: 'Enter a new password for this user (min 8 characters):', confirmRemove: 'Permanently delete this user?',
    loading: 'Loading...', saved: 'Saved', error: 'Error',
  },
};

export default function AdminUserPanel({ lang = 'fa' }) {
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'sales_manager', roles: ['sales_manager'] });
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');

  async function loadUsers() {
    setLoading(true);
    setMsg('');
    try {
      const res = await callAdminUsersFunction('list');
      setUsers(res.users || []);
    } catch (e) {
      setMsg(`${t.error}: ${e.message}`);
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
    } catch (e) {
      setMsg(`${t.error}: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    await run('create', { ...form, role: form.roles[0] || form.role }, 'create');
    setForm({ full_name: '', email: '', password: '', role: 'sales_manager', roles: ['sales_manager'] });
    setShowForm(false);
  }

  async function handleRoleChange(user_id, role) {
    await run('set_role', { user_id, role }, user_id);
  }

  async function handleToggleActive(user) {
    await run('set_active', { user_id: user.id, is_active: !user.is_active }, user.id);
  }

  async function handleDelete(user_id) {
    if (!window.confirm(t.confirmRemove)) return;
    await run('delete', { user_id }, user_id);
  }

  async function handleResetPassword(user_id) {
    const newPassword = window.prompt(t.promptNewPassword);
    if (!newPassword) return;
    await run('reset_password', { user_id, new_password: newPassword }, user_id);
  }

  function toggleFormRole(role) {
    setForm((f) => {
      const exists = f.roles.includes(role);
      let roles = exists ? f.roles.filter((r) => r !== role) : [...f.roles, role];
      roles = roles.slice(0, 3);
      return { ...f, roles, role: roles[0] || f.role };
    });
  }

  async function handleRolesChange(user, role) {
    const current = user.additional_roles?.length ? user.additional_roles : [user.role];
    const exists = current.includes(role);
    let roles = exists ? current.filter((r) => r !== role) : [...current, role];
    roles = roles.slice(0, 3);
    if (roles.length === 0) roles = [user.role];
    await run('set_role', { user_id: user.id, role: roles[0], roles }, user.id);
  }

  return (
    <div className="admin-panel" dir={dir} lang={lang}>
      <header className="admin-header">
        <div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" className="primary-btn" onClick={() => setShowForm((v) => !v)}>{showForm ? t.cancel : t.newUser}</button>
      </header>

      {msg && <div className={msg.startsWith(t.error) ? 'admin-msg error' : 'admin-msg'}>{msg}</div>}

      {showForm && (
        <form className="user-form" onSubmit={handleCreate}>
          <input required placeholder={t.name} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input required type="email" dir="ltr" placeholder={t.email} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="password" dir="ltr" placeholder={t.password} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} />
          <div className="role-checks">{ROLES.filter((r) => r.value !== 'admin').map((r) => <label key={r.value}><input type="checkbox" checked={form.roles.includes(r.value)} disabled={!form.roles.includes(r.value) && form.roles.length >= 3} onChange={() => toggleFormRole(r.value)} /> <span>{lang === 'fa' ? r.labelFa : r.labelEn}</span></label>)}</div>
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
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || '—'}</td>
                  <td dir="ltr">{u.email || '—'}</td>
                  <td>
                    <div className="role-checks inline">{ROLES.map((r) => { const userRoles = u.additional_roles?.length ? u.additional_roles : [u.role]; return <label key={r.value}><input type="checkbox" checked={userRoles.includes(r.value)} disabled={busyId === u.id || (!userRoles.includes(r.value) && userRoles.length >= 3)} onChange={() => handleRolesChange(u, r.value)} /> <span>{roleLabel(r.value, lang)}</span></label>; })}</div>
                  </td>
                  <td><span className={u.is_active ? 'status active' : 'status inactive'}>{u.is_active ? t.active : t.inactive}</span></td>
                  <td className="actions">
                    <button type="button" onClick={() => handleToggleActive(u)} disabled={busyId === u.id}>{u.is_active ? t.deactivate : t.activate}</button>
                    <button type="button" onClick={() => handleResetPassword(u.id)} disabled={busyId === u.id}>{t.resetPassword}</button>
                    <button type="button" className="danger" onClick={() => handleDelete(u.id)} disabled={busyId === u.id}>{t.remove}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
