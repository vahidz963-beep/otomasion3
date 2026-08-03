import React, { useState } from "react";
import { Cpu, Globe, LogIn } from "lucide-react";
import { useAuth } from "./AuthProvider";

const C = {
  graphite900: "#14181C",
  graphite800: "#1E252B",
  graphiteLine: "#2B333A",
  paper: "#F3F5F6",
  paperDim: "#E7EAEC",
  ink: "#1B2126",
  inkDim: "#5B6670",
  copper: "#A8672E",
  copperLight: "#E7C39C",
  red: "#A5453F",
};

const T = {
  fa: {
    company: "سامانه اتوماسیون شرکت",
    subtitle: "ورود کاربران",
    email: "ایمیل",
    password: "رمز عبور",
    submit: "ورود",
    submitting: "در حال ورود...",
    noAccount: "حساب کاربری نداری؟ با مدیر سیستم تماس بگیر.",
  },
  en: {
    company: "Company Automation System",
    subtitle: "Sign in",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in...",
    noAccount: "Don't have an account? Contact your system admin.",
  },
};

export default function LoginPage() {
  const { signIn } = useAuth();
  const [lang, setLang] = useState("fa");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const isFa = lang === "fa";
  const t = T[lang];

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const res = await signIn(email, password);
    setSubmitting(false);
    if (!res.ok) setFormError(res.error);
  }

  return (
    <div
      dir={isFa ? "rtl" : "ltr"}
      style={{
        fontFamily: "'Vazirmatn', sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.graphite900,
        padding: 20,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap');
      `}</style>

      <div style={{ position: "absolute", top: 20, [isFa ? "left" : "right"]: 20 }}>
        <button
          onClick={() => setLang(isFa ? "en" : "fa")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "transparent",
            color: "#fff", border: `1px solid ${C.graphiteLine}`, borderRadius: 10,
            padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <Globe size={15} /> {isFa ? "EN" : "فا"}
        </button>
      </div>

      <div style={{ width: "min(380px, 92vw)", background: "#fff", borderRadius: 16, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ background: C.graphite900, borderRadius: 10, padding: 8, display: "flex" }}>
            <Cpu size={18} color={C.copperLight} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{t.company}</div>
            <div style={{ fontSize: 12, color: C.inkDim }}>{t.subtitle}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.inkDim, display: "block", marginBottom: 4 }}>{t.email}</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.paperDim}`, fontSize: 14, fontFamily: "inherit" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.inkDim, display: "block", marginBottom: 4 }}>{t.password}</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.paperDim}`, fontSize: 14, fontFamily: "inherit" }}
            />
          </div>

          {formError && (
            <div style={{ fontSize: 12, color: C.red, background: "#F7E5E3", borderRadius: 8, padding: "8px 10px" }}>
              {formError}
            </div>
          )}

          <button
            type="submit" disabled={submitting}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: C.copper, color: "#fff", border: "none", borderRadius: 10,
              padding: "11px 0", fontSize: 14, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.7 : 1, marginTop: 4,
            }}
          >
            <LogIn size={16} /> {submitting ? t.submitting : t.submit}
          </button>
        </form>

        <p style={{ fontSize: 11, color: C.inkDim, textAlign: "center", marginTop: 16 }}>{t.noAccount}</p>
      </div>
    </div>
  );
}
