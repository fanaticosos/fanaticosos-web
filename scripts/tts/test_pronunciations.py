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

    def test_spanish_names_are_changed_for_latino_narration(self):
        written = "Los Chicago Bears y Caleb Williams enfrentan a Green Bay Packers."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(
            spoken,
            "Los Chicágo Bers y Kéileb Uíliams enfrentan a Grin Béi Páquers.",
        )
        self.assertIn("Caleb Williams", written)

    def test_team_aliases_and_case_are_applied_automatically(self):
        written = "Los BEARS reciben a los Packers, Lions y Vikings."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(
            spoken,
            "Los Bers reciben a los Páquers, Láions y Váikings.",
        )
        self.assertNotIn("Chicago Chicago", spoken)

    def test_english_text_is_unchanged(self):
        text = "The Bears beat Green Bay."
        self.assertEqual(apply_pronunciations(text, "en", self.configuration), text)

    def test_spanish_brand_name_is_preserved_in_english_narration(self):
        written = "Thanks for listening to Fanaticosos."
        spoken = apply_pronunciations(written, "en", self.configuration)
        self.assertEqual(spoken, "Thanks for listening to Fah-nah-tee-KOH-sohs.")
        self.assertIn("Fanaticosos", written)

    def test_spanish_touchdown_terms_use_one_broadcast_word(self):
        written = "Anotó dos touchdowns y el segundo touchdown decidió el partido."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(
            spoken,
            "Anotó dos tóchdauns y el segundo tóchdaun decidió el partido.",
        )

    def test_detroit_lions_does_not_sound_like_destroy(self):
        written = "Los Detroit Lions visitan Chicago."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(spoken, "Los Ditróit Láions visitan Chicago.")
        self.assertIn("Detroit Lions", written)

    def test_minnesota_vikings_preserves_vikings_diphthong(self):
        written = "Los Minnesota Vikings visitan Chicago."
        spoken = apply_pronunciations(written, "es", self.configuration)
        self.assertEqual(spoken, "Los Minesóta Váikings visitan Chicago.")

    def test_uncategorized_override_is_rejected(self):
        invalid = copy.deepcopy(self.configuration)
        del invalid["overrides"]["es"][0]["category"]
        with self.assertRaisesRegex(ValueError, "category"):
            validate_pronunciations(invalid)

    def test_does_not_replace_inside_longer_word(self):
        text = "NotGreen BayArea"
        self.assertEqual(apply_pronunciations(text, "es", self.configuration), text)

    def test_duplicate_override_is_rejected(self):
        invalid = copy.deepcopy(self.configuration)
        invalid["overrides"]["es"].append(invalid["overrides"]["es"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_pronunciations(invalid)

    def test_duplicate_alias_is_rejected_case_insensitively(self):
        invalid = copy.deepcopy(self.configuration)
        invalid["overrides"]["es"][1]["aliases"] = [
            {"written": "bears", "synthesisText": "Bers"}
        ]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_pronunciations(invalid)

    def test_pending_entry_is_not_applied(self):
        pending = copy.deepcopy(self.configuration)
        pending["overrides"]["es"][0]["status"] = "pending"
        text = "Los Bears juegan hoy."
        self.assertEqual(apply_pronunciations(text, "es", pending), text)


if __name__ == "__main__":
    unittest.main()
