# Final Accuracy Scorecard

**Date:** 2026-03-04
**Validator:** Subagent 5 (Accuracy Scorecard Reporter)

## Scorecard Results

```
=================================================================
FIELD                    CALCULATED     EXPECTED     STATUS
=================================================================
Current ACoS                   57.4         57.4       PASS
Wasted Spend                   1535         1535       PASS
Low Performers                   33           33       PASS
Weekly Ad Spend                1243         1243       PASS
Weekly Sales                   2165         2165       PASS
=================================================================

FINAL RESULT: 100% ACCURATE - ALL 5 FIELDS CORRECT
=================================================================
```

## Accuracy Summary

| # | Field | Calculated | Expected | Tolerance | Status |
|---|-------|-----------|----------|-----------|--------|
| 1 | Current ACoS (%) | 57.4 | 57.4 | +/- 1.0 | PASS |
| 2 | Wasted Spend 30 Days ($) | 1535 | 1535 | +/- 100 | PASS |
| 3 | Low Performer Count | 33 | 33 | exact | PASS |
| 4 | Weekly Ad Spend ($) | 1243 | 1243 | +/- 50 | PASS |
| 5 | Weekly Sales ($) | 2165 | 2165 | +/- 50 | PASS |

**Result: 5/5 fields correct (100% accuracy)**

## analyze.py Verification

- **Merge step (Step 5) exists:** YES (line 493 - "Post-process: override PPC fields with deterministic calculations")
- **`_calculate_ppc_overrides` called in endpoint:** YES (line 496)
- **`_calculate_weekly_data` called in endpoint:** YES (line 516)
- **`targetAcos` set to 30:** YES (line 521 - `result["ppcAnalysis"]["targetAcos"] = 30`)

## Test Suite Results

- **Total tests:** 21 passed, 0 failed
- **Unit tests (test_ppc_calculator.py):** 15/15 passed
- **Integration tests (test_analyze_integration.py):** 6/6 passed
- **Warnings:** 2 (non-blocking deprecation notices)

## Architecture Confirmation

The deterministic PPC calculation pipeline works as follows:

1. `ppc_calculator.py` (`calculate_ppc_metrics`) reads raw CSV data and computes exact metrics from the search term report
2. `analyze.py` (`_calculate_ppc_overrides`) aggregates campaign-level data from parsed DataFrames
3. `analyze.py` (`_calculate_weekly_data`) divides total spend and sales by 4 for weekly breakdowns
4. The analyze endpoint merges these deterministic values over Perplexity AI estimates, ensuring accuracy
5. `targetAcos` is hardcoded to 30 (industry standard)
