"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, Legend,
} from "recharts";
import { fetchWithAuth, isAuthenticated } from "@/lib/auth";
import { getCachedReport, setCachedReport, getCachedAuditList } from "@/lib/cache";
import { AuditResults, AnalysisLoading, GatedCta, type AnalysisResult } from "@/components/AuditResults";

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

/**
 * Extract a metric value from unstructured text (PDF / Word docs).
 * Looks for keyword near a number, e.g. "ACOS: 25.3%" or "Return Rate 4.1%".
 */
function extractMetricFromText(key: string, text: string): number | null {
  const keywordMap: Record<string, string[]> = {
    acos:                  ["acos", "advertising cost of sale"],
    roas:                  ["roas", "return on ad spend"],
    ctr:                   ["ctr", "click-through rate", "click through rate"],
    cpc:                   ["cpc", "cost per click"],
    conversion_rate:       ["conversion rate", "unit session percentage", "cvr"],
    units_per_order:       ["units per order", "units ordered"],
    buy_box_percentage:    ["buy box", "featured offer"],
    return_rate:           ["return rate"],
    order_defect_rate:     ["order defect", "odr"],
    late_shipment_rate:    ["late shipment"],
    valid_tracking_rate:   ["valid tracking"],
    cancellation_rate:     ["cancellation rate"],
    in_stock_rate:         ["in stock rate", "instock rate"],
    inventory_turnover:    ["inventory turnover", "turnover rate"],
    stranded_rate:         ["stranded rate", "stranded inventory"],
    aged_inventory_rate:   ["aged inventory", "180 day", "180-day"],
    listing_quality_score: ["quality score", "listing score"],
    image_count:           ["image count", "images per"],
    review_count:          ["review count", "number of reviews", "total reviews"],
  };
  const keywords = keywordMap[key];
  if (!keywords) return null;

  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    // Look for number within 50 chars after the keyword
    const after = text.slice(idx + kw.length, idx + kw.length + 50);
    const match = after.match(/[\s:=\-–—]*(\$?\d[\d,]*\.?\d*)\s*%?/);
    if (match) {
      const val = parseFloat(match[1].replace(/[$,]/g, ""));
      if (!isNaN(val)) return Math.round(val * 100) / 100;
    }
  }
  return null;
}

/**
 * Universal metric extractor — works with CSV columns/preview OR raw text.
 */
