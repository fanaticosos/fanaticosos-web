#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compile_azure_nfl_lexicon import (
    PLS_NS,
    apply_inline_ssml,
    compile_pls,
    load_configuration,
    pronunciation_entries,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = ROOT / "config/tts/azure-nfl-entities.json"


class AzureNflLexiconTests(unittest.TestCase):
    def setUp(self):
        self.configuration = load_configuration(CONFIGURATION)

    def test_all_32_teams_and_eight_divisions_are_present(self):
        self.assertEqual(len(self.configuration["teams"]), 32)
        self.assertEqual(
            {team["division"] for team in self.configuration["teams"]},
            {
                "NFC North", "NFC East", "NFC South", "NFC West",
                "AFC North", "AFC East", "AFC South", "AFC West",
            },
        )

    def test_compiled_pls_is_valid_xml_under_azure_size_limit(self):
        output = compile_pls(self.configuration)
        root = ET.fromstring(output)
        self.assertEqual(root.tag, f"{{{PLS_NS}}}lexicon")
        self.assertLess(len(output), 100 * 1024)

    def test_core_owner_approved_pronunciations_are_compiled(self):
        entries = {item["grapheme"]: item for item in pronunciation_entries(self.configuration)}
        self.assertEqual(entries["Bears"]["phoneme"], "ˈbeɾs")
        self.assertEqual(entries["Vikings"]["phoneme"], "ˈbaikɪŋs")
        self.assertEqual(entries["Justin"]["phoneme"], "ˈʝastin")
        self.assertEqual(entries["Halas Hall"]["phoneme"], "ˈhalas.ˈhol")

    def test_team_city_and_nickname_are_not_wrapped_as_one_phrase(self):
        output = apply_inline_ssml(
            "Los Chicago Bears reciben a los Minnesota Vikings.",
            self.configuration,
        )
        self.assertIn("Chicago <phoneme", output)
        self.assertIn("Minnesota <phoneme", output)
        self.assertNotIn(">Chicago Bears</", output)
        self.assertNotIn(">Minnesota Vikings</", output)

    def test_longest_names_win_and_text_is_xml_escaped(self):
        output = apply_inline_ssml(
            "Justin Jefferson habló con Justin & Caleb Williams.",
            self.configuration,
        )
        self.assertIn('xml:lang="en-US"', output)
        self.assertIn('<lang xml:lang="en-US">Justin Jefferson</lang>', output)
        self.assertIn("&amp;", output)
        self.assertIn('alias="Kéileb Uíliams">Caleb Williams</sub>', output)

    def test_owner_requested_english_names_and_td_delivery(self):
        output = apply_inline_ssml(
            "J.J. McCarthy lanzó un TD a Justin Jefferson y habló con Aaron Jones.",
            self.configuration,
        )
        self.assertIn('<lang xml:lang="en-US">J.J. McCarthy</lang>', output)
        self.assertIn('alias="touchdown">TD</sub>', output)
        self.assertIn('<lang xml:lang="en-US">Justin Jefferson</lang>', output)
        self.assertIn('<lang xml:lang="en-US">Aaron Jones</lang>', output)

    def test_offseason_has_no_forced_pronunciation(self):
        output = apply_inline_ssml("Durante la offseason mejoró el equipo.", self.configuration)
        self.assertIn("la offseason mejoró", output)
        self.assertNotIn("óf síson", output)

    def test_owner_reviewed_english_game_terms_are_not_hispanicized(self):
        output = apply_inline_ssml(
            "Dos fumbles tras varios handoffs obligaron a cambiar el play call.",
            self.configuration,
        )
        self.assertIn('<lang xml:lang="en-US">fumbles</lang>', output)
        self.assertIn('<lang xml:lang="en-US">handoffs</lang>', output)
        self.assertIn('<lang xml:lang="en-US">play call</lang>', output)

    def test_owner_handle_has_a_stable_spoken_form(self):
        output = apply_inline_ssml("En Twitter: @imcontreras", self.configuration)
        self.assertIn(
            '<lang xml:lang="en-US"><sub alias="I\'m Contreras">@imcontreras</sub></lang>',
            output,
        )


if __name__ == "__main__":
    unittest.main()
