"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, Legend,
} from "recharts";
import { fetchWithAuth, isAuthenticated } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

interface CsvData {
  report_type: string;
  rows: number;
  columns: string[];
  preview: Record<string, string>[];
  filename: string;
  file_type?: string;
  raw_text?: string;
  s3_key?: string;
  file_data?: string; // base64-encoded file content
  file_mime?: string;
}

interface BenchmarkMetric {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  industry_avg: number;
}

interface BenchmarkData {
  report_type: string;
  metrics: BenchmarkMetric[];
  citations: string[];
}

interface BrandAnalysis {
  summary: string;
  competitive_landscape: string;
  top_seller_traits: string[];
}

interface Recommendation {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date: string;
}

interface SearchResultGroup {
  query: string;
  results: SearchResult[];
}

interface AnalyzeResponse {
  brand_name: string;
  niche: string;
  marketplace: string;
  brand_analysis: BrandAnalysis;
  recommendations: Recommendation[];
  search_results: SearchResultGroup[];
  citations: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

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
  unknown:         "Unknown",
};

const PRIORITY_STYLES: Record<string, string> = {
  high:   "bg-red-500/20 text-red-300 border-red-500/40",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  low:    "bg-slate-700/60 text-slate-300 border-slate-600/40",
};

// ── Helpers ────────────────────────────────────────────────────────────────

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

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 flex flex-col items-center justify-center gap-3 min-h-[180px]">
      <div className="w-7 h-7 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
      <p className="text-sm font-semibold text-red-300 mb-1">Failed to load</p>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

function CitationLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Source {i + 1}
        </a>
      ))}
    </div>
  );
}

// ── Share Button ───────────────────────────────────────────────────────────

function ShareButton({ auditId, disabled }: { auditId: string; disabled: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const resp = await fetchWithAuth(`/api/audit/${auditId}/share`, { method: "POST" });
      if (!resp.ok) throw new Error("Failed");
      const { share_url } = await resp.json();
      await navigator.clipboard.writeText(share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // fallback: copy current URL
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } finally {
      setSharing(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={disabled || sharing}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-emerald-400">Link copied!</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share with Client
        </>
      )}
    </button>
  );
}


// ── Main Page ──────────────────────────────────────────────────────────────

