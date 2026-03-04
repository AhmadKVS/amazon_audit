"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, Legend,
} from "recharts";

// ── Types ───────────────────────────────────────────────────────────────────

interface Recommendation {
  title:       string;
  description: string;
  priority:    "high" | "medium" | "low";
}

interface BrandAnalysis {
  summary:               string;
  competitive_landscape: string;
  top_seller_traits:     string[];
}

interface PrevAudit {
  csv_metadata?: { columns?: string[]; preview?: Record<string, string>[]; raw_text?: string };
  created_at?:   string;
  raw_text?:     string;
}

interface SharedAudit {
  audit_id:        string;
  brand_name:      string;
  niche:           string;
  marketplace:     string;
  report_type:     string;
  audit_purpose:   string;
  created_at:      string;
  brand_analysis:  BrandAnalysis;
  recommendations: Recommendation[];
  benchmark_metrics: { key: string; label: string; unit: string; industry_avg: number; lower_is_better: boolean }[];
  citations:       string[];
  csv_metadata?:   { columns?: string[]; preview?: Record<string, string>[]; raw_text?: string };
  raw_text?:       string;
  prev_audit?:     PrevAudit;
}

// ── Constants ───────────────────────────────────────────────────────────────

const REPORT_COLORS: Record<string, string> = {
  business_report: "#3b82f6",
  active_listings: "#10b981",
  account_health:  "#f59e0b",
  ads:             "#8b5cf6",
  fba_inventory:   "#06b6d4",
};

const REPORT_LABELS: Record<string, string> = {
  business_report: "Business Report",
  active_listings: "Active Listings",
  account_health:  "Account Health",
  ads:             "Ads Performance",
  fba_inventory:   "FBA Inventory",
};

const PRIORITY_STYLES: Record<string, string> = {
  high:   "bg-red-500/15 text-red-300 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low:    "bg-slate-700/50 text-slate-400 border-slate-600/50",
};

// ── Progress Tracking helpers ────────────────────────────────────────────────

function extractUserMetric(key: string, preview: Record<string, string>[], columns: string[]): number | null {
  const columnMatches: Record<string, string[]> = {
    acos: ["acos", "advertising cost of sale"],
    roas: ["roas", "return on ad spend"],
    ctr: ["ctr", "click-through rate", "click through rate"],
    cpc: ["cpc", "cost per click"],
    conversion_rate: ["conversion rate", "unit session percentage"],
    units_per_order: ["units per order", "units ordered"],
    buy_box_percentage: ["buy box", "featured offer"],
    return_rate: ["return rate", "returns"],
    order_defect_rate: ["order defect", "odr"],
    late_shipment_rate: ["late shipment"],
    valid_tracking_rate: ["valid tracking"],
    cancellation_rate: ["cancellation", "cancel"],
    in_stock_rate: ["in stock", "instock"],
    inventory_turnover: ["turnover"],
    stranded_rate: ["stranded"],
    aged_inventory_rate: ["aged", "180"],
    listing_quality_score: ["quality score"],
    image_count: ["image"],
    review_count: ["review"],
  };
  const keywords = columnMatches[key] ?? [];
  const matchedCol = columns.find((col) => keywords.some((kw) => col.toLowerCase().includes(kw)));
  if (!matchedCol || !preview.length) return null;
  const values = preview
    .map((row) => parseFloat(String(row[matchedCol] ?? "").replace(/[%$,]/g, "")))
    .filter((v) => !isNaN(v));
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function extractMetricFromText(key: string, text: string): number | null {
  const keywordMap: Record<string, string[]> = {
    acos: ["acos", "advertising cost of sale"],
    roas: ["roas", "return on ad spend"],
    ctr: ["ctr", "click-through rate", "click through rate"],
    cpc: ["cpc", "cost per click"],
    conversion_rate: ["conversion rate", "unit session percentage", "cvr"],
    units_per_order: ["units per order", "units ordered"],
    buy_box_percentage: ["buy box", "featured offer"],
    return_rate: ["return rate"],
    order_defect_rate: ["order defect", "odr"],
    late_shipment_rate: ["late shipment"],
    valid_tracking_rate: ["valid tracking"],
    cancellation_rate: ["cancellation rate"],
    in_stock_rate: ["in stock rate", "instock rate"],
    inventory_turnover: ["inventory turnover", "turnover rate"],
    stranded_rate: ["stranded rate", "stranded inventory"],
    aged_inventory_rate: ["aged inventory", "180 day", "180-day"],
    listing_quality_score: ["quality score", "listing score"],
    image_count: ["image count", "images per"],
    review_count: ["review count", "number of reviews", "total reviews"],
  };
  const keywords = keywordMap[key];
  if (!keywords) return null;
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const after = text.slice(idx + kw.length, idx + kw.length + 50);
    const match = after.match(/[\s:=\-–—]*(\$?\d[\d,]*\.?\d*)\s*%?/);
    if (match) {
      const val = parseFloat(match[1].replace(/[$,]/g, ""));
      if (!isNaN(val)) return Math.round(val * 100) / 100;
    }
  }
  return null;
}

