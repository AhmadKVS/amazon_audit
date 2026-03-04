"use client";

interface Metrics {
  sessions: number;
  conversion_rate: number;
  revenue: number;
  ad_spend?: number;
  acos?: number;
  units_sold?: number;
}

interface ChangeSummary {
  change: string;
  expected_impact: string;
}

interface BeforeAfterPanelProps {
  asin: string;
  title: string;
  current: Metrics;
  projected: Metrics;
  changesSummary: ChangeSummary[];
}

function MetricRow({ label, current, projected, unit = "", prefix = "" }: {
  label: string; current: number; projected: number; unit?: string; prefix?: string;
}) {
  const diff = projected - current;
  const pct = current > 0 ? ((diff / current) * 100).toFixed(0) : "—";
  const isUp = diff > 0;

  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <p className="text-slate-400">{label}</p>
      <p className="text-slate-300 font-medium">{prefix}{current.toLocaleString()}{unit}</p>
      <p className="text-slate-200 font-semibold flex items-center gap-1.5">
        {prefix}{projected.toLocaleString()}{unit}
        {diff !== 0 && (
          <span className={`text-xs font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {isUp ? "▲" : "▼"} {pct}%
          </span>
        )}
      </p>
    </div>
  );
}

export default function BeforeAfterPanel({
  asin, title, current, projected, changesSummary,
}: BeforeAfterPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-slate-100">{title || asin}</p>
        <p className="text-xs text-slate-500">ASIN: {asin}</p>
      </div>

      {/* Comparison table */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-xs uppercase tracking-widest font-semibold text-slate-500 pb-2 border-b border-slate-800">
          <p>Metric</p>
          <p>Current</p>
          <p>Projected</p>
        </div>
        <MetricRow label="Sessions" current={current.sessions} projected={projected.sessions} />
        <MetricRow label="Conv. Rate" current={current.conversion_rate} projected={projected.conversion_rate} unit="%" />
        <MetricRow label="Revenue" current={current.revenue} projected={projected.revenue} prefix="$" />
        {current.units_sold !== undefined && (
          <MetricRow label="Units Sold" current={current.units_sold} projected={projected.units_sold ?? current.units_sold} />
        )}
      </div>

      {/* Changes summary */}
      {changesSummary.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">Recommended Changes</p>
          <div className="space-y-2">
            {changesSummary.map((c, i) => (
              <div key={i} className="flex gap-3 rounded-lg bg-slate-800/40 border border-slate-700/30 px-4 py-3">
                <span className="shrink-0 text-purple-400 font-bold text-sm">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 font-medium">{c.change}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{c.expected_impact}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
