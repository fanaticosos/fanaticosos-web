#!/usr/bin/env python3

import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compile_azure_nfl_lexicon import load_configuration
from render_article_azure import build_chunks, build_ssml

ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = ROOT / "config/tts/azure-nfl-entities.json"


class AzureArticleRendererTests(unittest.TestCase):
    def setUp(self):
        self.configuration = load_configuration(CONFIGURATION)

    def test_chunks_remain_below_free_tier_file_limit(self):
        segments = [
            {"id": "1", "text": "a" * 1400},
            {"id": "2", "text": "b" * 1400},
            {"id": "3", "text": "c" * 300},
        ]
        chunks = build_chunks(segments)
        self.assertEqual(len(chunks), 2)
        self.assertTrue(all(sum(len(segment["text"]) for segment in chunk) <= 2600 for chunk in chunks))

    def test_article_structure_produces_audible_heading_and_paragraph_pauses(self):
        chunks = build_chunks([
            {"id": "description", "kind": "description", "text": "Introducción."},
            {"id": "body-001", "kind": "heading", "text": "I. El mensaje"},
            {"id": "body-002", "kind": "paragraph", "text": "Primer párrafo."},
            {"id": "body-003", "kind": "heading", "text": "II. La respuesta"},
        ])
        text = build_ssml(chunks[0], self.configuration).decode("utf-8")
        self.assertIn('<break time="1000ms"/>I. El mensaje', text)
        self.assertIn('<break time="650ms"/>Primer párrafo.', text)
        self.assertIn('<break time="1000ms"/>II. La respuesta', text)

    def test_ssml_is_well_formed_and_uses_accepted_profile(self):
        ssml = build_ssml(
            "Los Chicago Bears jugaron en Halas Hall.",
            self.configuration,
        )
        ET.fromstring(ssml)
        text = ssml.decode("utf-8")
        self.assertIn('name="en-US-Brian:DragonHDLatestNeural"', text)
        self.assertIn("Chicago Bears", text)
        self.assertIn("Halas Hall", text)
        self.assertNotIn("<lang ", text)

    def test_article_ssml_contains_no_markdown_and_wraps_reported_terms(self):
        narration = (
            "Los safeties y linebackers hablaron con Luther Burden III, "
            "Rome Odunze, Colston Loveland, Jahdae Walker y Kyle DeVan, el tight end. "
            "Necesitan un quarterback. Go Bears!"
        )
        text = build_ssml(narration, self.configuration).decode("utf-8")
        self.assertNotIn("*", text)
        for phrase in (
            "safeties", "linebackers", "Luther Burden III", "Rome Odunze",
            "Colston Loveland", "Jahdae Walker", "Kyle DeVan", "tight end",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        self.assertEqual(text.count("<voice "), 1)
        self.assertIn('<voice name="en-US-Brian:DragonHDLatestNeural">', text)
        self.assertIn('<sub alias="tái-den">tight end</sub>', text)
        self.assertIn("Luther Burden III", text)
        self.assertNotIn("en-US-GuyNeural", text)
        self.assertIn("Rome Odunze", text)
        self.assertNotIn("<lang ", text)


if __name__ == "__main__":
    unittest.main()