function AuditResultsContent() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const auditId      = params.id as string;
  const brandName    = searchParams.get("brand_name") ?? "";
  const niche        = searchParams.get("niche") ?? "";
  const marketplace  = searchParams.get("marketplace") ?? "Amazon US";
  const reportType   = searchParams.get("report_type") ?? "business_report";
  const auditPurpose = searchParams.get("audit_purpose") ?? "";
  const notes        = searchParams.get("notes") ?? "";

  const [csvData, setCsvData]               = useState<CsvData | null>(null);
  const [sessionMissing, setSessionMissing] = useState(false);

  // Benchmarks — separate call (unchanged)
  const [benchmarks, setBenchmarks]               = useState<BenchmarkData | null>(null);
  const [benchmarksLoading, setBenchmarksLoading] = useState(true);
  const [benchmarksError, setBenchmarksError]     = useState<string | null>(null);

  // AI analysis — single POST /analyze call
  const [analysis, setAnalysis]           = useState<AnalyzeResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Raw search results panel
  const [showRawSearch, setShowRawSearch] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); return; }

    // Load uploaded file data from sessionStorage
    const stored = sessionStorage.getItem(`audit_${auditId}`);
    let parsedCsv: CsvData | null = null;
    if (stored) {
      try { parsedCsv = JSON.parse(stored); setCsvData(parsedCsv); }
      catch { setSessionMissing(true); }
    } else {
      setSessionMissing(true);
    }

    // ── Fetch benchmarks + analysis in parallel ─────────────────────────
    const benchmarksPromise = fetchWithAuth(`/api/benchmarks/${reportType}`)
      .then((r) => r.ok ? r.json() : r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Failed")))
      .then((d: BenchmarkData) => { setBenchmarks(d); return d; })
      .catch((e: unknown) => { setBenchmarksError(String(e)); return null as BenchmarkData | null; })
      .finally(() => setBenchmarksLoading(false));

    const analysisPromise = fetchWithAuth("/api/audit/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand_name: brandName, niche, marketplace, report_type: reportType, audit_purpose: auditPurpose, notes }),
    })
      .then((r) => r.ok ? r.json() : r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Failed")))
      .then((d: AnalyzeResponse) => { setAnalysis(d); return d; })
      .catch((e: unknown) => { setAnalysisError(String(e)); return null as AnalyzeResponse | null; })
      .finally(() => setAnalysisLoading(false));

    // ── Save to DynamoDB once BOTH complete ──────────────────────────────
    Promise.all([analysisPromise, benchmarksPromise]).then(([analysisData, benchmarkData]) => {
      if (!analysisData) return; // analysis failed — nothing to save

      console.log("[save] triggering save for audit", auditId);
      fetchWithAuth("/api/audit/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audit_id:         auditId,
          brand_name:       brandName,
          niche,
          marketplace,
          report_type:      reportType,
          audit_purpose:    auditPurpose,
          notes,
          brand_analysis:   analysisData.brand_analysis,
          recommendations:  analysisData.recommendations,
          benchmark_metrics: benchmarkData?.metrics ?? [],
          csv_metadata:     parsedCsv
            ? { filename: parsedCsv.filename, rows: parsedCsv.rows, columns: parsedCsv.columns }
            : {},
          citations:        analysisData.citations,
        }),
      }).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          console.error("[save] failed", r.status, body);
        } else {
          console.log("[save] audit saved successfully");
        }
      }).catch((err) => console.error("[save] network error", err));
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  const reportColor = REPORT_COLORS[reportType] || "#f59e0b";

  const chartData = benchmarks?.metrics.map((m) => {
    const userVal = csvData?.preview
      ? extractUserMetric(m.key, csvData.preview, csvData.columns)
      : null;
    return { name: m.label, unit: m.unit, industry: m.industry_avg, yours: userVal, lower_is_better: m.lower_is_better };
  }) ?? [];
  const hasYourData = chartData.some((d) => d.yours !== null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm; }
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .print-section { break-inside: avoid; }
          header { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10 no-print">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              New Audit
            </Link>
            <span className="text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{brandName || "Audit"}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton auditId={auditId} disabled={analysisLoading} />
            <button
              onClick={() => window.print()}
              disabled={analysisLoading}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

        {/* Audit metadata card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-100">{brandName}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {niche && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{niche}</span>
                )}
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{marketplace}</span>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium border"
                  style={{ backgroundColor: `${reportColor}15`, color: reportColor, borderColor: `${reportColor}40` }}>
                  {REPORT_LABELS[reportType] ?? reportType}
                </span>
              </div>
              {auditPurpose && <p className="mt-3 text-sm text-slate-400 max-w-xl">{auditPurpose}</p>}
            </div>
            {csvData && (
              <div className="text-right">
                <p className="text-xs text-slate-500">Data file</p>
                {csvData.file_data ? (
                  <button
                    onClick={() => {
                      const binary = atob(csvData.file_data!);
                      const bytes = new Uint8Array(binary.length);
                      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                      const blob = new Blob([bytes], { type: csvData.file_mime || "application/octet-stream" });
                      const url = URL.createObjectURL(blob);
                      window.open(url, "_blank");
                    }}
                    className="text-sm text-amber-400 hover:text-amber-300 font-medium underline underline-offset-2 transition-colors"
                  >
                    {csvData.filename}
                  </button>
                ) : (
                  <p className="text-sm text-slate-300 font-medium">{csvData.filename}</p>
                )}
                <p className="text-xs text-slate-500">
                  {csvData.file_type === "document" || csvData.rows === 0
                    ? `${(csvData.file_type ?? "file").toUpperCase()} document`
                    : `${csvData.rows.toLocaleString()} rows · ${csvData.columns.length} columns`}
                </p>
              </div>
            )}
          </div>
          {sessionMissing && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
              No file data found — benchmarks use industry averages only. Upload a file (CSV, Excel, Word, or PDF) when starting a new audit for personalised comparison.
            </div>
          )}
        </div>

        {/* ── Section 1: Brand & Niche Analysis ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs text-blue-400 font-bold">1</span>
            Brand &amp; Niche Analysis
          </h3>

          {analysisLoading && (
            <LoadingCard label="Running multi-query web search + AI synthesis..." />
          )}
          {analysisError && !analysisLoading && <ErrorCard message={analysisError} />}
          {analysis && !analysisLoading && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Brand Summary</p>
                <p className="text-sm text-slate-300 leading-relaxed">{analysis.brand_analysis.summary}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Competitive Landscape</p>
                <p className="text-sm text-slate-300 leading-relaxed">{analysis.brand_analysis.competitive_landscape}</p>
              </div>
              {analysis.brand_analysis.top_seller_traits.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">What Top Sellers Do</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.brand_analysis.top_seller_traits.map((trait, i) => (
                      <span key={i} className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">{trait}</span>
                    ))}
                  </div>
                </div>
              )}
              <CitationLinks urls={analysis.citations} />

              {/* Raw search results toggle */}
              {analysis.search_results.length > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <button
                    onClick={() => setShowRawSearch((v) => !v)}
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <svg className={`h-3.5 w-3.5 transition-transform ${showRawSearch ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {showRawSearch ? "Hide" : "Show"} raw search results ({analysis.search_results.length} queries)
                  </button>

                  {showRawSearch && (
                    <div className="mt-4 space-y-4">
                      {analysis.search_results.map((group, gi) => (
                        <div key={gi} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
                          <p className="text-xs font-semibold text-amber-400 mb-3">Query: &ldquo;{group.query}&rdquo;</p>
                          {group.results.length === 0 ? (
                            <p className="text-xs text-slate-500">No results</p>
                          ) : (
                            <div className="space-y-3">
                              {group.results.map((r, ri) => (
                                <div key={ri} className="space-y-0.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                                      className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors truncate">
                                      {r.title}
                                    </a>
                                    {r.date && <span className="text-xs text-slate-600 shrink-0">{r.date}</span>}
                                  </div>
                                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{r.snippet}</p>
                                  <p className="text-xs text-slate-600 truncate">{r.url}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Section 2: Industry Benchmarks ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">2</span>
            Industry Benchmarks
          </h3>
          {benchmarksLoading && <LoadingCard label="Fetching live industry benchmarks..." />}
          {benchmarksError && !benchmarksLoading && <ErrorCard message={benchmarksError} />}
          {benchmarks && !benchmarksLoading && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">Real-time Amazon seller industry averages</p>
                {hasYourData && <span className="text-xs text-emerald-400 font-medium">Your data included</span>}
              </div>

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
                      formatter={(value: number, name: string, props: { payload?: { unit?: string } }) => {
                        const unit = props.payload?.unit ?? "";
                        return [`${value}${unit}`, name === "industry" ? "Industry Avg" : "Your Data"];
                      }}
                    />
                    <Legend
                      payload={[
                        { value: "industry", type: "square", color: reportColor },
                        ...(hasYourData ? [{ value: "yours", type: "square" as const, color: "#22d3ee" }] : []),
                      ]}
                      formatter={(value) => (
                        <span className="text-xs text-slate-400">{value === "industry" ? "Industry Average" : "Your Data"}</span>
                      )}
                    />
                    <Bar dataKey="industry" name="industry" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {chartData.map((_, i) => <Cell key={i} fill={reportColor} fillOpacity={0.85} />)}
                    </Bar>
                    {hasYourData && (
                      <Bar dataKey="yours" name="yours" radius={[6, 6, 0, 0]} maxBarSize={48}>
                        {chartData.map((_, i) => <Cell key={i} fill="#22d3ee" fillOpacity={0.8} />)}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {benchmarks.metrics.map((m) => {
                  const userVal = csvData?.preview ? extractUserMetric(m.key, csvData.preview, csvData.columns) : null;
                  const diff    = userVal !== null ? userVal - m.industry_avg : null;
                  const isGood  = diff !== null ? (m.lower_is_better ? diff < 0 : diff > 0) : null;
                  return (
                    <div key={m.key} className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 space-y-1">
                      <p className="text-xs text-slate-500 font-medium truncate">{m.label}</p>
                      <p className="text-lg font-bold text-slate-200">
                        {m.industry_avg}{m.unit}
                        <span className="text-xs font-normal text-slate-500 ml-1">avg</span>
                      </p>
                      {userVal !== null && diff !== null && (
                        <p className={`text-xs font-semibold ${isGood ? "text-emerald-400" : "text-red-400"}`}>
                          {isGood ? "▲" : "▼"} Yours: {userVal}{m.unit}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <CitationLinks urls={benchmarks.citations} />
            </div>
          )}
        </section>

        {/* ── Section 3: Recommendations ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs text-emerald-400 font-bold">3</span>
            Improvement Recommendations
          </h3>
          {analysisLoading && <LoadingCard label="Generating tailored recommendations..." />}
          {analysisError && !analysisLoading && <ErrorCard message={analysisError} />}
          {analysis && !analysisLoading && (
            <div className="space-y-3">
              {[...analysis.recommendations]
                .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1))
                .map((rec, i) => (
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
          )}
        </section>

      </main>
    </div>
  );
}

export default function AuditResultsPage() {
  return <AuditResultsContent />;
}
