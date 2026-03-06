"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Lock,
  Target,
  Zap,
  AlertTriangle,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SourceInfo {
  file: string;
  method: string;
  detail: string;
}

export interface AnalysisResult {
  performanceSnapshot: {
    revenueOpportunity: {
      percentageIncrease: number;
      percentageFormula?: string;
      breakdown: { label: string; monthlyImpact: number; formula?: string }[];
      totalMonthlyImpact: number;
    };
    profitabilityOpportunity: {
      percentageIncrease: number;
      percentageFormula?: string;
      breakdown: { label: string; monthlySavings: number; formula?: string }[];
      totalMonthlySavings: number;
    };
  };
  performanceSnapshot_source?: SourceInfo;
  listingAnalysis: {
    overallScore: number;
    metrics: { label: string; score: number; status: "good" | "warning" | "critical" }[];
    keyFinding: string;
  };
  listingAnalysis_source?: SourceInfo;
  ppcAnalysis: {
    currentAcos: number | string;
    currentAcos_source?: SourceInfo;
    targetAcos: number | string;
    targetAcos_source?: SourceInfo;
    wastedSpend30Days: number | string;
    wastedSpend30Days_source?: SourceInfo;
    lowPerformerCount: number | string;
    lowPerformerCount_source?: SourceInfo;
    weeklyData: { week: string; adSpend: number; sales: number }[] | string;
    weeklyData_source?: SourceInfo;
    keyFinding: string;
  };
  topOpportunities: {
    title: string;
    description: string;
    impact: "High Impact" | "Medium Impact" | "Low Impact";
    potentialMonthlyGain: number;
  }[];
  topOpportunities_source?: SourceInfo;
  gatedInsights: {
    teaser: string;
    fullReportItems: string[];
  };
  gatedInsights_source?: SourceInfo;
}

interface AuditResultsProps {
  data: AnalysisResult;
  onUpdate?: (updated: AnalysisResult) => void;
}

// ── Inline Editable Components ───────────────────────────────────────────────

function EditableText({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [editing, draft]);

  if (!onChange) return <span className={className}>{value}</span>;

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onChange(draft); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); setDraft(value); }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { setEditing(false); if (draft !== value) onChange(draft); }
        }}
        className={`${className} bg-transparent border border-dashed border-slate-500 outline-none w-full resize-none overflow-hidden rounded p-1`}
        rows={1}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`${className} cursor-pointer hover:border-b hover:border-dashed hover:border-slate-500 transition-colors`}
      title="Click to edit"
    >
      {value}
    </span>
  );
}

