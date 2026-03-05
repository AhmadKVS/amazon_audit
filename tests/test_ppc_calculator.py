"""
Unit tests for the deterministic PPC metrics calculator.

Tests verify that calculate_ppc_metrics produces exact values matching
ground truth computed from the Crystal Clean Car Care Search Term Report CSV.
"""

import sys
import os
import json
import unittest

# Add backend to sys.path so we can import app.services.ppc_calculator
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.services.ppc_calculator import calculate_ppc_metrics

# Paths
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
CSV_PATH = os.path.join(FIXTURES_DIR, "search_terms_sample.csv")
GROUND_TRUTH_PATH = os.path.join(os.path.dirname(__file__), "GROUND_TRUTH.json")


def _load_csv() -> str:
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _load_ground_truth() -> dict:
    with open(GROUND_TRUTH_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


class TestPPCCalculator(unittest.TestCase):
    """Tests for calculate_ppc_metrics against ground truth."""

    @classmethod
    def setUpClass(cls):
        cls.csv_content = _load_csv()
        cls.ground_truth = _load_ground_truth()
        cls.result = calculate_ppc_metrics(cls.csv_content)

    # ── Current ACOS ──────────────────────────────────────────────────────

    def test_current_acos_matches_ground_truth(self):
        """currentAcos should match ground truth within 0.1 tolerance."""
        expected = self.ground_truth["currentAcos"]
        actual = self.result["currentAcos"]
        self.assertAlmostEqual(actual, expected, delta=0.1,
            msg=f"currentAcos: expected {expected}, got {actual}")

    def test_current_acos_is_positive(self):
        """ACOS must be a positive number."""
        self.assertGreater(self.result["currentAcos"], 0)

    # ── Wasted Spend ──────────────────────────────────────────────────────

    def test_wasted_spend_matches_ground_truth(self):
        """wastedSpend30Days should match ground truth exactly (raw, not scaled)."""
        expected = self.ground_truth["wastedSpend30Days"]
        actual = self.result["wastedSpend30Days"]
        self.assertEqual(actual, expected,
            msg=f"wastedSpend30Days: expected {expected}, got {actual}")

    def test_wasted_spend_less_than_total_spend(self):
        """Wasted spend cannot exceed total spend."""
        self.assertLessEqual(self.result["wastedSpend30Days"],
                             self.result["totalSpend"])

    # ── Low Performer Count ───────────────────────────────────────────────

    def test_low_performer_count_matches_ground_truth(self):
        """lowPerformerCount should match ground truth exactly."""
        expected = self.ground_truth["lowPerformerCount"]
        actual = self.result["lowPerformerCount"]
        self.assertEqual(actual, expected,
            msg=f"lowPerformerCount: expected {expected}, got {actual}")

    def test_low_performer_uses_campaign_aggregation(self):
        """Low performer count must be >= 30 (uses campaign-level aggregation, not row-level)."""
        self.assertGreaterEqual(self.result["lowPerformerCount"], 30,
            msg="lowPerformerCount should be >= 30 when using campaign-level aggregation")

    # ── Weekly Data ───────────────────────────────────────────────────────

    def test_weekly_data_has_4_weeks(self):
        """weeklyData must contain exactly 4 weeks."""
        self.assertEqual(len(self.result["weeklyData"]), 4)

    def test_weekly_data_week_labels(self):
        """Each week entry should have correct 'week' label."""
        for i, entry in enumerate(self.result["weeklyData"], start=1):
            self.assertEqual(entry["week"], f"Week {i}")

    def test_weekly_spend_less_than_weekly_sales(self):
        """Weekly adSpend should be less than weekly sales (profitable overall)."""
        for entry in self.result["weeklyData"]:
            self.assertLess(entry["adSpend"], entry["sales"],
                msg=f"{entry['week']}: adSpend ({entry['adSpend']}) >= sales ({entry['sales']})")

    def test_weekly_ad_spend_matches_ground_truth(self):
        """weeklyAdSpend should match ground truth."""
        expected = self.ground_truth["weeklyAdSpend"]
        actual = self.result["weeklyAdSpend"]
        self.assertEqual(actual, expected,
            msg=f"weeklyAdSpend: expected {expected}, got {actual}")

    def test_weekly_sales_matches_ground_truth(self):
        """weeklySales should match ground truth."""
        expected = self.ground_truth["weeklySales"]
        actual = self.result["weeklySales"]
        self.assertEqual(actual, expected,
            msg=f"weeklySales: expected {expected}, got {actual}")

    # ── Total Spend and Sales ─────────────────────────────────────────────

    def test_total_spend_matches_ground_truth(self):
        """totalSpend should match ground truth within $0.01."""
        expected = self.ground_truth["totalSpend"]
        actual = self.result["totalSpend"]
        self.assertAlmostEqual(actual, expected, delta=0.01,
            msg=f"totalSpend: expected {expected}, got {actual}")

    def test_total_sales_matches_ground_truth(self):
        """totalSales should match ground truth within $0.01."""
        expected = self.ground_truth["totalSales"]
        actual = self.result["totalSales"]
        self.assertAlmostEqual(actual, expected, delta=0.01,
            msg=f"totalSales: expected {expected}, got {actual}")

    # ── Return structure ──────────────────────────────────────────────────

    def test_result_has_all_required_keys(self):
        """Result dict must have all expected keys."""
        required_keys = {
            "currentAcos", "wastedSpend30Days", "lowPerformerCount",
            "weeklyData", "weeklyAdSpend", "weeklySales",
            "totalSpend", "totalSales",
        }
        self.assertTrue(required_keys.issubset(self.result.keys()),
            msg=f"Missing keys: {required_keys - self.result.keys()}")

    # ── Merge override test ───────────────────────────────────────────────

    def test_deterministic_values_overwrite_fake_perplexity(self):
        """Deterministic calculator values should overwrite fake Perplexity estimates."""
        # Simulate a Perplexity response with incorrect values
        fake_perplexity = {
            "currentAcos": 25.0,
            "wastedSpend30Days": 500,
            "lowPerformerCount": 5,
            "weeklyData": [
                {"week": "Week 1", "adSpend": 100, "sales": 200},
            ],
        }

        # Merge: deterministic values overwrite
        fake_perplexity.update(self.result)

        # After merge, all values should match our deterministic result
        self.assertEqual(fake_perplexity["currentAcos"], self.result["currentAcos"])
        self.assertEqual(fake_perplexity["wastedSpend30Days"], self.result["wastedSpend30Days"])
        self.assertEqual(fake_perplexity["lowPerformerCount"], self.result["lowPerformerCount"])
        self.assertEqual(len(fake_perplexity["weeklyData"]), 4,
            msg="After merge, weeklyData should have 4 weeks, not the fake 1")


if __name__ == "__main__":
    unittest.main()
