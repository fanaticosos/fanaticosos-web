#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compile_azure_nfl_lexicon import load_configuration
from render_article_azure_production import render_production

ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = load_configuration(ROOT / "config/tts/azure-nfl-entities.json")


def request(locale="es"):
    return {
        "schemaVersion": 1,
        "articleId": str(uuid.uuid4()),
        "locale": locale,
        "sourceRevision": "a" * 64,
        "title": "Los Bears",
        "segments": [{"id": "body", "text": "Un touchdown."}],
    }


class AzureProductionWorkerTests(unittest.TestCase):
    def test_rejects_non_spanish_jobs_before_network_use(self):
        with tempfile.TemporaryDirectory() as name:
            with self.assertRaisesRegex(ValueError, "Spanish jobs only"):
                render_production(
                    request("en"), CONFIGURATION, Path(name) / "audio", "secret", "eastus"
                )

    def test_requires_server_side_credential(self):
        with tempfile.TemporaryDirectory() as name:
            with self.assertRaisesRegex(ValueError, "credential is required"):
                render_production(
                    request(), CONFIGURATION, Path(name) / "audio", "", "eastus"
                )

    def test_existing_output_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name) / "audio"
            output.mkdir()
            marker = output / "accepted.txt"
            marker.write_text("preserve", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                render_production(request(), CONFIGURATION, output, "secret", "eastus")
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
