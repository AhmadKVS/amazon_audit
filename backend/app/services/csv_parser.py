"""
File Parser - Pandas-based parsing for CSV, Excel, Word, and PDF uploads.
Supports Amazon Seller Central exports (CSV/Excel) and client documents (Word/PDF).
"""
import io
import pandas as pd
from typing import Optional


def parse_csv(contents: bytes) -> pd.DataFrame:
    """Parse CSV bytes into DataFrame. Handles common Amazon report encodings."""
    try:
        df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(io.BytesIO(contents), encoding="latin-1")
    if df.empty:
        raise ValueError("CSV file is empty")
    return df


def detect_report_type(df: pd.DataFrame) -> str:
    """
    Detect Amazon report type from column names.
    Returns a human-readable report type string.
    """
    cols_lower = " ".join(str(c).lower() for c in df.columns)

    # Search Terms Report (most specific ads check — must be before generic ads)
    if ("customer search term" in cols_lower or "search term" in cols_lower) and (
        "campaign" in cols_lower or "ad group" in cols_lower
    ):
        return "Search Terms Report"

    # Query Performance Report (Brand Analytics)
    if "search query" in cols_lower or "query" in cols_lower and (
        "query volume" in cols_lower or "impressions" in cols_lower
    ):
        return "Query Performance Report"

    # Sponsored Products Campaign Report
    if "campaign name" in cols_lower and "acos" in cols_lower and "search term" not in cols_lower:
        return "Sponsored Products Report"

    # Business Report indicators
    if "ordered product sales" in cols_lower or "units ordered" in cols_lower:
        return "Business Report"

    # Active Listings
    if "listing id" in cols_lower or "seller sku" in cols_lower or "product id" in cols_lower:
        return "Active Listings Report"

    # Account Health
    if "order defect rate" in cols_lower or "odr" in cols_lower or "late shipment" in cols_lower:
        return "Account Health Report"

    # Generic Ads / Advertising report
    if "acos" in cols_lower or "ad group" in cols_lower or "campaign" in cols_lower:
        return "Advertising Report"

    # FBA Inventory
    if "fba" in cols_lower or "fulfillable" in cols_lower or "inbound" in cols_lower:
        return "FBA Inventory Report"

    return "Unknown Report"


def parse_excel(contents: bytes) -> pd.DataFrame:
    """Parse Excel (.xlsx / .xls) bytes into a DataFrame."""
    df = pd.read_excel(io.BytesIO(contents))
    if df.empty:
        raise ValueError("Excel file is empty")
    return df


def parse_docx(contents: bytes) -> str:
    """Extract all paragraph text from a Word (.docx) document."""
    from docx import Document  # python-docx
    doc = Document(io.BytesIO(contents))
    text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if not text:
        raise ValueError("Word document contains no readable text")
    return text


def parse_pdf(contents: bytes) -> tuple[Optional[pd.DataFrame], str]:
    """
    Extract tables and text from a PDF.
    Returns (dataframe_or_None, raw_text).
    If a table is found it is returned as a DataFrame; raw text is always returned.
    """
    import pdfplumber
    all_text: list[str] = []
    first_df: Optional[pd.DataFrame] = None

    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        for page in pdf.pages:
            # Try to extract tables first
            if first_df is None:
                tables = page.extract_tables()
                for table in tables:
                    if table and len(table) > 1:
                        headers = [str(h or "").strip() for h in table[0]]
                        rows = [[str(c or "").strip() for c in row] for row in table[1:]]
                        candidate = pd.DataFrame(rows, columns=headers)
                        if not candidate.empty:
                            first_df = candidate
                            break
            text = page.extract_text() or ""
            if text.strip():
                all_text.append(text)

    raw_text = "\n".join(all_text)
    if not raw_text and first_df is None:
        raise ValueError("PDF contains no extractable text or tables")
    return first_df, raw_text


# ── ASIN-level metric extraction for Business Reports ────────────────────

# Column name patterns → standardised keys (case-insensitive substring match)
_ASIN_COL_PATTERNS: dict[str, list[str]] = {
    "asin":            ["(child) asin", "child asin", "asin"],
    "parent_asin":     ["(parent) asin", "parent asin"],
    "title":           ["title", "product name"],
    "sessions":        ["sessions - total", "sessions"],
    "conversion_rate": ["unit session percentage", "session percentage", "conversion rate"],
    "units_sold":      ["units ordered", "units sold"],
    "revenue":         ["ordered product sales", "ordered revenue", "product sales"],
    "page_views":      ["page views", "pageviews"],
    "ad_spend":        ["spend", "ad spend", "total spend"],
    "acos":            ["acos", "advertising cost"],
}


def _find_column(columns: list[str], patterns: list[str]) -> Optional[str]:
    """Find the first column whose lowercased name contains any of the given patterns."""
    cols_lower = [(c, str(c).lower()) for c in columns]
    for pattern in patterns:
        for orig, low in cols_lower:
            if pattern in low:
                return str(orig)
    return None


def _parse_numeric(val: str) -> Optional[float]:
    """Parse a numeric string, stripping currency symbols, commas, and percent signs."""
    if pd.isna(val):
        return None
    cleaned = str(val).replace(",", "").replace("$", "").replace("%", "").replace("£", "").replace("€", "").strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def extract_asin_metrics(df: pd.DataFrame) -> list[dict]:
    """
    Extract per-ASIN metrics from an Amazon Business Report DataFrame.
    Returns a list of dicts with standardised keys:
      asin, title, sessions, conversion_rate, units_sold, revenue, ad_spend, acos
    """
    columns = [str(c) for c in df.columns]

    col_map: dict[str, Optional[str]] = {}
    for key, patterns in _ASIN_COL_PATTERNS.items():
        col_map[key] = _find_column(columns, patterns)

    asin_col = col_map.get("asin")
    if not asin_col:
        return []

    results: list[dict] = []
    for _, row in df.iterrows():
        asin_val = str(row.get(asin_col, "")).strip()
        if not asin_val or asin_val.lower() in ("nan", ""):
            continue

        entry: dict = {"asin": asin_val}
        entry["title"] = str(row.get(col_map.get("title", ""), "")).strip() if col_map.get("title") else ""

        for key in ("sessions", "conversion_rate", "units_sold", "revenue", "ad_spend", "acos"):
            col = col_map.get(key)
            if col and col in row.index:
                parsed = _parse_numeric(row[col])
                entry[key] = parsed if parsed is not None else 0
            else:
                entry[key] = 0

        results.append(entry)

    return results
