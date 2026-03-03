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
    Returns: business_report | active_listings | account_health | ads | fba_inventory | unknown
    """
    cols_lower = " ".join(str(c).lower() for c in df.columns)

    # Business Report indicators
    if "ordered product sales" in cols_lower or "units ordered" in cols_lower:
        return "business_report"

    # Active Listings
    if "listing id" in cols_lower or "seller sku" in cols_lower or "product id" in cols_lower:
        return "active_listings"

    # Account Health
    if "order defect rate" in cols_lower or "odr" in cols_lower or "late shipment" in cols_lower:
        return "account_health"

    # Ads
    if "acos" in cols_lower or "ad group" in cols_lower or "campaign" in cols_lower:
        return "ads"

    # FBA Inventory
    if "fba" in cols_lower or "fulfillable" in cols_lower or "inbound" in cols_lower:
        return "fba_inventory"

    return "unknown"


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
