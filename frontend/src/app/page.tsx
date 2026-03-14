"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth, setStoreUrl as persistStoreUrl } from "@/lib/auth";

export default function Dashboard() {
  const router = useRouter();
  const [storeUrl, setStoreUrl] = useState("");
  const [email, setEmail] = useState("");
  const [brandName, setBrandName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitDisabled = !storeUrl.trim() || !email.trim() || submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;

    setSubmitting(true);
    setError(null);
    persistStoreUrl(storeUrl.trim());

    try {
      const resp = await fetchWithAuth("/api/store-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_url: storeUrl.trim(),
          email: email.trim(),
          brand_name: brandName.trim(),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Lookup failed" }));
        throw new Error(err.detail ?? `Request failed (${resp.status})`);
      }

      const data = await resp.json();
      const auditId = data.audit_id;

      // Store scorecard in sessionStorage for the results page
      sessionStorage.setItem(
        `scorecard_${auditId}`,
        JSON.stringify({
          scorecard: data.scorecard,
          brand_name: data.brand_name,
          niche: data.niche,
          category: data.category,
          competitive_summary: data.competitive_summary,
          price_range: data.price_range,
          brand_analysis: data.brand_analysis,
        })
      );

      const params = new URLSearchParams({
        store_url: storeUrl.trim(),
        email: email.trim(),
        brand_name: data.brand_name || "",
        niche: data.niche || "",
      });

      router.push(`/audit/${auditId}?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <h1 className="text-xl font-semibold tracking-tight text-amber-400">Amazon Audit</h1>
        </div>
      </header>

      {/* Hero + Form */}
      <div className="mx-auto max-w-xl px-6 py-16">
        {/* Hero */}
        <div className="text-center space-y-4 mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 leading-tight">
            Get Your Free Amazon<br />Account Scorecard
          </h2>
          <p className="text-base text-slate-400 max-w-md mx-auto">
            Enter your store URL and we&apos;ll analyze your listings in under 60 seconds.
            No file uploads required.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Amazon Store URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                required
                placeholder="https://amazon.com/stores/YourBrand"
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
              />
              <p className="text-xs text-[var(--tw-ring-offset-color)] mt-1.5">
                Paste your Amazon storefront, seller page, or any product listing URL.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Brand Name <span className="text-slate-400">(optional)</span>
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Crystal Clean Car Care"
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
              />
              <p className="text-xs text-[var(--tw-ring-offset-color)] mt-1.5">
                Helps us identify your products more accurately.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Email Address <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition"
              />
              <p className="text-xs text-[var(--tw-ring-offset-color)] mt-1.5">
                We&apos;ll send your scorecard results to this email.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <svg className="h-4 w-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitDisabled}
            className="w-full rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                Analyzing your store...
              </span>
            ) : (
              "Get My Free Scorecard"
            )}
          </button>
        </form>

        {/* Trust signals */}
        <div className="mt-8 flex items-center justify-center gap-6 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            No login required
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Results in 60 seconds
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            100% free
          </span>
        </div>
      </div>
    </div>
  );
}
