"use client";

import React, { useState, useEffect } from "react";
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
      breakdown: { label: string; monthlyImpact: number }[];
      totalMonthlyImpact: number;
    };
    profitabilityOpportunity: {
      percentageIncrease: number;
      breakdown: { label: string; monthlySavings: number }[];
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
function SourceDetailRow({ sources }: { sources: { label: string; source?: SourceInfo }[] }) {
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
              <p className="text-slate-500 mt-0.5">{shortDetail(source!.detail)}</p>
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
}: {
  data: AnalysisResult["performanceSnapshot"];
  source?: SourceInfo;
}) {
  const { revenueOpportunity, profitabilityOpportunity } = data;

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-100 mb-1">
        Performance Snapshot
        <SectionSourceTag source={source} />
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
              +{revenueOpportunity.percentageIncrease}%
            </p>
            <p className="text-xs text-slate-400 mt-1">estimated monthly revenue increase</p>
          </div>

          <div className="space-y-2">
            {revenueOpportunity.breakdown.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-400 truncate pr-2">{item.label}</span>
                <span className="text-emerald-400 font-medium shrink-0">
                  +{formatDollars(item.monthlyImpact)}/mo
                </span>
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
              +{profitabilityOpportunity.percentageIncrease}%
            </p>
            <p className="text-xs text-slate-400 mt-1">estimated monthly profitability increase</p>
          </div>

          <div className="space-y-2">
            {profitabilityOpportunity.breakdown.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-400 truncate pr-2">{item.label}</span>
                <span className="text-emerald-400 font-medium shrink-0">
                  +{formatDollars(item.monthlySavings)}/mo
                </span>
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
}: {
  data: AnalysisResult["listingAnalysis"];
  source?: SourceInfo;
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
            <SectionSourceTag source={source} />
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
        <p className="text-sm text-slate-300 leading-relaxed">{data.keyFinding}</p>
      </div>
    </div>
  );
}

function PpcAnalysisCard({ data }: { data: AnalysisResult["ppcAnalysis"] }) {
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
            {acosNum !== null ? `${acosNum}%` : "N/A"}
          </p>
          <p className="text-xs text-slate-600">target: {targetNum !== null ? `${targetNum}%` : "N/A"}</p>
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Wasted Spend (30d)</p>
          <p className={`text-lg font-bold ${wastedNum !== null ? "text-red-400" : "text-slate-500"}`}>
            {wastedNum !== null ? formatDollars(wastedNum) : "N/A"}
          </p>
          <p className="text-xs text-slate-600">recoverable</p>
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Low Performers</p>
          <p className={`text-lg font-bold ${lowPerfNum !== null ? "text-amber-400" : "text-slate-500"}`}>
            {lowPerfNum !== null ? lowPerfNum : "N/A"}
          </p>
          <p className="text-xs text-slate-600">campaigns</p>
        </div>
      </div>

      <SourceDetailRow sources={[
        { label: "Current ACoS", source: data.currentAcos_source },
        { label: "Wasted Spend", source: data.wastedSpend30Days_source },
        { label: "Low Performers", source: data.lowPerformerCount_source },
      ]} />

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
        <p className="text-sm text-slate-300 leading-relaxed">{data.keyFinding}</p>
      </div>
    </div>
  );
}

function HighLevelFindings({
  data,
  listingSource,
}: {
  data: AnalysisResult;
  listingSource?: SourceInfo;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-100 mb-1">High-Level Findings</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ListingAnalysisCard data={data.listingAnalysis} source={listingSource} />
        <PpcAnalysisCard data={data.ppcAnalysis} />
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
        <SectionSourceTag source={source} />
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

export function AuditResults({ data }: AuditResultsProps) {
  return (
    <div className="space-y-10">
      <PerformanceSnapshot
        data={data.performanceSnapshot}
        source={data.performanceSnapshot_source}
      />
      <HighLevelFindings
        data={data}
        listingSource={data.listingAnalysis_source}
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
