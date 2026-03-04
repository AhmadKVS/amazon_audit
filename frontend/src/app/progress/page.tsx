"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithAuth, isAuthenticated, signOut } from "@/lib/auth";
import { getCachedAuditList, setCachedAuditList, getCachedReport } from "@/lib/cache";

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

// ── Metric extraction (mirrors audit detail page) ───────────────────────────

function extractUserMetric(
  key: string,
  preview: Record<string, string>[],
  columns: string[]
): number | null {
  const columnMatches: Record<string, string[]> = {
    acos:                  ["acos", "advertising cost of sale"],
    roas:                  ["roas", "return on ad spend"],
    ctr:                   ["ctr", "click-through rate", "click through rate"],
    cpc:                   ["cpc", "cost per click"],
    conversion_rate:       ["conversion rate", "unit session percentage"],
    units_per_order:       ["units per order", "units ordered"],
    buy_box_percentage:    ["buy box", "featured offer"],
    return_rate:           ["return rate", "returns"],
    order_defect_rate:     ["order defect", "odr"],
    late_shipment_rate:    ["late shipment"],
    valid_tracking_rate:   ["valid tracking"],
    cancellation_rate:     ["cancellation", "cancel"],
    in_stock_rate:         ["in stock", "instock"],
    inventory_turnover:    ["turnover"],
    stranded_rate:         ["stranded"],
    aged_inventory_rate:   ["aged", "180"],
    listing_quality_score: ["quality score"],
    image_count:           ["image"],
    review_count:          ["review"],
  };
  const keywords = columnMatches[key] ?? [];
  const matchedCol = columns.find((col) =>
    keywords.some((kw) => col.toLowerCase().includes(kw))
  );
  if (!matchedCol || !preview.length) return null;
  const values = preview
    .map((row) => parseFloat(String(row[matchedCol] ?? "").replace(/[%$,]/g, "")))
    .filter((v) => !isNaN(v));
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function extractMetricFromText(key: string, text: string): number | null {
  const keywordMap: Record<string, string[]> = {
    acos: ["acos", "advertising cost of sale"], roas: ["roas", "return on ad spend"],
    ctr: ["ctr", "click-through rate"], cpc: ["cpc", "cost per click"],
    conversion_rate: ["conversion rate", "unit session percentage", "cvr"],
    units_per_order: ["units per order"], buy_box_percentage: ["buy box", "featured offer"],
    return_rate: ["return rate"], order_defect_rate: ["order defect", "odr"],
    late_shipment_rate: ["late shipment"], valid_tracking_rate: ["valid tracking"],
    cancellation_rate: ["cancellation rate"], in_stock_rate: ["in stock rate"],
    inventory_turnover: ["inventory turnover", "turnover rate"],
    stranded_rate: ["stranded rate"], aged_inventory_rate: ["aged inventory", "180 day"],
    listing_quality_score: ["quality score"], image_count: ["image count"],
    review_count: ["review count", "total reviews"],
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
  data: { preview?: Record<string, string>[]; columns?: string[]; raw_text?: string }
): number | null {
  if (data.preview?.length && data.columns?.length) {
    const val = extractUserMetric(key, data.preview, data.columns);
    if (val !== null) return val;
  }
  if (data.raw_text) return extractMetricFromText(key, data.raw_text);
  return null;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface AuditSummary {
  audit_id:    string;
  brand_name:  string;
  niche:       string;
  marketplace: string;
  report_type: string;
  created_at:  string;
}

interface BenchmarkMetric {
  key: string; label: string; unit: string; lower_is_better: boolean; industry_avg: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FullAudit = Record<string, any>;

interface MetricSnapshot {
  date: string;
  audit_id: string;
  value: number;
}

interface BrandProgress {
  brand_name: string;
  report_type: string;
  audits: AuditSummary[];
  // metric key -> time series of values
  metrics: Record<string, { label: string; unit: string; lower_is_better: boolean; snapshots: MetricSnapshot[] }>;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const router = useRouter();
  const [audits, setAudits]         = useState<AuditSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedBrand, setSelected] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<BrandProgress[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  // Load audit list
  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); return; }

    const cached = getCachedAuditList() as AuditSummary[] | null;
    if (cached) { setAudits(cached); setLoading(false); }

    fetchWithAuth("/api/audit/list")
      .then((r) => {
        if (r.status === 401) { router.push("/login"); return Promise.reject("session expired"); }
        if (!r.ok) return r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? `HTTP ${r.status}`));
        return r.json();
      })
      .then((d: { audits?: AuditSummary[] }) => {
        const fresh = d.audits ?? [];
        setAudits(fresh);
        setCachedAuditList(fresh);
      })
      .catch((e: unknown) => {
        if (String(e) === "session expired") return;
        if (!cached) setError(String(e));
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Get unique brand names
  const brands = useMemo(() => {
    const set = new Set(audits.map((a) => a.brand_name));
    return Array.from(set).sort();
  }, [audits]);

  // Auto-select first brand
  useEffect(() => {
    if (!selectedBrand && brands.length > 0) setSelected(brands[0]);
  }, [brands, selectedBrand]);

  // Group audits by brand+report_type for selected brand
  const brandGroups = useMemo(() => {
    if (!selectedBrand) return [];
    const matching = audits.filter((a) => a.brand_name === selectedBrand);
    const groups: Record<string, AuditSummary[]> = {};
    for (const a of matching) {
      (groups[a.report_type] ??= []).push(a);
    }
    // Only keep groups with 2+ audits (need at least 2 to track progress)
    return Object.entries(groups)
      .filter(([, list]) => list.length >= 2)
      .map(([rt, list]) => ({ report_type: rt, audits: list.sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
  }, [audits, selectedBrand]);

  // Fetch full audit data for comparison when brand changes
  useEffect(() => {
    if (!brandGroups.length) { setProgressData([]); return; }
    setProgressLoading(true);

    const fetchAll = async () => {
      const results: BrandProgress[] = [];

      for (const group of brandGroups) {
        // Fetch each audit's full data
        const fullAudits: FullAudit[] = [];
        for (const a of group.audits) {
          const cached = getCachedReport(a.audit_id);
          if (cached && (cached.benchmark_metrics || cached.csv_metadata)) {
            fullAudits.push(cached);
            continue;
          }
          try {
            const r = await fetchWithAuth(`/api/audit/${a.audit_id}`);
            if (r.ok) {
              const data = await r.json();
              fullAudits.push(data);
            }
          } catch { /* skip */ }
        }

        // Get benchmark metric definitions from the most recent audit
        const benchmarkMetrics: BenchmarkMetric[] =
          fullAudits.findLast((a) => a.benchmark_metrics?.length)?.benchmark_metrics ?? [];

        if (!benchmarkMetrics.length) continue;

        // Extract metrics from each audit
        const metrics: BrandProgress["metrics"] = {};
        for (const m of benchmarkMetrics) {
          const snapshots: MetricSnapshot[] = [];
          for (let i = 0; i < fullAudits.length; i++) {
            const fa = fullAudits[i];
            const csvMeta = fa.csv_metadata ?? {};
            const data = { preview: csvMeta.preview, columns: csvMeta.columns, raw_text: csvMeta.raw_text ?? fa.raw_text };
            const val = extractMetric(m.key, data);
            if (val !== null) {
              snapshots.push({
                date: group.audits[i].created_at,
                audit_id: group.audits[i].audit_id,
                value: val,
              });
            }
          }
          if (snapshots.length >= 2) {
            metrics[m.key] = { label: m.label, unit: m.unit, lower_is_better: m.lower_is_better, snapshots };
          }
        }

        if (Object.keys(metrics).length > 0) {
          results.push({
            brand_name: selectedBrand!,
            report_type: group.report_type,
            audits: group.audits,
            metrics,
          });
        }
      }

      setProgressData(results);
      setProgressLoading(false);
    };

    fetchAll();
  }, [brandGroups, selectedBrand]);

  const handleSignOut = async () => { await signOut(); router.replace("/login"); };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    catch { return iso; }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-slate-400 hover:text-slate-100 transition-colors" title="Back to Dashboard">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <Link href="/" className="text-xl font-semibold tracking-tight text-amber-400 hover:text-amber-300 transition-colors">
              Amazon Audit
            </Link>
            <Link href="/audits" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">All Audits</Link>
          </div>
          <button onClick={handleSignOut} className="text-sm text-slate-400 hover:text-amber-400 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">Progress Tracking</h1>
          <p className="text-sm text-slate-400 mt-1">Compare metrics across audits to see how your brands improve over time.</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 animate-pulse">
                <div className="h-4 bg-slate-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-slate-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Could not load audits: {error}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-12 flex flex-col items-center justify-center gap-2 text-center">
            <svg className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-slate-400">No audits yet</p>
            <p className="text-xs text-slate-600">Create audits for the same brand to track progress over time.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Brand selector */}
            <div className="flex flex-wrap gap-2">
              {brands.map((brand) => (
                <button
                  key={brand}
                  onClick={() => setSelected(brand)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    selectedBrand === brand
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-slate-900/50 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200"
                  }`}
                >
                  {brand}
                  <span className="ml-2 text-xs opacity-60">
                    ({audits.filter((a) => a.brand_name === brand).length})
                  </span>
                </button>
              ))}
            </div>

            {/* Progress content */}
            {progressLoading ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 flex flex-col items-center justify-center gap-3">
                <div className="w-7 h-7 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <p className="text-sm text-slate-400">Loading progress data...</p>
              </div>
            ) : progressData.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center">
                <p className="text-sm text-slate-400">
                  {brandGroups.length === 0
                    ? `"${selectedBrand}" needs at least 2 audits of the same report type to track progress.`
                    : "No comparable metrics found between audits. Upload data files (CSV/PDF/Word) with metric values to enable tracking."}
                </p>
                <Link href="/" className="inline-block mt-3 text-xs text-amber-400 hover:text-amber-300 transition-colors">
                  Create a new audit →
                </Link>
              </div>
            ) : (
              progressData.map((pd) => {
                const color = REPORT_COLORS[pd.report_type] || "#f59e0b";
                const metricEntries = Object.entries(pd.metrics);
                const improved = metricEntries.filter(([, m]) => {
                  const prev = m.snapshots[m.snapshots.length - 2].value;
                  const last = m.snapshots[m.snapshots.length - 1].value;
                  return m.lower_is_better ? last < prev : last > prev;
                }).length;
                const unchanged = metricEntries.filter(([, m]) => {
                  return m.snapshots[m.snapshots.length - 2].value === m.snapshots[m.snapshots.length - 1].value;
                }).length;

                return (
                  <div key={pd.report_type} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <span className="px-3 py-1 rounded-full text-xs border font-medium"
                          style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}>
                          {REPORT_LABELS[pd.report_type] ?? pd.report_type}
                        </span>
                        <span className="text-sm text-slate-400">
                          {pd.audits.length} audits · {formatDate(pd.audits[0].created_at)} → {formatDate(pd.audits[pd.audits.length - 1].created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-200">
                          {improved}/{metricEntries.length} improved{unchanged > 0 ? ` · ${unchanged} unchanged` : ""}
                        </span>
                        <div className="w-20 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${metricEntries.length ? ((improved + unchanged) / metricEntries.length) * 100 : 0}%`,
                              backgroundColor: unchanged === metricEntries.length ? "#94a3b8" : improved / (metricEntries.length - unchanged || 1) >= 0.5 ? "#34d399" : "#f87171",
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Metric cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {metricEntries.map(([key, m]) => {
                        const prev = m.snapshots[m.snapshots.length - 2];
                        const last = m.snapshots[m.snapshots.length - 1];
                        const delta = last.value - prev.value;
                        const pctChange = prev.value !== 0 ? Math.round((delta / Math.abs(prev.value)) * 100) : null;
                        const isNeutral = delta === 0;
                        const isGood = !isNeutral && (m.lower_is_better ? delta < 0 : delta > 0);

                        return (
                          <div key={key} className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-4 space-y-3">
                            <div className="flex items-start justify-between">
                              <p className="text-xs text-slate-500 font-medium">{m.label}</p>
                              {pctChange !== null && (
                                <span className={`text-xs font-bold ${isNeutral ? "text-slate-400" : isGood ? "text-emerald-400" : "text-red-400"}`}>
                                  {isNeutral ? "" : isGood ? "+" : ""}{pctChange}%{isNeutral ? " =" : ""}
                                </span>
                              )}
                            </div>

                            {/* Timeline of values with labels */}
                            <div className="flex gap-1">
                              {m.snapshots.map((s, i) => {
                                const min = Math.min(...m.snapshots.map((x) => x.value));
                                const max = Math.max(...m.snapshots.map((x) => x.value));
                                const range = max - min || 1;
                                const height = 20 + ((s.value - min) / range) * 80;
                                const isLast = i === m.snapshots.length - 1;
                                const isPrev = i === m.snapshots.length - 2;
                                return (
                                  <div key={s.audit_id} className="flex-1 flex flex-col items-center">
                                    <div className="w-full h-10 flex items-end">
                                      <div
                                        className="w-full rounded-t transition-all"
                                        style={{
                                          height: `${height}%`,
                                          backgroundColor: isLast
                                            ? (isNeutral ? "#94a3b8" : isGood ? "#34d399" : "#f87171")
                                            : isPrev ? "rgba(148, 163, 184, 0.5)" : "rgba(148, 163, 184, 0.3)",
                                        }}
                                      />
                                    </div>
                                    <span className={`text-[10px] mt-1 font-medium ${isLast ? (isNeutral ? "text-slate-300" : isGood ? "text-emerald-400" : "text-red-400") : isPrev ? "text-slate-400" : "text-slate-600"}`}>
                                      {s.value}{m.unit}
                                    </span>
                                    <span className="text-[9px] text-slate-600">{formatDate(s.date)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
