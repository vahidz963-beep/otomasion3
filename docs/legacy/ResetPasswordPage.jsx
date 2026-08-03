import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './LoginPage.css'; // از همون هویت بصری صفحه‌ی لاگین استفاده می‌کنه

const COPY = {
  fa: {
    title: 'تعیین رمز عبور جدید',
    subtitle: 'رمز عبور جدید خود را وارد کنید.',
    newPassword: 'رمز عبور جدید',
    confirmPassword: 'تکرار رمز عبور',
    submit: 'ذخیره‌ی رمز عبور',
    submitting: 'در حال ذخیره...',
    mismatch: 'رمز عبور و تکرار آن یکسان نیستند.',
    tooShort: 'رمز عبور باید حداقل ۸ کاراکتر باشد.',
    success: 'رمز عبور با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.',
    goToLogin: 'رفتن به صفحه‌ی ورود',
    error: 'لینک بازیابی نامعتبر یا منقضی شده است.',
  },
  en: {
    title: 'Set a new password',
    subtitle: 'Enter your new password below.',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    submit: 'Save password',
    submitting: 'Saving...',
    mismatch: 'Passwords do not match.',
    tooShort: 'Password must be at least 8 characters.',
    success: 'Password changed successfully. You can now sign in.',
    goToLogin: 'Go to sign in',
    error: 'This reset link is invalid or has expired.',
  },
};

export default function ResetPasswordPage({ lang = 'fa', onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const t = COPY[lang];
  const dir = lang === 'fa' ? 'rtl' : 'ltr';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError(t.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.mismatch);
      return;
    }

    setLoading(true);
    // supabase.auth.resetPasswordForEmail لینکی می‌سازه که با کلیک روی اون،
    // یک نشست موقت برای همین کاربر ست می‌شه؛ پس updateUser همینجا کار می‌کنه.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(t.error);
      return;
    }
    setDone(true);
  }

  return (
    <div className="login-screen" dir={dir} lang={lang}>
      <div className="login-card">
        <div className="gauge-rail" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="tick" style={{ opacity: 0.35 + i * 0.11 }} />
          ))}
        </div>

        {!done ? (
          <>
            <h1 className="login-title">{t.title}</h1>
            <p className="login-subtitle">{t.subtitle}</p>
            <form onSubmit={handleSubmit} className="login-form">
              <label className="field">
                <span>{t.newPassword}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span>{t.confirmPassword}</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? t.submitting : t.submit}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="login-title">{t.success}</h1>
            <button type="button" className="submit-btn" onClick={() => onDone?.()}>
              {t.goToLogin}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
