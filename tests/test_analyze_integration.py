"""
Integration tests for the analyze endpoint's PPC calculation logic.
Tests the deterministic override functions directly with real CSV data.
"""
import sys, os
import json
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

import pytest

# Load ground truth
TRUTH_PATH = os.path.join(os.path.dirname(__file__), 'GROUND_TRUTH.json')
FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'search_terms_sample.csv')


@pytest.fixture
def ground_truth():
    with open(TRUTH_PATH) as f:
        return json.load(f)


@pytest.fixture
def parsed_df():
    """Load the real CSV as a DataFrame, mimicking what analyze.py does."""
    df = pd.read_csv(FIXTURE_PATH)
    return [("search_terms_sample.csv", df)]


class TestAnalyzeOverrides:
    """Test _calculate_ppc_overrides from analyze.py"""

    def test_overrides_return_correct_acos(self, parsed_df, ground_truth):
        from app.api.analyze import _calculate_ppc_overrides
        overrides = _calculate_ppc_overrides(parsed_df)
        assert "currentAcos" in overrides
        assert abs(overrides["currentAcos"] - round(ground_truth["currentAcos"])) <= 1

    def test_overrides_return_correct_low_performers(self, parsed_df, ground_truth):
        from app.api.analyze import _calculate_ppc_overrides
        overrides = _calculate_ppc_overrides(parsed_df)
        assert overrides["lowPerformerCount"] == ground_truth["lowPerformerCount"], \
            f"Expected {ground_truth['lowPerformerCount']}, got {overrides['lowPerformerCount']}"

    def test_overrides_return_correct_wasted_spend(self, parsed_df, ground_truth):
        from app.api.analyze import _calculate_ppc_overrides
        overrides = _calculate_ppc_overrides(parsed_df)
        assert "wastedSpend30Days" in overrides
        # The override scales by period_days (65) to 30 days and rounds to $100
        # Ground truth wastedSpend30Days is the RAW total (1535), override is scaled: 1535/65*30 ≈ 708 → rounded to 700
        assert overrides["wastedSpend30Days"] == 700, \
            f"Expected $700 (scaled 30d), got ${overrides['wastedSpend30Days']}"

    def test_weekly_data_calculation(self, ground_truth):
        from app.api.analyze import _calculate_weekly_data
        weeks = _calculate_weekly_data(ground_truth["totalSpend"], ground_truth["totalSales"])
        assert len(weeks) == 4
        for w in weeks:
            assert w["adSpend"] == ground_truth["weeklyAdSpend"]
            assert w["sales"] == ground_truth["weeklySales"]
            assert w["adSpend"] < w["sales"], "Ad spend must be less than sales"

    def test_weekly_spend_not_higher_than_monthly(self, ground_truth):
        from app.api.analyze import _calculate_weekly_data
        weeks = _calculate_weekly_data(ground_truth["totalSpend"], ground_truth["totalSales"])
        for w in weeks:
            assert w["adSpend"] < ground_truth["totalSpend"], \
                f"Weekly ${w['adSpend']} should be less than total ${ground_truth['totalSpend']}"

    def test_full_merge_overwrites_perplexity_hallucinations(self, parsed_df, ground_truth):
        """Simulate the full Step 5 merge from analyze.py"""
        from app.api.analyze import _calculate_ppc_overrides, _calculate_weekly_data

        # Fake Perplexity response with wrong numbers
        fake_result = {
            "ppcAnalysis": {
                "currentAcos": 25,
                "wastedSpend30Days": 500,
                "lowPerformerCount": 8,
                "weeklyData": [{"week": "Week 1", "adSpend": 5000, "sales": 3000}],
                "targetAcos": 20,
                "keyFinding": "Some finding"
            }
        }

        # Apply overrides (same as analyze.py Step 5)
        overrides = _calculate_ppc_overrides(parsed_df)
        fake_result["ppcAnalysis"].update(overrides)
        fake_result["ppcAnalysis"]["weeklyData"] = _calculate_weekly_data(
            ground_truth["totalSpend"], ground_truth["totalSales"]
        )
        fake_result["ppcAnalysis"]["targetAcos"] = 30

        # Verify all hallucinated values were overwritten
        ppc = fake_result["ppcAnalysis"]
        assert ppc["lowPerformerCount"] == ground_truth["lowPerformerCount"]
        assert ppc["weeklyData"][0]["adSpend"] == ground_truth["weeklyAdSpend"]
        assert ppc["weeklyData"][0]["sales"] == ground_truth["weeklySales"]
        assert ppc["targetAcos"] == 30
        # keyFinding should survive (not overwritten)
        assert ppc["keyFinding"] == "Some finding"
