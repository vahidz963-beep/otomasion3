import React, { useState } from 'react';
import { Cpu, Globe, LogIn } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabaseClient';
import './LoginPage.css';
import { getFriendlyErrorMessage, getTechnicalErrorMessage } from '../lib/errorMessages';

const COPY = {
  fa: {
    company: 'اتوماسیون آریامن',
    subtitle: 'ورود کاربران',
    email: 'ایمیل',
    password: 'رمز عبور',
    submit: 'ورود',
    submitting: 'در حال ورود...',
    noAccount: 'حساب کاربری نداری؟ با مدیر سیستم تماس بگیر.',
    forgot: 'فراموشی رمز عبور',
    resetSent: 'اگر ایمیل معتبر باشد، لینک بازیابی رمز ارسال می‌شود.',
  },
  en: {
    company: 'Aryaman Automation System',
    subtitle: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in...',
    noAccount: "Don't have an account? Contact your system admin.",
    forgot: 'Forgot password?',
    resetSent: 'If the email exists, a reset link will be sent.',
  },
};

export default function LoginPage() {
  const { signIn } = useAuth();
  const [lang, setLang] = useState('fa');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState('');

  const isFa = lang === 'fa';
  const t = COPY[lang];

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setNotice('');
    setSubmitting(true);
    const res = await signIn(email, password);
    setSubmitting(false);
    if (!res.ok) setFormError(res.error);
  }

  async function handleResetPassword() {
    setFormError(null);
    setNotice('');
    if (!email) {
      setFormError(isFa ? 'ابتدا ایمیل را وارد کنید.' : 'Enter your email first.');
      return;
    }
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) setFormError(getFriendlyErrorMessage(error, 'ورود انجام نشد. اطلاعات را بررسی کنید.'));
    else setNotice(t.resetSent);
  }

  return (
    <div className="login-screen" dir={isFa ? 'rtl' : 'ltr'}>
      <div className="login-lang">
        <button type="button" onClick={() => setLang(isFa ? 'en' : 'fa')}>
          <Globe size={15} /> {isFa ? 'EN' : 'فا'}
        </button>
      </div>

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo"><img src="/assets/aryaman-logo.png" alt="Aryaman" /></div>
          <div>
            <div className="login-title-small">{t.company}</div>
            <div className="login-subtitle-small">{t.subtitle}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>{t.email}</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" />
          </label>
          <label className="field">
            <span>{t.password}</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" />
          </label>

          {formError && <p className="form-error" role="alert">{formError}</p>}
          {notice && <p className="form-notice" role="status">{notice}</p>}

          <button type="submit" className="submit-btn" disabled={submitting}>
            <LogIn size={16} /> {submitting ? t.submitting : t.submit}
          </button>
          <button type="button" className="link-btn" onClick={handleResetPassword}>{t.forgot}</button>
        </form>

        <p className="login-hint">{t.noAccount}</p>
      </div>
    </div>
  );
}
