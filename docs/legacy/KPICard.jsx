export default function KPICard({ label, value, accent = 'slate', suffix = '' }) {
  const accentMap = {
    slate: 'border-slate-300 text-slate-900',
    amber: 'border-amber-400 text-amber-700',
    teal: 'border-teal-400 text-teal-700',
    rose: 'border-rose-400 text-rose-700',
    emerald: 'border-emerald-400 text-emerald-700',
  };

  return (
    <div
      className={`rounded-xl border-2 bg-white p-4 shadow-sm ${accentMap[accent] || accentMap.slate}`}
      dir="auto"
    >
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {suffix ? <div className="mt-0.5 text-xs font-normal text-slate-400 tabular-nums">{suffix}</div> : null}
    </div>
  );
}
