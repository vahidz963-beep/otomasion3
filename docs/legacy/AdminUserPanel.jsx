import { useEffect, useState } from 'react';
import { supabase, ROLES, roleLabel, callAdminUsersFunction } from '../lib/supabaseClient';
import './AdminUserPanel.css';

const COPY = {
  fa: {
    title: 'مدیریت کاربران',
    subtitle: 'افزودن، تغییر نقش و فعال/غیرفعال‌کردن کاربران سیستم',
    newUser: '+ کاربر جدید',
    name: 'نام و نام‌خانوادگی',
    email: 'ایمیل',
    password: 'رمز عبور اولیه',
    role: 'نقش',
    create: 'ایجاد کاربر',
    cancel: 'انصراف',
    colName: 'نام',
    colEmail: 'ایمیل',
    colRole: 'نقش',
    colStatus: 'وضعیت',
    colActions: 'عملیات',
    active: 'فعال',
    inactive: 'غیرفعال',
    deactivate: 'غیرفعال کردن',
    activate: 'فعال کردن',
    remove: 'حذف',
    resetPassword: 'تغییر رمز عبور',
    promptNewPassword: 'رمز عبور جدید برای این کاربر را وارد کنید (حداقل ۸ کاراکتر):',
    confirmRemove: 'این کاربر برای همیشه حذف شود؟',
    loading: 'در حال بارگذاری...',
    saved: 'ذخیره شد',
  },
  en: {
    title: 'User Management',
    subtitle: 'Add, change role, and activate/deactivate system users',
    newUser: '+ New user',
    name: 'Full name',
    email: 'Email',
    password: 'Initial password',
    role: 'Role',
    create: 'Create user',
    cancel: 'Cancel',
    colName: 'Name',
    colEmail: 'Email',
    colRole: 'Role',
    colStatus: 'Status',
    colActions: 'Actions',
    active: 'Active',
    inactive: 'Inactive',
    deactivate: 'Deactivate',
    activate: 'Activate',
    remove: 'Remove',
    resetPassword: 'Reset password',
    promptNewPassword: 'Enter a new password for this user (min 8 characters):',
    confirmRemove: 'Permanently delete this user?',
    loading: 'Loading...',
    saved: 'Saved',
  },
};

export default function AdminUserPanel({ lang = 'fa' }) {
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'sales' });
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active, created_at')
      .order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    await callAdminUsersFunction('create', form);
    setForm({ full_name: '', email: '', password: '', role: 'sales' });
    setShowForm(false);
    loadUsers();
  }

  async function handleRoleChange(user_id, role) {
    setBusyId(user_id);
    await callAdminUsersFunction('set_role', { user_id, role });
    await loadUsers();
    setBusyId(null);
  }

  async function handleToggleActive(user) {
    setBusyId(user.id);
    await callAdminUsersFunction('set_active', { user_id: user.id, is_active: !user.is_active });
    await loadUsers();
    setBusyId(null);
  }

  async function handleDelete(user_id) {
    if (!window.confirm(t.confirmRemove)) return;
    setBusyId(user_id);
    await callAdminUsersFunction('delete', { user_id });
    await loadUsers();
    setBusyId(null);
  }

  async function handleResetPassword(user_id) {
    const newPassword = window.prompt(t.promptNewPassword);
    if (!newPassword) return;
    setBusyId(user_id);
    await callAdminUsersFunction('reset_password', { user_id, new_password: newPassword });
    setBusyId(null);
  }

  return (
    <div className="admin-panel" dir={dir} lang={lang}>
      <header className="admin-header">
        <div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <button className="primary-btn" onClick={() => setShowForm((s) => !s)}>
          {t.newUser}
        </button>
      </header>

      {showForm && (
        <form className="create-form" onSubmit={handleCreate}>
          <input
            placeholder={t.name}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder={t.email}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder={t.password}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r[lang]}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button type="submit" className="primary-btn">{t.create}</button>
            <button type="button" className="ghost-btn" onClick={() => setShowForm(false)}>
              {t.cancel}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="hint">{t.loading}</p>
      ) : (
        <table className="user-table">
          <thead>
            <tr>
              <th>{t.colName}</th>
              <th>{t.colRole}</th>
              <th>{t.colStatus}</th>
              <th>{t.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={busyId === u.id ? 'row-busy' : ''}>
                <td>{u.full_name}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    disabled={busyId === u.id}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r[lang]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`status-badge ${u.is_active ? 'is-active' : 'is-inactive'}`}>
                    {u.is_active ? t.active : t.inactive}
                  </span>
                </td>
                <td className="actions-cell">
                  <button
                    className="ghost-btn"
                    disabled={busyId === u.id}
                    onClick={() => handleToggleActive(u)}
                  >
                    {u.is_active ? t.deactivate : t.activate}
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={busyId === u.id}
                    onClick={() => handleResetPassword(u.id)}
                  >
                    {t.resetPassword}
                  </button>
                  <button
                    className="danger-btn"
                    disabled={busyId === u.id}
                    onClick={() => handleDelete(u.id)}
                  >
                    {t.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
