"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAdminToken, adminFetch, clearAdminToken } from "@/lib/adminAuth";

interface AdminAudit {
  user_id: string;
  audit_id: string;
  brand_name: string;
  niche: string;
  marketplace: string;
  report_type: string;
  audit_purpose: string;
  created_at: string;
  email: string;
}

const REPORT_LABELS: Record<string, string> = {
  business_report: "Business Report",
  active_listings: "Active Listings",
  account_health: "Account Health",
  ads: "Ads Performance",
  fba_inventory: "FBA Inventory",
};

const REPORT_COLORS: Record<string, string> = {
  business_report: "#3b82f6",
  active_listings: "#10b981",
  account_health: "#f59e0b",
  ads: "#8b5cf6",
  fba_inventory: "#06b6d4",
};

export default function AdminDashboard() {
  const router = useRouter();
  const [audits, setAudits] = useState<AdminAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    fetchAudits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAudits = async (cursor?: string | null) => {
    try {
      const url = cursor
        ? `/api/admin/audits?limit=50&cursor=${encodeURIComponent(cursor)}`
        : "/api/admin/audits?limit=50";
      const res = await adminFetch(url);
      if (res.status === 401) {
        clearAdminToken();
        router.replace("/admin/login");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (cursor) {
        setAudits((prev) => [...prev, ...(data.audits ?? [])]);
      } else {
        setAudits(data.audits ?? []);
      }
      setNextCursor(data.next_cursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audits");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchAudits(nextCursor);
  };

  const handleDelete = async (userId: string, auditId: string) => {
    if (!window.confirm("Delete this audit? This cannot be undone.")) return;
    try {
      const res = await adminFetch(`/api/admin/audits/${userId}/${auditId}`, { method: "DELETE" });
      if (res.ok) {
        setAudits((prev) => prev.filter((a) => !(a.user_id === userId && a.audit_id === auditId)));
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    router.replace("/admin/login");
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return audits;
    const q = search.toLowerCase();
    return audits.filter(
      (a) =>
        (a.brand_name ?? "").toLowerCase().includes(q) ||
        (a.niche ?? "").toLowerCase().includes(q) ||
        (a.marketplace ?? "").toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q) ||
        (a.user_id ?? "").substring(0, 8).includes(q)
    );
  }, [audits, search]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-amber-400">Admin Panel</h1>
            <Link href="/" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">
              Dashboard
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-400 hover:text-red-400 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">All Audits</h2>
            <p className="text-sm text-slate-400 mt-1">
              {loading ? "Loading..." : `${audits.length} total audit${audits.length !== 1 ? "s" : ""} across all users`}
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by brand, niche, email, or user ID..."
              className="block w-full rounded-xl border border-slate-700 bg-slate-900/50 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
            />
          </div>
        </div>

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
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-12 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-slate-400">{search ? "No audits match your search" : "No audits found"}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {search && (
              <p className="text-xs text-slate-500 mb-1">
                Showing {filtered.length} of {audits.length}
              </p>
            )}
            {filtered.map((audit) => {
              const color = REPORT_COLORS[audit.report_type] || "#f59e0b";
              return (
                <div
                  key={`${audit.user_id}-${audit.audit_id}`}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-100 truncate">{audit.brand_name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-500 border border-slate-700 font-mono">
                          {audit.user_id.substring(0, 8)}...
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
                        <span
                          className="px-2 py-0.5 rounded-full text-xs border font-medium"
                          style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}
                        >
                          {REPORT_LABELS[audit.report_type] ?? audit.report_type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5">{formatDate(audit.created_at)}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 mt-1">
                      <Link
                        href={`/admin/audit/${audit.user_id}/${audit.audit_id}`}
                        className="text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors whitespace-nowrap"
                      >
                        View / Edit
                      </Link>
                      <button
                        onClick={() => handleDelete(audit.user_id, audit.audit_id)}
                        title="Delete audit"
                        className="text-red-400 hover:text-red-300 transition-colors p-0.5"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {nextCursor && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full rounded-xl border border-slate-700 bg-slate-900/50 py-3 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
