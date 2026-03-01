"""
CSV Parser - Pandas-based parsing for Amazon report types
Week 1: AUD-1 - Business Reports, Active Listings, Account Health, Ads, FBA Inventory
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