function EditableNumber({
  value,
  onChange,
  className,
  prefix = "",
  suffix = "",
}: {
  value: number;
  onChange?: (v: number) => void;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!onChange) return <span className={className}>{prefix}{value.toLocaleString()}{suffix}</span>;

  const commit = () => {
    setEditing(false);
    const num = parseFloat(draft.replace(/[^0-9.\-]/g, ""));
    if (!isNaN(num) && num !== value) onChange(num);
    else setDraft(String(value));
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(String(value)); } }}
        className={`${className} bg-transparent border-b border-dashed border-slate-500 outline-none w-20 text-right`}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className={`${className} cursor-pointer hover:border-b hover:border-dashed hover:border-slate-500 transition-colors`}
      title="Click to edit"
    >
      {prefix}{value.toLocaleString()}{suffix}
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDollars(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toLocaleString()}`;
}

function statusBarColor(status: "good" | "warning" | "critical"): string {
  switch (status) {
    case "good":     return "bg-emerald-500";
    case "warning":  return "bg-amber-500";
    case "critical": return "bg-red-500";
  }
}

function impactBadgeClasses(impact: "High Impact" | "Medium Impact" | "Low Impact"): string {
  switch (impact) {
    case "High Impact":   return "bg-red-500/20 text-red-400 border border-red-500/40";
    case "Medium Impact": return "bg-amber-500/20 text-amber-400 border border-amber-500/40";
    case "Low Impact":    return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40";
  }
}

// ── Source Tag Components ────────────────────────────────────────────────────

function SourceTag({ source }: { source?: SourceInfo }) {
  // Intentionally empty — detail is now shown via SourceDetailRow below the grid
  void source;
  return null;
}

/** Shows source details for multiple metrics in a single row below a grid of stat boxes. */
function SourceDetailRow({ sources, onDetailUpdate }: { sources: { label: string; source?: SourceInfo }[]; onDetailUpdate?: (label: string, newDetail: string) => void }) {
  const valid = sources.filter((s) => s.source && s.source.method !== "N/A");
  if (!valid.length) return null;

  // Extract short formula from detail (everything before "Rows:" metadata)
  const shortDetail = (detail: string) => detail.split(/[.,]\s*Rows:/)[0];

  return (
    <div className="rounded-xl border border-slate-700/30 bg-slate-800/30 px-4 py-3 text-[11px]">
      <div className="flex items-center gap-1.5 text-slate-500 mb-3">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium">How these numbers are calculated</span>
      </div>
      <div className="space-y-2.5">
        {valid.map(({ label, source }) => (
          <div key={label} className="border-l-2 border-slate-700 pl-3">
            <p className="text-slate-300 font-medium">{label}</p>
            {source!.detail && (
              <EditableText
                value={shortDetail(source!.detail)}
                onChange={onDetailUpdate ? (v) => onDetailUpdate(label, v) : undefined}
                className="text-slate-500 mt-0.5 block"
              />
            )}
          </div>
        ))}
        <p className="text-slate-600 pt-1 border-t border-slate-800 break-all">
          Source: {valid[0].source!.file}
        </p>
      </div>
    </div>
  );
}

function SectionSourceTag({ source }: { source?: SourceInfo }) {
  if (!source) return null;

  const methodColor = source.method.includes("CSV")
    ? "text-emerald-500/50"
    : source.method.includes("PDF")
    ? "text-blue-400/50"
    : source.method.includes("AI")
    ? "text-purple-400/50"
    : "text-slate-500/50";

  return (
    <span
      className={`text-[10px] ${methodColor} ml-2`}
      title={`Source: ${source.file} - ${source.method}`}
    >
      [{source.method}]
    </span>
  );
}

// ── Section 1: Performance Snapshot ─────────────────────────────────────────

function PerformanceSnapshot({
  data,
  source,
  onUpdate,
}: {
  data: AnalysisResult["performanceSnapshot"];
  source?: SourceInfo;
  onUpdate?: (updated: AnalysisResult["performanceSnapshot"]) => void;
}) {
  const { revenueOpportunity, profitabilityOpportunity } = data;

  const updateRevBreakdown = (idx: number, patch: Partial<typeof revenueOpportunity.breakdown[0]>) => {
    if (!onUpdate) return;
    const breakdown = revenueOpportunity.breakdown.map((b, i) => i === idx ? { ...b, ...patch } : b);
    const totalMonthlyImpact = breakdown.reduce((s, b) => s + b.monthlyImpact, 0);
    onUpdate({ ...data, revenueOpportunity: { ...revenueOpportunity, breakdown, totalMonthlyImpact } });
  };

  const updateProfBreakdown = (idx: number, patch: Partial<typeof profitabilityOpportunity.breakdown[0]>) => {
    if (!onUpdate) return;
    const breakdown = profitabilityOpportunity.breakdown.map((b, i) => i === idx ? { ...b, ...patch } : b);
    const totalMonthlySavings = breakdown.reduce((s, b) => s + b.monthlySavings, 0);
    onUpdate({ ...data, profitabilityOpportunity: { ...profitabilityOpportunity, breakdown, totalMonthlySavings } });
  };

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-100 mb-1">
        Performance Snapshot
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Revenue Card */}
        <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-slate-900/50 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
            <h4 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
              Increase Revenue
            </h4>
          </div>

          <div>
            <p className="text-4xl font-bold text-blue-400">
              +<EditableNumber value={revenueOpportunity.percentageIncrease} onChange={onUpdate ? (v) => onUpdate({ ...data, revenueOpportunity: { ...revenueOpportunity, percentageIncrease: v } }) : undefined} className="text-4xl font-bold text-blue-400" suffix="%" />
            </p>
            <p className="text-xs text-slate-400 mt-1">estimated monthly revenue increase</p>
            {revenueOpportunity.percentageFormula && (
              <EditableText value={revenueOpportunity.percentageFormula} onChange={onUpdate ? (v) => onUpdate({ ...data, revenueOpportunity: { ...revenueOpportunity, percentageFormula: v } }) : undefined} className="text-xs text-slate-400/80 mt-1 font-mono block" />
            )}
          </div>

          <div className="space-y-3">
            {revenueOpportunity.breakdown.map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <EditableText value={item.label} onChange={onUpdate ? (v) => updateRevBreakdown(i, { label: v }) : undefined} className="text-slate-400 min-w-0" />
                  <span className="text-emerald-400 font-medium shrink-0">
                    +<EditableNumber value={item.monthlyImpact} onChange={onUpdate ? (v) => updateRevBreakdown(i, { monthlyImpact: v }) : undefined} className="text-emerald-400 font-medium" prefix="$" />/mo
                  </span>
                </div>
                {item.formula && (
                  <EditableText value={item.formula} onChange={onUpdate ? (v) => updateRevBreakdown(i, { formula: v }) : undefined} className="text-xs text-slate-400/80 mt-0.5 font-mono block" />
                )}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-blue-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                Total Monthly Impact
              </span>
              <span className="text-2xl font-bold text-emerald-400">
                +{formatDollars(revenueOpportunity.totalMonthlyImpact)}/mo
              </span>
            </div>
          </div>
        </div>

        {/* Profitability Card */}
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/50 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <h4 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
              Increase Profitability
            </h4>
          </div>

          <div>
            <p className="text-4xl font-bold text-emerald-400">
              +<EditableNumber value={profitabilityOpportunity.percentageIncrease} onChange={onUpdate ? (v) => onUpdate({ ...data, profitabilityOpportunity: { ...profitabilityOpportunity, percentageIncrease: v } }) : undefined} className="text-4xl font-bold text-emerald-400" suffix="%" />
            </p>
            <p className="text-xs text-slate-400 mt-1">estimated monthly profitability increase</p>
            {profitabilityOpportunity.percentageFormula && (
              <EditableText value={profitabilityOpportunity.percentageFormula} onChange={onUpdate ? (v) => onUpdate({ ...data, profitabilityOpportunity: { ...profitabilityOpportunity, percentageFormula: v } }) : undefined} className="text-xs text-slate-400/80 mt-1 font-mono block" />
            )}
          </div>

          <div className="space-y-3">
            {profitabilityOpportunity.breakdown.map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <EditableText value={item.label} onChange={onUpdate ? (v) => updateProfBreakdown(i, { label: v }) : undefined} className="text-slate-400 min-w-0" />
                  <span className="text-emerald-400 font-medium shrink-0">
                    +<EditableNumber value={item.monthlySavings} onChange={onUpdate ? (v) => updateProfBreakdown(i, { monthlySavings: v }) : undefined} className="text-emerald-400 font-medium" prefix="$" />/mo
                  </span>
                </div>
                {item.formula && (
                  <EditableText value={item.formula} onChange={onUpdate ? (v) => updateProfBreakdown(i, { formula: v }) : undefined} className="text-xs text-slate-400/80 mt-0.5 font-mono block" />
                )}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-emerald-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                Total Monthly Savings
              </span>
              <span className="text-2xl font-bold text-emerald-400">
                +{formatDollars(profitabilityOpportunity.totalMonthlySavings)}/mo
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 2: High-Level Findings ───────────────────────────────────────────

function ListingAnalysisCard({
  data,
  source,
  onUpdate,
}: {
  data: AnalysisResult["listingAnalysis"];
  source?: SourceInfo;
  onUpdate?: (updated: AnalysisResult["listingAnalysis"]) => void;
}) {
  const scoreColor =
    data.overallScore >= 75
      ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
      : data.overallScore >= 50
      ? "text-amber-400 border-amber-500/50 bg-amber-500/10"
      : "text-red-400 border-red-500/50 bg-red-500/10";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-amber-400" />
          <h4 className="text-sm font-semibold text-slate-200">
            Listing Analysis
          </h4>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-bold border ${scoreColor}`}>
          {data.overallScore}/100
        </span>
      </div>

      <div className="space-y-3">
        {data.metrics.map((metric, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">{metric.label}</span>
              <span className="text-slate-300 font-semibold">{metric.score}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${statusBarColor(metric.status)}`}
                style={{ width: `${Math.min(metric.score, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
        <p className="text-xs font-semibold text-amber-400 mb-1">Key Finding</p>
        <EditableText
          value={data.keyFinding}
          onChange={onUpdate ? (v) => onUpdate({ ...data, keyFinding: v }) : undefined}
          className="text-sm text-slate-300 leading-relaxed"
        />
      </div>
    </div>
  );
}

function PpcAnalysisCard({ data, onUpdate }: { data: AnalysisResult["ppcAnalysis"]; onUpdate?: (updated: AnalysisResult["ppcAnalysis"]) => void }) {
  const acosNum = typeof data.currentAcos === "number" ? data.currentAcos : null;
  const wastedNum = typeof data.wastedSpend30Days === "number" ? data.wastedSpend30Days : null;
  const lowPerfNum = typeof data.lowPerformerCount === "number" ? data.lowPerformerCount : null;
  const hasWeekly = Array.isArray(data.weeklyData) && data.weeklyData.length > 0;
  const targetNum = typeof data.targetAcos === "number" ? data.targetAcos : null;
  const acosIsHigh = acosNum !== null && targetNum !== null && acosNum > targetNum;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-400" />
        <h4 className="text-sm font-semibold text-slate-200">PPC Performance</h4>
      </div>

      {/* Stat boxes */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Current ACoS</p>
          <p className={`text-lg font-bold ${acosNum === null ? "text-slate-500" : acosIsHigh ? "text-red-400" : "text-emerald-400"}`}>
            {acosNum !== null ? <EditableNumber value={acosNum} onChange={onUpdate ? (v) => onUpdate({ ...data, currentAcos: v }) : undefined} className={`text-lg font-bold ${acosIsHigh ? "text-red-400" : "text-emerald-400"}`} suffix="%" /> : "N/A"}
          </p>
          <p className="text-xs text-slate-600">target: {targetNum !== null ? `${targetNum}%` : "N/A"}</p>
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Wasted Spend (30d)</p>
          <p className={`text-lg font-bold ${wastedNum !== null ? "text-red-400" : "text-slate-500"}`}>
            {wastedNum !== null ? <EditableNumber value={wastedNum} onChange={onUpdate ? (v) => onUpdate({ ...data, wastedSpend30Days: v }) : undefined} className="text-lg font-bold text-red-400" prefix="$" /> : "N/A"}
          </p>
          <p className="text-xs text-slate-600">recoverable</p>
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Low Performers</p>
          <p className={`text-lg font-bold ${lowPerfNum !== null ? "text-amber-400" : "text-slate-500"}`}>
            {lowPerfNum !== null ? <EditableNumber value={lowPerfNum} onChange={onUpdate ? (v) => onUpdate({ ...data, lowPerformerCount: v }) : undefined} className="text-lg font-bold text-amber-400" /> : "N/A"}
          </p>
          <p className="text-xs text-slate-600">campaigns</p>
        </div>
      </div>

      <SourceDetailRow sources={[
        { label: "Current ACoS", source: data.currentAcos_source },
        { label: "Wasted Spend", source: data.wastedSpend30Days_source },
        { label: "Low Performers", source: data.lowPerformerCount_source },
      ]} onDetailUpdate={onUpdate ? (label, newDetail) => {
        const sourceKey = label === "Current ACoS" ? "currentAcos_source"
          : label === "Wasted Spend" ? "wastedSpend30Days_source"
          : "lowPerformerCount_source";
        onUpdate({
          ...data,
          [sourceKey]: { ...data[sourceKey as keyof typeof data] as SourceInfo, detail: newDetail },
        });
      } : undefined} />

      {/* Weekly chart */}
      {hasWeekly && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.weeklyData as { week: string; adSpend: number; sales: number }[]}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="30%"
            >
              <XAxis
                dataKey="week"
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                tick={{ fill: "#94a3b8" }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tick={{ fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(15, 23, 42, 0.97)",
                  border: "1px solid rgba(100, 116, 139, 0.4)",
                  borderRadius: "10px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                  padding: "10px 14px",
                }}
                labelStyle={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}
                formatter={(value: number, name: string) => [
                  `$${value.toLocaleString()}`,
                  name === "adSpend" ? "Ad Spend" : "Sales",
                ]}
              />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs text-slate-400">
                    {value === "adSpend" ? "Ad Spend" : "Sales"}
                  </span>
                )}
              />
              <Bar dataKey="adSpend" name="adSpend" fill="#f87171" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="sales"   name="sales"   fill="#34d399" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
        <p className="text-xs font-semibold text-red-400 mb-1">Key Finding</p>
        <EditableText
          value={data.keyFinding}
          onChange={onUpdate ? (v) => onUpdate({ ...data, keyFinding: v }) : undefined}
          className="text-sm text-slate-300 leading-relaxed"
        />
      </div>
    </div>
  );
}

function HighLevelFindings({
  data,
  listingSource,
  onPpcUpdate,
  onListingUpdate,
}: {
  data: AnalysisResult;
  listingSource?: SourceInfo;
  onPpcUpdate?: (updated: AnalysisResult["ppcAnalysis"]) => void;
  onListingUpdate?: (updated: AnalysisResult["listingAnalysis"]) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-100 mb-1">High-Level Findings</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ListingAnalysisCard data={data.listingAnalysis} source={listingSource} onUpdate={onListingUpdate} />
        <PpcAnalysisCard data={data.ppcAnalysis} onUpdate={onPpcUpdate} />
      </div>
    </section>
  );
}

// ── Section 3: Top 3 Opportunities ───────────────────────────────────────────

function TopOpportunities({
  data,
  source,
}: {
  data: AnalysisResult["topOpportunities"];
  source?: SourceInfo;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-100 mb-1">
        Top 3 Opportunities
      </h3>

      <div className="space-y-4">
        {data.slice(0, 3).map((opp, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-400">
                  {i + 1}
                </span>
                <p className="text-sm font-bold text-slate-100 leading-snug">{opp.title}</p>
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${impactBadgeClasses(opp.impact)}`}>
                {opp.impact}
              </span>
            </div>

            <p className="text-sm text-slate-400 leading-relaxed pl-10">{opp.description}</p>

            <div className="pl-10">
              <span className="text-base font-bold text-emerald-400">
                +{formatDollars(opp.potentialMonthlyGain)}/mo
              </span>
              <span className="text-xs text-slate-500 ml-2">estimated gain</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Section 4: Gated CTA ─────────────────────────────────────────────────────

export function GatedCta({ gated }: { gated: AnalysisResult["gatedInsights"] }) {
  const schedulingLink = process.env.NEXT_PUBLIC_SCHEDULING_LINK || "#";

  return (
    <section>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-2">
            <Lock className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-100">Want the Full Picture?</h3>
          <p className="text-slate-300 max-w-xl mx-auto leading-relaxed">{gated.teaser}</p>
        </div>

        {/* Blurred locked items */}
        <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-5 space-y-3 max-w-xl mx-auto">
          <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">
            Included in the full strategy report
          </p>
          <ul className="space-y-2.5">
            {gated.fullReportItems.map((item, i) => (
              <li key={i} className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                <span
                  className="text-sm text-slate-300 select-none"
                  style={{ filter: "blur(4px)" }}
                  aria-hidden="true"
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <a
            href={schedulingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors shadow-lg shadow-emerald-500/20"
          >
            <AlertTriangle className="w-5 h-5" />
            Schedule a Free Strategy Call
          </a>
          <p className="text-xs text-slate-500">No commitment required &mdash; 30 minutes, completely free</p>
        </div>
      </div>
    </section>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AuditResults({ data, onUpdate }: AuditResultsProps) {
  return (
    <div className="space-y-10">
      <PerformanceSnapshot
        data={data.performanceSnapshot}
        source={data.performanceSnapshot_source}
        onUpdate={onUpdate ? (snap) => onUpdate({ ...data, performanceSnapshot: snap }) : undefined}
      />
      <HighLevelFindings
        data={data}
        listingSource={data.listingAnalysis_source}
        onPpcUpdate={onUpdate ? (ppc) => onUpdate({ ...data, ppcAnalysis: ppc }) : undefined}
        onListingUpdate={onUpdate ? (listing) => onUpdate({ ...data, listingAnalysis: listing }) : undefined}
      />
      <TopOpportunities
        data={data.topOpportunities}
        source={data.topOpportunities_source}
      />
    </div>
  );
}

// ── Loading Component ─────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  "Analyzing your business data...",
  "Evaluating listing quality...",
  "Reviewing PPC performance...",
  "Identifying revenue opportunities...",
  "Calculating profitability improvements...",
  "Generating your audit report...",
];

export function AnalysisLoading() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 space-y-8">
      {/* Spinner rings */}
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-4 border-slate-800" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-amber-400 animate-spin" />
        <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-amber-500/50 animate-spin" style={{ animationDuration: "1.5s", animationDirection: "reverse" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full bg-amber-400 animate-pulse" />
        </div>
      </div>

      {/* Rotating message */}
      <div className="text-center space-y-2 min-h-[3rem] flex flex-col justify-center">
        <p
          key={messageIndex}
          className="text-base font-medium text-slate-200 transition-all duration-500"
        >
          {LOADING_MESSAGES[messageIndex]}
        </p>
        <p className="text-sm text-slate-500">This may take 30-60 seconds</p>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-2">
        {LOADING_MESSAGES.map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-500 ${
              i === messageIndex
                ? "w-3 h-3 bg-amber-400"
                : i < messageIndex
                ? "w-2 h-2 bg-amber-600/60"
                : "w-2 h-2 bg-slate-700"
            }`}
          />
        ))}
      </div>

      {/* Pulsing bar */}
      <div className="w-64 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 animate-pulse"
          style={{
            width: `${Math.round(((messageIndex + 1) / LOADING_MESSAGES.length) * 100)}%`,
            transition: "width 2.8s ease-in-out",
          }}
        />
      </div>
    </div>
  );
}
