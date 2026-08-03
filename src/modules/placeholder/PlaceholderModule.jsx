const COPY = {
  fa: {
    titleSuffix: 'در حال آماده‌سازی',
    body: 'زیرساخت مشترک و دیتابیس این بخش یکپارچه شده است. رابط کاربری عملیاتی آن در مرحله‌ی بعدی ساخته می‌شود.',
  },
  en: {
    titleSuffix: 'In preparation',
    body: 'The shared database/infrastructure for this module is being unified. Its operational UI will be built in the next step.',
  },
};

export default function PlaceholderModule({ title, lang = 'fa' }) {
  const t = COPY[lang];
  return (
    <div style={{ padding: 24 }} dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <div style={{ maxWidth: 860, margin: '0 auto', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 8px rgba(20,24,28,0.06)' }}>
        <h2 style={{ marginTop: 0 }}>{title} — {t.titleSuffix}</h2>
        <p style={{ color: '#5b6670', lineHeight: 1.9 }}>{t.body}</p>
      </div>
    </div>
  );
}
