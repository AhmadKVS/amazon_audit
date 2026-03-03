"use client";

import { useState, useRef } from "react";
import { fetchWithAuth } from "@/lib/auth";

interface UploadResult {
  filename: string;
  report_type: string;
  rows: number;
  columns: string[];
  preview?: Record<string, string>[];
  local?: boolean; // true when parsed client-side (backend unavailable)
}

interface CsvUploadProps {
  onSuccess: (result: UploadResult) => void;
}

// ─── Client-side CSV parser ────────────────────────────────────────────────

function parseRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
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

function detectReportType(columns: string[]): string {
  const s = columns.map((c) => c.toLowerCase()).join(" ");
  if (s.includes("ordered product sales") || s.includes("units ordered")) return "business_report";
  if (s.includes("order defect rate") || s.includes("late shipment") || s.includes("odr")) return "account_health";
  if (s.includes("acos") || s.includes("ad group") || s.includes("campaign")) return "ads";
  if (s.includes("fba") || s.includes("fulfillable") || s.includes("inbound")) return "fba_inventory";
  if (s.includes("listing id") || s.includes("seller sku") || s.includes("product id")) return "active_listings";
  return "unknown";
}

function countLines(text: string): number {
  // count non-empty lines minus the header row
  return text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
}

async function parseFileFallback(file: File): Promise<UploadResult> {
  const text = await file.text();
  const { headers, rows } = parseLocalCsv(text);
  if (!headers.length) throw new Error("CSV file appears to be empty");
  return {
    filename: file.name,
    report_type: detectReportType(headers),
    rows: countLines(text),
    columns: headers,
    preview: rows,
    local: true,
  };
}

// ─── Component ────────────────────────────────────────────────────────────

export function CsvUpload({ onSuccess }: CsvUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a CSV file.");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // ── Try backend first ──────────────────────────────────────────────
      const formData = new FormData();
      formData.append("file", file);

      let backendOk = false;
      try {
        const res = await fetchWithAuth("/api/upload/csv", {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(15_000),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.columns) {
          onSuccess({
            filename: data.filename ?? file.name,
            report_type: data.report_type ?? "unknown",
            rows: data.rows ?? 0,
            columns: data.columns ?? [],
            preview: data.preview ?? [],
          });
          backendOk = true;
        } else if (!res.ok) {
          // Extract readable error from FastAPI detail
          const detail = data?.detail;
          const msg = typeof detail === "string"
            ? detail
            : Array.isArray(detail)
            ? detail[0]?.msg
            : null;
          if (msg) throw new Error(msg); // real validation error — don't fall back
        }
      } catch (fetchErr) {
        // Only fall back for network/connection errors, not validation errors
        const isNetworkErr =
          fetchErr instanceof TypeError ||
          (fetchErr instanceof Error &&
            (fetchErr.message.includes("fetch") ||
              fetchErr.message.includes("socket") ||
              fetchErr.message.includes("ECONNRESET") ||
              fetchErr.message.includes("abort") ||
              fetchErr.message.includes("timed out") ||
              fetchErr.message.includes("NetworkError")));

        if (!isNetworkErr) throw fetchErr; // re-throw validation errors
        // else: fall through to local fallback below
      }

      // ── Local fallback (backend unreachable / crashed) ─────────────────
      if (!backendOk) {
        const local = await parseFileFallback(file);
        onSuccess(local);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".csv")) {
      if (file) setError("Please drop a CSV file.");
      return;
    }
    await uploadFile(file);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="text-lg font-medium text-slate-100">Upload CSV Report</h3>
      <p className="mt-1 text-sm text-slate-400">
        Upload Business Reports, Active Listings, Account Health, Ads, or FBA Inventory.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`mt-4 flex min-h-[180px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isDragging
            ? "border-amber-500 bg-amber-500/10"
            : "border-slate-700 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50"
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="h-6 w-6 animate-spin text-amber-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <p className="text-sm text-slate-400">Analyzing report...</p>
          </div>
        ) : (
          <>
            <svg className="h-12 w-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-sm text-slate-400">
              {isDragging ? "Drop CSV file here" : "Drag and drop or click to select CSV file"}
            </p>
          </>
        )}
      </button>

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}
