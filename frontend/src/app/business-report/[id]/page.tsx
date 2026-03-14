"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchWithAuth, setStoreUrl as persistStoreUrl } from "@/lib/auth";
import DiagnosticCard from "@/components/DiagnosticCard";
import HealthScoreGauge from "@/components/HealthScoreGauge";
import BeforeAfterPanel from "@/components/BeforeAfterPanel";

// ── Types ──────────────────────────────────────────────────────────────────

interface DiagnosticData {
  asin: string;
  title: string;
  sessions: number;
  conversion_rate: number;
  units_sold: number;
  revenue: number;
  ad_spend: number;
  acos: number;
  diagnosis: string;
  diagnosis_reason: string;
  explanation: string;
  top_actions: string[];
}

interface BeforeAfterData {
  asin: string;
  title: string;
  current: {
    sessions: number;
    conversion_rate: number;
    units_sold: number;
    revenue: number;
    ad_spend: number;
    acos: number;
  };
  projected: {
    sessions: number;
    conversion_rate: number;
    revenue: number;
  };
  changes_summary: { change: string; expected_impact: string }[];
}

interface ExecutiveSummary {
  health_score: number;
  top_wins: string[];
  top_risks: string[];
  thirty_day_priorities: string[];
  ninety_day_priorities: string[];
}

