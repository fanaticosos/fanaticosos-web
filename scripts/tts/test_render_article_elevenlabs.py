#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_article_elevenlabs import prepare_spoken_request, render_production, resolve_voice_id, split_text


ROOT = Path(__file__).resolve().parents[2]


class ElevenLabsProductionTests(unittest.TestCase):
    def test_spanish_uses_the_approved_shared_pronunciation_knowledge(self):
        pronunciations = json.loads((ROOT / "config/tts/pronunciations.json").read_text(encoding="utf-8"))
        request = {
            "schemaVersion": 1,
            "articleId": "00000000-0000-4000-8000-000000000001",
            "locale": "es",
            "sourceRevision": "a" * 64,
            "title": "Los Bears reciben a Carolina",
            "segments": [{"id": "body-001", "text": "Los Chicago Bears necesitan un touchdown con Caleb Williams."}],
        }
        spoken = prepare_spoken_request(request, pronunciations)
        self.assertEqual(spoken["title"], "Los Bers reciben a Carolina")
        self.assertEqual(spoken["segments"][0]["text"], "Los Chicago Bers necesitan un touchdown con Caleb Williams.")
        self.assertEqual(request["title"], "Los Bears reciben a Carolina")

    def test_worker_rejects_a_stale_pronunciation_knowledge_version(self):
        pronunciations = json.loads((ROOT / "config/tts/pronunciations.json").read_text(encoding="utf-8"))
        configuration = json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8"))
        configuration["pronunciationVersion"] -= 1
        request = {
            "schemaVersion": 1,
            "articleId": "00000000-0000-4000-8000-000000000001",
            "locale": "es",
            "sourceRevision": "a" * 64,
            "title": "Los Bears",
            "segments": [{"id": "body-001", "text": "Bear Down."}],
        }
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "version is stale"):
                render_production(request, configuration, pronunciations, Path(directory) / "output", "key")

    def test_long_articles_are_split_without_losing_text(self):
        text = "\n\n".join(["A" * 2000, "B" * 2000, "C" * 2000])
        chunks = split_text(text, 4500)
        self.assertEqual(chunks, ["A" * 2000 + "\n\n" + "B" * 2000, "C" * 2000])
        self.assertTrue(all(len(chunk) <= 4500 for chunk in chunks))

    def test_voice_resolution_requires_the_approved_exact_name(self):
        payload = b'{"voices":[{"name":"Other","voice_id":"bad"},{"name":"Will - Relaxed Optimist","voice_id":"approved"}]}'
        requester = lambda url, key: payload
        self.assertEqual(resolve_voice_id("key", "Will - Relaxed Optimist", requester), "approved")
        with self.assertRaisesRegex(ValueError, "voice was not found"):
            resolve_voice_id("key", "Missing", requester)


if __name__ == "__main__":
    unittest.main()
