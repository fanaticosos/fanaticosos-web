#!/usr/bin/env python3

import copy
import json
import unittest
from pathlib import Path

from pronunciations import apply_pronunciations, validate_pronunciations


ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = ROOT / "config" / "tts" / "pronunciations.json"


class PronunciationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.configuration = json.loads(CONFIGURATION.read_text(encoding="utf-8"))

    def test_repository_configuration_is_valid(self):
        self.assertEqual(
            validate_pronunciations(self.configuration), self.configuration
        )

    def test_spanish_green_bay_is_changed_for_narration(self):
        written = "Los Bears vencieron a Green Bay en Chicago."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(spoken, "Los Bears vencieron a Grin Bei en Chicago.")
        self.assertIn("Green Bay", written)

    def test_english_text_is_unchanged(self):
        text = "The Bears beat Green Bay."
        self.assertEqual(apply_pronunciations(text, "en", self.configuration), text)

    def test_does_not_replace_inside_longer_word(self):
        text = "NotGreen BayArea"
        self.assertEqual(apply_pronunciations(text, "es", self.configuration), text)

    def test_duplicate_override_is_rejected(self):
        invalid = copy.deepcopy(self.configuration)
        invalid["overrides"]["es"].append(invalid["overrides"]["es"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_pronunciations(invalid)


if __name__ == "__main__":
    unittest.main()
