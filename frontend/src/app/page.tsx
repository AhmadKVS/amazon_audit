"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, signOut, fetchWithAuth } from "@/lib/auth";

// ── CSV helpers ────────────────────────────────────────────────────────────

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

function detectReportType(columns: string[]): string {
  const s = columns.map((c) => c.toLowerCase()).join(" ");
  if (s.includes("ordered product sales") || s.includes("units ordered")) return "business_report";
  if (s.includes("order defect rate") || s.includes("late shipment") || s.includes("odr")) return "account_health";
  if (s.includes("acos") || s.includes("ad group") || s.includes("campaign")) return "ads";
  if (s.includes("fba") || s.includes("fulfillable") || s.includes("inbound")) return "fba_inventory";
  if (s.includes("listing id") || s.includes("seller sku") || s.includes("product id")) return "active_listings";
  return "unknown";
}

// ── Constants ──────────────────────────────────────────────────────────────

const FILE_TYPES = [
  { value: "business_report", label: "Business Report" },
  { value: "active_listings", label: "Active Listings" },
  { value: "account_health",  label: "Account Health" },
  { value: "ads",             label: "Ads Performance" },
  { value: "fba_inventory",   label: "FBA Inventory" },
] as const;

const MARKETPLACES = [
  "Amazon US", "Amazon UK", "Amazon DE", "Amazon CA",
  "Amazon AU", "Amazon IN", "Amazon JP", "Amazon FR",
  "Amazon IT", "Amazon ES",
];

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

// ── Types ──────────────────────────────────────────────────────────────────

interface UploadedFile {
  name: string;
  file_type: string;  // csv | xlsx | xls | docx | pdf
  rows: number;
  report_type: string;
  columns: string[];
  preview: Record<string, string>[];
  raw_text?: string;  // for Word/PDF documents
  s3_key?: string;    // S3 key (when S3 is configured)
  file_data?: string; // base64-encoded file content for local viewing
  file_mime?: string; // MIME type
}

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

// ── Past Audits Panel ──────────────────────────────────────────────────────

