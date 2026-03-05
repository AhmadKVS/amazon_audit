# Test Results

**Date:** 2026-03-04
**Platform:** Windows 11, Python 3.12.10, pytest 9.0.2
**Result:** 21 passed, 0 failed, 2 warnings

## Full Output

```
============================= test session starts =============================
platform win32 -- Python 3.12.10, pytest-9.0.2, pluggy-1.6.0

tests/test_analyze_integration.py::TestAnalyzeOverrides::test_overrides_return_correct_acos PASSED [  4%]
tests/test_analyze_integration.py::TestAnalyzeOverrides::test_overrides_return_correct_low_performers PASSED [  9%]
tests/test_analyze_integration.py::TestAnalyzeOverrides::test_overrides_return_correct_wasted_spend PASSED [ 14%]
tests/test_analyze_integration.py::TestAnalyzeOverrides::test_weekly_data_calculation PASSED [ 19%]
tests/test_analyze_integration.py::TestAnalyzeOverrides::test_weekly_spend_not_higher_than_monthly PASSED [ 23%]
tests/test_analyze_integration.py::TestAnalyzeOverrides::test_full_merge_overwrites_perplexity_hallucinations PASSED [ 28%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_current_acos_is_positive PASSED [ 33%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_current_acos_matches_ground_truth PASSED [ 38%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_deterministic_values_overwrite_fake_perplexity PASSED [ 42%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_low_performer_count_matches_ground_truth PASSED [ 47%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_low_performer_uses_campaign_aggregation PASSED [ 52%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_result_has_all_required_keys PASSED [ 57%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_total_sales_matches_ground_truth PASSED [ 61%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_total_spend_matches_ground_truth PASSED [ 66%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_wasted_spend_less_than_total_spend PASSED [ 71%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_wasted_spend_matches_ground_truth PASSED [ 76%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_weekly_ad_spend_matches_ground_truth PASSED [ 80%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_weekly_data_has_4_weeks PASSED [ 85%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_weekly_data_week_labels PASSED [ 90%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_weekly_sales_matches_ground_truth PASSED [ 95%]
tests/test_ppc_calculator.py::TestPPCCalculator::test_weekly_spend_less_than_weekly_sales PASSED [100%]

======================= 21 passed, 2 warnings in 1.60s ========================
```

## Test Breakdown

### Unit Tests (test_ppc_calculator.py) - 15 passed
- currentAcos matches ground truth (57.4) within 0.1 tolerance
- wastedSpend30Days matches ground truth (1535) exactly
- lowPerformerCount matches ground truth (33) exactly
- weeklyAdSpend matches ground truth (1243)
- weeklySales matches ground truth (2165)
- totalSpend matches ground truth (4973.95)
- totalSales matches ground truth (8659.45)
- weeklyData has 4 weeks with correct labels
- Weekly spend < weekly sales (profitable)
- All required keys present in result dict
- Deterministic values correctly overwrite fake Perplexity estimates

### Integration Tests (test_analyze_integration.py) - 6 passed
- _calculate_ppc_overrides returns correct ACOS (rounded to integer)
- _calculate_ppc_overrides returns correct lowPerformerCount (33)
- _calculate_ppc_overrides returns scaled wastedSpend30Days ($700 = 1535/65*30 rounded to $100)
- _calculate_weekly_data produces 4 weeks with correct spend/sales
- Weekly spend < total monthly spend
- Full merge correctly overwrites Perplexity hallucinations while preserving non-overridden fields

## Warnings (non-blocking)
1. PendingDeprecationWarning: `import python_multipart` instead of `import multipart`
2. PydanticDeprecatedSince20: class-based config deprecation
