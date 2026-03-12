"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAdminToken, adminFetch, clearAdminToken } from "@/lib/adminAuth";
import { AuditResults, type AnalysisResult } from "@/components/AuditResults";

export default function AdminAuditDetailPage() {
  const { userId, auditId } = useParams<{ userId: string; auditId: string }>();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [audit, setAudit] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Editable fields
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    loadAudit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, auditId]);

  const loadAudit = async () => {
    try {
      const res = await adminFetch(`/api/admin/audits/${userId}/${auditId}`);
      if (res.status === 401) {
        clearAdminToken();
        router.replace("/admin/login");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAudit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveField = async (updates: Record<string, any>) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await adminFetch(`/api/admin/audits/${userId}/${auditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveMsg("Saved");
      // Update local state
      setAudit((prev) => (prev ? { ...prev, ...updates } : prev));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSummary = () => {
    if (!audit?.deep_analysis) return;
    const updated = {
      ...audit.deep_analysis,
      compiledReport: {
        ...(audit.deep_analysis.compiledReport ?? {}),
        executiveSummary: summaryDraft,
      },
    };
    saveField({ deep_analysis: updated });
    setAudit((prev) =>
      prev ? { ...prev, deep_analysis: updated } : prev
    );
    setEditingSummary(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this audit permanently? This cannot be undone.")) return;
    try {
      const res = await adminFetch(`/api/admin/audits/${userId}/${auditId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin");
      }
    } catch {
      // ignore
    }
  };

  const handleUpdateDeepAnalysis = (updated: AnalysisResult) => {
    saveField({ deep_analysis: updated });
    setAudit((prev) => (prev ? { ...prev, deep_analysis: updated } : prev));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Loading audit...</p>
        </div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm space-y-3">
          <p className="text-slate-200 font-medium">Error</p>
          <p className="text-sm text-slate-500">{error ?? "Audit not found"}</p>
          <Link href="/admin" className="text-xs text-amber-400 hover:text-amber-300">
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  const deepAnalysis = audit.deep_analysis as AnalysisResult | undefined;
  const compiledSummary = deepAnalysis?.compiledReport?.executiveSummary ?? "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-slate-400 hover:text-slate-100 transition-colors" title="Back to Admin">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold tracking-tight text-amber-400">Admin</h1>
            <span className="text-slate-700">/</span>
            <span className="text-sm text-slate-300 truncate max-w-[200px]">{audit.brand_name || "Audit"}</span>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span className={`text-xs ${saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 transition-colors border border-red-500/30 rounded-lg px-3 py-1.5"
            >
              Delete
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Metadata */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-100">{audit.brand_name}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-500 border border-slate-700 font-mono">
                  user: {audit.user_id?.substring(0, 12)}...
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-500 border border-slate-700 font-mono">
                  id: {audit.audit_id?.substring(0, 12)}...
                </span>
                {audit.email && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700">
                    {audit.email}
                  </span>
                )}
                {audit.niche && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700">
                    {audit.niche}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700">
                  {audit.marketplace}
                </span>
              </div>
            </div>
            <span className="text-xs text-slate-500 shrink-0">
              {audit.created_at ? new Date(audit.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""}
            </span>
          </div>
        </div>

        {/* Editable executive summary (for new 4-layer audits) */}
        {compiledSummary && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Executive Summary (editable)</h3>
              {!editingSummary ? (
                <button
                  onClick={() => { setSummaryDraft(compiledSummary); setEditingSummary(true); }}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                >
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingSummary(false)}
                    className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSummary}
                    disabled={saving}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
            {editingSummary ? (
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition resize-y"
              />
            ) : (
              <p className="text-sm text-slate-400 leading-relaxed">{compiledSummary}</p>
            )}
          </div>
        )}

        {/* AI Analysis results */}
        {deepAnalysis && (
          <section>
            <h3 className="text-lg font-semibold text-slate-100 mb-6">
              {deepAnalysis.listingHealthSnapshot ? "Audit Report" : "AI Performance Analysis"}
            </h3>
            <AuditResults data={deepAnalysis} onUpdate={handleUpdateDeepAnalysis} />
          </section>
        )}

        {/* Brand Analysis (Perplexity) */}
        {audit.brand_analysis && audit.brand_analysis.summary && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300">Brand Analysis</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{audit.brand_analysis.summary}</p>
            {audit.brand_analysis.competitive_landscape && (
              <p className="text-sm text-slate-400 leading-relaxed">{audit.brand_analysis.competitive_landscape}</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
