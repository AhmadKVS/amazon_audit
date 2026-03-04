"use client";

const DIAGNOSIS_STYLES: Record<string, { bg: string; text: string; border: string; label: string; emoji: string }> = {
  HEALTHY:       { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/40", label: "HEALTHY",       emoji: "🟢" },
  LISTING_ISSUE: { bg: "bg-red-500/20",     text: "text-red-300",     border: "border-red-500/40",     label: "LISTING ISSUE", emoji: "🔴" },
  TRAFFIC_ISSUE: { bg: "bg-amber-500/20",   text: "text-amber-300",   border: "border-amber-500/40",   label: "TRAFFIC ISSUE", emoji: "🟡" },
  CRITICAL:      { bg: "bg-red-600/20",     text: "text-red-400",     border: "border-red-600/40",     label: "CRITICAL",      emoji: "🔴" },
};

interface DiagnosticCardProps {
  asin: string;
  title: string;
  sessions: number;
  conversionRate: number;
  unitsSold: number;
  revenue: number;
  diagnosis: string;
  explanation: string;
  actions: string[];
}

export default function DiagnosticCard({
  asin, title, sessions, conversionRate, unitsSold, revenue,
  diagnosis, explanation, actions,
}: DiagnosticCardProps) {
  const style = DIAGNOSIS_STYLES[diagnosis] ?? DIAGNOSIS_STYLES.CRITICAL;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{title || asin}</p>
          <p className="text-xs text-slate-500 mt-0.5">ASIN: {asin}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}>
          {style.emoji} {style.label}
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/40 px-3 py-2">
          <p className="text-xs text-slate-500">Sessions</p>
          <p className="text-sm font-bold text-slate-200">{sessions.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/40 px-3 py-2">
          <p className="text-xs text-slate-500">Conv. Rate</p>
          <p className="text-sm font-bold text-slate-200">{conversionRate}%</p>
        </div>
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/40 px-3 py-2">
          <p className="text-xs text-slate-500">Units Sold</p>
          <p className="text-sm font-bold text-slate-200">{unitsSold.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/40 px-3 py-2">
          <p className="text-xs text-slate-500">Revenue</p>
          <p className="text-sm font-bold text-slate-200">${revenue.toLocaleString()}</p>
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <p className="text-sm text-slate-300 leading-relaxed">{explanation}</p>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Recommended Actions</p>
          <ol className="space-y-1.5">
            {actions.map((action, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="shrink-0 w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xs font-bold text-amber-400">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{action}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
