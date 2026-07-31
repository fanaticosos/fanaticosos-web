#!/usr/bin/env python3

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "config" / "tts" / "mexican-broadcast-sources.json"
INVENTORY = ROOT / "config" / "tts" / "nfl-name-review.json"


class MexicanBroadcastSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = json.loads(SOURCES.read_text(encoding="utf-8"))
        cls.inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))

    def test_source_registry_identity(self):
        self.assertEqual(self.sources["schemaVersion"], 1)
        self.assertEqual(self.sources["version"], 1)
        self.assertEqual(self.sources["locale"], "es-MX")
        self.assertEqual(self.sources["sourceType"], "mexican-broadcast")
        self.assertEqual(
            self.sources["publisher"]["playlist"],
            "https://www.youtube.com/playlist?list=PLDOzSEyymu3Q",
        )

    def test_registry_covers_exactly_the_inventory_teams(self):
        inventory_teams = {
            team["written"]
            for division in self.inventory["divisions"]
            for team in division["teams"]
        }
        source_teams = {entry["team"] for entry in self.sources["teams"]}
        self.assertEqual(len(self.sources["teams"]), 32)
        self.assertEqual(source_teams, inventory_teams)

    def test_available_references_are_unique_youtube_shorts(self):
        references = [
            entry["reference"]
            for entry in self.sources["teams"]
            if entry["status"] == "available"
        ]
        self.assertEqual(len(references), 30)
        self.assertEqual(len(references), len(set(references)))
        self.assertTrue(
            all(
                reference.startswith("https://www.youtube.com/shorts/")
                for reference in references
            )
        )

    def test_coverage_gaps_are_explicit(self):
        missing = {
            entry["team"]
            for entry in self.sources["teams"]
            if entry["status"] == "not-found"
        }
        self.assertEqual(missing, {"Baltimore Ravens", "Houston Texans"})
        self.assertTrue(
            all(
                entry["reference"] is None
                for entry in self.sources["teams"]
                if entry["status"] == "not-found"
            )
        )


if __name__ == "__main__":
    unittest.main()
