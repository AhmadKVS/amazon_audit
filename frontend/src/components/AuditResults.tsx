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
      methodology?: string;
      breakdown: { label: string; monthlyImpact: number; reasoning?: string }[];
      totalMonthlyImpact: number;
    };
    profitabilityOpportunity: {
      percentageIncrease: number;
      methodology?: string;
      breakdown: { label: string; monthlySavings: number; reasoning?: string }[];
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

  // ── 4-Layer Keys ──
  listingHealthSnapshot?: ListingHealthSnapshot;
  revenueGapReport?: RevenueGapReport;
  adEfficiencySignal?: AdEfficiencySignal;
  compiledReport?: CompiledReport;
}

// ── 4-Layer Types ──

export interface ListingHealthSnapshot {
  mainAsin: { asin: string; title: string; url?: string; imageUrl?: string };
  imageCount: { count: number | null; benchmark: number; status: string; imageUrls?: string[] };
  aPlusContent: { present: boolean | null; status: string; proofUrl?: string };
  brandRegistry: { detected: boolean | null; status: string; brandName?: string; evidence?: string; dataSource?: string };
  reviewRating: { rating: number | null; reviewCount: number | null; categoryAvg: number | null; status: string; ratingDistribution?: Record<string | number, number> };
  topProducts?: { asin: string; title: string; rating: number; reviews: number; price: string; image?: string; link?: string }[];
  bestSellers?: { asin: string; title: string; rating: number; reviews: number; price: string; image?: string; link?: string }[];
  lowestSellers?: { asin: string; title: string; rating: number; reviews: number; price: string; image?: string; link?: string }[];
  keyFinding: string;
  dataSource?: "rainforest" | "perplexity";
  citations?: string[];
}

export interface RevenueGapReport {
  topAsins: { asin: string; title: string; sessions: number; conversionRate: number; benchmarkCR: number; revenue: number; monthlyGap: number }[];
  flaggedAsins: { asin: string; title: string; sessions: number; conversionRate: number; monthlyDollarGap: number; reason: string }[];
  buyBoxMetrics: { asin: string; buyBoxPercentage: number; status: string }[];
  totalMonthlyRevenueGap: number;
  keyFinding: string;
}

export interface AdEfficiencySignal {
  totalSpend: number;
  adAttributedSales: number;
  currentAcos: number | string;
  acosBenchmark: { low: number; high: number };
  zeroOrderSpend: number;
  topWastedTerms: { term: string; spend: number; clicks: number; orders: number }[];
  totalRecoverableAdSpend: number;
  keyFinding: string;
}

export interface CompiledReport {
  executiveSummary: string;
  totalMonthlyOpportunity: number;
  dataGaps: string[];
  topActions: { title: string; description: string; impact: string; estimatedMonthlyGain: number }[];
}

interface AuditResultsProps {
  data: AnalysisResult;
  onUpdate?: (updated: AnalysisResult) => void;
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
  if (!source || source.method === "N/A") return null;

  const [expanded, setExpanded] = React.useState(false);

  const methodColor = source.method.includes("CSV")
    ? "text-emerald-500/70 border-emerald-500/30 bg-emerald-500/5"
    : source.method.includes("PDF")
    ? "text-blue-400/70 border-blue-400/30 bg-blue-400/5"
    : source.method.includes("AI")
    ? "text-purple-400/70 border-purple-400/30 bg-purple-400/5"
    : "text-slate-500/70 border-slate-500/30 bg-slate-500/5";

