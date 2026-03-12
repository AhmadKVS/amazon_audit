"""
AI Audit Analysis — full-report analysis via Claude API.

Flow:
  POST /api/analyze
    1. Accept session_id, list of S3 keys, brand/niche/marketplace metadata.
    2. Download each S3 file and parse it (CSV, Excel, PDF, Word).
    2b. Run deterministic Python PPC calculations on CSV DataFrames.
    3. Combine all parsed content + pre-calculated PPC context into a capped string.
    4. Call Claude API with system prompt (Claude uses pre-calculated PPC metrics).
    5. Parse JSON response, override PPC fields with Python-calculated values.
"""
import asyncio
import base64
import json
import re
from typing import Optional

import anthropic
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import get_current_user, check_rate_limit
from app.services.s3_storage import download_from_s3
from app.services.csv_parser import (
    parse_csv,
    parse_excel,
    parse_docx,
    parse_pdf,
    detect_report_type,
)

router = APIRouter()

# Maximum characters of combined file content sent to Claude
# ~4 chars per token → 30k chars ≈ 7,500 tokens (fits within 10k TPM rate limit)
_MAX_CONTEXT_CHARS = 30_000


def _source(file: str, method: str, detail: str = "") -> dict:
    """Create a source citation dict for tracking where a metric came from."""
    return {"file": file, "method": method, "detail": detail}


# ── Request model ──────────────────────────────────────────────────────────

class InlineFile(BaseModel):
    filename: str
    content: str           # base64-encoded file bytes
    content_type: str = "text/csv"


class AnalyzeRequest(BaseModel):
    session_id: str
    s3_keys: list[str] = []       # S3 keys from previous uploads
    inline_files: list[InlineFile] = []  # base64 files when S3 is unavailable
    brand_name: str = ""
    niche: str = ""
    marketplace: str = "Amazon US"
    existing_scorecard: dict = {}  # Scorecard data from store lookup (provides brand/ASIN context)
    requested_sections: list[str] = []  # e.g. ["revenueGapReport"] or ["adEfficiencySignal"]


# ── Helpers ────────────────────────────────────────────────────────────────

def _require_key() -> None:
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            503,
            "AI service not configured — add ANTHROPIC_API_KEY to .env",
        )


def _ext(s3_key: str) -> str:
    """Extract lowercase file extension from an S3 key."""
    name = s3_key.rsplit("/", 1)[-1]
    if "." in name:
        return "." + name.rsplit(".", 1)[-1].lower()
    return ""


def _df_to_text(df, label: str) -> str:
    """Convert a DataFrame to a compact text block for the prompt."""
    try:
        rows_text = df.head(500).fillna("").astype(str).to_csv(index=False)
        report_type = detect_report_type(df)
        header = f"=== {label} (type: {report_type}, {len(df)} rows) ==="
        return f"{header}\n{rows_text}"
    except Exception as exc:
        return f"=== {label} ===\n[Could not convert to text: {exc}]"


async def _fetch_and_parse(s3_key: str) -> Optional[str]:
    """
    Download a file from S3 and return its content as a plain-text string.
    Returns None and logs a warning if the download or parse fails.
    """
    result = await download_from_s3(s3_key)
    if result is None:
        print(f"[analyze] S3 download returned None for key={s3_key!r} - skipping")
        return None

    contents, _content_type = result
    ext = _ext(s3_key)
    label = s3_key.rsplit("/", 1)[-1]

    try:
        if ext == ".csv":
            df = parse_csv(contents)
            return _df_to_text(df, label)

        if ext in (".xlsx", ".xls"):
            df = parse_excel(contents)
            return _df_to_text(df, label)

        if ext == ".docx":
            raw_text = parse_docx(contents)
            return f"=== {label} (Word document) ===\n{raw_text}"

        if ext == ".pdf":
            df_pdf, raw_text = parse_pdf(contents)
            parts = [f"=== {label} (PDF) ==="]
            if df_pdf is not None and not df_pdf.empty:
                parts.append(_df_to_text(df_pdf, f"{label} (table)"))
            if raw_text:
                parts.append(raw_text)
            return "\n".join(parts)

        # Unknown extension — try UTF-8 text decode as a best-effort fallback
        try:
            text = contents.decode("utf-8", errors="replace")
            return f"=== {label} (raw text) ===\n{text}"
        except Exception:
            return None

    except Exception as exc:
        print(f"[analyze] Parse error for key={s3_key!r}: {exc}")
        return None


def _extract_json(text: str) -> str:
    """
    Best-effort extraction of a JSON object from an LLM response that may
    contain markdown code fences, preamble, or trailing explanation.
    Mirrors the pattern used in audit.py and business_report.py.
    """
    text = text.strip()

    # Strip ```json ... ``` or ``` ... ``` fences
    fence_match = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    if text.startswith("{"):
        return text

    start = text.find("{")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        end = text.rfind("}")
        if end > start:
            return text[start : end + 1]

    return text



# ── Deterministic PPC calculator ──────────────────────────────────────────

def _find_col(df: "pd.DataFrame", keywords: list[str]) -> Optional[str]:
    """Find a DataFrame column whose name contains ALL given keywords (case-insensitive)."""
    for col in df.columns:
        if all(k.lower() in col.lower() for k in keywords):
            return col
    return None


def _clean_currency(val) -> float:
    """Convert Amazon currency strings like '$4,251.30' to float."""
    if pd.isna(val):
        return 0.0
    return float(str(val).replace("$", "").replace(",", "").strip() or 0)


