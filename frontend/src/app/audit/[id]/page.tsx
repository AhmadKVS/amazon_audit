"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchWithAuth, setStoreUrl as persistStoreUrl } from "@/lib/auth";
import { getCachedReport, setCachedReport } from "@/lib/cache";
import {
  AuditResults,
  AnalysisLoading,
  ListingHealthSection,
  RevenueGapSection,
  AdEfficiencySection,
  LockedSectionCard,
  CtaSection,
  type AnalysisResult,
  type ListingHealthSnapshot,
  type RevenueGapReport,
  type AdEfficiencySignal,
  type CompiledReport,
} from "@/components/AuditResults";

// ── Types ──────────────────────────────────────────────────────────────────

interface ScorecardData {
  scorecard: ListingHealthSnapshot;
  brand_name: string;
  niche: string;
  category: string;
  competitive_summary: string;
  price_range: string;
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

// ── Helpers ────────────────────────────────────────────────────────────────

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 flex flex-col items-center justify-center gap-3 min-h-[180px]">
      <div className="w-7 h-7 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}

// CSV helpers for inline file processing
function parseRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseLocalCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1, 21).map((line) => {
    const vals = parseRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return { headers, rows };
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
          Share
        </>
      )}
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function AuditResultsContent() {
  const params = useParams();
  const searchParams = useSearchParams();

  const auditId = params.id as string;
  const brandName = searchParams.get("brand_name") ?? "";
  const niche = searchParams.get("niche") ?? "";
  const storeUrlParam = searchParams.get("store_url") ?? "";
  const emailParam = searchParams.get("email") ?? "";
  const isSaved = searchParams.get("saved") === "true";

  // ── State ──
  const [scorecard, setScorecard] = useState<ListingHealthSnapshot | null>(null);
  const [revenueGap, setRevenueGap] = useState<RevenueGapReport | null>(null);
  const [adEfficiency, setAdEfficiency] = useState<AdEfficiencySignal | null>(null);
  const [compiledReport, setCompiledReport] = useState<CompiledReport | null>(null);
  const [competitiveSummary, setCompetitiveSummary] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  // Upload states for locked sections
  const [uploadingRevGap, setUploadingRevGap] = useState(false);
  const [uploadingAdEff, setUploadingAdEff] = useState(false);

  // Legacy support — full deep analysis for old audits
  const [deepAnalysis, setDeepAnalysis] = useState<AnalysisResult | null>(null);
  const [isLegacyAudit, setIsLegacyAudit] = useState(false);
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false);

  // Brand analysis from Perplexity
  const [brandAnalysis, setBrandAnalysis] = useState<BrandAnalysis | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  const loadedRef = useRef(false);

  // ── Load scorecard data ──
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    if (storeUrlParam) persistStoreUrl(storeUrlParam);

    // 1. Check sessionStorage for fresh scorecard (just submitted)
    const scorecardRaw = sessionStorage.getItem(`scorecard_${auditId}`);
    if (scorecardRaw) {
      try {
        const data: ScorecardData = JSON.parse(scorecardRaw);
        setScorecard(data.scorecard);
        setCompetitiveSummary(data.competitive_summary);
        setCategory(data.category);
        setBrandAnalysis({
          summary: data.competitive_summary,
          competitive_landscape: data.competitive_summary,
          top_seller_traits: [],
        });
        setLoading(false);
        return;
      } catch { /* fall through */ }
    }

    // 2. Check localStorage cache
    const cached = getCachedReport(auditId);
    if (cached) {
      _applyData(cached);
      return;
    }

    // 3. Try DynamoDB
    fetchWithAuth(`/api/audit/${auditId}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) return null;
        return r.json();
      })
      .then((saved) => {
        if (saved) {
          setCachedReport(auditId, saved);
          _applyData(saved);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function _applyData(data: any) {
      const da = data.deep_analysis;

      // Check if this is a new-style audit with scorecard
      if (da?.listingHealthSnapshot) {
        setScorecard(da.listingHealthSnapshot);
        if (da.revenueGapReport) setRevenueGap(da.revenueGapReport);
        if (da.adEfficiencySignal) setAdEfficiency(da.adEfficiencySignal);
        if (da.compiledReport) setCompiledReport(da.compiledReport);

        // Check for legacy keys too (full analysis may have both)
        if (da.performanceSnapshot || da.ppcAnalysis) {
          setDeepAnalysis(da as AnalysisResult);
        }
      } else if (da && Object.keys(da).length > 0) {
        // Old-style audit with only legacy deep_analysis
        setIsLegacyAudit(true);
        setDeepAnalysis(da as AnalysisResult);
      }

      // Brand analysis
      if (data.brand_analysis && Object.keys(data.brand_analysis).length > 0) {
        setBrandAnalysis(data.brand_analysis);
        setCompetitiveSummary(data.brand_analysis.summary || data.brand_analysis.competitive_landscape || "");
      }
      if (data.recommendations) setRecommendations(data.recommendations);
      if (data.niche) setCategory(data.niche);

      setLoading(false);
    }
  }, [auditId, storeUrlParam]);

  // ── Inline file upload handler (for unlocking sections) ──
  const handleFileUpload = useCallback(async (
    file: File,
    section: "revenueGapReport" | "adEfficiencySignal",
  ) => {
    const isRevGap = section === "revenueGapReport";
    if (isRevGap) setUploadingRevGap(true);
    else setUploadingAdEff(true);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      let s3Key: string | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let inlineFiles: any[] = [];

      // Upload to S3
      const formData = new FormData();
      formData.append("file", file);
      const uploadResp = await fetchWithAuth("/api/upload/csv", { method: "POST", body: formData });
      if (uploadResp.ok) {
        const uploadData = await uploadResp.json();
        s3Key = uploadData.s3_key;
      }

      // If no S3 key, use inline base64 fallback
      if (!s3Key) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read file"));
          reader.readAsDataURL(file);
        });
        inlineFiles = [{
          filename: file.name,
          content: base64,
          content_type: file.type || (ext === "csv" ? "text/csv" : "application/octet-stream"),
        }];
      }

      // Call /api/analyze with the file + existing scorecard context
      const analyzeResp = await fetchWithAuth("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: auditId,
          s3_keys: s3Key ? [s3Key] : [],
          inline_files: inlineFiles,
          brand_name: brandName,
          niche,
          marketplace: "Amazon US",
          existing_scorecard: scorecard ?? {},
          requested_sections: [section],
        }),
      });

      if (!analyzeResp.ok) {
        const err = await analyzeResp.json().catch(() => ({ detail: "Analysis failed" }));
        throw new Error(err.detail ?? "Analysis failed");
      }

      const analyzeData = await analyzeResp.json();
      const analysis = analyzeData.analysis;

      // Update the relevant section
      if (isRevGap && analysis?.revenueGapReport) {
        setRevenueGap(analysis.revenueGapReport);
      }
      if (!isRevGap && analysis?.adEfficiencySignal) {
        setAdEfficiency(analysis.adEfficiencySignal);
      }
      // Update compiled report if present
      if (analysis?.compiledReport) {
        setCompiledReport(analysis.compiledReport);
      }

      // Save to DynamoDB
      const deepUpdate: Record<string, unknown> = {};
      if (scorecard) deepUpdate.listingHealthSnapshot = scorecard;
      if (isRevGap && analysis?.revenueGapReport) deepUpdate.revenueGapReport = analysis.revenueGapReport;
      if (!isRevGap && analysis?.adEfficiencySignal) deepUpdate.adEfficiencySignal = analysis.adEfficiencySignal;
      if (revenueGap && !isRevGap) deepUpdate.revenueGapReport = revenueGap;
      if (adEfficiency && isRevGap) deepUpdate.adEfficiencySignal = adEfficiency;
      if (analysis?.compiledReport) deepUpdate.compiledReport = analysis.compiledReport;

      fetchWithAuth("/api/audit/update-deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_id: auditId, deep_analysis: deepUpdate }),
      }).catch(() => {});

    } catch (err) {
      console.error(`[upload] ${section} unlock failed:`, err);
    } finally {
      if (isRevGap) setUploadingRevGap(false);
      else setUploadingAdEff(false);
    }
  }, [auditId, brandName, niche, scorecard, revenueGap, adEfficiency]);

  // Compute totals for CTA
  const revenueGapTotal = revenueGap?.totalMonthlyRevenueGap ?? null;
  const adSpendGapTotal = adEfficiency?.totalRecoverableAdSpend ?? null;

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <AnalysisLoading />
      </div>
    );
  }

  // ── Legacy audit layout ──
  if (isLegacyAudit && deepAnalysis) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-sm text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Home
              </Link>
              <span className="text-slate-700">/</span>
              <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{brandName || "Audit"}</span>
            </div>
            <ShareButton auditId={auditId} disabled={false} />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10 space-y-8">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-2xl font-bold text-slate-100">{brandName}</h2>
            {niche && <p className="text-sm text-slate-400 mt-1">{niche}</p>}
          </div>
          <AuditResults data={deepAnalysis} />
        </main>
      </div>
    );
  }

  // ── New progressive unlock layout ──
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          .no-print, header { display: none !important; }
          .print-only { display: block !important; }
          main { padding: 14mm 18mm 18mm 18mm !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body, .min-h-screen { background: white !important; color: #1e293b !important; }
          .text-slate-100, .text-slate-200, .text-slate-300 { color: #1e293b !important; }
          .text-slate-400, .text-slate-500 { color: #64748b !important; }
          .rounded-2xl { background: #f8fafc !important; border-color: #e2e8f0 !important; }
          .rounded-xl { background: #f8fafc !important; border-color: #e2e8f0 !important; }
        }
      `}</style>

      {/* Print-only header */}
      <div className="print-only hidden mb-6">
        <div className="flex items-center justify-between border-b border-slate-300 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Amazon Account Scorecard</h1>
            <p className="text-sm text-slate-500 mt-1">{brandName} — {category || niche || "General"}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Generated by</p>
            <p className="text-sm font-semibold text-slate-700">Amazon Audit</p>
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
              Home
            </Link>
            <span className="text-slate-700">/</span>
            <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{brandName || "Scorecard"}</span>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton auditId={auditId} disabled={!scorecard} />
            <button
              onClick={() => {
                const orig = document.title;
                document.title = `${brandName} — Amazon Account Scorecard`;
                window.print();
                document.title = orig;
              }}
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
          <h2 className="text-2xl font-bold text-slate-100">{brandName || "Account Scorecard"}</h2>
          <div className="flex flex-wrap gap-2 mt-2">
            {(category || niche) && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {category || niche}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
              Amazon US
            </span>
          </div>
          {competitiveSummary && (
            <p className="mt-3 text-sm text-slate-400 max-w-xl leading-relaxed">{competitiveSummary}</p>
          )}
        </div>

        {/* ── Page 1: Account Scorecard (always visible) ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-xs text-blue-400 font-bold">1</span>
            Your Account Scorecard
          </h3>

          {scorecard ? (
            <ListingHealthSection data={scorecard} />
          ) : (
            <LoadingCard label="Generating your scorecard..." />
          )}
        </section>

        {/* ── Page 2: Revenue Gap Analysis (unlock with Business Report) ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs text-amber-400 font-bold">2</span>
            Revenue Gap Analysis
          </h3>

          {revenueGap ? (
            <RevenueGapSection data={revenueGap} />
          ) : (
            <LockedSectionCard
              title="Revenue Gap Analysis"
              description="See your per-ASIN conversion rates vs. Amazon benchmarks, Buy Box health, and the exact dollar amount you're leaving on the table each month."
              teaserMetrics={[
                { label: "Conversion Rate vs Benchmark", blurredValue: "8.3% vs 12.5%" },
                { label: "Monthly Revenue Gap", blurredValue: "$4,250/mo" },
                { label: "Buy Box Health", blurredValue: "87%" },
              ]}
              uploadLabel="Business Report"
              uploadHelperText='Download from Seller Central: Reports > Business Reports > "Detail Page Sales and Traffic by ASIN"'
              onFileReady={(f) => handleFileUpload(f, "revenueGapReport")}
              uploading={uploadingRevGap}
            />
          )}
        </section>

        {/* ── Page 3: Advertising Efficiency (unlock with Search Terms Report) ── */}
        <section>
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-xs text-red-400 font-bold">3</span>
            Advertising Efficiency
          </h3>

          {adEfficiency ? (
            <AdEfficiencySection data={adEfficiency} />
          ) : (
            <LockedSectionCard
              title="Ad Efficiency Signal"
              description="See your exact ACoS vs. benchmark, wasted ad spend on zero-conversion terms, and how much you can recover each month."
              teaserMetrics={[
                { label: "ACoS vs Benchmark", blurredValue: "33.5% vs 25-30%" },
                { label: "Wasted Ad Spend", blurredValue: "$1,200/mo" },
                { label: "Top Wasted Terms", blurredValue: "3 terms identified" },
              ]}
              uploadLabel="Search Terms Report"
              uploadHelperText="Download from Seller Central: Reports > Advertising Reports > Search Term Report"
              onFileReady={(f) => handleFileUpload(f, "adEfficiencySignal")}
              uploading={uploadingAdEff}
            />
          )}
        </section>

        {/* ── Page 4: CTA ── */}
        <CtaSection
          brandName={brandName}
          category={category || niche}
          revenueGap={revenueGapTotal}
          adSpendGap={typeof adSpendGapTotal === "number" ? adSpendGapTotal : null}
        />

      </main>

      {/* Print-only footer */}
      <div className="print-only hidden mt-8 pt-4 border-t border-slate-300 text-center">
        <p className="text-xs text-slate-500">
          Generated by <span className="font-semibold">Amazon Audit</span>
        </p>
      </div>
    </div>
  );
}

export default function AuditResultsPage() {
  return <AuditResultsContent />;
}
