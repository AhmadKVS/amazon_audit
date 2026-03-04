/**
 * Simple localStorage cache for audit data.
 * - audit list:    cached on login + refreshed in background on page load
 * - audit reports: cached when first opened, served from cache on revisit
 */

const LIST_KEY = "audit_list_cache";
const REPORT_PREFIX = "audit_report_";

// ── Audit list ──────────────────────────────────────────────────────────────

interface CachedList {
  audits: unknown[];
  ts: number; // Date.now() when cached
}

export function getCachedAuditList(): unknown[] | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const parsed: CachedList = JSON.parse(raw);
    return parsed.audits;
  } catch {
    return null;
  }
}

export function setCachedAuditList(audits: unknown[]) {
  try {
    const data: CachedList = { audits, ts: Date.now() };
    localStorage.setItem(LIST_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

// ── Individual audit reports ────────────────────────────────────────────────

interface CachedReport {
  data: Record<string, unknown>;
  ts: number;
}

export function getCachedReport(auditId: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(REPORT_PREFIX + auditId);
    if (!raw) return null;
    const parsed: CachedReport = JSON.parse(raw);
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCachedReport(auditId: string, data: Record<string, unknown>) {
  try {
    const entry: CachedReport = { data, ts: Date.now() };
    localStorage.setItem(REPORT_PREFIX + auditId, JSON.stringify(entry));
  } catch { /* quota exceeded — ignore */ }
}

export function removeCachedReport(auditId: string) {
  try {
    localStorage.removeItem(REPORT_PREFIX + auditId);
  } catch { /* ignore */ }
}

// ── Clear all cache (call on sign-out) ──────────────────────────────────────

export function clearAuditCache() {
  localStorage.removeItem(LIST_KEY);
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(REPORT_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}
