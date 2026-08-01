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
    voice_segments,
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

    def test_spanish_reference_is_loaded_and_normalized(self):
        reference = self.configuration["termReferenceData"]
        terms = {item["canonical"]: item for item in reference["terms"]}
        self.assertGreaterEqual(len(terms), 75)
        self.assertEqual(terms["linebacker"]["preferredSpanish"], "linebacker")
        self.assertIn("apoyador", terms["linebacker"]["acceptedSpanish"])
        self.assertEqual(terms["safety"]["preferredSpanish"], "safety")
        self.assertIn("profundo", terms["safety"]["acceptedSpanish"])
        self.assertEqual(terms["overtime"]["preferredSpanish"], "tiempo extra")
        self.assertEqual(terms["turnover"]["preferredSpanish"], "pérdida de balón")

    def test_compiled_pls_is_valid_xml_under_azure_size_limit(self):
        output = compile_pls(self.configuration)
        root = ET.fromstring(output)
        self.assertEqual(root.tag, f"{{{PLS_NS}}}lexicon")
        self.assertLess(len(output), 100 * 1024)

    def test_core_owner_approved_pronunciations_are_compiled(self):
        entries = {item["grapheme"]: item for item in pronunciation_entries(self.configuration)}
        self.assertEqual(entries["Bears"]["phoneme"], "ˈbeɾs")
        self.assertEqual(entries["Vikings"]["phoneme"], "ˈbaikɪŋs")
        self.assertEqual(entries["Justin"]["language"], "en-US")
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
        self.assertIn('<lang xml:lang="en-US">Caleb Williams</lang>', output)

    def test_owner_requested_english_names_and_td_delivery(self):
        output = apply_inline_ssml(
            "J.J. McCarthy lanzó un TD a Justin Jefferson y habló con Aaron Jones.",
            self.configuration,
        )
        self.assertIn('<lang xml:lang="en-US">J.J. McCarthy</lang>', output)
        self.assertIn('alias="touchdown">TD</sub>', output)
        self.assertIn('<lang xml:lang="en-US">Justin Jefferson</lang>', output)
        self.assertIn('<lang xml:lang="en-US">Aaron Jones</lang>', output)

    def test_reported_bears_names_and_defensive_terms_use_english_delivery(self):
        phrases = [
            "Luther Burden III", "Rome Odunze", "Colston Loveland",
            "Jahdae Walker", "Kyle DeVan", "safety", "safeties",
            "linebacker", "linebackers",
        ]
        entries = {item["grapheme"]: item for item in self.configuration["entities"]}
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                self.assertIn(entries[phrase]["mode"], {"english-low", "english-voice"})
                self.assertEqual(entries[phrase]["language"], "en-US")

        output = apply_inline_ssml(
            "Luther Burden III, Rome Odunze, Colston Loveland, Jahdae Walker y "
            "Kyle DeVan hablaron con los safeties y linebackers.",
            self.configuration,
        )
        for phrase in phrases[:5] + ["safeties", "linebackers"]:
            with self.subTest(rendered_phrase=phrase):
                self.assertIn(phrase, output)

    def test_offseason_has_no_forced_pronunciation(self):
        output = apply_inline_ssml("Durante la offseason mejoró el equipo.", self.configuration)
        self.assertIn("la offseason mejoró", output)
        self.assertNotIn("óf síson", output)

    def test_names_and_retained_terms_are_assigned_to_a_real_english_voice(self):
        segments = voice_segments(
            "Luther Burden III, Rome Odunze y el tight end hablaron con Caleb Williams.",
            self.configuration,
        )
        english = [item["markup"] for item in segments if item["voice"] == "en-US-GuyNeural"]
        self.assertIn(
            '<sub alias="Luther Burden the Third">Luther Burden III</sub>',
            english,
        )
        self.assertIn("Rome Odunze", english)
        self.assertIn("tight end", english)
        self.assertIn("Caleb Williams", english)
        self.assertTrue(any(item["voice"] == "es-MX-JorgeMultilingualNeural" for item in segments))

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
