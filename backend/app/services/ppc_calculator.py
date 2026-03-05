"""
Deterministic PPC metrics calculator.
Reads CSV content string, returns exact metrics calculated from data.
"""
import pandas as pd
from io import StringIO


def calculate_ppc_metrics(csv_content: str, period_days: int = 65) -> dict:
    """
    Calculate PPC metrics from Search Term Report CSV content.

    Returns dict with:
      - currentAcos: float (1 decimal)
      - wastedSpend30Days: int (raw sum of spend where orders=0, NOT scaled)
      - lowPerformerCount: int (unique campaigns with ACOS>45% or clicks>5 & orders=0)
      - weeklyData: list of 4 weeks with adSpend and sales (total/4)
      - totalSpend: float
      - totalSales: float
    """
    df = pd.read_csv(StringIO(csv_content))

    # Find column names
    spend_col = "Spend"
    orders_col = next(c for c in df.columns if "7 Day Total Orders" in c)
    sales_col = next(c for c in df.columns if "7 Day Total Sales" in c)
    clicks_col = "Clicks"
    campaign_col = "Campaign Name"

    # Coerce numeric
    for col in [spend_col, orders_col, sales_col, clicks_col]:
        df[col] = pd.to_numeric(
            df[col].astype(str).str.replace(r"[$,%]", "", regex=True),
            errors="coerce"
        ).fillna(0)

    total_spend = df[spend_col].sum()
    total_sales = df[sales_col].sum()

    # Current ACOS
    current_acos = round(total_spend / total_sales * 100, 1) if total_sales > 0 else 0

    # Wasted spend: sum of Spend where orders = 0 (raw, not scaled)
    wasted_spend = round(df.loc[df[orders_col] == 0, spend_col].sum())

    # Low performers: aggregate by campaign first
    camp_agg = df.groupby(campaign_col).agg(
        total_spend=(spend_col, "sum"),
        total_sales=(sales_col, "sum"),
        total_orders=(orders_col, "sum"),
        total_clicks=(clicks_col, "sum"),
    ).reset_index()

    low_perf = set()
    # (a) Campaign ACOS > 45%
    high_acos = camp_agg[
        (camp_agg["total_spend"] > 0) & (
            (camp_agg["total_sales"] == 0) |
            (camp_agg["total_spend"] / camp_agg["total_sales"] * 100 > 45)
        )
    ]
    low_perf.update(high_acos[campaign_col].tolist())

    # (b) Campaign clicks > 5 AND orders = 0
    high_click_zero = camp_agg[
        (camp_agg["total_clicks"] > 5) & (camp_agg["total_orders"] == 0)
    ]
    low_perf.update(high_click_zero[campaign_col].tolist())

    # Weekly data: total / 4
    weekly_spend = round(total_spend / 4)
    weekly_sales = round(total_sales / 4)
    weekly_data = [
        {"week": f"Week {i}", "adSpend": weekly_spend, "sales": weekly_sales}
        for i in range(1, 5)
    ]

    return {
        "currentAcos": current_acos,
        "wastedSpend30Days": wasted_spend,
        "lowPerformerCount": len(low_perf),
        "weeklyData": weekly_data,
        "weeklyAdSpend": weekly_spend,
        "weeklySales": weekly_sales,
        "totalSpend": round(total_spend, 2),
        "totalSales": round(total_sales, 2),
    }
