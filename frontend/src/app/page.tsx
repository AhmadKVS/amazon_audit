"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, signOut, fetchWithAuth } from "@/lib/auth";
import { getCachedAuditList, setCachedAuditList, removeCachedReport } from "@/lib/cache";
import { extractAsinMetrics, isBusinessReportCsv } from "@/lib/csvMetrics";

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

/** Map backend human-readable report types to frontend slot keys used by benchmarks API. */
function normalizeReportType(backendType: string): string | null {
  const t = backendType.toLowerCase();
  if (t === "business report") return "business_report";
  if (t === "active listings report") return "active_listings";
  if (t === "account health report") return "account_health";
  if (t.includes("advertising") || t.includes("sponsored") || t === "ads") return "ads";
  if (t.includes("search term")) return "ads";
  if (t === "fba inventory report") return "fba_inventory";
  // Unrecognized — return null so caller falls back to slotKey
  return null;
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

// ── Upload slot configuration ──────────────────────────────────────────────

type SlotKey = "business_report" | "search_terms" | "query_performance" | "additional";

interface SlotConfig {
  key: SlotKey;
  label: string;
  badge: "required" | "recommended" | "optional";
  helperText: string;
  acceptMultiple: boolean;
}

const UPLOAD_SLOTS: SlotConfig[] = [
  {
    key: "business_report",
    label: "Business Report",
    badge: "required",
    helperText: 'Download from Seller Central: Reports > Business Reports > "By ASIN" or "Detail Page Sales and Traffic"',
    acceptMultiple: false,
  },
  {
    key: "search_terms",
    label: "Search Terms Report",
    badge: "recommended",
    helperText: "Download from Seller Central: Reports > Advertising Reports > Search Term Report",
    acceptMultiple: false,
  },
  {
    key: "query_performance",
    label: "Query Performance Report",
    badge: "recommended",
    helperText: "Download from Seller Central: Brand Analytics > Search Query Performance",
    acceptMultiple: false,
  },
  {
    key: "additional",
    label: "Additional Files",
    badge: "optional",
    helperText: "Any other relevant reports, such as Active Listings, Account Health, FBA Inventory, or custom documents",
    acceptMultiple: true,
  },
];

interface SlotFile {
  raw: File;
  parsed: UploadedFile | null; // null while parsing in progress
  error: string | null;
  progress: number; // 0 = idle, 1-100 = processing
}

type SlotState = { [K in SlotKey]: SlotFile[] };

const BADGE_STYLES: Record<string, string> = {
  required:    "bg-red-500/15 text-red-400 border border-red-500/30",
  recommended: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  optional:    "bg-slate-700/60 text-slate-400 border border-slate-600/40",
};

const BADGE_LABELS: Record<string, string> = {
  required:    "Required",
  recommended: "Recommended",
  optional:    "Optional",
};

const ACCEPTED_EXTS = ["csv", "xlsx", "xls", "docx", "pdf"];

// ── SlotUploadZone component ────────────────────────────────────────────────

interface SlotUploadZoneProps {
  config: SlotConfig;
  files: SlotFile[];
  onFilesAdded: (slot: SlotKey, files: File[]) => void;
  onFileRemoved: (slot: SlotKey, index: number) => void;
}

function SlotUploadZone({ config, files, onFilesAdded, onFileRemoved }: SlotUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) onFilesAdded(config.key, config.acceptMultiple ? dropped : [dropped[0]]);
  };
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) onFilesAdded(config.key, config.acceptMultiple ? selected : [selected[0]]);
    e.target.value = "";
  };

  const hasFiles = files.length > 0;
  const anyProcessing = files.some((f) => f.progress > 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      {/* Slot header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-100 truncate">{config.label}</span>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${BADGE_STYLES[config.badge]}`}>
            {BADGE_LABELS[config.badge]}
          </span>
        </div>
        {hasFiles && !anyProcessing && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="shrink-0 text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap"
          >
            {config.acceptMultiple ? "+ Add more" : "Replace"}
          </button>
        )}
      </div>

      {/* Helper text */}
      <p className="text-xs text-slate-500 leading-relaxed">{config.helperText}</p>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.docx,.pdf"
        multiple={config.acceptMultiple}
        onChange={handleInput}
        className="hidden"
      />

      {/* File list */}
      {files.map((sf, i) => (
        <div key={i}>
          {sf.progress > 0 ? (
            /* Processing state */
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-300 truncate">{sf.raw.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {sf.progress < 40 ? "Reading file..." : sf.progress < 75 ? "Processing data..." : "Finishing up..."}
                </p>
                <div className="mt-2 h-1 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-500 ease-out"
                    style={{ width: `${sf.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : sf.error ? (
            /* Error state */
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <svg className="h-4 w-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-red-300 truncate">{sf.raw.name}</p>
                  <p className="text-xs text-red-400 mt-0.5">{sf.error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onFileRemoved(config.key, i)}
                className="shrink-0 text-xs text-slate-500 hover:text-red-400 transition-colors mt-0.5"
              >
                Remove
              </button>
            </div>
          ) : sf.parsed ? (
            /* Success state */
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <svg className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-emerald-300 truncate">{sf.parsed.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {sf.parsed.report_type === "document"
                      ? `${sf.parsed.file_type.toUpperCase()} document`
                      : `${sf.parsed.rows.toLocaleString()} rows · ${sf.parsed.columns.length} cols`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onFileRemoved(config.key, i)}
                className="shrink-0 text-xs text-slate-500 hover:text-red-400 transition-colors mt-0.5"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ))}

      {/* Drop zone — show when no files yet, or for multi-slot always show a compact add zone */}
      {(!hasFiles || (config.acceptMultiple && !anyProcessing)) && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-5 transition-colors ${
            isDragging
              ? "border-amber-500 bg-amber-500/10"
              : hasFiles
              ? "border-slate-700/60 bg-slate-800/20 hover:border-slate-600 hover:bg-slate-800/30"
              : "border-slate-700 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50"
          }`}
        >
          <svg className="h-5 w-5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="text-left">
            <p className="text-xs font-medium text-slate-300">
              {isDragging ? "Drop file here" : hasFiles ? "Drop another file or click to browse" : "Drag & drop or click to browse"}
            </p>
            <p className="text-xs text-slate-600">CSV, Excel (.xlsx/.xls), Word (.docx), or PDF</p>
          </div>
        </button>
      )}
    </div>
  );
}

// ── Past Audits Panel ──────────────────────────────────────────────────────

function PastAuditsPanel() {
  const router = useRouter();
  const [audits, setAudits]   = useState<PastAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
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
        if (!cached) setError(msg); // only show error if no cache fallback
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
      saved:         "true",
    });
    return `/audit/${a.audit_id}?${params.toString()}`;
  };

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

  const visibleAudits = audits.slice(0, 5);

  return (
    <div className="space-y-3">
      {visibleAudits.map((audit) => {
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
              <div className="shrink-0 flex items-center gap-2">
                <Link
                  href={auditHref(audit)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors whitespace-nowrap"
                >
                  View Report →
                </Link>
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
  const [brandFocused, setBrandFocused] = useState(false);
  const [niche, setNiche]               = useState("");
  const [storeUrl, setStoreUrl]         = useState("");
  const [marketplace, setMarketplace]   = useState("Amazon US");
  const [auditPurpose, setAuditPurpose] = useState("");
  const [fileType, setFileType]         = useState("business_report");
  const [notes, setNotes]               = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [detailedReport, setDetailedReport] = useState(false);

  // ── Multi-slot upload state ──────────────────────────────────────────────
  const emptySlots = (): SlotState => ({
    business_report:   [],
    search_terms:      [],
    query_performance: [],
    additional:        [],
  });
  const [slots, setSlots] = useState<SlotState>(emptySlots);
  const [multiUploadError, setMultiUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/login"); }
    else { setAuthChecked(true); }
  }, [router]);

  const handleSignOut = async () => { await signOut(); router.replace("/login"); };

  // Get existing brand names for autocomplete
  const existingBrands = (() => {
    const cached = getCachedAuditList() as { brand_name?: string }[] | null;
    if (!cached) return [];
    const set = new Set(cached.map((a) => a.brand_name).filter(Boolean) as string[]);
    return Array.from(set).sort();
  })();
  const brandSuggestions = brandFocused && brandName.length > 0
    ? existingBrands.filter((b) => b.toLowerCase().includes(brandName.toLowerCase()) && b !== brandName)
    : brandFocused && brandName.length === 0
      ? existingBrands
      : [];

  // ── Per-slot file processing ────────────────────────────────────────────

  const processSingleFile = useCallback(async (
    file: File,
    slotKey: SlotKey,
    fileIndex: number,
    setProgress: (p: number) => void,
  ): Promise<UploadedFile> => {
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!ACCEPTED_EXTS.includes(ext)) {
      throw new Error("Supported formats: CSV, Excel (.xlsx/.xls), Word (.docx), PDF");
    }

    setProgress(10);

    // Read base64 for local viewing
    const fileBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
    const fileMime = file.type || "application/octet-stream";
    setProgress(25);

    // CSV: parse client-side
    if (ext === "csv") {
      setProgress(50);
      const text = await file.text();
      setProgress(75);
      const { headers, rows } = parseLocalCsv(text);
      if (!headers.length) throw new Error("CSV file appears to be empty.");
      const rowCount = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
      const detected = detectReportType(headers);
      setProgress(100);
      return {
        name: file.name, file_type: "csv",
        rows: rowCount,
        report_type: detected !== "unknown" ? detected : slotKey,
        columns: headers, preview: rows,
        file_data: fileBase64, file_mime: fileMime,
      };
    }

    // Excel / Word / PDF: send to backend via existing single-file endpoint
    setProgress(40);
    const form = new FormData();
    form.append("file", file);
    setProgress(55);
    const resp = await fetchWithAuth("/api/upload/csv", { method: "POST", body: form });
    setProgress(80);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(err.detail ?? "Upload failed");
    }
    const data = await resp.json();
    setProgress(100);
    return {
      name:        data.filename,
      file_type:   data.file_type ?? ext,
      rows:        data.rows ?? 0,
      report_type: normalizeReportType(data.report_type ?? "") ?? slotKey,
      columns:     data.columns ?? [],
      preview:     data.preview ?? [],
      raw_text:    data.raw_text,
      s3_key:      data.s3_key,
      file_data:   fileBase64,
      file_mime:   fileMime,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileType]);

  const handleFilesAdded = useCallback(async (slotKey: SlotKey, files: File[]) => {
    setMultiUploadError(null);

    // For non-multiple slots, replace existing file
    const config = UPLOAD_SLOTS.find((s) => s.key === slotKey)!;
    const newSlotFiles: SlotFile[] = files.map((f) => ({
      raw: f, parsed: null, error: null, progress: 5,
    }));

    setSlots((prev) => {
      const existing = config.acceptMultiple ? prev[slotKey] : [];
      return { ...prev, [slotKey]: [...existing, ...newSlotFiles] };
    });

    // Process each new file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Determine actual index in the slot array
      const slotIndexOffset = config.acceptMultiple
        ? (slots[slotKey]?.length ?? 0) + i
        : i;

      const setProgress = (p: number) => {
        setSlots((prev) => {
          const updated = [...prev[slotKey]];
          // For single-slot replace, we only have one new file at index 0
          const targetIdx = config.acceptMultiple ? slotIndexOffset : 0;
          if (updated[targetIdx]) {
            updated[targetIdx] = { ...updated[targetIdx], progress: p };
          }
          return { ...prev, [slotKey]: updated };
        });
      };

      try {
        const parsed = await processSingleFile(file, slotKey, slotIndexOffset, setProgress);
        setSlots((prev) => {
          const updated = [...prev[slotKey]];
          const targetIdx = config.acceptMultiple ? slotIndexOffset : 0;
          if (updated[targetIdx]) {
            updated[targetIdx] = { ...updated[targetIdx], parsed, progress: 0, error: null };
          }
          return { ...prev, [slotKey]: updated };
        });
        // Auto-set fileType from business_report slot
        if (slotKey === "business_report" && parsed.report_type !== "unknown" && parsed.report_type !== "document") {
          setFileType(normalizeReportType(parsed.report_type) ?? parsed.report_type);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to process file";
        setSlots((prev) => {
          const updated = [...prev[slotKey]];
          const targetIdx = config.acceptMultiple ? slotIndexOffset : 0;
          if (updated[targetIdx]) {
            updated[targetIdx] = { ...updated[targetIdx], error: msg, progress: 0 };
          }
          return { ...prev, [slotKey]: updated };
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processSingleFile, slots]);

  const handleFileRemoved = useCallback((slotKey: SlotKey, index: number) => {
    setSlots((prev) => {
      const updated = prev[slotKey].filter((_, i) => i !== index);
      return { ...prev, [slotKey]: updated };
    });
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────

  // First successfully parsed file from business_report slot (for legacy compat)
  const primaryFile: UploadedFile | null =
    slots.business_report.find((sf) => sf.parsed !== null)?.parsed ?? null;

  const hasBusinessReport = slots.business_report.some((sf) => sf.parsed !== null);
  const anySlotProcessing = Object.values(slots).flat().some((sf) => sf.progress > 0);

  // Show the detailed business report toggle when a business report CSV with ASIN data is present
  const showDetailedToggle = primaryFile
    && (primaryFile.report_type === "business_report" || fileType === "business_report")
    && isBusinessReportCsv(primaryFile.columns);

  // ── Form submission ───────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim()) return;

    if (!hasBusinessReport) {
      setMultiUploadError("Please upload a Business Report file before starting an audit.");
      return;
    }

    setSubmitting(true);
    setMultiUploadError(null);

    const auditId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const reportType = fileType;

    // ── Detailed Business Report flow ─────────────────────────────────────
    if (detailedReport && primaryFile && showDetailedToggle) {
      const asinMetrics = extractAsinMetrics(primaryFile.preview, primaryFile.columns);
      sessionStorage.setItem(`business_report_${auditId}`, JSON.stringify({
        asin_metrics: asinMetrics,
        csv_metadata: { filename: primaryFile.name, rows: primaryFile.rows, columns: primaryFile.columns },
        session_id:   sessionId,
      }));
      const params = new URLSearchParams({
        brand_name: brandName.trim(), niche: niche.trim(), marketplace,
        audit_purpose: auditPurpose.trim(), notes: notes.trim(),
        session_id: sessionId,
      });
      router.push(`/business-report/${auditId}?${params.toString()}`);
      return;
    }

    // ── Build multi-file FormData and send to /api/upload/multi ──────────
    const allSuccessful = Object.entries(slots).flatMap(([slotKey, slotFiles]) =>
      slotFiles
        .filter((sf) => sf.parsed !== null)
        .map((sf) => ({ slotKey: slotKey as SlotKey, sf }))
    );

    if (allSuccessful.length > 0) {
      try {
        const formData = new FormData();
        formData.append("session_id", sessionId);

        const labelsList: string[] = [];
        for (const { slotKey, sf } of allSuccessful) {
          formData.append("files", sf.raw);
          labelsList.push(slotKey);
        }
        formData.append("slot_labels", JSON.stringify(labelsList));

        const resp = await fetchWithAuth("/api/upload/multi", {
          method: "POST",
          body: formData,
        });

        if (resp.ok) {
          const multiData = await resp.json();
          // Store session metadata
          sessionStorage.setItem(`multi_session_${auditId}`, JSON.stringify({
            session_id: sessionId,
            files: multiData.files,
          }));
        }
        // Non-critical: continue even if multi-upload partially fails
      } catch {
        // Non-blocking — local parsed data is still stored below
      }
    }

    // ── Store all slot files' inline data for /api/analyze fallback ────
    const allInlineFiles = allSuccessful
      .filter(({ sf }) => sf.parsed?.file_data)
      .map(({ sf }) => ({
        filename: sf.parsed!.name,
        content: sf.parsed!.file_data!,
        content_type: sf.parsed!.file_mime || "application/octet-stream",
      }));
    try {
      sessionStorage.setItem(`audit_all_files_${auditId}`, JSON.stringify(allInlineFiles));
    } catch { /* quota exceeded */ }

    // ── Standard audit flow: store primary file data in sessionStorage ────
    if (primaryFile) {
      sessionStorage.setItem(`audit_${auditId}`, JSON.stringify({
        report_type: reportType, rows: primaryFile.rows,
        columns: primaryFile.columns, preview: primaryFile.preview,
        filename: primaryFile.name, file_type: primaryFile.file_type,
        raw_text: primaryFile.raw_text, s3_key: primaryFile.s3_key,
        session_id: sessionId,
      }));
      if (primaryFile.file_data) {
        try {
          sessionStorage.setItem(`audit_file_${auditId}`, JSON.stringify({
            file_data: primaryFile.file_data, file_mime: primaryFile.file_mime,
          }));
        } catch { /* quota exceeded — download will fall back to S3 */ }
      }
    }

    const params = new URLSearchParams({
      brand_name: brandName.trim(), niche: niche.trim(), marketplace,
      report_type: reportType, audit_purpose: auditPurpose.trim(), notes: notes.trim(),
      session_id: sessionId,
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

  const submitDisabled = !brandName.trim() || submitting || anySlotProcessing || !hasBusinessReport;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-amber-400">Amazon Audit</h1>
            <Link href="/audits" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">All Audits</Link>
            <Link href="/progress" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">Progress</Link>
          </div>
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
            {/* Brand Details card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Brand Details</h3>
                <p className="text-xs text-slate-500 mt-0.5">Basic information about the brand you&apos;re auditing.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="relative">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Brand Name <span className="text-red-400">*</span></label>
                  <input type="text" value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    onFocus={() => setBrandFocused(true)}
                    onBlur={() => setTimeout(() => setBrandFocused(false), 150)}
                    placeholder="e.g. Crystal Clean Car Care" required autoComplete="off"
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition" />
                  {brandSuggestions.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-slate-700 bg-slate-800 shadow-xl max-h-40 overflow-y-auto">
                      {brandSuggestions.map((b) => (
                        <button key={b} type="button"
                          onMouseDown={() => { setBrandName(b); setBrandFocused(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700/60 transition-colors truncate">
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
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
            </div>

            {/* Upload slots card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Upload Data Files</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload your Amazon Seller Central exports. The Business Report is required; others improve analysis accuracy.
                </p>
              </div>

              {/* Four labeled upload slots */}
              <div className="space-y-3">
                {UPLOAD_SLOTS.map((config) => (
                  <SlotUploadZone
                    key={config.key}
                    config={config}
                    files={slots[config.key]}
                    onFilesAdded={handleFilesAdded}
                    onFileRemoved={handleFileRemoved}
                  />
                ))}
              </div>

              {/* Validation error */}
              {multiUploadError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                  <svg className="h-4 w-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-red-300">{multiUploadError}</p>
                </div>
              )}

              {/* Info banner when no business report yet */}
              {!hasBusinessReport && !multiUploadError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                  <svg className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-xs text-amber-300">
                    Upload a Business Report to enable audit submission. Additional reports improve analysis accuracy but are optional.
                  </p>
                </div>
              )}
            </div>

            {/* Detailed Business Report toggle */}
            {showDetailedToggle && (
              <button type="button" onClick={() => setDetailedReport(!detailedReport)}
                className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  detailedReport
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-slate-700 bg-slate-800/30 hover:border-slate-600"
                }`}>
                <div className={`w-9 h-5 rounded-full relative transition-colors ${detailedReport ? "bg-blue-500" : "bg-slate-600"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${detailedReport ? "left-[18px]" : "left-0.5"}`} />
                </div>
                <div className="text-left">
                  <p className={`text-xs font-semibold ${detailedReport ? "text-blue-300" : "text-slate-300"}`}>
                    Detailed Business Report Analysis
                  </p>
                  <p className="text-xs text-slate-500">
                    Per-ASIN diagnostics, before/after projections, and executive summary
                  </p>
                </div>
              </button>
            )}

            {/* Additional Notes */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <label className="block text-xs font-medium text-slate-400 mb-1">Additional Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any specific focus areas or concerns for this audit?"
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition resize-none" />
            </div>

            <button
              type="submit"
              disabled={submitDisabled}
              title={!hasBusinessReport ? "Upload a Business Report to enable submission" : undefined}
              className="w-full rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting
                ? "Starting audit..."
                : anySlotProcessing
                ? "Processing files..."
                : detailedReport && showDetailedToggle
                ? "Generate Business Report"
                : "Start Audit"}
            </button>
          </form>
        </div>

        {/* ── Right: Past Audits ── */}
        <div className="w-80 shrink-0 xl:w-96">
          <div className="sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-100">Past Audits</h2>
              <Link
                href="/audits"
                className="text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                View All →
              </Link>
            </div>
            <PastAuditsPanel />
          </div>
        </div>

      </div>
    </div>
  );
}
