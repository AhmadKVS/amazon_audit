"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, Legend,
} from "recharts";
import { FileText, Database, Columns3, TrendingUp, Loader2, ExternalLink, AlertCircle } from "lucide-react";

interface ReportPreviewProps {
  result: {
    filename: string;
    report_type: string;
    rows: number;
    columns: string[];
    preview?: Record<string, string>[];
    local?: boolean;
  };
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
  source: string;
}

const REPORT_LABELS: Record<string, string> = {
  business_report: "Business Report",
  active_listings: "Active Listings",
  account_health: "Account Health",
  ads: "Ads Performance",
  fba_inventory: "FBA Inventory",
  unknown: "Unknown",
};

const REPORT_COLORS: Record<string, string> = {
  business_report: "#3b82f6",
  active_listings: "#10b981",
  account_health: "#f59e0b",
  ads: "#8b5cf6",
  fba_inventory: "#06b6d4",
};

/** Try to extract a numeric average for a metric key from preview rows */
function extractUserMetric(
  key: string,
  preview: Record<string, string>[],
  columns: string[]
): number | null {
  // Map metric keys to possible column name substrings (case-insensitive)
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
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg * 100) / 100;
}

export function ReportPreview({ result }: ReportPreviewProps) {
  const [benchmarks, setBenchmarks] = useState<BenchmarkData | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const reportColor = REPORT_COLORS[result.report_type] || "#f59e0b";

  useEffect(() => {
    if (result.report_type === "unknown") return;

    setBenchmarkLoading(true);
    setBenchmarkError(null);

    fetch(`/api/benchmarks/${result.report_type}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.detail ?? "Failed"));
        return r.json();
      })
      .then((data: BenchmarkData) => setBenchmarks(data))
      .catch((err) => setBenchmarkError(String(err)))
      .finally(() => setBenchmarkLoading(false));
  }, [result.report_type]);

  // Build chart data: industry_avg + user value (if extractable from preview)
  const chartData = benchmarks?.metrics.map((m) => {
    const userVal = result.preview
      ? extractUserMetric(m.key, result.preview, result.columns)
      : null;
    return {
      name: m.label,
      unit: m.unit,
      industry: m.industry_avg,
      yours: userVal,
      lower_is_better: m.lower_is_better,
    };
  }) ?? [];

  const hasYourData = chartData.some((d) => d.yours !== null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 border border-slate-700/50 shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/5 to-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100">Upload Summary</h2>
              <p className="text-sm text-slate-400 mt-1">Report analysis and industry benchmark comparison</p>
            </div>
          </div>
          {result.local ? (
            <div className="px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center gap-2" title="Backend unavailable — parsed in your browser">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm font-medium text-amber-300">Offline mode</span>
            </div>
          ) : (
            <div className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-emerald-300">Ready</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* File */}
        <div className="group relative overflow-hidden rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-5 hover:border-slate-600/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/5 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">File</p>
            </div>
            <p className="text-sm font-semibold text-slate-100 truncate" title={result.filename}>
              {result.filename}
            </p>
          </div>
        </div>

        {/* Report Type */}
        <div className="group relative overflow-hidden rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-5 hover:border-slate-600/50 transition-all duration-300 hover:shadow-lg">
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ background: `linear-gradient(to right, ${reportColor}00, ${reportColor}08, ${reportColor}00)` }} />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: reportColor }} />
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Report Type</p>
            </div>
            <p className="text-sm font-semibold rounded-lg px-3 py-1 w-fit"
              style={{ color: reportColor, backgroundColor: `${reportColor}15` }}>
              {REPORT_LABELS[result.report_type] || result.report_type}
            </p>
          </div>
        </div>

        {/* Data Size */}
        <div className="group relative overflow-hidden rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/40 to-slate-900/40 p-5 hover:border-slate-600/50 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/10">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/5 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" />
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">Data Size</p>
            </div>
            <p className="text-2xl font-bold text-cyan-300">{result.rows.toLocaleString()}</p>
            <p className="text-xs text-slate-400">rows × {result.columns.length} columns</p>
          </div>
        </div>
      </div>

      {/* Benchmark Comparison Chart */}
      {result.report_type !== "unknown" && (
        <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/30 to-slate-900/30 p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">Industry Benchmark Comparison</h3>
            </div>
            {benchmarks && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <span>via Perplexity Sonar</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Real-time Amazon seller industry averages — see how your report stacks up
          </p>

          {/* Loading state */}
          {benchmarkLoading && (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
              <p className="text-sm text-slate-400">Fetching live benchmarks from the web...</p>
            </div>
          )}

          {/* Error state */}
          {benchmarkError && !benchmarkLoading && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl bg-slate-800/50 border border-red-500/20 py-10 px-6 text-center">
              <div className="p-4 rounded-full bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-red-300">Benchmark API not working</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  {benchmarkError.includes("not configured") || benchmarkError.includes("PERPLEXITY")
                    ? "Perplexity API key is missing. Add PERPLEXITY_API_KEY to your backend .env file."
                    : benchmarkError.includes("timed out")
                    ? "The benchmark service timed out. Check your internet connection and try again."
                    : `Could not fetch benchmarks: ${benchmarkError}`}
                </p>
              </div>
              {(benchmarkError.includes("not configured") || benchmarkError.includes("PERPLEXITY")) && (
                <div className="rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-left w-full max-w-sm">
                  <p className="text-xs text-slate-500 mb-1 font-medium">backend/.env</p>
                  <code className="text-xs text-amber-300">PERPLEXITY_API_KEY=pplx-your-key-here</code>
                </div>
              )}
            </div>
          )}

          {/* Chart */}
          {benchmarks && !benchmarkLoading && chartData.length > 0 && (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <XAxis
                      dataKey="name"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      tick={{ fill: "#94a3b8" }}
                    />
                    <YAxis stroke="#64748b" fontSize={11} tick={{ fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.97)",
                        border: "1px solid rgba(100, 116, 139, 0.4)",
                        borderRadius: "10px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                        padding: "10px 14px",
                      }}
                      labelStyle={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 4 }}
                      formatter={(value: number, name: string, props) => {
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
                        <span className="text-xs text-slate-400">
                          {value === "industry" ? "Industry Average" : "Your Data"}
                        </span>
                      )}
                    />
                    <Bar dataKey="industry" name="industry" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={reportColor} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    {hasYourData && (
                      <Bar dataKey="yours" name="yours" radius={[6, 6, 0, 0]} maxBarSize={48}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill="#22d3ee" fillOpacity={0.8} />
                        ))}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Metric cards below chart */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {benchmarks.metrics.map((m) => {
                  const userVal = result.preview
                    ? extractUserMetric(m.key, result.preview, result.columns)
                    : null;
                  const diff = userVal !== null ? userVal - m.industry_avg : null;
                  const isGood = diff !== null
                    ? (m.lower_is_better ? diff < 0 : diff > 0)
                    : null;

                  return (
                    <div key={m.key} className="rounded-lg bg-slate-800/50 border border-slate-700/40 p-3 space-y-1">
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

              {/* Citations */}
              {benchmarks.citations.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {benchmarks.citations.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Source {i + 1}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Columns */}
      <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/30 to-slate-900/30 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Columns3 className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold text-slate-200">Data Columns ({result.columns.length})</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.columns.map((col) => (
            <span
              key={col}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-purple-600/10 border border-purple-500/40 text-xs font-medium text-purple-300 hover:border-purple-500/60 hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-200 cursor-default"
            >
              {col}
            </span>
          ))}
        </div>
      </div>

      {/* Data Preview Table */}
      {result.preview && result.preview.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/30 to-slate-900/30 p-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-green-400" />
            Data Preview
            <span className="ml-auto text-xs text-slate-400 font-normal">
              {result.preview.length} of {result.rows.toLocaleString()} rows
            </span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-700/50 shadow-lg">
            <table className="w-full divide-y divide-slate-700/50 text-left text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-slate-800/50 to-slate-700/30">
                  {result.columns.map((col) => (
                    <th key={col} className="px-4 py-3 font-semibold text-slate-300 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {result.preview.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-700/30 transition-colors duration-150">
                    {result.columns.map((col) => (
                      <td
                        key={col}
                        className="px-4 py-3 text-slate-300 whitespace-nowrap max-w-[250px] truncate"
                        title={String(row[col] ?? "")}
                      >
                        {String(row[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