function extractMetric(
  key: string,
  data: { preview?: Record<string, string>[]; columns?: string[]; raw_text?: string },
): number | null {
  if (data.preview?.length && data.columns?.length) {
    const val = extractUserMetric(key, data.preview, data.columns);
    if (val !== null) return val;
  }
  if (data.raw_text) {
    return extractMetricFromText(key, data.raw_text);
  }
  return null;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [audit, setAudit]     = useState<SharedAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Not found")))
      .then(setAudit)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Loading report…</p>
        </div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <p className="text-slate-200 font-medium">Report not found</p>
          <p className="text-sm text-slate-500">{error ?? "This link may have expired or been removed."}</p>
        </div>
      </div>
    );
  }

  const reportColor = REPORT_COLORS[audit.report_type] || "#f59e0b";
  const chartData   = audit.benchmark_metrics.slice(0, 6).map((m) => ({
    name: m.label.replace(/ /g, "\n"), industry: m.industry_avg, unit: m.unit,
  }));
  const sorted = [...audit.recommendations].sort(
    (a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1)
  );
  const date = new Date(audit.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // ── Section 4: Progress Tracking ──────────────────────────────────────────
  const progressSection = (() => {
    const prevAudit = audit.prev_audit;
    const csvData   = audit.csv_metadata;

    const currentData = {
      preview:  csvData?.preview,
      columns:  csvData?.columns,
      raw_text: audit.raw_text ?? csvData?.raw_text,
    };
    const prevCsv = prevAudit?.csv_metadata;
    const prevData = {
      preview:  prevCsv?.preview,
      columns:  prevCsv?.columns,
      raw_text: prevAudit?.raw_text ?? prevCsv?.raw_text,
    };

    const hasCurrentData = (currentData.preview?.length && currentData.columns?.length) || currentData.raw_text;
    const hasPrevData    = (prevData.preview?.length && prevData.columns?.length) || prevData.raw_text;

    if (!prevAudit || !hasCurrentData || !hasPrevData || !audit.benchmark_metrics?.length) return null;

    const prevDate = prevAudit.created_at
      ? new Date(prevAudit.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Previous";

    const comparisons = audit.benchmark_metrics.map((m) => {
      const current  = extractMetric(m.key, currentData);
      const previous = extractMetric(m.key, prevData);
      if (current === null && previous === null) return null;
      const delta     = current !== null && previous !== null ? current - previous : null;
      const pctChange = delta !== null && previous !== null && previous !== 0
        ? Math.round((delta / Math.abs(previous)) * 100)
        : null;
      const isImproved = delta !== null ? (m.lower_is_better ? delta < 0 : delta > 0) : null;
      return { key: m.key, label: m.label, unit: m.unit, current, previous, delta, pctChange, isImproved, isNew: previous === null };
    }).filter(Boolean) as {
      key: string; label: string; unit: string;
      current: number | null; previous: number | null;
      delta: number | null; pctChange: number | null;
      isImproved: boolean | null; isNew: boolean;
    }[];

    if (!comparisons.length) return null;

    const improved   = comparisons.filter((c) => c.isImproved === true).length;
    const comparable = comparisons.filter((c) => c.delta !== null).length;

    return { prevDate, comparisons, improved, comparable };
  })();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm; }
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          header { display: none !important; }
        }
      `}</style>

      {/* Branded header — no nav links */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur no-print">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <span className="text-base font-semibold text-amber-400 tracking-tight">Amazon Audit</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Report prepared {date}</span>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 space-y-8">

        {/* Metadata card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h1 className="text-2xl font-bold text-slate-100">{audit.brand_name}</h1>
          <div className="flex flex-wrap gap-2 mt-2">
            {audit.niche && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{audit.niche}</span>
            )}
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{audit.marketplace}</span>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium border"
              style={{ backgroundColor: `${reportColor}15`, color: reportColor, borderColor: `${reportColor}40` }}>
              {REPORT_LABELS[audit.report_type] ?? audit.report_type}
            </span>
          </div>
          {audit.audit_purpose && (
            <p className="mt-3 text-sm text-slate-400 max-w-xl">{audit.audit_purpose}</p>
          )}
        </div>

        {/* Section 1: Brand Analysis */}
        <section>
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs text-blue-400 font-bold">1</span>
            Brand &amp; Niche Analysis
          </h2>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Brand Summary</p>
              <p className="text-sm text-slate-300 leading-relaxed">{audit.brand_analysis.summary}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Competitive Landscape</p>
              <p className="text-sm text-slate-300 leading-relaxed">{audit.brand_analysis.competitive_landscape}</p>
            </div>
            {audit.brand_analysis.top_seller_traits.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">What Top Sellers Do</p>
                <div className="flex flex-wrap gap-2">
                  {audit.brand_analysis.top_seller_traits.map((t, i) => (
                    <span key={i} className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {audit.citations.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                {audit.citations.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Source {i + 1}
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Section 2: Benchmarks */}
        {chartData.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">2</span>
              Industry Benchmarks
            </h2>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
              <p className="text-sm text-slate-400">Amazon seller industry averages</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} tick={{ fill: "#94a3b8" }} />
                    <YAxis stroke="#64748b" fontSize={11} tick={{ fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.05)" }}
                      contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(100,116,139,0.4)", borderRadius: "10px", padding: "10px 14px" }}
                      labelStyle={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "#cbd5e1" }}
                      formatter={(value: number, _: string, props: { payload?: { unit?: string } }) => {
                        return [`${value}${props.payload?.unit ?? ""}`, "Industry Avg"];
                      }}
                    />
                    <Legend
                      payload={[{ value: "industry", type: "square", color: reportColor }]}
                      formatter={() => <span className="text-xs text-slate-400">Industry Average</span>}
                    />
                    <Bar dataKey="industry" name="industry" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {chartData.map((_, i) => <Cell key={i} fill={reportColor} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {audit.benchmark_metrics.map((m) => (
                  <div key={m.key} className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 space-y-1">
                    <p className="text-xs text-slate-500 font-medium truncate">{m.label}</p>
                    <p className="text-lg font-bold text-slate-200">
                      {m.industry_avg}{m.unit}
                      <span className="text-xs font-normal text-slate-500 ml-1">avg</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Section 3: Recommendations */}
        <section>
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs text-emerald-400 font-bold">3</span>
            Improvement Recommendations
          </h2>
          <div className="space-y-3">
            {sorted.map((rec, i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4 flex gap-4">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-100">{rec.title}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_STYLES[rec.priority] ?? PRIORITY_STYLES.medium}`}>
                      {rec.priority}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-1 leading-relaxed">{rec.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Progress Tracking */}
        {progressSection && (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-xs text-cyan-400 font-bold">4</span>
              Progress Tracking
            </h2>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
              {/* Summary bar */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm text-slate-400">
                    Comparing with audit from <span className="text-slate-200 font-medium">{progressSection.prevDate}</span>
                  </p>
                </div>
                {progressSection.comparable > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-200">
                      {progressSection.improved}/{progressSection.comparable} metrics improved
                    </span>
                    <div className="w-24 h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(progressSection.improved / progressSection.comparable) * 100}%`,
                          backgroundColor: progressSection.improved / progressSection.comparable >= 0.5 ? "#34d399" : "#f87171",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* Metric comparison cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {progressSection.comparisons.map((c) => (
                  <div key={c.key} className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 space-y-2">
                    <p className="text-xs text-slate-500 font-medium truncate">{c.label}</p>
                    {c.isNew ? (
                      <>
                        <p className="text-lg font-bold text-slate-200">{c.current}{c.unit}</p>
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">NEW</span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs text-slate-600">{c.previous}{c.unit}</span>
                          <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span className="text-lg font-bold text-slate-200">{c.current}{c.unit}</span>
                        </div>
                        {c.pctChange !== null && (
                          <p className={`text-xs font-semibold ${c.isImproved ? "text-emerald-400" : "text-red-400"}`}>
                            {c.isImproved ? "▲" : "▼"} {c.pctChange > 0 ? "+" : ""}{c.pctChange}% change
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-6 no-print">
        <p className="text-center text-xs text-slate-600">Prepared with Amazon Audit · {date}</p>
      </footer>
    </div>
  );
}
