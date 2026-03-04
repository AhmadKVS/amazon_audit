"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveTokens, isAuthenticated, fetchWithAuth } from "@/lib/auth";
import { setCachedAuditList, setCachedReport } from "@/lib/cache";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) router.replace("/");
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.detail?.includes("not confirmed")) {
          router.push(`/confirm?email=${encodeURIComponent(email)}`);
          return;
        }
        setError(data.detail ?? "Sign in failed");
        return;
      }
      saveTokens(data);
      // Pre-fetch audit list + all individual reports in background
      fetchWithAuth("/api/audit/list")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!d?.audits) return;
          setCachedAuditList(d.audits);
          // Fetch and cache each audit report
          for (const audit of d.audits) {
            fetchWithAuth(`/api/audit/${audit.audit_id}`)
              .then((r) => r.ok ? r.json() : null)
              .then((report) => {
                if (report?.brand_analysis) setCachedReport(audit.audit_id, report);
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
      router.replace("/");
    } catch {
      setError("Could not connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-amber-400">Amazon Audit</h1>
          <p className="text-slate-400 mt-1">Sign in to access your seller analytics</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-slate-100 mb-6">Sign in</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-amber-400 hover:text-amber-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-amber-400 hover:text-amber-300 font-medium transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
