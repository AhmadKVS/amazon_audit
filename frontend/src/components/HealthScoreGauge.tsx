"use client";

interface HealthScoreGaugeProps {
  score: number; // 1-10
}

function getScoreStyle(score: number) {
  if (score <= 3) return { bg: "bg-red-500/20", border: "border-red-500/50", text: "text-red-400", label: "Critical" };
  if (score <= 6) return { bg: "bg-amber-500/20", border: "border-amber-500/50", text: "text-amber-400", label: "Needs Work" };
  if (score <= 8) return { bg: "bg-blue-500/20", border: "border-blue-500/50", text: "text-blue-400", label: "Good" };
  return { bg: "bg-emerald-500/20", border: "border-emerald-500/50", text: "text-emerald-400", label: "Excellent" };
}

export default function HealthScoreGauge({ score }: HealthScoreGaugeProps) {
  const clamped = Math.max(1, Math.min(10, Math.round(score)));
  const style = getScoreStyle(clamped);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`w-24 h-24 rounded-full ${style.bg} border-2 ${style.border} flex items-center justify-center`}>
        <span className={`text-4xl font-bold ${style.text}`}>{clamped}</span>
      </div>
      <div className="text-center">
        <p className={`text-sm font-semibold ${style.text}`}>{style.label}</p>
        <p className="text-xs text-slate-500">out of 10</p>
      </div>
    </div>
  );
}
