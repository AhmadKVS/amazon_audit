"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AuditResults,
  PerformanceSnapshot,
  PpcAnalysisCard,
  TopOpportunities,
  ListingHealthSection,
  RevenueGapSection,
  AdEfficiencySection,
  CtaSection,
  type AnalysisResult,
  type ListingHealthSnapshot,
  type RevenueGapReport,
  type AdEfficiencySignal,
} from "@/components/AuditResults";
import { Lock } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface BrandAnalysis {
  summary:               string;
  competitive_landscape: string;
  top_seller_traits:     string[];
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
  benchmark_metrics: { key: string; label: string; unit: string; industry_avg: number; lower_is_better: boolean }[];
  citations:       string[];
  csv_metadata?:   { columns?: string[]; preview?: Record<string, string>[]; raw_text?: string };
  raw_text?:       string;
  deep_analysis?:  AnalysisResult & {
    listingHealthSnapshot?: ListingHealthSnapshot;
    revenueGapReport?: RevenueGapReport;
    adEfficiencySignal?: AdEfficiencySignal;
    compiledReport?: { executiveSummary?: string; totalMonthlyOpportunity?: number; topActions?: { action: string; estimatedImpact: string }[] };
  };
}

const STRATEGY_CALL_URL = "https://launch.withrevlyn.com/widget/bookings/discovery-call-with-revlyn";

// ── Read-only locked section (no upload) ─────────────────────────────────

