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

from elevenlabs_quota import QuotaError, ledger_path, read_ledger
from render_article_elevenlabs import (
    api_request, cached_chunk, chunk_identity, configured_voice_id, legacy_chunk_identity, narration_chunks,
    prepare_spoken_request, quota_plan, render_production, resolve_voice_id, split_text, write_progress,
)


ROOT = Path(__file__).resolve().parents[2]


def http_error(code, status, message="rejected"):
    return urllib.error.HTTPError(
        "https://api.elevenlabs.io/v1/text-to-speech/voice", code, "Error", {},
        BytesIO(json.dumps({"detail": {"status": status, "message": message}}).encode()),
    )


class ElevenLabsProductionTests(unittest.TestCase):
    def test_transient_provider_errors_are_retried_with_backoff_but_client_errors_are_not(self):
        sleeps = []
        responses = [http_error(503, "server_error"), http_error(429, "too_many_requests")]
        class Success:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return b"audio"
        def urlopen(request, timeout):
            if responses:
                raise responses.pop(0)
            return Success()
        with patch("urllib.request.urlopen", side_effect=urlopen):
            self.assertEqual(api_request("https://api.elevenlabs.io/v1/x", "key", {"text": "a"}, sleep=sleeps.append), b"audio")
        self.assertEqual(sleeps, [2, 4])
        with patch("urllib.request.urlopen", side_effect=[http_error(503, "server_error") for _ in range(3)]):
            with self.assertRaisesRegex(RuntimeError, "503: server_error"):
                api_request("https://api.elevenlabs.io/v1/x", "key", {"text": "a"}, sleep=lambda _: None)
        calls = []
        def unauthorized(request, timeout):
            calls.append(1)
            raise http_error(401, "quota_exceeded", "Insufficient quota")
        with patch("urllib.request.urlopen", side_effect=unauthorized):
            with self.assertRaisesRegex(RuntimeError, "401: quota_exceeded"):
                api_request("https://api.elevenlabs.io/v1/x", "key", {"text": "a"}, sleep=lambda _: None)
        self.assertEqual(len(calls), 1)

    def test_pronunciation_version_bumps_reuse_paid_blocks_through_legacy_identity_migration(self):
        configuration = json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8"))
        bumped = {**configuration, "pronunciationVersion": configuration["pronunciationVersion"] + 1}
        self.assertEqual(chunk_identity("Texto", "voice", configuration), chunk_identity("Texto", "voice", bumped))
        self.assertNotEqual(legacy_chunk_identity("Texto", "voice", configuration), legacy_chunk_identity("Texto", "voice", bumped))
        self.assertNotEqual(chunk_identity("Texto", "voice", configuration), chunk_identity("Otro", "voice", configuration))
        calls = []
        requester = lambda url, key, payload: calls.append(payload["text"]) or b"paid"
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            legacy = cache / f"{legacy_chunk_identity('Texto', 'voice', configuration)}.mp3"
            legacy.write_bytes(b"paid-before-split")
            audio, reused = cached_chunk("Texto", "voice", "key", configuration, cache, requester)
            self.assertEqual((audio, reused), (b"paid-before-split", True))
            self.assertEqual((cache / f"{chunk_identity('Texto', 'voice', configuration)}.mp3").read_bytes(), b"paid-before-split")
            self.assertEqual(calls, [])
            plan = quota_plan([
                {"text": "Texto", "previousText": None, "nextText": None},
                {"text": "Nuevo bloque", "previousText": None, "nextText": None},
            ], "voice", configuration, cache)
            self.assertEqual(plan, {"totalChunks": 2, "cachedChunks": 1, "pendingChunks": 1, "requiredCharacters": len("Nuevo bloque")})

    def test_pinned_voice_id_avoids_the_network_lookup(self):
        def requester(*args):
            raise AssertionError("network lookup must not happen for a pinned voice")
        self.assertEqual(configured_voice_id({"voiceId": "abc123DEF456", "voiceName": "Will"}, "key", requester), "abc123DEF456")
        with self.assertRaisesRegex(ValueError, "voiceId is invalid"):
            configured_voice_id({"voiceId": "../x", "voiceName": "Will"}, "key", requester)
        payload = b'{"voices":[{"name":"Will","voice_id":"resolved"}]}'
        self.assertEqual(configured_voice_id({"voiceName": "Will"}, "key", lambda url, key: payload), "resolved")

    def _request(self):
        return {
            "schemaVersion": 1, "articleId": "00000000-0000-4000-8000-000000000001", "locale": "es",
            "sourceRevision": "a" * 64, "title": "Los Bears",
            "segments": [{"id": "script-001", "text": "Un bloque de prueba con costo real que supera los sesenta y ocho caracteres restantes de la cuenta limitada.", "pauseAfterMs": 0}],
        }

    def test_quota_preflight_refuses_before_buying_anything(self):
        pronunciations = json.loads((ROOT / "config/tts/pronunciations.json").read_text(encoding="utf-8"))
        configuration = {**json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8")), "voiceId": "pinnedVoice01"}
        calls = []
        requester = lambda url, key, payload: calls.append(payload["text"]) or b"paid"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(QuotaError, "quedan 68") as caught:
                render_production(self._request(), configuration, pronunciations, root / "audio", root / "cache", "key",
                                  requester=requester, subscription_fetcher=lambda key: {"character_limit": 40_000, "character_count": 39_932},
                                  environment={})
            self.assertEqual(calls, [])
            self.assertFalse((root / "audio").exists())
            self.assertFalse((root / "audio.generating").exists())
            progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
            self.assertEqual(progress["stage"], "preflight")
            self.assertEqual(progress["quota"]["accountRemaining"], 68)
            self.assertGreater(progress["quota"]["requiredCharacters"], 0)
            self.assertNotIn("Un bloque", json.dumps(progress))
            self.assertNotIn("key", progress.get("quota", {}))
            self.assertNotIn("se consumió", "")  # message documents that nothing was billed
            self.assertIn("No se consumió ningún crédito", str(caught.exception))
            with self.assertRaisesRegex(QuotaError, "API key"):
                render_production(self._request(), configuration, pronunciations, root / "audio", root / "cache", "key",
                                  requester=requester, subscription_fetcher=lambda key: {"character_limit": 100_000, "character_count": 0},
                                  environment={"ELEVENLABS_KEY_CHARACTER_LIMIT": "10"})
            self.assertEqual(calls, [])
            with self.assertRaisesRegex(QuotaError, "network_unavailable"):
                render_production(self._request(), configuration, pronunciations, root / "audio", root / "cache", "key",
                                  requester=requester, subscription_fetcher=lambda key: (_ for _ in ()).throw(QuotaError("ElevenLabs HTTP 0: network_unavailable: x")),
                                  environment={})
            self.assertEqual(calls, [])

    def test_generated_blocks_are_recorded_in_the_key_ledger(self):
        pronunciations = json.loads((ROOT / "config/tts/pronunciations.json").read_text(encoding="utf-8"))
        configuration = {**json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8")), "voiceId": "pinnedVoice01"}
        requester = lambda url, key, payload: b"paid"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Assembly needs real audio; stop right after the paid block is cached and recorded.
            with patch("render_article_elevenlabs.subprocess.run", side_effect=RuntimeError("stop before assembly")):
                with self.assertRaisesRegex(RuntimeError, "stop before assembly"):
                    render_production(self._request(), configuration, pronunciations, root / "audio", root / "cache", "key",
                                      requester=requester, subscription_fetcher=lambda key: {"character_limit": 100_000, "character_count": 0, "next_character_count_reset_unix": 123},
                                      environment={"ELEVENLABS_KEY_CHARACTER_LIMIT": "40000"})
            ledger = read_ledger(root / "cache", "key", 123)
            self.assertGreater(ledger["characters"], 0)
            self.assertEqual(ledger["resetUnix"], 123)
            self.assertTrue(ledger_path(root / "cache", "key").exists())
            progress = json.loads((root / "progress.json").read_text(encoding="utf-8"))
            self.assertEqual(progress["stage"], "assembling")
            self.assertEqual(progress["quota"]["keyLimit"], 40_000)

    def test_progress_is_atomic_sanitized_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            write_progress(path, stage="generating", total_chunks=10, completed_chunks=3, cache_hits=2, generated_chunks=1)
            value = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(value["completedChunks"], 3)
            self.assertEqual(value["cacheHits"], 2)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("text", value)

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
                render_production(request, configuration, pronunciations, Path(directory) / "output", Path(directory) / "cache", "key")

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
        self.assertIsNone(chunks[0]["nextText"])
        self.assertIsNone(chunks[1]["previousText"])

    def test_quote_attribution_and_following_paragraph_stay_in_one_generation(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Su pase de touchdown cayó entre dos defensores.", "pauseAfterMs": 700},
            {"id": "script-002", "text": "“Así es como queremos vernos cada semana”.\n\n— Caleb Williams", "pauseAfterMs": 700},
            {"id": "script-003", "text": "La actuación no fue perfecta.", "pauseAfterMs": 0},
        ]}
        chunks = narration_chunks(request, 4500)
        self.assertEqual(len(chunks), 1)
        self.assertIn('— Caleb Williams\n\n<break time="0.7s" />\n\nLa actuación', chunks[0]["text"])

    def test_article_sections_are_stable_reusable_generation_blocks(self):
        original = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Introducción original.", "pauseAfterMs": 700},
            {"id": "script-002", "text": "Primera sección", "pauseAfterMs": 900},
            {"id": "script-003", "text": "Contenido sin cambios.", "pauseAfterMs": 700},
            {"id": "script-004", "text": "Segunda sección", "pauseAfterMs": 900},
            {"id": "script-005", "text": "Más contenido sin cambios.", "pauseAfterMs": 0},
        ]}
        edited = json.loads(json.dumps(original))
        edited["segments"][0]["text"] = "Introducción corregida."
        before = narration_chunks(original, 4500)
        after = narration_chunks(edited, 4500)
        self.assertEqual(len(before), 3)
        self.assertNotEqual(before[0]["text"], after[0]["text"])
        self.assertEqual(before[1:], after[1:])

    def test_narration_chunks_reject_invalid_provider_pause_lengths(self):
        request = {"title": "Título", "segments": [
            {"id": "script-001", "text": "Primera parte.", "pauseAfterMs": 3001},
            {"id": "script-002", "text": "Segunda parte.", "pauseAfterMs": 0},
        ]}
        with self.assertRaisesRegex(ValueError, "between 1 and 3000"):
            narration_chunks(request, 4500)

    def test_paid_chunks_are_reused_after_a_later_request_fails(self):
        configuration = json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8"))
        calls = []
        def requester(url, key, payload):
            calls.append(payload["text"])
            if payload["text"] == "Segundo bloque":
                raise RuntimeError("quota_exceeded")
            return b"paid-audio"
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            audio, reused = cached_chunk("Primer bloque", "voice", "key", configuration, cache, requester)
            self.assertEqual((audio, reused), (b"paid-audio", False))
            with self.assertRaisesRegex(RuntimeError, "quota_exceeded"):
                cached_chunk("Segundo bloque", "voice", "key", configuration, cache, requester)
            audio, reused = cached_chunk("Primer bloque", "voice", "key", configuration, cache, requester)
            self.assertEqual((audio, reused), (b"paid-audio", True))
            self.assertEqual(calls, ["Primer bloque", "Segundo bloque"])

    def test_changed_block_does_not_invalidate_unrelated_cached_audio(self):
        configuration = json.loads((ROOT / "config/tts/elevenlabs-production.json").read_text(encoding="utf-8"))
        calls = []
        requester = lambda url, key, payload: calls.append(payload["text"]) or payload["text"].encode()
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            cached_chunk("Sin cambios", "voice", "key", configuration, cache, requester)
            cached_chunk("Texto original", "voice", "key", configuration, cache, requester)
            _, first_reused = cached_chunk("Sin cambios", "voice", "key", configuration, cache, requester)
            _, changed_reused = cached_chunk("Texto corregido", "voice", "key", configuration, cache, requester)
            self.assertTrue(first_reused)
            self.assertFalse(changed_reused)
            self.assertEqual(calls, ["Sin cambios", "Texto original", "Texto corregido"])

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