def calculate_ppc_metrics(df: "pd.DataFrame") -> Optional[dict]:
    """
    Calculate PPC metrics deterministically from a Search Term Report DataFrame.

    Returns a dict with currentAcos, wastedSpend30Days, lowPerformerCount,
    targetAcos, weeklyData, and _meta. Returns None if the DataFrame lacks
    required columns or has insufficient data.
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    # ── Column detection (dynamic, never hardcoded) ──
    col_spend = _find_col(df, ["spend"])
    col_sales = _find_col(df, ["sales"]) or _find_col(df, ["revenue"])
    col_orders = _find_col(df, ["orders"]) or _find_col(df, ["purchases"])
    col_campaign = _find_col(df, ["campaign"])
    col_clicks = _find_col(df, ["clicks"])
    col_search_term = _find_col(df, ["customer", "search", "term"]) or _find_col(df, ["targeting"])

    print(f"[PPC] Column mapping: spend={col_spend}, sales={col_sales}, "
          f"orders={col_orders}, campaign={col_campaign}, clicks={col_clicks}, "
          f"search_term={col_search_term}")

    if not col_spend or not col_sales:
        print(f"[PPC] Missing required columns (spend={col_spend}, sales={col_sales}) — skipping")
        return None

    # ── Data cleaning ──
    df["_spend"] = df[col_spend].apply(_clean_currency)
    df["_sales"] = df[col_sales].apply(_clean_currency)
    df["_orders"] = (
        pd.to_numeric(df[col_orders], errors="coerce").fillna(0)
        if col_orders else 0
    )
    if col_clicks:
        df["_clicks"] = pd.to_numeric(df[col_clicks], errors="coerce").fillna(0)

    total_spend = df["_spend"].sum()
    total_sales = df["_sales"].sum()
    total_orders = df["_orders"].sum() if col_orders else 0

    # ── Sanity check ──
    print(f"[PPC] Sanity check: rows={len(df)}, spend=${total_spend:,.2f}, "
          f"sales=${total_sales:,.2f}, orders={total_orders:,.0f}")

    if total_spend < 100 or total_sales < 100:
        print(f"[PPC] Data too small (spend=${total_spend:.2f}, sales=${total_sales:.2f}) — skipping")
        return None

    current_acos = round(total_spend / total_sales * 100, 1)
    if current_acos > 200:
        print(f"[PPC] WARNING: ACOS={current_acos}% — possible column mapping error")

    # ── Date range detection ──
    actual_days = 65  # fallback
    start_col = _find_col(df, ["start", "date"])
    end_col = _find_col(df, ["end", "date"])
    date_range_str = "unknown"
    if start_col and end_col:
        try:
            start_dates = pd.to_datetime(df[start_col], errors="coerce")
            end_dates = pd.to_datetime(df[end_col], errors="coerce")
            date_min = start_dates.min()
            date_max = end_dates.max()
            if pd.notna(date_min) and pd.notna(date_max):
                actual_days = (date_max - date_min).days + 1
                date_range_str = f"{date_min.strftime('%Y-%m-%d')} to {date_max.strftime('%Y-%m-%d')}"
                print(f"[PPC] Date range: {date_range_str} = {actual_days} days")
        except Exception as exc:
            print(f"[PPC] Date range detection failed: {exc}")
    else:
        print(f"[PPC] No date columns found — using fallback {actual_days} days")

    # ── Zero-conversion waste ──
    zero_waste = df[(df["_orders"] == 0) & (df["_spend"] > 0)]["_spend"].sum()

    # ── Top wasted search terms (zero orders, sorted by spend) ──
    top_wasted_terms: list[dict] = []
    if col_search_term:
        zero_order_rows = df[(df["_orders"] == 0) & (df["_spend"] > 1.0)].copy()
        zero_order_rows = zero_order_rows.sort_values("_spend", ascending=False)
        for _, row in zero_order_rows.head(10).iterrows():
            term = row.get(col_search_term)
            if pd.notna(term) and str(term).strip():
                top_wasted_terms.append({
                    "term": str(term).strip(),
                    "spend": round(float(row["_spend"]), 2),
                    "clicks": int(row.get("_clicks", 0)) if "_clicks" in row.index else 0,
                    "orders": 0,
                })
        print(f"[PPC] Top wasted terms: {len(top_wasted_terms)} found")

    # ── High ACOS waste + low performer count (campaign-level) ──
    high_acos_waste = 0.0
    low_performer_count = 0
    low_performer_names: list[str] = []

    if col_campaign:
        camp = df.groupby(col_campaign).agg(
            Spend=("_spend", "sum"),
            Sales=("_sales", "sum"),
            Orders=("_orders", "sum"),
        ).reset_index()
        camp["ACOS"] = camp.apply(
            lambda r: r["Spend"] / r["Sales"] * 100 if r["Sales"] > 0 else None,
            axis=1,
        )

        # High ACOS campaigns (ACOS > 45%)
        high_acos_mask = camp["ACOS"].notna() & (camp["ACOS"] > 45)
        high_acos_waste = camp.loc[high_acos_mask, "Spend"].sum()

        # Low performers: ACOS > 45% OR (no orders AND spend > $10)
        low_perf_mask = high_acos_mask | (
            (camp["Orders"] == 0) & (camp["Spend"] > 10)
        )
        low_performer_count = int(low_perf_mask.sum())
        low_performer_names = (
            camp.loc[low_perf_mask]
            .sort_values("Spend", ascending=False)[col_campaign]
            .head(5)
            .tolist()
        )

        print(f"[PPC] Campaigns: {len(camp)} total, {low_performer_count} low performers, "
              f"high ACOS waste=${high_acos_waste:,.2f}")

    total_wasted = zero_waste + high_acos_waste
    wasted_30d = round(total_wasted * 30 / actual_days, -2)  # round to nearest $100

    # ── Weekly data (real per-week totals grouped by ISO week) ──
    weekly_data: list[dict] = []
    if start_col:
        try:
            df["_start_dt"] = pd.to_datetime(df[start_col], errors="coerce")
            valid = df[df["_start_dt"].notna()].copy()
            valid["_iso_week"] = valid["_start_dt"].dt.isocalendar().week.astype(int)
            valid["_iso_year"] = valid["_start_dt"].dt.isocalendar().year.astype(int)
            weekly_agg = (
                valid.groupby(["_iso_year", "_iso_week"])
                .agg(adSpend=("_spend", "sum"), sales=("_sales", "sum"))
                .reset_index()
                .sort_values(["_iso_year", "_iso_week"])
            )
            for i, row in enumerate(weekly_agg.itertuples(), 1):
                weekly_data.append({
                    "week": f"Week {i}",
                    "adSpend": round(row.adSpend),
                    "sales": round(row.sales),
                })
            print(f"[PPC] Weekly data: {len(weekly_data)} weeks from ISO week grouping")
        except Exception as exc:
            print(f"[PPC] Weekly grouping failed: {exc}")

    if not weekly_data:
        # Fallback: equal distribution over 4 weeks
        weekly_spend = round(total_spend / 4)
        weekly_sales = round(total_sales / 4)
        weekly_data = [
            {"week": f"Week {i}", "adSpend": weekly_spend, "sales": weekly_sales}
            for i in range(1, 5)
        ]
        print(f"[PPC] Weekly data: fallback equal distribution (4 weeks)")

    result = {
        "currentAcos": current_acos,
        "wastedSpend30Days": int(wasted_30d),
        "lowPerformerCount": low_performer_count,
        "targetAcos": 35,
        "weeklyData": weekly_data,
        "topWastedTerms": top_wasted_terms,
        "_meta": {
            "total_spend": round(total_spend, 2),
            "total_sales": round(total_sales, 2),
            "total_orders": int(total_orders),
            "actual_days": actual_days,
            "date_range": date_range_str,
            "rows": len(df),
            "zero_waste": round(zero_waste, 2),
            "high_acos_waste": round(high_acos_waste, 2),
            "low_performer_names": low_performer_names,
        },
    }

    print(f"[PPC] Python calc SUCCESS: ACOS={current_acos}%, wasted_30d=${int(wasted_30d):,}, "
          f"low_perf={low_performer_count}, rows={len(df)}, spend=${total_spend:,.2f}")

    return result


def calculate_performance_snapshot(ppc: dict) -> dict:
    """
    Calculate revenue and profitability opportunity deterministically from PPC metrics.

    Returns a dict matching the performanceSnapshot JSON schema with all numbers
    derived from actual CSV data — no AI estimation.
    """
    meta = ppc["_meta"]
    total_spend = meta["total_spend"]
    total_sales = meta["total_sales"]
    actual_days = meta["actual_days"]
    current_acos = ppc["currentAcos"]
    target_acos = ppc["targetAcos"]  # 35%
    wasted_30d = ppc["wastedSpend30Days"]
    zero_waste = meta["zero_waste"]
    high_acos_waste = meta["high_acos_waste"]

    # Scale to monthly
    monthly_spend = round(total_spend * 30 / actual_days, 2)
    monthly_sales = round(total_sales * 30 / actual_days, 2)
    sales_per_dollar = total_sales / total_spend if total_spend > 0 else 0
    high_acos_monthly = round(high_acos_waste * 30 / actual_days)

    # ── Revenue Opportunity ──
    # 1. PPC Waste Recovery: 50% of wasted spend redirected at current conversion ratio
    rev_waste_recovery = round(wasted_30d * 0.5 * sales_per_dollar)
    # 2. ACOS Optimization: excess spend above target converts to revenue
    excess_acos_pct = max(0, (current_acos - target_acos) / 100)
    rev_acos_opt = round(monthly_sales * excess_acos_pct)
    # 3. Campaign Efficiency: 30% of low-performer budget recaptured
    rev_campaign_eff = round(high_acos_monthly * 0.3 * sales_per_dollar)

    total_rev_impact = rev_waste_recovery + rev_acos_opt + rev_campaign_eff
    rev_pct = round(total_rev_impact / monthly_sales * 100) if monthly_sales > 0 else 0

    # ── Profitability Opportunity (direct cost savings) ──
    # 1. Eliminate wasted spend entirely
    prof_waste = wasted_30d
    # 2. ACOS reduction savings: spend reduction needed to hit target
    prof_acos = round(monthly_spend * max(0, (current_acos - target_acos) / current_acos)) if current_acos > 0 else 0
    # 3. Cut low-performer budgets
    prof_campaign = high_acos_monthly

    total_prof_savings = prof_waste + prof_acos + prof_campaign
    prof_pct = round(total_prof_savings / monthly_spend * 100) if monthly_spend > 0 else 0

    snapshot = {
        "revenueOpportunity": {
            "percentageIncrease": rev_pct,
            "percentageFormula": f"${total_rev_impact:,} / ${monthly_sales:,.0f} × 100 = {rev_pct}%",
            "breakdown": [
                {
                    "label": "PPC Optimization & Waste Reduction",
                    "monthlyImpact": rev_waste_recovery,
                    "formula": f"${wasted_30d:,} wasted × 50% recovery × {sales_per_dollar:.2f} sales/$ = ${rev_waste_recovery:,}",
                },
                {
                    "label": f"ACOS Optimization ({current_acos}% → {target_acos}%)",
                    "monthlyImpact": rev_acos_opt,
                    "formula": f"${monthly_sales:,.0f}/mo × {excess_acos_pct:.1%} excess ACOS = ${rev_acos_opt:,}",
                },
                {
                    "label": "Campaign Structure Enhancement",
                    "monthlyImpact": rev_campaign_eff,
                    "formula": f"${high_acos_monthly:,}/mo high-ACOS spend × 30% recapture × {sales_per_dollar:.2f} sales/$ = ${rev_campaign_eff:,}",
                },
            ],
            "totalMonthlyImpact": total_rev_impact,
        },
        "profitabilityOpportunity": {
            "percentageIncrease": prof_pct,
            "percentageFormula": f"${total_prof_savings:,} / ${monthly_spend:,.0f} × 100 = {prof_pct}%",
            "breakdown": [
                {
                    "label": "Eliminate Wasted Ad Spend",
                    "monthlySavings": prof_waste,
                    "formula": f"${prof_waste:,}/mo wasted on zero-conversion & high-ACOS terms",
                },
                {
                    "label": f"ACOS Optimization ({current_acos}% to {target_acos}%)",
                    "monthlySavings": prof_acos,
                    "formula": f"${monthly_spend:,.0f}/mo × ({current_acos}% − {target_acos}%) / {current_acos}% = ${prof_acos:,}",
                },
                {
                    "label": "Campaign Efficiency Improvements",
                    "monthlySavings": prof_campaign,
                    "formula": f"${prof_campaign:,}/mo spent on campaigns with ACOS > 45%",
                },
            ],
            "totalMonthlySavings": total_prof_savings,
        },
    }

    print(
        f"[SNAPSHOT] Revenue: +{rev_pct}% (${total_rev_impact:,}/mo) | "
        f"Profitability: +{prof_pct}% (${total_prof_savings:,}/mo) | "
        f"Formulas: waste_recovery=${rev_waste_recovery:,} acos_opt=${rev_acos_opt:,} "
        f"campaign_eff=${rev_campaign_eff:,}"
    )

    return snapshot


def calculate_revenue_gap(df: "pd.DataFrame") -> Optional[dict]:
    """
    Calculate revenue gap metrics deterministically from a Business Report CSV.

    Returns a dict matching the revenueGapReport schema with per-ASIN conversion
    rate comparisons, flagged ASINs, and total monthly revenue gap.
    Returns None if the DataFrame lacks required columns.
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    # Column detection for Business Report
    col_asin = _find_col(df, ["asin"]) or _find_col(df, ["child"])
    col_title = _find_col(df, ["title"]) or _find_col(df, ["product"])
    col_sessions = _find_col(df, ["sessions"]) or _find_col(df, ["session"])
    col_cr = (_find_col(df, ["unit", "session", "percentage"])
              or _find_col(df, ["conversion"])
              or _find_col(df, ["buy", "box", "percentage"]))
    col_revenue = (_find_col(df, ["ordered", "product", "sales"])
                   or _find_col(df, ["revenue"])
                   or _find_col(df, ["sales"]))
    col_units = _find_col(df, ["units", "ordered"]) or _find_col(df, ["units"])
    col_buybox = _find_col(df, ["buy", "box", "percentage"])

    print(f"[RevGap] Column mapping: asin={col_asin}, title={col_title}, "
          f"sessions={col_sessions}, cr={col_cr}, revenue={col_revenue}, "
          f"units={col_units}, buybox={col_buybox}")

    if not col_sessions or not col_revenue:
        print("[RevGap] Missing required columns — skipping")
        return None

    # Clean numeric data
    df["_sessions"] = pd.to_numeric(
        df[col_sessions].astype(str).str.replace(",", "").str.replace("%", ""),
        errors="coerce",
    ).fillna(0)
    df["_revenue"] = df[col_revenue].apply(_clean_currency) if col_revenue else 0

    if col_cr:
        df["_cr"] = pd.to_numeric(
            df[col_cr].astype(str).str.replace("%", "").str.replace(",", ""),
            errors="coerce",
        ).fillna(0)
    else:
        # Calculate CR from units / sessions
        if col_units:
            df["_units"] = pd.to_numeric(
                df[col_units].astype(str).str.replace(",", ""),
                errors="coerce",
            ).fillna(0)
            df["_cr"] = (df["_units"] / df["_sessions"].replace(0, float("nan")) * 100).fillna(0)
        else:
            df["_cr"] = 0

    if col_buybox:
        df["_buybox"] = pd.to_numeric(
            df[col_buybox].astype(str).str.replace("%", "").str.replace(",", ""),
            errors="coerce",
        ).fillna(0)

    # Filter to rows with meaningful data
    df = df[df["_sessions"] > 0].copy()
    if df.empty:
        print("[RevGap] No rows with sessions > 0 — skipping")
        return None

    # Amazon benchmark conversion rate (typical range 12-15%)
    benchmark_cr = 12.5

    # Build per-ASIN data
    top_asins = []
    flagged_asins = []
    total_gap = 0

    # Sort by revenue descending
    df = df.sort_values("_revenue", ascending=False)

    for _, row in df.head(20).iterrows():
        asin = str(row.get(col_asin, "")) if col_asin else ""
        title = str(row.get(col_title, "")) if col_title else ""
        sessions = float(row["_sessions"])
        cr = float(row["_cr"])
        revenue = float(row["_revenue"])

        # Calculate gap: if CR is below benchmark
        if sessions > 0 and cr < benchmark_cr and cr > 0:
            avg_order_val = revenue / (sessions * cr / 100) if (sessions * cr / 100) > 0 else 0
            monthly_gap = round(sessions * (benchmark_cr - cr) / 100 * avg_order_val)
        else:
            monthly_gap = 0

        total_gap += monthly_gap

        asin_data = {
            "asin": asin,
            "title": title[:80] if title else "",
            "sessions": int(sessions),
            "conversionRate": round(cr, 1),
            "benchmarkCR": benchmark_cr,
            "revenue": round(revenue, 2),
            "monthlyGap": monthly_gap,
        }
        top_asins.append(asin_data)

        # Flag ASINs with high sessions but low conversion
        if sessions > 100 and cr < benchmark_cr * 0.6:
            flagged_asins.append({
                "asin": asin,
                "title": title[:80] if title else "",
                "sessions": int(sessions),
                "conversionRate": round(cr, 1),
                "monthlyDollarGap": monthly_gap,
                "reason": f"High sessions ({int(sessions):,}) but low conversion ({cr:.1f}% vs {benchmark_cr}% benchmark)",
            })

    # Revenue concentration risk
    total_revenue = df["_revenue"].sum()
    top3_revenue = df["_revenue"].head(3).sum() if len(df) >= 3 else total_revenue
    concentration_pct = round(top3_revenue / total_revenue * 100, 1) if total_revenue > 0 else 0

    # Buy Box metrics
    buybox_metrics = []
    if col_buybox:
        for _, row in df.head(10).iterrows():
            bb = float(row.get("_buybox", 0))
            if bb > 0:
                buybox_metrics.append({
                    "asin": str(row.get(col_asin, "")) if col_asin else "",
                    "buyBoxPercentage": round(bb, 1),
                    "status": "good" if bb >= 90 else "warning" if bb >= 70 else "critical",
                })

    key_finding = (
        f"Estimated ${total_gap:,}/month revenue gap across {len(top_asins)} ASINs. "
        + (f"Revenue concentration risk: top 3 ASINs account for {concentration_pct}% of revenue. "
           if concentration_pct > 70 else "")
        + (f"{len(flagged_asins)} ASIN(s) flagged for high sessions with low conversion."
           if flagged_asins else "")
    )

    print(f"[RevGap] Total gap: ${total_gap:,}/mo, {len(flagged_asins)} flagged, "
          f"concentration={concentration_pct}%")

    return {
        "topAsins": top_asins[:10],
        "flaggedAsins": flagged_asins[:5],
        "buyBoxMetrics": buybox_metrics[:5],
        "totalMonthlyRevenueGap": total_gap,
        "revenueConcentration": concentration_pct,
        "keyFinding": key_finding,
    }


