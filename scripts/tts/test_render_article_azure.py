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
        self.assertTrue(all(len(chunk) <= 2600 for chunk in chunks))

    def test_ssml_is_well_formed_and_uses_accepted_profile(self):
        ssml = build_ssml(
            "Los Chicago Bears jugaron en Halas Hall.",
            self.configuration,
        )
        ET.fromstring(ssml)
        text = ssml.decode("utf-8")
        self.assertIn('name="es-MX-JorgeMultilingualNeural"', text)
        self.assertIn('rate="+8%"', text)
        self.assertIn('ph="ˈbeɾs"', text)
        self.assertIn('ph="ˈhalas.ˈhol"', text)


if __name__ == "__main__":
    unittest.main()
