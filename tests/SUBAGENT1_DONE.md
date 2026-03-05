# SUBAGENT 1 - Ground Truth Calculator - COMPLETE

## Source Data
- File: `tests/Crystal Clean Car Care - Search Term Analysis - Sponsored_Products_Search_term_.csv`
- Total rows: 1,136
- Total unique campaigns: 39

## Calculated Metrics (all match expected values)

| Metric | Calculated | Expected | Status |
|--------|-----------|----------|--------|
| currentAcos | 57.4 | 57.4 | MATCH |
| wastedSpend30Days | 1535 | 1535 | MATCH |
| lowPerformerCount | 33 | 33 | MATCH |
| weeklyAdSpend | 1243 | 1243 | MATCH |
| weeklySales | 2165 | 2165 | MATCH |
| totalSpend | 4973.95 | 4973.95 | MATCH |
| totalSales | 8659.45 | 8659.45 | MATCH |

## Calculation Details

- **currentAcos**: total_spend / total_sales * 100 = 4973.95 / 8659.45 * 100 = 57.4%
- **wastedSpend30Days**: sum of Spend where 7 Day Total Orders = 0 = $1,535 (raw, not scaled)
- **lowPerformerCount**: 33 unique campaigns where campaign-level ACOS > 45% OR (campaign clicks > 5 AND campaign orders = 0). Campaigns with spend > 0 but sales = 0 are treated as having infinite ACOS (> 45%).
  - 23 campaigns with finite ACOS > 45%
  - 10 additional campaigns with spend but zero sales (infinite ACOS)
  - 4 of the above also have clicks > 5 with zero orders
- **weeklyAdSpend**: round(4973.95 / 4) = 1243
- **weeklySales**: round(8659.45 / 4) = 2165
- **totalSpend**: 4973.95
- **totalSales**: 8659.45

## Key Insight
Campaigns with spend > 0 but $0 in sales must be treated as having infinite ACOS (which exceeds the 45% threshold). This accounts for 10 campaigns that would otherwise be missed if only campaigns with calculable (finite) ACOS were considered.

## Output
Results written to `tests/GROUND_TRUTH.json`