function extractMetric(
  key: string,
  data: { preview?: Record<string, string>[]; columns?: string[]; raw_text?: string }
): number | null {
  // Try structured CSV data first
  if (data.preview?.length && data.columns?.length) {
    const val = extractUserMetric(key, data.preview, data.columns);
    if (val !== null) return val;
  }
  // Fall back to raw text extraction (PDF / Word)
  if (data.raw_text) {
    return extractMetricFromText(key, data.raw_text);
  }
  return null;
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
  const isSaved      = searchParams.get("saved") === "true";

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

  // Progress tracking — compare with previous audit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prevAudit, setPrevAudit] = useState<Record<string, any> | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);

  // AI deep analysis (Claude-powered)
  const [deepAnalysis, setDeepAnalysis] = useState<AnalysisResult | null>(null);
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false);
  const [deepAnalysisError, setDeepAnalysisError] = useState<string | null>(null);
  const deepAnalysisRestoredRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); return; }

    // Load uploaded file data from sessionStorage
    const stored = sessionStorage.getItem(`audit_${auditId}`);
    let parsedCsv: CsvData | null = null;
    if (stored) {
      try {
        parsedCsv = JSON.parse(stored);
        // Merge large file blob stored separately (may not exist if quota was exceeded)
        const fileBlob = sessionStorage.getItem(`audit_file_${auditId}`);
        if (fileBlob && parsedCsv) {
          const { file_data, file_mime } = JSON.parse(fileBlob);
          parsedCsv.file_data = file_data;
          parsedCsv.file_mime = file_mime;
        }
        setCsvData(parsedCsv);
      }
      catch { setSessionMissing(true); }
    } else {
      setSessionMissing(true);
    }

    // ── Check localStorage cache first for instant display ──────────────
    const cached = getCachedReport(auditId);
    if (cached && cached.brand_analysis && Object.keys(cached.brand_analysis as object).length > 0) {
      console.log("[audit] Loading from localStorage cache (instant)");
      _applyData(cached);
      return; // done — no API calls needed
    }

    // ── No local cache — try DynamoDB ───────────────────────────────────
    fetchWithAuth(`/api/audit/${auditId}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) return null;
        return r.json();
      })
      .then((saved) => {
        if (saved && saved.brand_analysis && Object.keys(saved.brand_analysis).length > 0) {
          console.log("[audit] Loading from DynamoDB (caching locally)");
          setCachedReport(auditId, saved); // cache for next time
          _applyData(saved);
          return;
        }

        // No saved data found
        if (isSaved) {
          console.log("[audit] Saved audit has no data — skipping Perplexity");
          setAnalysisError("Could not load saved report data. Please try again.");
          setAnalysisLoading(false);
          setBenchmarksLoading(false);
          return;
        }
        console.log("[audit] No saved data found — calling Perplexity API");
        _fetchFresh(parsedCsv);
      })
      .catch(() => {
        if (isSaved) {
          console.log("[audit] Network error loading saved audit — skipping Perplexity");
          setAnalysisError("Could not load saved report. Please check your connection.");
          setAnalysisLoading(false);
          setBenchmarksLoading(false);
          return;
        }
        _fetchFresh(parsedCsv);
      });

    // ── Apply saved/cached data to state ────────────────────────────────
    function _applyData(data: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setAnalysis({
        brand_name:     d.brand_name ?? brandName,
        niche:          d.niche ?? niche,
        marketplace:    d.marketplace ?? marketplace,
        brand_analysis: d.brand_analysis,
        recommendations: d.recommendations ?? [],
        search_results: [],
        citations:      d.citations ?? [],
      });
      setAnalysisLoading(false);

      if (d.benchmark_metrics?.length) {
        setBenchmarks({
          report_type: d.report_type ?? reportType,
          metrics:     d.benchmark_metrics,
          citations:   d.citations ?? [],
        });
        setBenchmarksLoading(false);
      } else {
        _fetchBenchmarks();
      }

      // Restore deep analysis from saved data (skip re-fetching from Claude)
      if (d.deep_analysis && typeof d.deep_analysis === "object" && Object.keys(d.deep_analysis).length > 0) {
        deepAnalysisRestoredRef.current = true;
        setDeepAnalysis(d.deep_analysis as AnalysisResult);
        setDeepAnalysisLoading(false);
      }

      // Restore uploaded file info if sessionStorage is empty
      const s3Key = d.s3_key || d.csv_metadata?.s3_key;
      const meta = d.csv_metadata ?? {};
      if (!parsedCsv && (s3Key || meta.filename)) {
        // Show filename immediately from metadata (include preview + raw_text for progress tracking)
        setCsvData({
          report_type: d.report_type ?? reportType,
          rows:        meta.rows ?? 0,
          columns:     meta.columns ?? [],
          preview:     meta.preview ?? [],
          filename:    meta.filename ?? "uploaded file",
          raw_text:    meta.raw_text,
          s3_key:      s3Key,
        });
        setSessionMissing(false);

        // Then fetch actual file blob from S3 for download link
        if (s3Key) {
          fetchWithAuth(`/api/upload/file?s3_key=${encodeURIComponent(s3Key)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((file) => {
              if (!file) return;
              setCsvData((prev) => prev ? {
                ...prev,
                file_data: file.file_data,
                file_mime: file.content_type,
                filename:  file.filename ?? prev.filename,
              } : prev);
            })
            .catch(() => {});
        }
      }
    }

    const VALID_BENCHMARK_TYPES = ["ads", "business_report", "account_health", "fba_inventory", "active_listings"];

    function _fetchBenchmarks() {
      if (!VALID_BENCHMARK_TYPES.includes(reportType)) {
        setBenchmarksLoading(false);
        return;
      }
      fetchWithAuth(`/api/benchmarks/${reportType}`)
        .then((r) => r.ok ? r.json() : r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Failed")))
        .then((d: BenchmarkData) => { setBenchmarks(d); })
        .catch((e: unknown) => { setBenchmarksError(String(e)); })
        .finally(() => setBenchmarksLoading(false));
    }

    function _fetchFresh(csv: CsvData | null) {
      const benchmarksPromise = VALID_BENCHMARK_TYPES.includes(reportType)
        ? fetchWithAuth(`/api/benchmarks/${reportType}`)
            .then(async (r) => {
              if (r.ok) return r.json();
              const text = await r.text();
              let detail = text;
              try { detail = JSON.parse(text)?.detail ?? text; } catch { /* plain text error */ }
              return Promise.reject(detail);
            })
            .then((d: BenchmarkData) => { setBenchmarks(d); return d; })
            .catch((e: unknown) => { setBenchmarksError(String(e)); return null as BenchmarkData | null; })
            .finally(() => setBenchmarksLoading(false))
        : Promise.resolve(null as BenchmarkData | null).finally(() => setBenchmarksLoading(false));

      const analysisPromise = fetchWithAuth("/api/audit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: brandName, niche, marketplace, report_type: reportType, audit_purpose: auditPurpose, notes }),
      })
        .then(async (r) => {
          if (r.ok) return r.json();
          // Try JSON first, fall back to text for non-JSON error responses
          const text = await r.text();
          let detail = text;
          try { detail = JSON.parse(text)?.detail ?? text; } catch { /* plain text error */ }
          return Promise.reject(detail);
        })
        .then((d: AnalyzeResponse) => { setAnalysis(d); return d; })
        .catch((e: unknown) => { setAnalysisError(String(e)); return null as AnalyzeResponse | null; })
        .finally(() => setAnalysisLoading(false));

      // ── Save to DynamoDB + localStorage once BOTH complete ─────────────
      Promise.all([analysisPromise, benchmarksPromise]).then(([analysisData, benchmarkData]) => {
        if (!analysisData) return;

        const savePayload = {
          audit_id:         auditId,
          created_at:       new Date().toISOString(),
          brand_name:       brandName,
          niche,
          marketplace,
          report_type:      reportType,
          audit_purpose:    auditPurpose,
          notes,
          brand_analysis:   analysisData.brand_analysis,
          recommendations:  analysisData.recommendations,
          benchmark_metrics: benchmarkData?.metrics ?? [],
          csv_metadata:     csv
            ? { filename: csv.filename, rows: csv.rows, columns: csv.columns, preview: csv.preview, raw_text: csv.raw_text }
            : {},
          citations:        analysisData.citations,
          s3_key:           csv?.s3_key ?? "",
        };

        // Cache locally for instant loads next time
        setCachedReport(auditId, savePayload);

        console.log("[save] triggering save for audit", auditId);
        fetchWithAuth("/api/audit/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            console.error("[save] failed", r.status, body);
          } else {
            console.log("[save] audit saved successfully");
          }
        }).catch((err) => console.error("[save] network error", err));
      });
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // ── Progress tracking: find previous audit for same brand + report type ──
  useEffect(() => {
    if (!brandName || !reportType) return;
    setProgressLoading(true);

    // Try cached list first, then fall back to API
    const tryList = (list: { audit_id: string; brand_name: string; report_type: string; created_at: string }[] | null) => {
      if (!list) return null;
      return list
        .filter((a) => a.brand_name === brandName && a.report_type === reportType && a.audit_id !== auditId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    };

    const cached = getCachedAuditList() as { audit_id: string; brand_name: string; report_type: string; created_at: string }[] | null;
    const prev = tryList(cached);

    const loadPrev = (prevId: string, createdAt?: string) => {
      const cachedReport = getCachedReport(prevId);
      if (cachedReport && cachedReport.csv_metadata) {
        if (createdAt && !cachedReport.created_at) cachedReport.created_at = createdAt;
        setPrevAudit(cachedReport);
        setProgressLoading(false);
        return;
      }
      fetchWithAuth(`/api/audit/${prevId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            if (createdAt && !data.created_at) data.created_at = createdAt;
            setPrevAudit(data);
          }
        })
        .catch(() => {})
        .finally(() => setProgressLoading(false));
    };

    if (prev) {
      loadPrev(prev.audit_id, prev.created_at);
    } else {
      // No cached list — fetch from API
      fetchWithAuth("/api/audit/list")
        .then((r) => r.ok ? r.json() : null)
        .then((d: { audits?: { audit_id: string; brand_name: string; report_type: string; created_at: string }[] } | null) => {
          const match = tryList(d?.audits ?? null);
          if (match) loadPrev(match.audit_id, match.created_at);
          else setProgressLoading(false);
        })
        .catch(() => setProgressLoading(false));
    }
  }, [auditId, brandName, reportType]);

  // ── Deep analysis: call Claude-powered /api/analyze when we have file data ──
  useEffect(() => {
    // Skip if already restored from DynamoDB/cache, already loaded, or loading
    if (deepAnalysisRestoredRef.current || deepAnalysis || deepAnalysisLoading) return;
    // Need either an S3 key or inline base64 file data
    if (!csvData?.s3_key && !csvData?.file_data) return;

    setDeepAnalysisLoading(true);

    // Collect S3 keys from multi-session upload (all slots)
    const multiRaw = sessionStorage.getItem(`multi_session_${auditId}`);
    const multiFiles: { s3_key?: string }[] = multiRaw ? (JSON.parse(multiRaw)?.files ?? []) : [];
    const allS3Keys: string[] = multiFiles.map((f) => f.s3_key).filter(Boolean) as string[];

    // Include primary file's S3 key if not already present
    if (csvData.s3_key && !allS3Keys.includes(csvData.s3_key)) {
      allS3Keys.push(csvData.s3_key);
    }

    // Collect inline files (base64 fallback when S3 unavailable)
    const allInlineRaw = sessionStorage.getItem(`audit_all_files_${auditId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allInlineFiles: any[] = allInlineRaw ? JSON.parse(allInlineRaw) : [];

    // Fall back to just the primary file if no multi-file data exists
    if (allInlineFiles.length === 0 && csvData.file_data) {
      allInlineFiles.push({
        filename: csvData.filename || "upload.csv",
        content: csvData.file_data,
        content_type: csvData.file_mime || "text/csv",
      });
    }

    const payload = {
      session_id: auditId,
      s3_keys: allS3Keys,
      inline_files: allInlineFiles,
      brand_name: brandName,
      niche,
      marketplace,
    };

    fetchWithAuth("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Analysis failed"));
        return r.json();
      })
      .then((data) => {
        if (data?.analysis) {
          setDeepAnalysis(data.analysis as AnalysisResult);

          // Persist deep_analysis to DynamoDB so past audits load instantly
          fetchWithAuth("/api/audit/update-deep-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audit_id: auditId,
              deep_analysis: data.analysis,
            }),
          })
            .then((r) => {
              if (r.ok) console.log("[deep-analysis] saved to DynamoDB");
              else console.error("[deep-analysis] save failed", r.status);
            })
            .catch((err) => console.error("[deep-analysis] save error", err));

          // Update local cache too
          try {
            const cached = localStorage.getItem(`audit_report_${auditId}`);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed.data) {
                parsed.data.deep_analysis = data.analysis;
                localStorage.setItem(`audit_report_${auditId}`, JSON.stringify(parsed));
              }
            }
          } catch { /* ignore */ }
        }
      })
      .catch((e: unknown) => {
        console.error("[deep-analysis] Error:", e);
        setDeepAnalysisError(String(e));
      })
      .finally(() => setDeepAnalysisLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvData?.s3_key, csvData?.file_data, auditId]);

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
          @page { size: A4; margin: 0; }

          /* Hide nav, show print-only branding */
          .no-print, header { display: none !important; }
          .print-only { display: block !important; }

          /* Padding replaces @page margin — hides browser URL header/footer */
          main { padding: 14mm 18mm 18mm 18mm !important; }

          /* Force color printing */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* White base */
          html, body, .min-h-screen {
            background: white !important;
            color: #1e293b !important;
          }

          /* ── Text readability on white ── */
          .text-slate-100, .text-slate-200, .text-slate-300 { color: #1e293b !important; }
          .text-slate-400, .text-slate-500 { color: #64748b !important; }
          .text-slate-600 { color: #94a3b8 !important; }

          /* ── Cards: light gray bg, subtle border ── */
          .rounded-2xl { background: #f8fafc !important; border-color: #e2e8f0 !important; }
          .rounded-xl { background: #f8fafc !important; border-color: #e2e8f0 !important; }

          /* ── Section number badges — keep original colors ── */
          .bg-blue-500\\/20 { background: #dbeafe !important; }
          .text-blue-400 { color: #3b82f6 !important; }
          .border-blue-500\\/40 { border-color: #93c5fd !important; }

          .bg-amber-500\\/20 { background: #fef3c7 !important; }
          .text-amber-400 { color: #f59e0b !important; }
          .border-amber-500\\/40 { border-color: #fcd34d !important; }

          .bg-emerald-500\\/20 { background: #d1fae5 !important; }
          .text-emerald-400 { color: #10b981 !important; }
          .border-emerald-500\\/40 { border-color: #6ee7b7 !important; }

          .bg-cyan-500\\/20 { background: #cffafe !important; }
          .text-cyan-400 { color: #06b6d4 !important; }
          .border-cyan-500\\/40 { border-color: #67e8f9 !important; }

          /* ── Metadata tag badges ── */
          .bg-slate-800 { background: #f1f5f9 !important; }
          .border-slate-700 { border-color: #cbd5e1 !important; }

          /* ── Top seller trait pills ── */
          .bg-blue-500\\/10 { background: #eff6ff !important; }
          .border-blue-500\\/30 { border-color: #93c5fd !important; }
          .text-blue-300 { color: #2563eb !important; }

          /* ── Priority badges — keep vivid colors ── */
          .bg-red-500\\/20 { background: #fee2e2 !important; }
          .text-red-300 { color: #dc2626 !important; }
          .border-red-500\\/40 { border-color: #fca5a5 !important; }

          .bg-amber-500\\/20 { background: #fef3c7 !important; }
          .text-amber-300 { color: #d97706 !important; }
          .border-amber-500\\/40 { border-color: #fcd34d !important; }

          .bg-slate-700\\/60 { background: #e2e8f0 !important; }
          .text-slate-300 { color: #334155 !important; }
          .border-slate-600\\/40 { border-color: #cbd5e1 !important; }

          /* ── Step number boxes (01, 02...) ── */
          .bg-emerald-500\\/10 { background: #ecfdf5 !important; }
          .border-emerald-500\\/30 { border-color: #6ee7b7 !important; }

          /* ── Outcome line ── */
          .text-emerald-400\\/80 { color: #059669 !important; }
          .text-emerald-400 { color: #059669 !important; }

          /* ── Source links ── */
          .text-slate-500 a, a.text-slate-500 { color: #64748b !important; }

          /* ── Bullet dots ── */
          .bg-slate-600 { background: #94a3b8 !important; }

          /* ── Benchmark metric cards ── */
          .bg-slate-800\\/50 { background: #f1f5f9 !important; }
          .border-slate-700\\/40 { border-color: #e2e8f0 !important; }

          /* ── Chart readable on white ── */
          .recharts-cartesian-axis-tick-value { fill: #475569 !important; }
          .recharts-legend-item-text { color: #475569 !important; }

          /* ── Page break rules ── */
          section, .rounded-2xl, .benchmark-print-group {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
          .rec-card, .grid > div {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          section > h3 { break-after: avoid; page-break-after: avoid; }

          /* Timeline line hidden */
          .timeline-line { display: none !important; }

          /* ── Spacing ── */
          .space-y-8 > * + * { margin-top: 1.25rem !important; }
          .space-y-5 > * + * { margin-top: 0.75rem !important; }
          .pb-8 { padding-bottom: 0.5rem !important; }

          /* ── Progress tracking colors ── */
          .bg-blue-500\\/20 { background: #dbeafe !important; }
          .text-blue-300 { color: #2563eb !important; }
          .border-blue-500\\/30 { border-color: #93c5fd !important; }
        }
      `}</style>

      {/* Print-only header — replaces browser URL */}
      <div className="print-only hidden mb-6">
        <div className="flex items-center justify-between border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Amazon Audit Report</h1>
            <p className="text-sm text-slate-500 mt-1">{brandName} — {niche || "General"} · {marketplace}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Generated by</p>
            <p className="text-sm font-semibold text-slate-700">Amazon Audit by Khan Business Consulting Company</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10 no-print">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Dashboard
            </Link>
            <span className="text-slate-700">/</span>
            <Link href="/audits" className="text-sm text-slate-400 hover:text-amber-400 transition-colors">
              All Audits
            </Link>
            <span className="text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{brandName || "Audit"}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton auditId={auditId} disabled={analysisLoading} />
            <button
              onClick={() => {
                const orig = document.title;
                document.title = `${brandName} — Amazon Audit Report`;
                window.print();
                document.title = orig;
              }}
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
                ) : csvData.s3_key ? (
                  <button
                    onClick={() => {
                      fetchWithAuth(`/api/upload/file?s3_key=${encodeURIComponent(csvData.s3_key!)}`)
                        .then((r) => r.ok ? r.json() : null)
                        .then((file) => {
                          if (!file?.file_data) return;
                          const binary = atob(file.file_data);
                          const bytes = new Uint8Array(binary.length);
                          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                          const blob = new Blob([bytes], { type: file.content_type || "application/octet-stream" });
                          window.open(URL.createObjectURL(blob), "_blank");
                        });
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

        {/* ── Section 2: AI Deep Analysis (Claude-powered) ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">2</span>
            AI Performance Analysis
          </h3>

          {deepAnalysisLoading && <AnalysisLoading />}
          {deepAnalysisError && !deepAnalysisLoading && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
              <p className="text-sm font-semibold text-red-300 mb-1">Analysis unavailable</p>
              <p className="text-sm text-slate-400">{deepAnalysisError}</p>
            </div>
          )}
          {deepAnalysis && !deepAnalysisLoading && (
            <AuditResults data={deepAnalysis} />
          )}
          {!deepAnalysisLoading && !deepAnalysisError && !deepAnalysis && !csvData?.s3_key && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
              <p className="text-sm text-slate-400">Upload a file with your audit to unlock AI-powered performance analysis</p>
            </div>
          )}
        </section>

        {/* ── Section 3: Industry Benchmarks ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">3</span>
            Industry Benchmarks
          </h3>
          {benchmarksLoading && <LoadingCard label="Fetching live industry benchmarks..." />}
          {benchmarksError && !benchmarksLoading && <ErrorCard message={benchmarksError} />}
          {benchmarks && !benchmarksLoading && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5 benchmark-print-group">
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

        {/* ── Section 4: Recommendations ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs text-emerald-400 font-bold">4</span>
            Improvement Recommendations
          </h3>
          {analysisLoading && <LoadingCard label="Generating tailored recommendations..." />}
          {analysisError && !analysisLoading && <ErrorCard message={analysisError} />}
          {analysis && !analysisLoading && (
            <div className="relative space-y-0">
              {/* Vertical timeline line */}
              <div className="absolute left-[23px] top-8 bottom-8 w-px bg-gradient-to-b from-emerald-500/40 via-slate-700/60 to-transparent timeline-line" />

              {[...analysis.recommendations]
                .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1))
                .map((rec, i) => {
                  // Split description into sentences for bullet points
                  const sentences = rec.description
                    .split(/(?<=[.!?])\s+/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);

                  return (
                    <div key={i} className="relative pl-16 pb-8 last:pb-0 group rec-card">
                      {/* Step number */}
                      <div className="absolute left-0 top-0 w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-lg font-bold text-emerald-400 group-hover:bg-emerald-500/20 group-hover:border-emerald-500/50 transition-colors z-10">
                        {String(i + 1).padStart(2, "0")}
                      </div>

                      {/* Card */}
                      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-700 transition-colors">
                        {/* Title row */}
                        <div className="flex items-center gap-3 flex-wrap mb-3">
                          <h4 className="text-base font-semibold text-slate-100">{rec.title}</h4>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide border ${PRIORITY_STYLES[rec.priority] ?? PRIORITY_STYLES.medium}`}>
                            {rec.priority}
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
                            <span className="font-semibold text-emerald-400/80">Outcome:</span>{" "}
                            {rec.priority === "high"
                              ? "High-impact improvement driving measurable results."
                              : rec.priority === "medium"
                                ? "Meaningful optimization contributing to sustained growth."
                                : "Incremental refinement supporting long-term performance."}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* ── Section 5: Progress Tracking ── */}
        {(() => {
          if (progressLoading) {
            return (
              <section>
                <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-xs text-cyan-400 font-bold">5</span>
                  Progress Tracking
                </h3>
                <LoadingCard label="Looking for previous audits to compare..." />
              </section>
            );
          }

          // Need previous audit + benchmarks; works with CSV, PDF, or Word data
          const prevCsv = prevAudit?.csv_metadata as { columns?: string[]; preview?: Record<string, string>[]; raw_text?: string } | undefined;
          const currentData = { preview: csvData?.preview, columns: csvData?.columns, raw_text: csvData?.raw_text };
          const prevData = { preview: prevCsv?.preview, columns: prevCsv?.columns, raw_text: (prevAudit?.raw_text ?? prevCsv?.raw_text) as string | undefined };

          // Need at least some data on both sides + benchmark metrics to compare against
          const hasCurrentData = (currentData.preview?.length && currentData.columns?.length) || currentData.raw_text;
          const hasPrevData = (prevData.preview?.length && prevData.columns?.length) || prevData.raw_text;
          if (!prevAudit || !hasCurrentData || !hasPrevData || !benchmarks?.metrics?.length) return null;

          const prevDate = prevAudit.created_at
            ? new Date(prevAudit.created_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "Previous";

          // Build comparison data for each metric
          const comparisons = benchmarks.metrics.map((m) => {
            const current = extractMetric(m.key, currentData);
            const previous = extractMetric(m.key, prevData);
            if (current === null && previous === null) return null;

            const delta = current !== null && previous !== null ? current - previous : null;
            const pctChange = delta !== null && previous !== null && previous !== 0 ? Math.round((delta / Math.abs(previous)) * 100) : null;
            const isNeutral = delta === 0;
            const isImproved = delta !== null && !isNeutral ? (m.lower_is_better ? delta < 0 : delta > 0) : null;

            return { key: m.key, label: m.label, unit: m.unit, current, previous, delta, pctChange, isImproved, isNeutral, isNew: previous === null };
          }).filter(Boolean) as { key: string; label: string; unit: string; current: number | null; previous: number | null; delta: number | null; pctChange: number | null; isImproved: boolean | null; isNeutral: boolean; isNew: boolean }[];

          if (comparisons.length === 0) return null;

          const improved = comparisons.filter((c) => c.isImproved === true).length;
          const unchanged = comparisons.filter((c) => c.isNeutral).length;
          const comparable = comparisons.filter((c) => c.delta !== null).length;

          return (
            <section className="print-section">
              <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-xs text-cyan-400 font-bold">4</span>
                Progress Tracking
              </h3>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
                {/* Summary bar */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-sm text-slate-400">
                      Comparing with audit from <span className="text-slate-200 font-medium">{prevDate}</span>
                    </p>
                  </div>
                  {comparable > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-200">
                        {improved}/{comparable} improved{unchanged > 0 ? ` · ${unchanged} unchanged` : ""}
                      </span>
                      <div className="w-24 h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${((improved + unchanged) / comparable) * 100}%`,
                            backgroundColor: unchanged === comparable ? "#94a3b8" : improved / (comparable - unchanged || 1) >= 0.5 ? "#34d399" : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Metric comparison cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {comparisons.map((c) => (
                    <div key={c.key} className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 space-y-2">
                      <p className="text-xs text-slate-500 font-medium truncate">{c.label}</p>

                      {c.isNew ? (
                        <>
                          <p className="text-lg font-bold text-slate-200">
                            {c.current}{c.unit}
                          </p>
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            NEW
                          </span>
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
                            <p className={`text-xs font-semibold ${c.isNeutral ? "text-slate-400" : c.isImproved ? "text-emerald-400" : "text-red-400"}`}>
                              {c.isNeutral ? "=" : c.isImproved ? "▲" : "▼"} {c.pctChange > 0 ? "+" : ""}{c.pctChange}% change
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })()}

        {/* ── Gated CTA — after all sections ── */}
        {deepAnalysis?.gatedInsights && (
          <GatedCta gated={deepAnalysis.gatedInsights} />
        )}

      </main>

      {/* Print-only footer */}
      <div className="print-only hidden mt-8 pt-4 border-t border-slate-300 text-center">
        <p className="text-xs text-slate-500">
          Generated by <span className="font-semibold">Amazon Audit by Khan Business Consulting Company</span>
        </p>
      </div>
    </div>
  );
}

export default function AuditResultsPage() {
  return <AuditResultsContent />;
}
