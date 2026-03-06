"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AuditResults, GatedCta, type AnalysisResult } from "@/components/AuditResults";

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
  citations:       string[];
  deep_analysis?:  AnalysisResult;
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
  const date = new Date(audit.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

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

        {/* Section 2: AI Performance Analysis */}
        {audit.deep_analysis && (
          <section>
            <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-400 font-bold">2</span>
              AI Performance Analysis
            </h2>
            <AuditResults data={audit.deep_analysis} />
          </section>
        )}

        {/* Booking CTA */}
        {audit.deep_analysis?.gatedInsights && (
          <GatedCta gated={audit.deep_analysis.gatedInsights} />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-6 no-print">
        <p className="text-center text-xs text-slate-600">Prepared with Amazon Audit · {date}</p>
      </footer>
    </div>
  );
}
