#!/usr/bin/env python3

import copy
import json
import unittest
from pathlib import Path

from review_nfl_names import validate_inventory


ROOT = Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "config" / "tts" / "nfl-name-review.json"


class NFLNameReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))

    def test_repository_inventory_has_32_unique_teams(self):
        self.assertEqual(validate_inventory(self.inventory), self.inventory)
        teams = [team["written"] for division in self.inventory["divisions"] for team in division["teams"]]
        self.assertEqual(len(teams), 32)
        self.assertEqual(len(set(teams)), 32)

    def test_duplicate_team_is_rejected(self):
        invalid = copy.deepcopy(self.inventory)
        invalid["divisions"][1]["teams"][0]["written"] = invalid["divisions"][0]["teams"][0]["written"]
        with self.assertRaisesRegex(ValueError, "32 unique"):
            validate_inventory(invalid)

    def test_each_team_has_market_and_spoken_forms(self):
        for division in self.inventory["divisions"]:
            for team in division["teams"]:
                self.assertTrue(team["spoken"])
                self.assertTrue(team["marketWritten"])
                self.assertTrue(team["marketSpoken"])


if __name__ == "__main__":
    unittest.main()
