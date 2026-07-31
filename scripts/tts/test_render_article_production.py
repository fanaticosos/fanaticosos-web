#!/usr/bin/env python3

import sys
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_article_production import worker_arguments, worker_environment


def request(locale):
    return {
        "schemaVersion": 1,
        "articleId": str(uuid.uuid4()),
        "locale": locale,
        "sourceRevision": "a" * 64,
        "title": "Title",
        "segments": [{"id": "body", "text": "Body"}],
    }


class ProductionRouterTests(unittest.TestCase):
    def test_spanish_routes_only_to_azure(self):
        command = worker_arguments(request("es"), Path("/repo"), Path("/jobs/1/audio"))
        joined = " ".join(command)
        self.assertIn("render_article_azure_production.py", joined)
        self.assertNotIn("render_article_kokoro.py", joined)

    def test_english_routes_only_to_kokoro(self):
        command = worker_arguments(request("en"), Path("/repo"), Path("/jobs/1/audio"))
        joined = " ".join(command)
        self.assertIn("render_article_kokoro.py", joined)
        self.assertIn("production.json", joined)
        self.assertNotIn("render_article_azure_production.py", joined)

    def test_english_worker_does_not_inherit_azure_credentials(self):
        environment = worker_environment(
            "en",
            {"PATH": "/usr/bin", "AZURE_SPEECH_KEY": "secret", "AZURE_SPEECH_REGION": "eastus"},
        )
        self.assertEqual(environment, {"PATH": "/usr/bin"})

    def test_spanish_worker_retains_azure_credentials(self):
        environment = worker_environment("es", {"AZURE_SPEECH_KEY": "secret"})
        self.assertEqual(environment["AZURE_SPEECH_KEY"], "secret")


if __name__ == "__main__":
    unittest.main()
