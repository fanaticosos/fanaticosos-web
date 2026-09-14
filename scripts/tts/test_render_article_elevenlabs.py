#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
import urllib.error
from io import BytesIO
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_article_elevenlabs import api_request, narration_chunks, prepare_spoken_request, render_production, resolve_voice_id, split_text


ROOT = Path(__file__).resolve().parents[2]


class ElevenLabsProductionTests(unittest.TestCase):
    def test_production_assembly_decodes_every_chunk_instead_of_copying_mp3_boundaries(self):
        source = (ROOT / "scripts/tts/render_article_elevenlabs.py").read_text(encoding="utf-8")
        self.assertNotIn('"-c", "copy"', source)
        self.assertNotIn("joined.mp3", source)
        self.assertIn('"-f", "concat", "-safe", "0", "-i", str(concat), "-af", "loudnorm=', source)

    def test_spanish_applies_reviewed_bears_pronunciation_to_plain_narration(self):
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

    def test_spoken_request_preserves_names_and_places_not_overridden_for_elevenlabs(self):
        pronunciations = json.loads((ROOT / "config/tts/pronunciations.json").read_text(encoding="utf-8"))
        request = {
            "schemaVersion": 1,
            "articleId": "00000000-0000-4000-8000-000000000001",
            "locale": "es",
            "sourceRevision": "a" * 64,
            "title": "Chicago en Soldier Field",
            "narrationScript": "Caleb Williams encontró a Kyle Monangai en Soldier Field.",
            "segments": [{"id": "script-001", "text": "Caleb Williams encontró a Kyle Monangai en Soldier Field.", "pauseAfterMs": 0}],
        }
        spoken = prepare_spoken_request(request, pronunciations)
        self.assertEqual(spoken["segments"][0]["text"], request["segments"][0]["text"])

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

    def test_narration_chunks_render_native_breaks_inside_continuous_requests(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Primera parte.", "pauseAfterMs": 700},
            {"id": "script-002", "text": "Segunda parte.", "pauseAfterMs": 0},
        ]}
        chunks = narration_chunks(request, 4500)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0]["text"],
            'Título\n\n<break time="0.7s" />\n\nPrimera parte.\n\n<break time="0.7s" />\n\nSegunda parte.',
        )
        self.assertIsNone(chunks[0]["previousText"])
        self.assertIsNone(chunks[0]["nextText"])

    def test_narration_chunks_only_split_at_the_provider_limit(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "A" * 2400, "pauseAfterMs": 700},
            {"id": "script-002", "text": "B" * 2400, "pauseAfterMs": 0},
        ]}
        chunks = narration_chunks(request, 4500)
        self.assertEqual(len(chunks), 2)
        self.assertIn('<break time="0.7s" />', chunks[0]["text"])
        self.assertEqual(chunks[0]["nextText"], chunks[1]["text"])
        self.assertEqual(chunks[1]["previousText"], chunks[0]["text"])

    def test_quote_attribution_and_following_paragraph_stay_in_one_generation(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Su pase de touchdown cayó entre dos defensores.", "pauseAfterMs": 700},
            {"id": "script-002", "text": "“Así es como queremos vernos cada semana”.\n\n— Caleb Williams", "pauseAfterMs": 700},
            {"id": "script-003", "text": "La actuación no fue perfecta.", "pauseAfterMs": 0},
        ]}
        chunks = narration_chunks(request, 4500)
        self.assertEqual(len(chunks), 1)
        self.assertIn('— Caleb Williams\n\n<break time="0.7s" />\n\nLa actuación', chunks[0]["text"])

    def test_narration_chunks_reject_invalid_provider_pause_lengths(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Primera parte.", "pauseAfterMs": 3001},
            {"id": "script-002", "text": "Segunda parte.", "pauseAfterMs": 0},
        ]}
        with self.assertRaisesRegex(ValueError, "between 1 and 3000"):
            narration_chunks(request, 4500)

    def test_voice_resolution_requires_the_approved_exact_name(self):
        payload = b'{"voices":[{"name":"Other","voice_id":"bad"},{"name":"Will - Relaxed Optimist","voice_id":"approved"}]}'
        requester = lambda url, key: payload
        self.assertEqual(resolve_voice_id("key", "Will - Relaxed Optimist", requester), "approved")
        with self.assertRaisesRegex(ValueError, "voice was not found"):
            resolve_voice_id("key", "Missing", requester)

    def test_provider_error_preserves_only_actionable_response_detail(self):
        error = urllib.error.HTTPError(
            "https://api.elevenlabs.io/v1/text-to-speech/voice",
            401,
            "Unauthorized",
            {},
            BytesIO(json.dumps({
                "detail": {
                    "status": "quota_exceeded",
                    "message": "Insufficient quota",
                    "request_id": "private-request-id",
                }
            }).encode()),
        )
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "401: quota_exceeded: Insufficient quota") as caught:
                api_request("https://api.elevenlabs.io/v1/text-to-speech/voice", "secret", {"text": "safe"})
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn("private-request-id", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
