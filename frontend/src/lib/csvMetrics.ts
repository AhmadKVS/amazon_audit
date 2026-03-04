/**
 * Extract per-ASIN metrics from parsed Amazon Business Report CSV data.
 */

export interface AsinMetrics {
  asin: string;
  title: string;
  sessions: number;
  conversion_rate: number;
  units_sold: number;
  revenue: number;
  ad_spend: number;
  acos: number;
}

// Column name patterns → standardised keys (case-insensitive substring match)
const COL_PATTERNS: Record<string, string[]> = {
  asin:            ["(child) asin", "child asin", "asin"],
  title:           ["title", "product name"],
  sessions:        ["sessions - total", "sessions"],
  conversion_rate: ["unit session percentage", "session percentage", "conversion rate"],
  units_sold:      ["units ordered", "units sold"],
  revenue:         ["ordered product sales", "ordered revenue", "product sales"],
  ad_spend:        ["spend", "ad spend", "total spend"],
  acos:            ["acos", "advertising cost"],
};

function findColumn(columns: string[], patterns: string[]): string | null {
  const colsLower = columns.map((c) => ({ orig: c, low: c.toLowerCase() }));
  for (const pattern of patterns) {
    for (const { orig, low } of colsLower) {
      if (low.includes(pattern)) return orig;
    }
  }
  return null;
}

function parseNumeric(val: string | undefined | null): number {
  if (val === undefined || val === null || val === "") return 0;
  const cleaned = String(val).replace(/[,$%£€]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extract per-ASIN metrics from CSV preview rows.
 * @param preview  Array of row objects (first 20 rows from CSV)
 * @param columns  Column header names
 * @returns Array of AsinMetrics
 */
export function extractAsinMetrics(
  preview: Record<string, string>[],
  columns: string[],
): AsinMetrics[] {
  const colMap: Record<string, string | null> = {};
  for (const [key, patterns] of Object.entries(COL_PATTERNS)) {
    colMap[key] = findColumn(columns, patterns);
  }

  const asinCol = colMap.asin;
  if (!asinCol || !preview.length) return [];

  const results: AsinMetrics[] = [];
  for (const row of preview) {
    const asinVal = (row[asinCol] ?? "").trim();
    if (!asinVal) continue;

    results.push({
      asin: asinVal,
      title: colMap.title ? (row[colMap.title] ?? "").trim() : "",
      sessions: parseNumeric(colMap.sessions ? row[colMap.sessions] : undefined),
      conversion_rate: parseNumeric(colMap.conversion_rate ? row[colMap.conversion_rate] : undefined),
      units_sold: parseNumeric(colMap.units_sold ? row[colMap.units_sold] : undefined),
      revenue: parseNumeric(colMap.revenue ? row[colMap.revenue] : undefined),
      ad_spend: parseNumeric(colMap.ad_spend ? row[colMap.ad_spend] : undefined),
      acos: parseNumeric(colMap.acos ? row[colMap.acos] : undefined),
    });
  }

  return results;
}

/**
 * Check whether the given columns look like an Amazon Business Report.
 */
export function isBusinessReportCsv(columns: string[]): boolean {
  const asinCol = findColumn(columns, COL_PATTERNS.asin);
  const sessionsCol = findColumn(columns, COL_PATTERNS.sessions);
  return asinCol !== null && sessionsCol !== null;
}
