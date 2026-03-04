"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithAuth, isAuthenticated, signOut } from "@/lib/auth";
import { getCachedAuditList, setCachedAuditList, removeCachedReport } from "@/lib/cache";

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

// ── Types ───────────────────────────────────────────────────────────────────

interface PastAudit {
  audit_id:      string;
  brand_name:    string;
  niche:         string;
  marketplace:   string;
  report_type:   string;
  audit_purpose: string;
  notes:         string;
  created_at:    string;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AllAuditsPage() {
  const router = useRouter();
  const [audits, setAudits]   = useState<PastAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); return; }

    // Show cached list instantly if available
    const cached = getCachedAuditList() as PastAudit[] | null;
    if (cached) {
      setAudits(cached);
      setLoading(false);
    }

    // Refresh from API in background and update cache
    fetchWithAuth("/api/audit/list")
      .then((r) => {
        if (r.status === 401) { router.push("/login"); return Promise.reject("session expired"); }
        if (!r.ok) return r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? `HTTP ${r.status}`));
        return r.json();
      })
      .then((d: { audits?: PastAudit[] }) => {
        const fresh = d.audits ?? [];
        setAudits(fresh);
        setCachedAuditList(fresh);
      })
      .catch((e: unknown) => {
        const msg = String(e);
        if (msg === "session expired") return;
        if (!cached) setError(msg);
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSignOut = async () => { await signOut(); router.replace("/login"); };

  const handleDelete = async (e: React.MouseEvent, auditId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Delete this audit report? This cannot be undone.")) return;
    try {
      const res = await fetchWithAuth(`/api/audit/${auditId}`, { method: "DELETE" });
      if (!res.ok) return;
      const updated = audits.filter((a) => a.audit_id !== auditId);
      setAudits(updated);
      setCachedAuditList(updated);
      removeCachedReport(auditId);
    } catch {
      // silently ignore network errors
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return audits;
    const q = search.toLowerCase();
    return audits.filter((a) =>
      (a.brand_name ?? "").toLowerCase().includes(q) ||
      (a.niche ?? "").toLowerCase().includes(q) ||
      (a.marketplace ?? "").toLowerCase().includes(q) ||
      (REPORT_LABELS[a.report_type] ?? a.report_type ?? "").toLowerCase().includes(q)
    );
  }, [audits, search]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { return iso; }
  };

  const auditHref = (a: PastAudit) => {
    const params = new URLSearchParams({
      brand_name:    a.brand_name,
      niche:         a.niche,
      marketplace:   a.marketplace,
      report_type:   a.report_type,
      audit_purpose: a.audit_purpose,
      notes:         a.notes,
      saved:         "true",
    });
    return `/audit/${a.audit_id}?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
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
            <Link href="/progress" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">Progress</Link>
          </div>
          <button onClick={handleSignOut} className="text-sm text-slate-400 hover:text-amber-400 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Title + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">All Audit Reports</h1>
            <p className="text-sm text-slate-400 mt-1">
              {loading ? "Loading..." : `${audits.length} total report${audits.length !== 1 ? "s" : ""}`}
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by brand, niche, marketplace, or type..."
              className="block w-full rounded-xl border border-slate-700 bg-slate-900/50 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 animate-pulse">
                <div className="h-4 bg-slate-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-slate-800 rounded w-1/2 mb-3" />
                <div className="h-3 bg-slate-800 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Could not load audits: {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-12 flex flex-col items-center justify-center gap-2 text-center">
            <svg className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm text-slate-400">
              {search ? "No audits match your search" : "No audits yet"}
            </p>
            {search && (
              <button onClick={() => setSearch("")} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {search && (
              <p className="text-xs text-slate-500 mb-1">
                Showing {filtered.length} of {audits.length} report{audits.length !== 1 ? "s" : ""}
              </p>
            )}
            {filtered.map((audit) => {
              const color = REPORT_COLORS[audit.report_type] || "#f59e0b";
              return (
                <Link
                  key={audit.audit_id}
                  href={auditHref(audit)}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700 hover:bg-slate-900/80 transition-colors block"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-100 truncate">{audit.brand_name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {audit.niche && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700">
                            {audit.niche}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700">
                          {audit.marketplace}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs border font-medium"
                          style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}>
                          {REPORT_LABELS[audit.report_type] ?? audit.report_type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5">{formatDate(audit.created_at)}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 mt-1">
                      <span className="text-xs text-amber-400 font-medium whitespace-nowrap">
                        View Report →
                      </span>
                      <button
                        onClick={(e) => handleDelete(e, audit.audit_id)}
                        title="Delete audit"
                        className="text-red-400 hover:text-red-300 transition-colors p-0.5"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
