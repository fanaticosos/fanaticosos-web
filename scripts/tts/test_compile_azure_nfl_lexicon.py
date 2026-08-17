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
        self.assertEqual(entries["Justin"]["alias"], "Yástin")
        self.assertEqual(entries["Halas Hall"]["language"], "en-US")

    def test_reported_names_places_titles_and_terms_use_english_delivery(self):
        text = (
            "George McCaskey y Ben Johnson visitaron Hammond, Indiana, Lost Marsh, "
            "Wolf Lake Terminal, Lake, Porter, Denver, Cleveland, Lake Forest y Halas Hall. "
            "Coby Bryant, Xavier Woods, Dillon Thieneman, Ray-Ray McCloud III, "
            "Peyton Manning, Patrick Mahomes, Andy Reid, Tyson Bagent y Kyle Monangai. "
            "Stevenson High School en Lincolnshire. "
            "Holiday Touchdown: A Bears Love Story, de Hallmark, apareció en el playbook."
        )
        output = apply_inline_ssml(text, self.configuration)
        for phrase in (
            "George McCaskey", "Ben Johnson", "Hammond", "Indiana", "Lost Marsh",
            "Wolf Lake Terminal", "Lake", "Porter", "Denver", "Cleveland", "Lake Forest",
            "Halas Hall", "Coby Bryant", "Xavier Woods", "Peyton Manning",
            "Patrick Mahomes", "Andy Reid", "Stevenson High School", "Lincolnshire",
            "Holiday Touchdown: A Bears Love Story", "Hallmark", "playbook",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(f'<lang xml:lang="en-US">{phrase}</lang>', output)
        self.assertIn('alias="Dillon thee nuh mun"', output)
        self.assertIn('alias="Ray-Ray McCloud the Third"', output)
        self.assertIn('alias="Tyson bay jint"', output)
        self.assertIn('alias="Kyle muh nun guy"', output)

    def test_spanish_text_is_language_locked_and_reported_phrases_are_controlled(self):
        output = apply_inline_ssml(
            "Afición Navy and Orange. ¿Confianza competitiva o soberbia? "
            "El apunte fanaticOSO. Bear Down.",
            self.configuration,
        )
        self.assertIn('<lang xml:lang="es-MX">. ¿Confianza competitiva o soberbia? El apunte </lang>', output)
        self.assertIn('alias="Néivi and Órinch"', output)
        self.assertIn('alias="fanaticoso"', output)
        self.assertIn('alias="Bér Daun"', output)
        self.assertNotIn('<lang xml:lang="en-US">Bear Down</lang>', output)

    def test_encanto_does_not_change_encanto_with_a_written_accent(self):
        output = apply_inline_ssml("El encanto regresó y encantó a todos.", self.configuration)
        self.assertIn('ph="enˈkanto">encanto</phoneme>', output)
        self.assertIn("y encantó a todos", output)

    def test_team_city_and_nickname_are_not_wrapped_as_one_phrase(self):
        output = apply_inline_ssml(
            "Los Chicago Bears reciben a los Minnesota Vikings.",
            self.configuration,
        )
        self.assertIn("Chicago </lang><phoneme", output)
        self.assertIn("Minnesota </lang><phoneme", output)
        self.assertNotIn(">Chicago Bears</", output)
        self.assertNotIn(">Minnesota Vikings</", output)

    def test_longest_names_win_and_text_is_xml_escaped(self):
        output = apply_inline_ssml(
            "Justin Jefferson habló con Justin & Caleb Williams.",
            self.configuration,
        )
        self.assertIn('<sub alias="Yástin Yéferson">Justin Jefferson</sub>', output)
        self.assertIn("&amp;", output)
        self.assertIn('<sub alias="Kéileb Uíliams">Caleb Williams</sub>', output)

    def test_owner_requested_english_names_and_td_delivery(self):
        output = apply_inline_ssml(
            "J.J. McCarthy lanzó un TD a Justin Jefferson y habló con Aaron Jones.",
            self.configuration,
        )
        self.assertIn('<sub alias="Yéi Yéi Makárthi">J.J. McCarthy</sub>', output)
        self.assertIn('alias="tóchdaun">TD</sub>', output)
        self.assertIn('<sub alias="Yástin Yéferson">Justin Jefferson</sub>', output)
        self.assertIn('<sub alias="Éron Yóuns">Aaron Jones</sub>', output)

    def test_reported_bears_names_and_defensive_terms_use_spanish_broadcast_aliases(self):
        phrases = [
            "Luther Burden III", "Rome Odunze", "Colston Loveland",
            "Jahdae Walker", "Kyle DeVan", "safety", "safeties",
            "linebacker", "linebackers",
        ]
        entries = {item["grapheme"]: item for item in self.configuration["entities"]}
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                self.assertEqual(entries[phrase]["mode"], "spanish-broadcast")
                self.assertIn("alias", entries[phrase])

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

    def test_names_and_retained_terms_stay_in_one_spanish_voice(self):
        segments = voice_segments(
            "Luther Burden III, Rome Odunze y el tight end hablaron con Caleb Williams.",
            self.configuration,
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["voice"], "es-MX-JorgeMultilingualNeural")
        markup = segments[0]["markup"]
        self.assertIn('<sub alias="Lúther Bérden de térd">Luther Burden III</sub>', markup)
        self.assertIn('<sub alias="Róum Odúnzei">Rome Odunze</sub>', markup)
        self.assertIn('<sub alias="tái-den">tight end</sub>', markup)
        self.assertIn('<sub alias="Kéileb Uíliams">Caleb Williams</sub>', markup)
        self.assertNotIn("en-US", markup)

    def test_current_article_names_places_and_surnames_are_retained(self):
        output = apply_inline_ssml(
            "Michigan y Cincinnati. Deshaun Watson; Maurice Alexander; Kaden Davis; "
            "Cairo Santos; Case Keenum; Salvon Ahmed; Brittain Brown; Coleman Bennett; "
            "Jamree Kromah; Beanie Bishop Jr.; Shedeur Sanders; Dillon Gabriel; "
            "Ruben Hyppolite II; Nephi Sewell; Nikola Kalinic. "
            "Bagent, Keenum, Davis, Kromah, Bishop y Kalinic.",
            self.configuration,
        )
        for alias in (
            "Míshigan", "Sinsináti", "Deshón Uátson", "Morís Alexander",
            "Kéiden Déivis", "Káiro Santos", "Kéis Kínum", "Savón Okmed",
            "Brítin Braun", "Cóulman Bénet", "Yámri Króuma",
            "Bíni Bíshop Yúnior", "Shadúr Sánders", "Dílan Gáibriel",
            "Rúben Hípolait de sécond", "Nífai Súel", "Nícola Kálinich",
            "bay jint", "Kínum", "Déivis", "Króuma", "Bíshop", "Kálinich",
        ):
            with self.subTest(alias=alias):
                self.assertIn(f'alias="{alias}"', output)

    def test_owner_reviewed_english_game_terms_use_latino_phonetic_aliases(self):
        output = apply_inline_ssml(
            "Dos fumbles tras varios handoffs obligaron a cambiar el play call.",
            self.configuration,
        )
        self.assertIn('<sub alias="fámbols">fumbles</sub>', output)
        self.assertIn('<sub alias="hándofs">handoffs</sub>', output)
        self.assertIn('<sub alias="pléi kol">play call</sub>', output)

    def test_owner_handle_has_a_stable_spoken_form(self):
        output = apply_inline_ssml("En Twitter: @imcontreras", self.configuration)
        self.assertIn('<sub alias="arroba, Aim Contreras">@imcontreras</sub>', output)


if __name__ == "__main__":
    unittest.main()