  return (
    <div className="relative mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1 text-[10px] leading-tight px-1.5 py-0.5 rounded border ${methodColor} hover:opacity-80 transition-opacity`}
      >
        <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {source.method}
      </button>
      {expanded && (
        <div className="absolute z-20 mt-1 left-0 w-64 rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs shadow-xl">
          <p className="text-slate-400">
            <span className="text-slate-300 font-medium">File:</span> {source.file}
          </p>
          <p className="text-slate-400 mt-1">
            <span className="text-slate-300 font-medium">Method:</span> {source.method}
          </p>
          {source.detail && (
            <p className="text-slate-400 mt-1">
              <span className="text-slate-300 font-medium">Detail:</span> {source.detail}
            </p>
          )}
        </div>
      )}
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

export function PerformanceSnapshot({
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

          {revenueOpportunity.methodology && (
            <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg px-4 py-2.5">
              <p className="text-[10px] font-semibold text-blue-400/70 uppercase tracking-wider mb-1">How we calculated this</p>
              <p className="text-xs text-slate-400 leading-relaxed">{revenueOpportunity.methodology}</p>
            </div>
          )}

          <div className="space-y-2">
            {revenueOpportunity.breakdown.map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400 truncate pr-2">{item.label}</span>
                  <span className="text-emerald-400 font-medium shrink-0">
                    +{formatDollars(item.monthlyImpact)}/mo
                  </span>
                </div>
                {item.reasoning && (
                  <p className="text-[10px] text-slate-500 mt-0.5 pl-0.5">{item.reasoning}</p>
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
              +{profitabilityOpportunity.percentageIncrease}%
            </p>
            <p className="text-xs text-slate-400 mt-1">estimated monthly profitability increase</p>
          </div>

          {profitabilityOpportunity.methodology && (
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-4 py-2.5">
              <p className="text-[10px] font-semibold text-emerald-400/70 uppercase tracking-wider mb-1">How we calculated this</p>
              <p className="text-xs text-slate-400 leading-relaxed">{profitabilityOpportunity.methodology}</p>
            </div>
          )}

          <div className="space-y-2">
            {profitabilityOpportunity.breakdown.map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400 truncate pr-2">{item.label}</span>
                  <span className="text-emerald-400 font-medium shrink-0">
                    +{formatDollars(item.monthlySavings)}/mo
                  </span>
                </div>
                {item.reasoning && (
                  <p className="text-[10px] text-slate-500 mt-0.5 pl-0.5">{item.reasoning}</p>
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

export function PpcAnalysisCard({ data }: { data: AnalysisResult["ppcAnalysis"] }) {
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
          <SourceTag source={data.currentAcos_source} />
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Wasted Spend (30d)</p>
          <p className={`text-lg font-bold ${wastedNum !== null ? "text-red-400" : "text-slate-500"}`}>
            {wastedNum !== null ? formatDollars(wastedNum) : "N/A"}
          </p>
          <p className="text-xs text-slate-600">recoverable</p>
          <SourceTag source={data.wastedSpend30Days_source} />
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
          <p className="text-xs text-slate-500 mb-1">Low Performers</p>
          <p className={`text-lg font-bold ${lowPerfNum !== null ? "text-amber-400" : "text-slate-500"}`}>
            {lowPerfNum !== null ? lowPerfNum : "N/A"}
          </p>
          <p className="text-xs text-slate-600">campaigns</p>
          <SourceTag source={data.lowPerformerCount_source} />
        </div>
      </div>

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

export function TopOpportunities({
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

      <div className="relative space-y-0">
        {/* Vertical timeline line */}
        <div className="absolute left-[23px] top-8 bottom-8 w-px bg-gradient-to-b from-amber-500/40 via-slate-700/60 to-transparent timeline-line" />

        {data.slice(0, 3).map((opp, i) => {
          const sentences = opp.description
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          return (
            <div key={i} className="relative pl-16 pb-8 last:pb-0 group">
              {/* Step number */}
              <div className="absolute left-0 top-0 w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-lg font-bold text-amber-400 group-hover:bg-amber-500/20 group-hover:border-amber-500/50 transition-colors z-10">
                {String(i + 1).padStart(2, "0")}
              </div>

              {/* Card */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-700 transition-colors">
                {/* Title row */}
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <h4 className="text-base font-semibold text-slate-100">{opp.title}</h4>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide border ${impactBadgeClasses(opp.impact)}`}>
                    {opp.impact}
                  </span>
                </div>

                {/* Bullet points */}
                <ul className="space-y-2 mb-4">
                  {sentences.map((sentence, si) => (
                    <li key={si} className="flex items-start gap-2.5 text-sm text-slate-400 leading-relaxed">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
                      {sentence}
                    </li>
                  ))}
                </ul>

                {/* Outcome line */}
                <div className="pt-3 border-t border-slate-800/60">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-emerald-400/80">Estimated Gain:</span>{" "}
                    <span className="text-base font-bold text-emerald-400">+{formatDollars(opp.potentialMonthlyGain)}/mo</span>
                  </p>
                </div>
              </div>
            </div>
          );
        })}
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

// ── 4-Layer Section: Compiled Report ──────────────────────────────────────────

export function CompiledReportSection({ data }: { data: CompiledReport }) {
  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-100">Executive Summary</h3>

      {/* Executive summary */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-slate-900/50 p-6 space-y-5">
        <p className="text-sm text-slate-300 leading-relaxed">{data.executiveSummary}</p>

        {/* Hero number */}
        <div className="text-center py-3">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1">Total Monthly Opportunity</p>
          <p className="text-4xl font-bold text-amber-400">{formatDollars(data.totalMonthlyOpportunity)}<span className="text-lg text-amber-500/70">/mo</span></p>
        </div>

        {/* Data gaps */}
        {data.dataGaps && data.dataGaps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.dataGaps.map((gap, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                <AlertTriangle className="w-3 h-3" />
                {gap}
              </span>
            ))}
          </div>
        )}

        {/* Top actions */}
        {data.topActions && data.topActions.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Prioritized Actions</p>
            {data.topActions.map((action, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-slate-200">{action.title}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${
                      action.impact === "High" ? "bg-red-500/20 text-red-400 border-red-500/40"
                        : action.impact === "Medium" ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                        : "bg-slate-700/60 text-slate-400 border-slate-600/40"
                    }`}>
                      {action.impact}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{action.description}</p>
                  {action.estimatedMonthlyGain > 0 && (
                    <p className="text-xs text-emerald-400 font-medium mt-1">+{formatDollars(action.estimatedMonthlyGain)}/mo</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── 4-Layer Section: Listing Health ──────────────────────────────────────────

function statusBadge(status: string, label: string) {
  const colors = status === "good"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : status === "critical"
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${colors}`}>
      {status === "good" ? "✓" : status === "critical" ? "✕" : "!"} {label}
    </span>
  );
}

export function ListingHealthSection({ data }: { data: ListingHealthSnapshot }) {
  const [showImages, setShowImages] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Listing Health Snapshot</h3>
        {data.dataSource && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
            data.dataSource === "rainforest"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}>
            {data.dataSource === "rainforest" ? "Verified data" : "Estimated data"}
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
        {/* Main ASIN with product image */}
        <div className="flex items-center gap-4">
          {data.mainAsin.imageUrl && (
            <img
              src={data.mainAsin.imageUrl}
              alt={data.mainAsin.title}
              className="w-14 h-14 rounded-lg object-contain bg-white/5 border border-slate-700/50 p-1"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {data.mainAsin.url ? (
                <a href={data.mainAsin.url} target="_blank" rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs font-mono text-blue-400 hover:bg-blue-500/20 transition-colors">
                  {data.mainAsin.asin}
                </a>
              ) : (
                <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs font-mono text-blue-400">
                  {data.mainAsin.asin}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-300 truncate mt-1">{data.mainAsin.title}</p>
          </div>
        </div>

        {/* Metric cards grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Image Count */}
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3 space-y-2">
            <p className="text-xs text-slate-500 font-medium">Images</p>
            {data.imageCount.count === null ? (
              <>
                <p className="text-2xl font-bold text-slate-500">—</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/60 text-slate-400">Not found</span>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <p className={`text-2xl font-bold ${data.imageCount.status === "good" ? "text-emerald-400" : data.imageCount.status === "critical" ? "text-red-400" : "text-amber-400"}`}>
                    {data.imageCount.count}<span className="text-sm text-slate-500">/{data.imageCount.benchmark}</span>
                  </p>
                  {statusBadge(data.imageCount.status, data.imageCount.status === "good" ? "Meets benchmark" : "Below benchmark")}
                </div>
              </>
            )}
            {data.imageCount.imageUrls && data.imageCount.imageUrls.length > 0 && (
              <button onClick={() => setShowImages(!showImages)}
                className="block text-[10px] text-blue-400 hover:text-blue-300 mt-2 transition-colors">
                {showImages ? "Hide images" : "View images"}
              </button>
            )}
          </div>

          {/* A+ Content */}
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3 space-y-2">
            <p className="text-xs text-slate-500 font-medium">A+ Content</p>
            {data.aPlusContent.present === null ? (
              <>
                <p className="text-2xl font-bold text-slate-500">—</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/60 text-slate-400">Not found</span>
              </>
            ) : (
              <>
                <p className={`text-2xl font-bold ${data.aPlusContent.present ? "text-emerald-400" : "text-amber-400"}`}>
                  {data.aPlusContent.present ? "Yes" : "No"}
                </p>
                {statusBadge(data.aPlusContent.status, data.aPlusContent.present ? "Active" : "Missing")}
              </>
            )}
            {data.aPlusContent.proofUrl && (
              <a href={data.aPlusContent.proofUrl} target="_blank" rel="noopener noreferrer"
                className="block text-[10px] text-blue-400 hover:text-blue-300 mt-1 transition-colors">
                View on Amazon
              </a>
            )}
          </div>

          {/* Brand Registry */}
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3 space-y-2">
            <p className="text-xs text-slate-500 font-medium">Brand Registry</p>
            {data.brandRegistry.detected === null ? (
              <>
                <p className="text-2xl font-bold text-slate-500">—</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/60 text-slate-400">Not found</span>
              </>
            ) : (
              <>
                <p className={`text-2xl font-bold ${data.brandRegistry.detected ? "text-emerald-400" : "text-amber-400"}`}>
                  {data.brandRegistry.detected ? "Yes" : "No"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {statusBadge(data.brandRegistry.status, data.brandRegistry.detected ? "Enrolled" : "Not detected")}
                  {data.brandRegistry.dataSource === "perplexity" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400">
                      Web search
                    </span>
                  )}
                </div>
              </>
            )}
            {data.brandRegistry.brandName && (
              <p className="text-xs text-slate-500 mt-1">Brand: {data.brandRegistry.brandName}</p>
            )}
            {data.brandRegistry.evidence && (
              <p className="text-xs text-slate-500">{data.brandRegistry.evidence}</p>
            )}
          </div>

          {/* Review Rating */}
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-3 space-y-2">
            <p className="text-xs text-slate-500 font-medium">Reviews</p>
            {data.reviewRating.rating === null ? (
              <>
                <p className="text-2xl font-bold text-slate-500">—</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/60 text-slate-400">Not found</span>
              </>
            ) : (
              <>
                <p className={`text-2xl font-bold ${data.reviewRating.status === "good" ? "text-emerald-400" : data.reviewRating.status === "critical" ? "text-red-400" : "text-amber-400"}`}>
                  {data.reviewRating.rating}<span className="text-sm text-yellow-400">★</span>
                </p>
                <p className="text-xs text-slate-500">
                  {data.reviewRating.reviewCount !== null ? data.reviewRating.reviewCount.toLocaleString() : "?"} reviews
                  {data.reviewRating.categoryAvg !== null ? ` · avg ${data.reviewRating.categoryAvg}★` : ""}
                </p>
              </>
            )}
            {/* Rating distribution bars */}
            {data.reviewRating.ratingDistribution && (
              <div className="space-y-1.5 mt-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const pct = data.reviewRating.ratingDistribution?.[String(star)] ?? data.reviewRating.ratingDistribution?.[star] ?? 0;
                  return (
                    <div key={star} className="flex items-center gap-2 min-h-[20px]">
                      <span className="text-xs font-medium text-slate-400 w-5 shrink-0 text-right tabular-nums">{star}</span>
                      <div className="flex-1 min-w-0 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-amber-400/70 transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-400 w-9 shrink-0 text-right tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Image gallery (expandable) */}
        {showImages && data.imageCount.imageUrls && (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
            {data.imageCount.imageUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                <img src={url} alt={`Product image ${i + 1}`}
                  className="w-full aspect-square rounded-lg object-contain bg-white/5 border border-slate-700/50 p-0.5 hover:border-blue-500/50 transition-colors" />
              </a>
            ))}
          </div>
        )}

        {/* Best Sellers + Lowest Sellers */}
        {((data.bestSellers && data.bestSellers.length > 0) || (data.lowestSellers && data.lowestSellers.length > 0)) && (
          <div className="space-y-4">
            {/* Best Sellers */}
            {data.bestSellers && data.bestSellers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-widest font-semibold text-emerald-500 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  Top {data.bestSellers.length} Best Seller{data.bestSellers.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-2">
                  {data.bestSellers.map((p, i) => (
                    <a key={i} href={p.link || "#"} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3 hover:border-emerald-500/30 transition-colors group">
                      {p.image && (
                        <img src={p.image} alt={p.title}
                          className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-slate-700/50 p-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 truncate group-hover:text-emerald-300 transition-colors">{p.title}</p>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono">{p.asin}</p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="text-sm text-amber-400 font-medium">{p.rating}★</p>
                        <p className="text-xs text-slate-500">{(p.reviews || 0).toLocaleString()} reviews</p>
                        <p className="text-xs text-emerald-400">{p.price}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Lowest Sellers */}
            {data.lowestSellers && data.lowestSellers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-widest font-semibold text-amber-500 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Top {data.lowestSellers.length} Lowest Seller{data.lowestSellers.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-2">
                  {data.lowestSellers.map((p, i) => (
                    <a key={i} href={p.link || "#"} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl bg-amber-500/5 border border-amber-500/15 p-3 hover:border-amber-500/30 transition-colors group">
                      {p.image && (
                        <img src={p.image} alt={p.title}
                          className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-slate-700/50 p-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 truncate group-hover:text-amber-300 transition-colors">{p.title}</p>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono">{p.asin}</p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="text-sm text-amber-400 font-medium">{p.rating}★</p>
                        <p className="text-xs text-slate-500">{(p.reviews || 0).toLocaleString()} reviews</p>
                        <p className="text-xs text-emerald-400">{p.price}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Key finding */}
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3">
          <p className="text-xs font-semibold text-blue-400 mb-1">Key Finding</p>
          <p className="text-sm text-slate-300 leading-relaxed">{data.keyFinding}</p>
        </div>

        {/* Citations — verified Amazon sources */}
        {data.citations && data.citations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Verified Sources
            </p>
            <div className="flex flex-wrap gap-2">
              {(() => {
                let listingNum = 0;
                return data.citations.map((url, i) => {
                  let label: string;
                  if (url.includes("amazon.com/stores") || url.includes("/stores/")) {
                    label = "Amazon Store";
                  } else if (url.includes("/dp/")) {
                    listingNum++;
                    label = `Listing ${listingNum}`;
                  } else {
                    label = `Source ${i + 1}`;
                  }
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-colors"
                    >
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {label}
                    </a>
                  );
                });
              })()}
            </div>
            <p className="text-[10px] text-slate-600">Data pulled directly from Amazon in real-time via Rainforest API</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── 4-Layer Section: Revenue Gap Report ──────────────────────────────────────

export function RevenueGapSection({ data }: { data: RevenueGapReport }) {
  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-100">Revenue Gap Report</h3>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
        {/* Hero number */}
        <div className="text-center py-2">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1">Total Monthly Revenue Gap</p>
          <p className="text-3xl font-bold text-amber-400">{formatDollars(data.totalMonthlyRevenueGap)}<span className="text-base text-amber-500/70">/mo</span></p>
        </div>

        {/* Top ASINs table */}
        {data.topAsins && data.topAsins.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Top ASINs</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">ASIN</th>
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Title</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Sessions</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">CR%</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Bench CR%</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topAsins.map((asin, i) => (
                    <tr key={i} className="border-b border-slate-800/50">
                      <td className="py-2 px-2 font-mono text-blue-400">{asin.asin}</td>
                      <td className="py-2 px-2 text-slate-300 max-w-[200px] truncate">{asin.title}</td>
                      <td className="py-2 px-2 text-right text-slate-400">{asin.sessions.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-slate-400">{asin.conversionRate}%</td>
                      <td className="py-2 px-2 text-right text-slate-500">{asin.benchmarkCR}%</td>
                      <td className="py-2 px-2 text-right text-amber-400 font-medium">{formatDollars(asin.monthlyGap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Flagged ASINs */}
        {data.flaggedAsins && data.flaggedAsins.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Flagged ASINs</p>
            <div className="space-y-2">
              {data.flaggedAsins.map((asin, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl bg-red-500/5 border border-red-500/20 p-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/25 shrink-0">{asin.asin}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 truncate">{asin.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{asin.reason}</p>
                  </div>
                  <span className="text-xs text-red-400 font-medium shrink-0">-{formatDollars(asin.monthlyDollarGap)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Buy Box metrics */}
        {data.buyBoxMetrics && data.buyBoxMetrics.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Buy Box</p>
            <div className="flex flex-wrap gap-2">
              {data.buyBoxMetrics.map((bb, i) => (
                <div key={i} className="inline-flex items-center gap-2 rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2">
                  <span className="text-[10px] font-mono text-slate-500">{bb.asin}</span>
                  <span className={`text-sm font-bold ${bb.status === "good" ? "text-emerald-400" : bb.status === "critical" ? "text-red-400" : "text-amber-400"}`}>
                    {bb.buyBoxPercentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key finding */}
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">Key Finding</p>
          <p className="text-sm text-slate-300 leading-relaxed">{data.keyFinding}</p>
        </div>
      </div>
    </section>
  );
}

// ── 4-Layer Section: Ad Efficiency Signal ────────────────────────────────────

export function AdEfficiencySection({ data }: { data: AdEfficiencySignal }) {
  const acosNum = typeof data.currentAcos === "number" ? data.currentAcos : null;
  const acosLow = data.acosBenchmark?.low ?? 25;
  const acosHigh = data.acosBenchmark?.high ?? 30;
  const acosStatus = acosNum === null ? "neutral" : acosNum <= acosLow ? "good" : acosNum <= acosHigh ? "warning" : "critical";

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-100">Ad Efficiency Signal</h3>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
        {/* Stat boxes */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
            <p className="text-xs text-slate-500 mb-1">Total Spend</p>
            <p className="text-lg font-bold text-slate-200">{formatDollars(data.totalSpend)}</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
            <p className="text-xs text-slate-500 mb-1">Ad Sales</p>
            <p className="text-lg font-bold text-emerald-400">{formatDollars(data.adAttributedSales)}</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
            <p className="text-xs text-slate-500 mb-1">ACoS</p>
            <p className={`text-lg font-bold ${acosStatus === "good" ? "text-emerald-400" : acosStatus === "critical" ? "text-red-400" : acosStatus === "warning" ? "text-amber-400" : "text-slate-400"}`}>
              {acosNum !== null ? `${acosNum}%` : "N/A"}
            </p>
            <p className="text-[10px] text-slate-600">target: {acosLow}-{acosHigh}%</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-3 text-center">
            <p className="text-xs text-slate-500 mb-1">Zero-Order Spend</p>
            <p className="text-lg font-bold text-red-400">{formatDollars(data.zeroOrderSpend)}</p>
          </div>
        </div>

        {/* ACoS gauge bar */}
        {acosNum !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>0%</span>
              <span>{acosLow}%</span>
              <span>{acosHigh}%</span>
              <span>60%+</span>
            </div>
            <div className="h-3 rounded-full bg-slate-800 overflow-hidden flex">
              <div className="bg-emerald-500/60" style={{ width: `${(acosLow / 60) * 100}%` }} />
              <div className="bg-amber-500/60" style={{ width: `${((acosHigh - acosLow) / 60) * 100}%` }} />
              <div className="bg-red-500/40 flex-1" />
            </div>
            <div className="relative h-3">
              <div className="absolute top-0 w-0.5 h-3 bg-white rounded" style={{ left: `${Math.min(acosNum / 60 * 100, 100)}%` }} />
              <span className="absolute text-[10px] font-bold text-white" style={{ left: `${Math.min(acosNum / 60 * 100, 100)}%`, transform: "translateX(-50%)", top: "14px" }}>
                {acosNum}%
              </span>
            </div>
          </div>
        )}

        {/* Top wasted terms */}
        {data.topWastedTerms && data.topWastedTerms.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Top Wasted Search Terms</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Term</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Spend</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Clicks</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topWastedTerms.map((term, i) => (
                    <tr key={i} className="border-b border-slate-800/50">
                      <td className="py-2 px-2 text-slate-300">{term.term}</td>
                      <td className="py-2 px-2 text-right text-red-400 font-medium">${term.spend.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-slate-400">{term.clicks}</td>
                      <td className="py-2 px-2 text-right text-red-400">0</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recoverable ad spend */}
        <div className="text-center py-2 rounded-xl bg-red-500/5 border border-red-500/20">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1">Recoverable Ad Spend</p>
          <p className="text-2xl font-bold text-red-400">{formatDollars(data.totalRecoverableAdSpend)}<span className="text-sm text-red-500/70">/mo</span></p>
        </div>

        {/* Key finding */}
        {data.keyFinding && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <p className="text-xs font-semibold text-red-400 mb-1">Key Finding</p>
            <p className="text-sm text-slate-300 leading-relaxed">{data.keyFinding}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Locked Section Card (upload-to-unlock) ───────────────────────────────────

interface LockedSectionProps {
  title: string;
  description: string;
  teaserMetrics: { label: string; blurredValue: string }[];
  uploadLabel: string;
  uploadHelperText: string;
  onFileReady: (file: File) => void;
  uploading: boolean;
}

export function LockedSectionCard({
  title,
  description,
  teaserMetrics,
  uploadLabel,
  uploadHelperText,
  onFileReady,
  uploading,
}: LockedSectionProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-slate-500" />
        <h3 className="text-lg font-semibold text-slate-400">{title}</h3>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-6 space-y-5 relative overflow-hidden">
        <p className="text-sm text-slate-500">{description}</p>

        {/* Blurred teaser metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {teaserMetrics.map((m, i) => (
            <div key={i} className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3 space-y-1">
              <p className="text-xs text-slate-600 font-medium">{m.label}</p>
              <p className="text-lg font-bold text-slate-600 blur-[6px] select-none">{m.blurredValue}</p>
            </div>
          ))}
        </div>

        {/* Upload zone */}
        <div className="border-t border-slate-800/60 pt-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400">
            <Zap className="w-3 h-3 inline mr-1" />
            Upload your {uploadLabel} to unlock this section
          </p>
          <p className="text-xs text-slate-600">{uploadHelperText}</p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileReady(f);
              e.target.value = "";
            }}
            className="hidden"
          />

          {uploading ? (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              <span className="text-xs text-amber-300 font-medium">Analyzing your data...</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) onFileReady(f);
              }}
              className={`w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-4 transition-colors ${
                isDragging
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-slate-700 bg-slate-800/30 hover:border-amber-500/50 hover:bg-slate-800/50"
              }`}
            >
              <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div className="text-left">
                <p className="text-xs font-medium text-slate-300">Drop your {uploadLabel} here or click to browse</p>
                <p className="text-xs text-slate-600">CSV or Excel file</p>
              </div>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── CTA Section ──────────────────────────────────────────────────────────────

interface CtaSectionProps {
  brandName: string;
  category: string;
  revenueGap: number | null;
  adSpendGap: number | null;
  lockedTeasers?: string[];
}

export function CtaSection({ brandName, category, revenueGap, adSpendGap, lockedTeasers }: CtaSectionProps) {
  const totalGap = (revenueGap ?? 0) + (adSpendGap ?? 0);
  const hasGapData = totalGap > 0;

  const defaultTeasers = [
    `${brandName || "Your brand"} vs. top 3 competitors in ${category || "your category"} — organic keyword gap analysis`,
    `Full PPC restructure blueprint for your active campaigns`,
    `ASIN-level listing rewrite priority list with estimated conversion impact`,
  ];
  const teasers = lockedTeasers && lockedTeasers.length > 0 ? lockedTeasers : defaultTeasers;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-slate-900/80 to-slate-900/50 p-8 space-y-6">
        {/* Hero gap number */}
        {hasGapData && (
          <div className="text-center">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">Your Estimated Monthly Gap</p>
            <p className="text-5xl font-bold text-amber-400">{formatDollars(totalGap)}<span className="text-xl text-amber-500/70">/mo</span></p>
            {revenueGap != null && adSpendGap != null && revenueGap > 0 && adSpendGap > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                {formatDollars(revenueGap)} revenue gap + {formatDollars(adSpendGap)} recoverable ad spend
              </p>
            )}
          </div>
        )}

        {/* Locked teaser items */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">What You&apos;ll Get in a Full Audit</p>
          {teasers.map((teaser, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-800/50 border border-slate-700/40 p-4">
              <Lock className="w-4 h-4 text-amber-500/60 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-400 blur-[2px] select-none hover:blur-none transition-all duration-300">{teaser}</p>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <div className="text-center space-y-3 pt-2">
          <a
            href="https://launch.withrevlyn.com/widget/bookings/discovery-call-with-revlyn"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
          >
            <Target className="w-5 h-5" />
            {hasGapData
              ? `Your account has a ${formatDollars(totalGap)}/mo gap. Book a call to close it.`
              : "Book a 30-Minute Strategy Call"}
          </a>
          <p className="text-xs text-slate-500">No commitment required &mdash; 30 minutes, completely free</p>
        </div>
      </div>
    </section>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AuditResults({ data, onUpdate }: AuditResultsProps) {
  const hasNewLayout = !!data.listingHealthSnapshot;

  if (hasNewLayout) {
    return (
      <div className="space-y-10">
        {data.compiledReport && <CompiledReportSection data={data.compiledReport} />}
        {data.listingHealthSnapshot && <ListingHealthSection data={data.listingHealthSnapshot} />}
        {data.revenueGapReport && <RevenueGapSection data={data.revenueGapReport} />}
        {data.adEfficiencySignal && <AdEfficiencySection data={data.adEfficiencySignal} />}
      </div>
    );
  }

  // Old layout fallback for backward compat
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
