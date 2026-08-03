export default function KPICard({ label, value, accent = 'slate', suffix = '' }) {
  return (
    <div className={`kpi-card accent-${accent}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {suffix ? <div className="kpi-suffix">{suffix}</div> : null}
    </div>
  );
}