interface ReportData {
  brand_name: string;
  niche: string;
  marketplace: string;
  diagnostics: DiagnosticData[];
  before_after: BeforeAfterData[];
  executive_summary: ExecutiveSummary;
  citations: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
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
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } finally {
      setSharing(false);
    }
  };

  return (
    <button onClick={handleShare} disabled={disabled || sharing}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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

function BusinessReportContent() {
  const params       = useParams();
  const searchParams = useSearchParams();

  const auditId      = params.id as string;
  const brandName    = searchParams.get("brand_name") ?? "";
  const niche        = searchParams.get("niche") ?? "";
  const marketplace  = searchParams.get("marketplace") ?? "Amazon US";
  const auditPurpose = searchParams.get("audit_purpose") ?? "";
  const notes        = searchParams.get("notes") ?? "";
  const isSaved      = searchParams.get("saved") === "true";
  const storeUrlParam = searchParams.get("store_url") ?? "";

  const [report, setReport]           = useState<ReportData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [asinCount, setAsinCount]     = useState(0);

  useEffect(() => {
    if (storeUrlParam) persistStoreUrl(storeUrlParam);

    // Load ASIN metrics from sessionStorage
    const stored = sessionStorage.getItem(`business_report_${auditId}`);
    let asinMetrics: Record<string, unknown>[] = [];
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        asinMetrics = parsed.asin_metrics ?? [];
        setAsinCount(asinMetrics.length);
      } catch { /* ignore */ }
    }

    // Try loading saved report from DynamoDB first
    fetchWithAuth(`/api/business-report/${auditId}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) return null;
        return r.json();
      })
      .then((saved) => {
        if (saved && saved.diagnostics && saved.diagnostics.length > 0) {
          console.log("[business-report] Loading saved report (no API calls)");
          setReport({
            brand_name:       saved.brand_name ?? brandName,
            niche:            saved.niche ?? niche,
            marketplace:      saved.marketplace ?? marketplace,
            diagnostics:      saved.diagnostics ?? [],
            before_after:     saved.before_after ?? [],
            executive_summary: saved.executive_summary ?? { health_score: 5, top_wins: [], top_risks: [], thirty_day_priorities: [], ninety_day_priorities: [] },
            citations:        saved.citations ?? [],
          });
          setAsinCount(saved.diagnostics?.length ?? 0);
          setLoading(false);
          return;
        }

        if (isSaved) {
          setError("Could not load saved report data. Please try again.");
          setLoading(false);
          return;
        }

        if (!asinMetrics.length) {
          setError("No ASIN data found. Please upload a Business Report CSV and try again.");
          setLoading(false);
          return;
        }

        // Fresh analysis
        _fetchFresh(asinMetrics);
      })
      .catch(() => {
        if (isSaved) {
          setError("Could not load saved report. Please check your connection.");
          setLoading(false);
          return;
        }
        if (!asinMetrics.length) {
          setError("No ASIN data found and server unavailable.");
          setLoading(false);
          return;
        }
        _fetchFresh(asinMetrics);
      });

    function _fetchFresh(metrics: Record<string, unknown>[]) {
      fetchWithAuth("/api/business-report/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_name: brandName,
          niche,
          marketplace,
          audit_purpose: auditPurpose,
          notes,
          asin_metrics: metrics,
        }),
      })
        .then((r) => r.ok ? r.json() : r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? "Failed")))
        .then((data: ReportData) => {
          setReport(data);
          setAsinCount(data.diagnostics.length);

          // Auto-save
          fetchWithAuth("/api/business-report/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audit_id:          auditId,
              brand_name:        brandName,
              niche,
              marketplace,
              audit_purpose:     auditPurpose,
              notes,
              diagnostics:       data.diagnostics,
              before_after:      data.before_after,
              executive_summary: data.executive_summary,
              citations:         data.citations,
            }),
          }).then(async (r) => {
            if (!r.ok) console.error("[save] failed", r.status);
            else console.log("[save] business report saved successfully");
          }).catch((err) => console.error("[save] network error", err));
        })
        .catch((e: unknown) => { setError(String(e)); })
        .finally(() => setLoading(false));
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // Diagnostic summary counts
  const healthyCount      = report?.diagnostics.filter((d) => d.diagnosis === "HEALTHY").length ?? 0;
  const listingIssueCount = report?.diagnostics.filter((d) => d.diagnosis === "LISTING_ISSUE").length ?? 0;
  const trafficIssueCount = report?.diagnostics.filter((d) => d.diagnosis === "TRAFFIC_ISSUE").length ?? 0;
  const criticalCount     = report?.diagnostics.filter((d) => d.diagnosis === "CRITICAL").length ?? 0;

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
              Dashboard
            </Link>
            <span className="text-slate-700">/</span>
            <Link href="/audits" className="text-sm text-slate-400 hover:text-amber-400 transition-colors">
              All Audits
            </Link>
            <span className="text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{brandName || "Business Report"}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton auditId={auditId} disabled={loading} />
            <button onClick={() => window.print()} disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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

        {/* Report header card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-100">{brandName}</h2>
              <p className="text-sm text-slate-400 mt-1">Business Report Analysis</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {niche && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{niche}</span>
                )}
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{marketplace}</span>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/40">
                  Business Report
                </span>
              </div>
              {auditPurpose && <p className="mt-3 text-sm text-slate-400 max-w-xl">{auditPurpose}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">{asinCount} ASIN{asinCount !== 1 ? "s" : ""} analyzed</p>
            </div>
          </div>
        </div>

        {/* Global error */}
        {error && !loading && <ErrorCard message={error} />}

        {/* ── Section 1: Performance Diagnostics ── */}
        <section className="print-section">
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-xs text-red-400 font-bold">1</span>
            Performance Diagnostics
          </h3>

          {loading && <LoadingCard label="Analyzing ASIN performance data..." />}
          {report && !loading && (
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-3 text-center">
                  <p className="text-lg font-bold text-slate-200">{report.diagnostics.length}</p>
                  <p className="text-xs text-slate-500">Total ASINs</p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{healthyCount}</p>
                  <p className="text-xs text-emerald-400/70">Healthy</p>
                </div>
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-center">
                  <p className="text-lg font-bold text-red-400">{listingIssueCount}</p>
                  <p className="text-xs text-red-400/70">Listing Issues</p>
                </div>
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-center">
                  <p className="text-lg font-bold text-amber-400">{trafficIssueCount}</p>
                  <p className="text-xs text-amber-400/70">Traffic Issues</p>
                </div>
                <div className="rounded-xl bg-red-600/10 border border-red-600/30 p-3 text-center">
                  <p className="text-lg font-bold text-red-500">{criticalCount}</p>
                  <p className="text-xs text-red-400/70">Critical</p>
                </div>
              </div>

              {/* Diagnostic cards */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {report.diagnostics.map((d) => (
                  <DiagnosticCard
                    key={d.asin}
                    asin={d.asin}
                    title={d.title}
                    sessions={d.sessions}
                    conversionRate={d.conversion_rate}
                    unitsSold={d.units_sold}
                    revenue={d.revenue}
                    diagnosis={d.diagnosis}
                    explanation={d.explanation}
                    actions={d.top_actions}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Section 2: Before vs. After ── */}
        <section className="print-section">
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">2</span>
            Before vs. After Projections
          </h3>

          {loading && <LoadingCard label="Generating optimization projections..." />}
          {report && !loading && report.before_after.length > 0 && (
            <div className="space-y-4">
              {report.before_after.map((ba) => (
                <BeforeAfterPanel
                  key={ba.asin}
                  asin={ba.asin}
                  title={ba.title}
                  current={ba.current}
                  projected={ba.projected}
                  changesSummary={ba.changes_summary}
                />
              ))}
            </div>
          )}
          {report && !loading && report.before_after.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
              No before/after projections available for this report.
            </div>
          )}
        </section>

        {/* ── Section 3: Executive Summary ── */}
        <section className="print-section">
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">3</span>
            Executive Summary
          </h3>

          {loading && <LoadingCard label="Generating executive summary..." />}
          {report && !loading && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-6">
              {/* Health score */}
              <div className="flex justify-center py-4">
                <HealthScoreGauge score={report.executive_summary.health_score} />
              </div>

              {/* Wins & Risks */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-emerald-400 mb-3">Top Wins</p>
                  <div className="space-y-2">
                    {report.executive_summary.top_wins.map((win, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                        <span className="shrink-0 text-emerald-400 text-sm">+</span>
                        <p className="text-sm text-slate-300">{win}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-red-400 mb-3">Top Risks</p>
                  <div className="space-y-2">
                    {report.executive_summary.top_risks.map((risk, i) => (
                      <div key={i} className="flex gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                        <span className="shrink-0 text-red-400 text-sm">!</span>
                        <p className="text-sm text-slate-300">{risk}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Priority lists */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">30-Day Priorities</p>
                  <ol className="space-y-2">
                    {report.executive_summary.thirty_day_priorities.map((p, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-300">
                        <span className="shrink-0 w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xs font-bold text-amber-400">{i + 1}</span>
                        <span className="leading-relaxed">{p}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">90-Day Priorities</p>
                  <ol className="space-y-2">
                    {report.executive_summary.ninety_day_priorities.map((p, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-300">
                        <span className="shrink-0 w-5 h-5 rounded-md bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-xs font-bold text-blue-400">{i + 1}</span>
                        <span className="leading-relaxed">{p}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Citations */}
              <CitationLinks urls={report.citations} />
            </div>
          )}
        </section>

      </main>
    </div>
  );
}

export default function BusinessReportPage() {
  return (
    <React.Suspense>
      <BusinessReportContent />
    </React.Suspense>
  );
}