function ReadOnlyLockedSection({
  title,
  description,
  teaserMetrics,
}: {
  title: string;
  description: string;
  teaserMetrics: { label: string; blurredValue: string }[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-slate-500" />
        <h3 className="text-lg font-semibold text-slate-400">{title}</h3>
      </div>
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-6 space-y-5">
        <p className="text-sm text-slate-500">{description}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {teaserMetrics.map((m, i) => (
            <div key={i} className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3 space-y-1">
              <p className="text-xs text-slate-400 font-medium">{m.label}</p>
              <p className="text-lg font-bold text-slate-400 blur-[6px] select-none">{m.blurredValue}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-800/60 pt-4">
          <p className="text-xs text-slate-500">
            This section is locked. The account owner can unlock it by uploading the required report.
          </p>
        </div>
      </div>
    </section>
  );
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
          <p className="text-sm text-slate-400">Loading report...</p>
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

  const da = audit.deep_analysis;
  const isNewFormat = !!da?.listingHealthSnapshot;
  const date = new Date(audit.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Extract data for new-format audits
  const scorecard = da?.listingHealthSnapshot ?? null;
  const revenueGap = da?.revenueGapReport ?? null;
  const adEfficiency = da?.adEfficiencySignal ?? null;
  const revenueGapTotal = revenueGap?.totalMonthlyRevenueGap ?? null;
  const adSpendGapTotal = adEfficiency?.totalRecoverableAdSpend ?? null;

  // ── New format layout ──
  if (isNewFormat && scorecard) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <style>{`
          @media print {
            @page { size: A4; margin: 18mm; }
            .no-print { display: none !important; }
            body { background: white !important; color: black !important; }
            header { display: none !important; }
          }
        `}</style>

        {/* Header */}
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

        <main className="mx-auto max-w-5xl px-4 py-10 space-y-10">
          {/* Brand header card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h1 className="text-2xl font-bold text-slate-100">{audit.brand_name}</h1>
            <div className="flex flex-wrap gap-2 mt-2">
              {audit.niche && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">{audit.niche}</span>
              )}
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {audit.marketplace || "Amazon US"}
              </span>
            </div>
            {audit.brand_analysis?.summary && (
              <p className="mt-3 text-sm text-slate-400 max-w-xl leading-relaxed">{audit.brand_analysis.summary}</p>
            )}
          </div>

          {/* Page 1: Account Scorecard (always visible) */}
          <section>
            <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs text-blue-400 font-bold">1</span>
              Account Scorecard
            </h3>
            <ListingHealthSection data={scorecard} />
          </section>

          {/* Page 2: Revenue Gap Analysis */}
          <section>
            <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">2</span>
              Revenue Gap Analysis
            </h3>
            {revenueGap ? (
              <RevenueGapSection data={revenueGap} />
            ) : (
              <ReadOnlyLockedSection
                title="Revenue Gap Analysis"
                description="This section shows per-ASIN conversion rates vs. Amazon benchmarks, Buy Box health, and the exact dollar amount being left on the table each month."
                teaserMetrics={[
                  { label: "Conversion Rate vs Benchmark", blurredValue: "8.3% vs 12.5%" },
                  { label: "Monthly Revenue Gap", blurredValue: "$4,250/mo" },
                  { label: "Buy Box Health", blurredValue: "87%" },
                ]}
              />
            )}
          </section>

          {/* Page 3: Advertising Efficiency */}
          <section>
            <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-xs text-red-400 font-bold">3</span>
              Advertising Efficiency
            </h3>
            {adEfficiency ? (
              <AdEfficiencySection data={adEfficiency} />
            ) : (
              <ReadOnlyLockedSection
                title="Ad Efficiency Signal"
                description="This section shows ACoS vs. benchmark, wasted ad spend on zero-conversion terms, and how much can be recovered each month."
                teaserMetrics={[
                  { label: "ACoS vs Benchmark", blurredValue: "33.5% vs 25-30%" },
                  { label: "Wasted Ad Spend", blurredValue: "$1,200/mo" },
                  { label: "Top Wasted Terms", blurredValue: "3 terms identified" },
                ]}
              />
            )}
          </section>

          {/* Page 4: CTA */}
          <CtaSection
            brandName={audit.brand_name}
            category={audit.niche}
            revenueGap={revenueGapTotal}
            adSpendGap={typeof adSpendGapTotal === "number" ? adSpendGapTotal : null}
          />
        </main>

        <footer className="border-t border-slate-800 mt-16 py-6 no-print">
          <p className="text-center text-xs text-slate-400">Prepared with Amazon Audit &middot; {date}</p>
        </footer>
      </div>
    );
  }

  // ── Legacy layout (old audits with performanceSnapshot/ppcAnalysis) ──
  let sectionNum = 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm; }
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          header { display: none !important; }
        }
      `}</style>

      {/* Header */}
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
          </div>
          {audit.audit_purpose && (
            <p className="mt-3 text-sm text-slate-400 max-w-xl">{audit.audit_purpose}</p>
          )}
        </div>

        {/* Brand Analysis */}
        {audit.brand_analysis?.summary && (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs text-blue-400 font-bold">{++sectionNum}</span>
              Brand &amp; Niche Analysis
            </h2>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Brand Summary</p>
                <p className="text-sm text-slate-300 leading-relaxed">{audit.brand_analysis.summary}</p>
              </div>
              {audit.brand_analysis.competitive_landscape && (
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-2">Competitive Landscape</p>
                  <p className="text-sm text-slate-300 leading-relaxed">{audit.brand_analysis.competitive_landscape}</p>
                </div>
              )}
              {audit.brand_analysis.top_seller_traits?.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-widest font-semibold text-slate-500 mb-3">What Top Sellers Do</p>
                  <div className="flex flex-wrap gap-2">
                    {audit.brand_analysis.top_seller_traits.map((t, i) => (
                      <span key={i} className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {audit.citations?.length > 0 && (
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
        )}

        {/* AI Analysis — 4-layer or legacy */}
        {da && typeof da === "object" && da.listingHealthSnapshot ? (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">{++sectionNum}</span>
              Audit Report
            </h2>
            <AuditResults data={da as AnalysisResult} />
          </section>
        ) : (
          <>
            {da && typeof da === "object" && da.performanceSnapshot && (
              <section>
                <h2 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">{++sectionNum}</span>
                  AI Performance Snapshot
                </h2>
                <PerformanceSnapshot
                  data={da.performanceSnapshot}
                  source={(da as AnalysisResult).performanceSnapshot_source}
                />
              </section>
            )}
            {da && typeof da === "object" && da.ppcAnalysis && (
              <section>
                <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">{++sectionNum}</span>
                  PPC Performance
                </h2>
                <PpcAnalysisCard data={da.ppcAnalysis} />
              </section>
            )}
          </>
        )}

        {/* Top 3 Opportunities (legacy only) */}
        {da && typeof da === "object" && da.topOpportunities && !da.listingHealthSnapshot && (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">{++sectionNum}</span>
              Top 3 Opportunities
            </h2>
            <TopOpportunities
              data={da.topOpportunities}
              source={(da as AnalysisResult).topOpportunities_source}
            />
          </section>
        )}

        {/* CTA */}
        <section>
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/50 p-8 text-center space-y-4">
            <h3 className="text-2xl font-bold text-slate-100">Ready to Unlock These Opportunities?</h3>
            <p className="text-sm text-slate-400 max-w-lg mx-auto">
              Our team will walk you through these findings and build a custom action plan to grow your Amazon business.
            </p>
            <a
              href={STRATEGY_CALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors shadow-lg shadow-emerald-500/20"
            >
              Book a Strategy Call
            </a>
            <p className="text-xs text-slate-500">No commitment required &mdash; 30 minutes, completely free</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 mt-16 py-6 no-print">
        <p className="text-center text-xs text-slate-400">Prepared with Amazon Audit &middot; {date}</p>
      </footer>
    </div>
  );
}