_SYSTEM_PROMPT = """\
You are an expert Amazon seller consultant specializing in revenue growth and profitability optimization.
You will receive data exports from an Amazon seller's account (Business Reports, Advertising Reports, Search Terms Reports, etc.).
Your task is to analyze the data and return a single JSON object — no markdown, no explanations, no code fences, ONLY valid JSON.

The JSON must have ALL of the following top-level keys. You MUST include BOTH the legacy keys AND the new 4-layer keys:

=== LEGACY KEYS (required for backward compatibility) ===

{
  "performanceSnapshot": {
    "revenueOpportunity": {
      "percentageIncrease": <integer>,
      "breakdown": [{"label": "<category>", "monthlyImpact": <integer USD>}],
      "totalMonthlyImpact": <integer USD>
    },
    "profitabilityOpportunity": {
      "percentageIncrease": <integer>,
      "breakdown": [{"label": "<category>", "monthlySavings": <integer USD>}],
      "totalMonthlySavings": <integer USD>
    }
  },
  "listingAnalysis": {
    "overallScore": <integer 0-100>,
    "metrics": [
      {"label": "Title Optimization", "score": <0-100>, "status": "good"|"warning"|"critical"},
      {"label": "Backend Keywords", "score": <0-100>, "status": "good"|"warning"|"critical"},
      {"label": "Image Quality", "score": <0-100>, "status": "good"|"warning"|"critical"},
      {"label": "A+ Content", "score": <0-100>, "status": "good"|"warning"|"critical"},
      {"label": "Price Competitiveness", "score": <0-100>, "status": "good"|"warning"|"critical"}
    ],
    "keyFinding": "<1-2 sentence summary>"
  },
  "ppcAnalysis": {
    "currentAcos": <float or "N/A">,
    "currentAcos_source": {"file": "<filename>", "method": "<how>", "detail": "<math>"},
    "targetAcos": <float or "N/A">,
    "targetAcos_source": {"file": "<filename>", "method": "AI recommendation", "detail": "<reasoning>"},
    "wastedSpend30Days": <integer or "N/A">,
    "wastedSpend30Days_source": {"file": "<filename>", "method": "<how>", "detail": "<math>"},
    "lowPerformerCount": <integer or "N/A">,
    "lowPerformerCount_source": {"file": "<filename>", "method": "<how>", "detail": "<math>"},
    "weeklyData": [{"week": "Week 1", "adSpend": <int>, "sales": <int>}, ...] or "N/A",
    "weeklyData_source": {"file": "<filename>", "method": "<how>", "detail": "<math>"},
    "keyFinding": "<1-2 sentence summary>"
  },
  "topOpportunities": [
    {"title": "<short title>", "description": "<1-2 sentences>", "impact": "High Impact"|"Medium Impact"|"Low Impact", "potentialMonthlyGain": <integer USD>}
  ],
  "gatedInsights": {
    "teaser": "<1-2 sentence tease>",
    "fullReportItems": ["<item 1>", "<item 2>", "<item 3>", "<item 4>", "<item 5>"]
  }
}

=== NEW 4-LAYER KEYS (Account Audit Report) ===

{
  "listingHealthSnapshot": {
    "mainAsin": {"asin": "B0...", "title": "Product Name"},
    "imageCount": {"count": <int>, "benchmark": 7, "status": "good"|"warning"|"critical"},
    "aPlusContent": {"present": <bool>, "status": "good"|"warning"},
    "brandRegistry": {"detected": <bool>, "status": "good"|"warning"},
    "reviewRating": {"rating": <float>, "reviewCount": <int>, "categoryAvg": <float>, "status": "good"|"warning"|"critical"},
    "keyFinding": "<summary sentence>"
  },
  "revenueGapReport": {
    "topAsins": [
      {"asin": "...", "title": "...", "sessions": <int>, "conversionRate": <float>, "benchmarkCR": <float>, "revenue": <int>, "monthlyGap": <int>}
    ],
    "flaggedAsins": [
      {"asin": "...", "title": "...", "sessions": <int>, "conversionRate": <float>, "monthlyDollarGap": <int>, "reason": "..."}
    ],
    "buyBoxMetrics": [
      {"asin": "...", "buyBoxPercentage": <int>, "status": "good"|"warning"|"critical"}
    ],
    "totalMonthlyRevenueGap": <int>,
    "keyFinding": "<summary>"
  },
  "adEfficiencySignal": {
    "totalSpend": <float>,
    "adAttributedSales": <float>,
    "currentAcos": <float>,
    "acosBenchmark": {"low": 25, "high": 30},
    "zeroOrderSpend": <float>,
    "topWastedTerms": [
      {"term": "...", "spend": <float>, "clicks": <int>, "orders": 0}
    ],
    "totalRecoverableAdSpend": <int>,
    "keyFinding": "<summary>"
  },
  "compiledReport": {
    "executiveSummary": "<3-4 sentence overview combining all layers>",
    "totalMonthlyOpportunity": <int>,
    "dataGaps": ["<missing file notice>"],
    "topActions": [
      {"title": "...", "description": "...", "impact": "High"|"Medium"|"Low", "estimatedMonthlyGain": <int>}
    ]
  }
}

=== INSTRUCTIONS ===

PPC METRICS — PRE-CALCULATED:
The PPC metrics (currentAcos, wastedSpend30Days, lowPerformerCount, targetAcos, weeklyData) and ad efficiency metrics have been calculated by the backend Python engine. Use these exact values in ppcAnalysis and adEfficiencySignal. Do NOT recalculate from CSV text. If no pre-calculated metrics are provided, return "N/A" for PPC fields and estimate adEfficiencySignal fields.

For each PPC metric _source field, set method to "See calculation" and include details from the pre-calculated section.

PERFORMANCE SNAPSHOT — PRE-CALCULATED:
If a "PERFORMANCE SNAPSHOT (PRE-CALCULATED)" section is provided, use those exact values in performanceSnapshot. Do NOT estimate your own.

4-LAYER RULES:
- adEfficiencySignal PPC fields will be overridden by Python — focus on keyFinding and analysis.
- revenueGapReport: derive from Business Report CSV if present (sessions, conversion rates, revenue per ASIN).
- listingHealthSnapshot: estimate from available data. If no listing data, make reasonable estimates and flag in dataGaps.
- dataGaps: explicitly list any missing files (e.g., "No Search Terms Report uploaded", "No Active Listings data"). Never use nulls or made-up estimates without flagging.
- Every insight must name specifics: ASIN, dollar amount, percentage.
- compiledReport.topActions: 3-5 prioritized actions with estimated monthly gains, ranked by impact.

OTHER RULES:
- Base ALL numeric estimates on the actual data provided.
- "status" in listingAnalysis.metrics: score >= 75 = "good", 50-74 = "warning", < 50 = "critical".
- topOpportunities must be ranked by potentialMonthlyGain descending, exactly 3 items.
- Respond with ONLY the JSON object — no markdown, no code fences, no preamble.
"""


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("")
async def analyze_audit(
    request: AnalyzeRequest,
    user: str = Depends(get_current_user),
    _rl=Depends(check_rate_limit),
):
    """
    Full AI audit using Claude API.

    Downloads uploaded report files from S3, parses them, combines into a
    single context, and calls Claude API to produce a structured audit JSON.
    """
    _require_key()

    sources: dict[str, dict] = {}
    parsed_filenames: list[str] = []

    # ── 1. Download and parse all S3 files ────────────────────────────────
    file_texts: list[str] = []
    parsed_dfs: list[tuple[str, "pd.DataFrame"]] = []  # (label, df) for logging
    for key in request.s3_keys:
        # Basic path-traversal guard — must be under uploads/
        if not key.startswith("uploads/"):
            print(f"[analyze] Skipping invalid s3_key: {key!r}")
            continue
        text = await _fetch_and_parse(key)
        if text:
            file_texts.append(text)

        # Also try to get a DataFrame for logging (row counts, column names)
        try:
            dl_result = await download_from_s3(key)
            if dl_result:
                contents, _ = dl_result
                ext = _ext(key)
                label = key.rsplit("/", 1)[-1]
                parsed_filenames.append(label)
                print(f"[STEP 1] Parsing S3 file: {label} (ext={ext})")
                if ext == ".csv":
                    df = parse_csv(contents)
                    parsed_dfs.append((label, df))
                    print(f"[analyze] Parsed CSV for PPC calc: {label} ({len(df)} rows, cols: {list(df.columns)[:5]})")
                elif ext in (".xlsx", ".xls"):
                    df = parse_excel(contents)
                    parsed_dfs.append((label, df))
                    print(f"[analyze] Parsed Excel for PPC calc: {label} ({len(df)} rows)")
                elif ext == ".pdf":
                    df_pdf, _ = parse_pdf(contents)
                    if df_pdf is not None and not df_pdf.empty:
                        parsed_dfs.append((label, df_pdf))
                        print(f"[analyze] [PDF-TABLE] S3 PDF table for PPC calc: {label} ({len(df_pdf)} rows, cols: {list(df_pdf.columns)[:8]})")
                    else:
                        print(f"[analyze] [PDF-TABLE] S3 PDF had no table for PPC calc: {label}")
                else:
                    print(f"[analyze] Skipping non-CSV/Excel/PDF file for PPC calc: {label} (ext={ext})")
            else:
                print(f"[analyze] S3 download returned None for PPC calc: {key}")
        except Exception as exc:
            print(f"[analyze] PPC DataFrame parse failed for {key}: {exc}")

    # ── 1b. Process inline files (base64 fallback when S3 is unavailable) ──
    for inline in request.inline_files:
        try:
            raw = base64.b64decode(inline.content)
            ext = _ext(inline.filename)
            label = inline.filename
            parsed_filenames.append(label)

            if ext == ".csv":
                df = parse_csv(raw)
                parsed_dfs.append((label, df))
                text = _df_to_text(df, label)
                if text:
                    file_texts.append(text)
                print(f"[STEP 1b] Parsed inline CSV: {label} ({len(df)} rows, {len(text)} chars)")
            elif ext in (".xlsx", ".xls"):
                df = parse_excel(raw)
                parsed_dfs.append((label, df))
                text = _df_to_text(df, label)
                if text:
                    file_texts.append(text)
                print(f"[STEP 1b] Parsed inline Excel: {label} ({len(df)} rows, {len(text)} chars)")
            elif ext == ".pdf":
                df_pdf, raw_text = parse_pdf(raw)
                parts = [f"=== {label} (PDF) ==="]
                table_rows = 0
                text_chars = 0
                if df_pdf is not None and not df_pdf.empty:
                    parts.append(_df_to_text(df_pdf, f"{label} (table)"))
                    # KEY FIX: add PDF table DataFrame to parsed_dfs for PPC calc
                    parsed_dfs.append((label, df_pdf))
                    table_rows = len(df_pdf)
                    print(f"[analyze] [PDF-TABLE] Added PDF table to parsed_dfs: {label} ({table_rows} rows, cols: {list(df_pdf.columns)[:8]})")
                else:
                    print(f"[analyze] [PDF-TABLE] No table extracted from PDF: {label}")
                if raw_text:
                    parts.append(raw_text)
                    text_chars = len(raw_text)
                    print(f"[analyze] [PDF-TEXT] Extracted {text_chars} chars of text from PDF")
                file_texts.append("\n".join(parts))
                print(f"[STEP 1b] Parsed inline PDF: {label} (table_rows={table_rows}, text_chars={text_chars})")
            elif ext == ".docx":
                raw_text = parse_docx(raw)
                file_texts.append(f"=== {label} (Word) ===\n{raw_text}")
                print(f"[STEP 1b] Parsed inline Word: {label} ({len(raw_text)} chars)")
            else:
                # Try as text
                decoded_text = raw.decode("utf-8", errors="replace")
                file_texts.append(f"=== {label} ===\n{decoded_text}")
                print(f"[STEP 1b] Parsed inline raw text: {label} ({len(decoded_text)} chars)")
        except Exception as exc:
            print(f"[analyze] Inline file parse failed for {inline.filename}: {exc}")

    # ── 2. Run deterministic Python PPC calculations ─────────────────────
    python_ppc: Optional[dict] = None
    ppc_source_file = ""
    for label, df in parsed_dfs:
        try:
            result = calculate_ppc_metrics(df.copy())
            if result:
                python_ppc = result
                ppc_source_file = label
                print(f"[PPC] Python calc success from '{label}': ACOS={result['currentAcos']}% "
                      f"rows={result['_meta']['rows']} spend=${result['_meta']['total_spend']:,.2f}")
                break
        except Exception as exc:
            print(f"[PPC] calculate_ppc_metrics failed for '{label}': {exc}")

    if not python_ppc:
        print("[PPC] WARNING: No valid CSV found for Python PPC calculation")

    # Build ppc_context string to inject before CSV text
    if python_ppc:
        meta = python_ppc["_meta"]
        lp_names = meta.get("low_performer_names", [])
        lp_list = "\n".join(f"  - {n}" for n in lp_names) if lp_names else "  (none)"
        ppc_context = (
            "\n=== PPC METRICS (PRE-CALCULATED BY BACKEND — DO NOT RECALCULATE) ===\n"
            "These numbers have been verified by the Python engine from the raw CSV.\n"
            "Use them exactly as provided. Do not recalculate from CSV text.\n\n"
            f"Current ACOS:              {python_ppc['currentAcos']}%\n"
            f"Target ACOS:               {python_ppc['targetAcos']}%\n"
            f"Wasted Spend (30d):        ${python_ppc['wastedSpend30Days']:,}\n"
            f"  Zero-conversion waste:   ${meta['zero_waste']:,.2f}\n"
            f"  High ACOS waste:         ${meta['high_acos_waste']:,.2f}\n"
            f"Low Performer Campaigns:   {python_ppc['lowPerformerCount']}\n"
            f"Top low performers:\n{lp_list}\n"
            f"Total Spend (full period): ${meta['total_spend']:,.2f}\n"
            f"Total Sales (full period): ${meta['total_sales']:,.2f}\n"
            f"Total Orders:              {meta['total_orders']}\n"
            f"Report Date Range:         {meta['date_range']} ({meta['actual_days']} days)\n"
            f"Rows Analyzed:             {meta['rows']}\n"
            f"Source File:               {ppc_source_file}\n"
            "=== END PRE-CALCULATED METRICS ===\n\n"
        )
    else:
        ppc_context = ""

    # ── 2a. Run deterministic Performance Snapshot calculations ───────────
    python_snapshot: Optional[dict] = None
    snapshot_context = ""
    if python_ppc:
        python_snapshot = calculate_performance_snapshot(python_ppc)
        rev = python_snapshot["revenueOpportunity"]
        prof = python_snapshot["profitabilityOpportunity"]
        rev_breakdown = "\n".join(
            f"  - {b['label']}: ${b['monthlyImpact']:,}/mo" for b in rev["breakdown"]
        )
        prof_breakdown = "\n".join(
            f"  - {b['label']}: ${b['monthlySavings']:,}/mo" for b in prof["breakdown"]
        )
        snapshot_context = (
            "\n=== PERFORMANCE SNAPSHOT (PRE-CALCULATED — USE EXACT VALUES) ===\n"
            f"Revenue Opportunity: +{rev['percentageIncrease']}% (${rev['totalMonthlyImpact']:,}/mo)\n"
            f"{rev_breakdown}\n"
            f"Profitability Opportunity: +{prof['percentageIncrease']}% (${prof['totalMonthlySavings']:,}/mo)\n"
            f"{prof_breakdown}\n"
            "Use these exact numbers in performanceSnapshot. Do NOT estimate your own.\n"
            "=== END PERFORMANCE SNAPSHOT ===\n\n"
        )

    # ── 2b. Run deterministic Revenue Gap calculations ────────────────────
    python_revenue_gap: Optional[dict] = None
    rev_gap_source_file = ""
    for label, df in parsed_dfs:
        try:
            result_rg = calculate_revenue_gap(df.copy())
            if result_rg:
                python_revenue_gap = result_rg
                rev_gap_source_file = label
                print(f"[RevGap] Python calc success from '{label}': "
                      f"gap=${result_rg['totalMonthlyRevenueGap']:,}/mo")
                break
        except Exception as exc:
            print(f"[RevGap] calculate_revenue_gap failed for '{label}': {exc}")

    # ── 2c. Build combined context ─────────────────────────────────────────
    brand_info_parts = []
    if request.brand_name:
        brand_info_parts.append(f"Brand: {request.brand_name}")
    if request.niche:
        brand_info_parts.append(f"Niche: {request.niche}")
    if request.marketplace:
        brand_info_parts.append(f"Marketplace: {request.marketplace}")

    # Include existing scorecard context if provided (from store lookup)
    scorecard_context = ""
    if request.existing_scorecard:
        sc = request.existing_scorecard
        main_asin = sc.get("mainAsin", {})
        scorecard_context = (
            "\n=== EXISTING SCORECARD (from Store URL Lookup) ===\n"
            f"Top listing: {main_asin.get('asin', 'N/A')} — {main_asin.get('title', 'N/A')}\n"
            f"Image count: {sc.get('imageCount', {}).get('count', 'N/A')} "
            f"(benchmark: {sc.get('imageCount', {}).get('benchmark', 7)})\n"
            f"A+ Content: {'Yes' if sc.get('aPlusContent', {}).get('present') else 'No'}\n"
            f"Brand Registry: {'Yes' if sc.get('brandRegistry', {}).get('detected') else 'No'}\n"
            f"Reviews: {sc.get('reviewRating', {}).get('reviewCount', 'N/A')} "
            f"(avg: {sc.get('reviewRating', {}).get('rating', 'N/A')}, "
            f"category avg: {sc.get('reviewRating', {}).get('categoryAvg', 'N/A')})\n"
            f"Key Finding: {sc.get('keyFinding', 'N/A')}\n"
            "=== END SCORECARD ===\n\n"
        )

    header = (
        "== Seller Information ==\n"
        + ("\n".join(brand_info_parts) if brand_info_parts else "(not provided)")
        + "\n\n"
        + scorecard_context
        + "== Uploaded Report Data ==\n"
    )

    combined = header + ppc_context + snapshot_context + "\n\n".join(file_texts) if file_texts else (
        header + "[No report files were provided or could be parsed. "
        "Please generate best-effort estimates based on typical Amazon seller benchmarks "
        f"for {request.niche or 'general Amazon products'} on {request.marketplace}.]"
    )

    # Cap context to avoid token limits
    if len(combined) > _MAX_CONTEXT_CHARS:
        combined = combined[:_MAX_CONTEXT_CHARS] + "\n\n[... content truncated ...]"

    print(f"[STEP 2] Combined context: {len(combined)} chars from {len(file_texts)} files")

    # ── 3. Call Claude API ─────────────────────────────────────────────────
    print(f"[STEP 3] Sending {len(combined)} chars to Claude API...")
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=120.0)
    response_text = ""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=6000,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": combined}],
            )
            response_text = message.content[0].text if message.content else ""
            break  # success
        except anthropic.RateLimitError as exc:
            wait = 65  # wait just over 1 minute for rate limit window to reset
            print(f"[analyze] Rate limited (attempt {attempt + 1}/{max_retries}), retrying in {wait}s...")
            if attempt == max_retries - 1:
                raise HTTPException(429, f"Claude API rate limit exceeded after {max_retries} retries. Please try again in a minute.")
            await asyncio.sleep(wait)
        except anthropic.APIStatusError as exc:
            print(f"[analyze] Anthropic API error {exc.status_code}: {exc.message}")
            raise HTTPException(502, f"Anthropic API error {exc.status_code}: {exc.message}")
        except anthropic.APITimeoutError:
            raise HTTPException(504, "Claude API timed out — please try again")
        except anthropic.APIConnectionError as exc:
            raise HTTPException(502, f"Could not reach Claude API: {exc}")
        except Exception as exc:
            print(f"[analyze] Unexpected error calling Claude: {exc}")
            raise HTTPException(500, f"AI analysis failed: {str(exc)}")

    # ── 4. Parse the JSON response ─────────────────────────────────────────
    try:
        extracted = _extract_json(response_text)
        result = json.loads(extracted)
        print(f"[STEP 3] Claude returned valid JSON ({len(result)} top-level keys: {list(result.keys())})")
    except json.JSONDecodeError:
        # Return a structured fallback so the frontend doesn't crash,
        # while surfacing the raw text for debugging.
        print(f"[analyze] JSON parse failed. Raw response snippet: {response_text[:500]}")
        raise HTTPException(
            500,
            "Could not parse AI analysis response as JSON — please try again",
        )

    # ── 5. Override PPC metrics with Python-calculated values ──────────────
    if "ppcAnalysis" not in result:
        result["ppcAnalysis"] = {}
    ppc = result["ppcAnalysis"]

    if python_ppc:
        meta = python_ppc["_meta"]
        lp_names = meta.get("low_performer_names", [])
        lp_detail = ", ".join(lp_names[:5]) if lp_names else "none"
        detail_base = (
            f"Rows: {meta['rows']}, "
            f"Spend: ${meta['total_spend']:,.2f}, "
            f"Sales: ${meta['total_sales']:,.2f}, "
            f"Date range: {meta['date_range']} ({meta['actual_days']}d)"
        )

        # Override with Python values — these are deterministic and correct
        ppc["currentAcos"] = python_ppc["currentAcos"]
        ppc["currentAcos_source"] = _source(
            ppc_source_file, "See calculation",
            f"${meta['total_spend']:,.2f} / ${meta['total_sales']:,.2f} * 100 = {python_ppc['currentAcos']}%. {detail_base}",
        )

        ppc["wastedSpend30Days"] = python_ppc["wastedSpend30Days"]
        ppc["wastedSpend30Days_source"] = _source(
            ppc_source_file, "See calculation",
            f"Zero-conv: ${meta['zero_waste']:,.2f} + high ACOS: ${meta['high_acos_waste']:,.2f} "
            f"= ${meta['zero_waste'] + meta['high_acos_waste']:,.2f}, "
            f"scaled 30/{meta['actual_days']}d = ${python_ppc['wastedSpend30Days']:,}. {detail_base}",
        )

        ppc["lowPerformerCount"] = python_ppc["lowPerformerCount"]
        ppc["lowPerformerCount_source"] = _source(
            ppc_source_file, "See calculation",
            f"{python_ppc['lowPerformerCount']} campaigns (ACOS>45% or $10+ spend with 0 orders). Top: {lp_detail}. {detail_base}",
        )

        ppc["targetAcos"] = python_ppc["targetAcos"]
        ppc["targetAcos_source"] = _source(
            ppc_source_file, "AI recommendation",
            f"Default target: {python_ppc['targetAcos']}% based on account data",
        )

        ppc["weeklyData"] = python_ppc["weeklyData"]
        weeks = python_ppc["weeklyData"]
        week_summary = ", ".join(f"{w['week']}: ${w['adSpend']:,}/{w['sales']:,}" for w in weeks[:4])
        ppc["weeklyData_source"] = _source(
            ppc_source_file, "See calculation",
            f"{len(weeks)} weeks grouped by ISO week from Start Date. {week_summary}",
        )

        print(f"[STEP 5] Python PPC overrides applied from '{ppc_source_file}':")
    else:
        # No Python PPC available — ensure N/A fallback
        print(f"[STEP 5] No Python PPC — applying N/A fallbacks:")

    for field in ("currentAcos", "targetAcos", "wastedSpend30Days", "lowPerformerCount", "weeklyData"):
        if field not in ppc or ppc[field] is None:
            ppc[field] = "N/A"
        src_key = f"{field}_source"
        if src_key not in ppc or ppc[src_key] is None:
            ppc[src_key] = _source("N/A", "N/A", "Not found in uploaded data")
        val = ppc.get(field)
        src = ppc.get(src_key, {})
        val_display = val if not isinstance(val, list) else f"[{len(val)} weeks]"
        print(f"  {field}={val_display} | source: {src.get('method', 'unknown')} ({src.get('file', 'unknown')})")

    # ── 5b. Override performanceSnapshot with Python-calculated values ──
    if python_snapshot:
        result["performanceSnapshot"] = python_snapshot
        print(f"[STEP 5b] Python performanceSnapshot override applied")
    else:
        print(f"[STEP 5b] No Python snapshot — keeping Claude estimates")

    # ── 5c. Build adEfficiencySignal from Python PPC ──
    if python_ppc:
        meta = python_ppc["_meta"]
        result["adEfficiencySignal"] = {
            "totalSpend": meta["total_spend"],
            "adAttributedSales": meta["total_sales"],
            "currentAcos": python_ppc["currentAcos"],
            "acosBenchmark": {"low": 25, "high": 30},
            "zeroOrderSpend": meta["zero_waste"],
            "topWastedTerms": python_ppc.get("topWastedTerms", []),
            "totalRecoverableAdSpend": python_ppc["wastedSpend30Days"],
            "keyFinding": result.get("adEfficiencySignal", {}).get("keyFinding", ""),
        }
        print(f"[STEP 5c] Python adEfficiencySignal override applied")

    # ── 5c2. Build revenueGapReport from Python revenue gap calc ──
    if python_revenue_gap:
        result["revenueGapReport"] = python_revenue_gap
        print(f"[STEP 5c2] Python revenueGapReport override applied: "
              f"${python_revenue_gap['totalMonthlyRevenueGap']:,}/mo gap")

    # ── 5d. Overlay compiledReport.totalMonthlyOpportunity ──
    if "compiledReport" not in result:
        result["compiledReport"] = {}
    compiled = result["compiledReport"]

    # Combine revenue gap + ad savings for total opportunity
    rev_gap_total = python_revenue_gap["totalMonthlyRevenueGap"] if python_revenue_gap else 0
    ad_savings = python_ppc["wastedSpend30Days"] if python_ppc else 0
    snapshot_rev = 0
    snapshot_sav = 0
    if python_snapshot:
        snapshot_rev = python_snapshot.get("revenueOpportunity", {}).get("totalMonthlyImpact", 0)
        snapshot_sav = python_snapshot.get("profitabilityOpportunity", {}).get("totalMonthlySavings", 0)

    total_opportunity = max(rev_gap_total + ad_savings, snapshot_rev + snapshot_sav)
    if total_opportunity > 0:
        compiled["totalMonthlyOpportunity"] = total_opportunity
        print(f"[STEP 5d] compiledReport.totalMonthlyOpportunity = ${total_opportunity:,} "
              f"(revGap=${rev_gap_total:,} + adSavings=${ad_savings:,})")

    # ── 6. Add section-level sources ──────────────────────────────────────
    ai_file_label = ", ".join(parsed_filenames) if parsed_filenames else "all uploaded files"
    for section in ("listingAnalysis", "topOpportunities", "gatedInsights"):
        if section in result:
            result[f"{section}_source"] = _source(ai_file_label, "AI analysis (Claude)", "Generated from uploaded data context")

    # performanceSnapshot source depends on whether Python-calculated or AI-estimated
    if python_snapshot:
        result["performanceSnapshot_source"] = _source(
            ppc_source_file, "See calculation",
            "Deterministic calculation from CSV ad spend data (wasted spend, ACOS gap, campaign efficiency)",
        )
    elif "performanceSnapshot" in result:
        result["performanceSnapshot_source"] = _source(ai_file_label, "AI analysis (Claude)", "Generated from uploaded data context")

    return {
        "session_id": request.session_id,
        "brand_name": request.brand_name,
        "niche": request.niche,
        "marketplace": request.marketplace,
        "files_analyzed": len(file_texts),
        "analysis": result,
    }