function PastAuditsPanel() {
  const router = useRouter();
  const [audits, setAudits]   = useState<PastAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/audit/list")
      .then((r) => {
        if (r.status === 401) { router.push("/login"); return Promise.reject("session expired"); }
        if (!r.ok) return r.json().then((d: { detail?: string }) => Promise.reject(d.detail ?? `HTTP ${r.status}`));
        return r.json();
      })
      .then((d: { audits?: PastAudit[] }) => {
        console.log("[PastAudits] response:", d);
        setAudits(d.audits ?? []);
      })
      .catch((e: unknown) => {
        const msg = String(e);
        if (msg === "session expired") return;
        console.error("[PastAudits] error:", e);
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [router]);

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
    });
    return `/audit/${a.audit_id}?${params.toString()}`;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-2/3 mb-2" />
            <div className="h-3 bg-slate-800 rounded w-1/2 mb-3" />
            <div className="h-3 bg-slate-800 rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Could not load past audits: {error}
      </div>
    );
  }

  if (audits.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-8 flex flex-col items-center justify-center gap-2 text-center">
        <svg className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-slate-400">No audits yet</p>
        <p className="text-xs text-slate-600">Complete your first audit to see reports here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {audits.map((audit) => {
        const color = REPORT_COLORS[audit.report_type] || "#f59e0b";
        return (
          <div key={audit.audit_id}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700 transition-colors group">
            <div className="flex items-start justify-between gap-3">
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
              <Link
                href={auditHref(audit)}
                className="shrink-0 text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors whitespace-nowrap"
              >
                View Report →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [brandName, setBrandName]       = useState("");
  const [niche, setNiche]               = useState("");
  const [storeUrl, setStoreUrl]         = useState("");
  const [marketplace, setMarketplace]   = useState("Amazon US");
  const [auditPurpose, setAuditPurpose] = useState("");
  const [fileType, setFileType]         = useState("business_report");
  const [notes, setNotes]               = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging]     = useState(false);
  const [fileError, setFileError]       = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); }
    else { setAuthChecked(true); }
  }, [router]);

  const handleSignOut = async () => { await signOut(); router.replace("/login"); };

  const processFile = async (file: File) => {
    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : "";
    const accepted = ["csv", "xlsx", "xls", "docx", "pdf"];
    if (!accepted.includes(ext)) {
      setFileError("Supported formats: CSV, Excel (.xlsx/.xls), Word (.docx), PDF");
      return;
    }
    setFileError(null);

    // Read file as base64 for later viewing/downloading
    const fileBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
    const fileMime = file.type || "application/octet-stream";

    // CSV: parse client-side (fast, no round-trip needed)
    if (ext === "csv") {
      const text = await file.text();
      const { headers, rows } = parseLocalCsv(text);
      if (!headers.length) { setFileError("CSV file appears to be empty."); return; }
      const rowCount = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
      const detected = detectReportType(headers);
      setUploadedFile({
        name: file.name, file_type: "csv",
        rows: rowCount, report_type: detected !== "unknown" ? detected : fileType,
        columns: headers, preview: rows,
        file_data: fileBase64, file_mime: fileMime,
      });
      return;
    }

    // Excel / Word / PDF: send to backend for parsing
    setFileError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetchWithAuth("/api/upload/csv", { method: "POST", body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Upload failed" }));
        setFileError(err.detail ?? "Upload failed");
        return;
      }
      const data = await resp.json();
      setUploadedFile({
        name:        data.filename,
        file_type:   data.file_type ?? ext,
        rows:        data.rows ?? 0,
        report_type: data.report_type !== "unknown" ? data.report_type : fileType,
        columns:     data.columns ?? [],
        preview:     data.preview ?? [],
        raw_text:    data.raw_text,
        s3_key:      data.s3_key,
        file_data:   fileBase64, file_mime: fileMime,
      });
      if (data.report_type && data.report_type !== "unknown" && data.report_type !== "document") {
        setFileType(data.report_type);
      }
    } catch {
      setFileError("Failed to upload file — please try again");
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    await processFile(file); e.target.value = "";
  };

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop      = async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0]; if (file) await processFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim()) return;
    setSubmitting(true);
    const auditId    = crypto.randomUUID();
    const reportType = uploadedFile?.report_type ?? fileType;
    if (uploadedFile) {
      sessionStorage.setItem(`audit_${auditId}`, JSON.stringify({
        report_type: reportType, rows: uploadedFile.rows,
        columns: uploadedFile.columns, preview: uploadedFile.preview,
        filename: uploadedFile.name, file_type: uploadedFile.file_type,
        raw_text: uploadedFile.raw_text, s3_key: uploadedFile.s3_key,
        file_data: uploadedFile.file_data, file_mime: uploadedFile.file_mime,
      }));
    }
    const params = new URLSearchParams({
      brand_name: brandName.trim(), niche: niche.trim(), marketplace,
      report_type: reportType, audit_purpose: auditPurpose.trim(), notes: notes.trim(),
    });
    router.push(`/audit/${auditId}?${params.toString()}`);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  const fileTypeLabel = FILE_TYPES.find((f) => f.value === fileType)?.label ?? "File";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <h1 className="text-xl font-semibold tracking-tight text-amber-400">Amazon Audit</h1>
          <button onClick={handleSignOut} className="text-sm text-slate-400 hover:text-amber-400 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      {/* Two-panel layout */}
      <div className="mx-auto max-w-7xl px-6 py-8 flex gap-8 items-start">

        {/* ── Left: New Audit Form ── */}
        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-100">New Audit</h2>
            <p className="mt-1 text-sm text-slate-400">Enter brand details to generate an AI-powered analysis.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Brand Details</h3>
                <p className="text-xs text-slate-500 mt-0.5">Basic information about the brand you&apos;re auditing.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Brand Name <span className="text-red-400">*</span></label>
                  <input type="text" value={brandName} onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Crystal Clean Car Care" required
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Product Niche</label>
                  <input type="text" value={niche} onChange={(e) => setNiche(e.target.value)}
                    placeholder="e.g. Car Care Products"
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Amazon Store URL</label>
                  <input type="url" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)}
                    placeholder="https://amazon.com/stores/..."
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Marketplace</label>
                  <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition appearance-none">
                    {MARKETPLACES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Audit Purpose</label>
                <textarea value={auditPurpose} onChange={(e) => setAuditPurpose(e.target.value)} rows={2}
                  placeholder="e.g. Identify gaps, optimize advertising performance..."
                  className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition resize-none" />
              </div>

              {/* Upload */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-slate-400">Upload Data Files</label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">File Type:</span>
                    <select value={fileType} onChange={(e) => setFileType(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 outline-none transition appearance-none">
                      {FILE_TYPES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                </div>

                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.docx,.pdf" onChange={handleFileInput} className="hidden" />

                {uploadedFile ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-xs font-medium text-emerald-300">{uploadedFile.name}</p>
                        <p className="text-xs text-slate-500">
                          {uploadedFile.report_type === "document"
                            ? `${uploadedFile.file_type.toUpperCase()} document — used as context`
                            : `${uploadedFile.rows.toLocaleString()} rows · ${uploadedFile.columns.length} cols`}
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setUploadedFile(null)} className="text-xs text-slate-500 hover:text-red-400 transition-colors">Remove</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => inputRef.current?.click()}
                    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                    className={`w-full flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 transition-colors ${
                      isDragging ? "border-amber-500 bg-amber-500/10" : "border-slate-700 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50"
                    }`}>
                    <svg className="h-8 w-8 text-slate-500 mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xs font-medium text-slate-300">{isDragging ? "Drop file here" : "Click to select a file"}</p>
                    <p className="text-xs text-slate-600 mt-0.5">CSV, Excel, Word, or PDF</p>
                  </button>
                )}

                {fileError && <p className="mt-1.5 text-xs text-red-400">{fileError}</p>}

                {!uploadedFile && !fileError && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <svg className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    <p className="text-xs text-amber-300">No data files uploaded. Reports require at least one data file to generate accurate analysis. You can add files later from the audit page.</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Additional Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  placeholder="Any specific focus areas or concerns for this audit?"
                  className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition resize-none" />
              </div>
            </div>

            <button type="submit" disabled={!brandName.trim() || submitting}
              className="w-full rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {submitting ? "Starting audit..." : "Start Audit"}
            </button>
          </form>
        </div>

        {/* ── Right: Past Audits ── */}
        <div className="w-80 shrink-0 xl:w-96">
          <div className="sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-100">Past Audits</h2>
            </div>
            <PastAuditsPanel />
          </div>
        </div>

      </div>
    </div>
  );
}
