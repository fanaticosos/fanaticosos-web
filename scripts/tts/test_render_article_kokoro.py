#!/usr/bin/env python3

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from render_article_kokoro import (
    render_article,
    resolve_delivery,
    resolve_production_voice,
    validate_voice,
)


ARTICLE_ID = "00000000-0000-4000-8000-000000000001"


def request_fixture(locale="es"):
    return {
        "schemaVersion": 1,
        "articleId": ARTICLE_ID,
        "locale": locale,
        "sourceRevision": "1" * 64,
        "title": "Los Bears ganan" if locale == "es" else "The Bears win",
        "segments": [{"id": "body-001", "text": "Texto final."}],
    }


def manifest_fixture(model_root):
    files = []
    paths = [
        "config.json",
        "kokoro-v1_0.pth",
        "voices/ef_dora.pt",
        "voices/em_alex.pt",
        "voices/em_santa.pt",
        "voices/af_heart.pt",
        "voices/af_bella.pt",
    ]
    for relative in paths:
        path = model_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        content = relative.encode("utf-8")
        path.write_bytes(content)
        files.append(
            {
                "path": relative,
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    return {
        "schemaVersion": 1,
        "repository": "hexgrad/Kokoro-82M",
        "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        "license": "Apache-2.0",
        "files": files,
    }


def fake_synthesizer(
    request, manifest, model_root, voice, wav_path, speed, pause_seconds
):
    wav_path.write_bytes(b"fake-wav")
    return {"generationSeconds": 1.0}


def fake_ffmpeg(wav_path, mp3_path):
    mp3_path.write_bytes(b"fake-mp3")


def fake_probe(path):
    return {
        "codec": "mp3",
        "sampleRateHz": 48000,
        "channels": 1,
        "bitRate": 128000,
        "durationSeconds": 10.0,
        "sizeBytes": path.stat().st_size,
    }


class KokoroArticleWorkerTests(unittest.TestCase):
    def test_rejects_cross_language_voice(self):
        with self.assertRaisesRegex(ValueError, "not permitted"):
            validate_voice("es", "af_heart")

    def test_rejects_unknown_voice(self):
        with self.assertRaisesRegex(ValueError, "not permitted"):
            validate_voice("en", "custom_voice")

    def test_success_publishes_atomic_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_root = root / "model"
            manifest = manifest_fixture(model_root)
            output = root / "result"
            with patch("render_article_kokoro.run_ffmpeg", fake_ffmpeg), patch(
                "render_article_kokoro.probe_audio", fake_probe
            ):
                result = render_article(
                    request_fixture(),
                    manifest,
                    model_root,
                    output,
                    "ef_dora",
                    1,
                    fake_synthesizer,
                )
            self.assertTrue((output / result["file"]).is_file())
            self.assertTrue((output / "result.json").is_file())
            self.assertFalse(output.with_name("result.generating").exists())
            published = json.loads((output / "result.json").read_text())
            self.assertEqual(published["voice"], "ef_dora")
            self.assertEqual(published["sha256"], hashlib.sha256(b"fake-mp3").hexdigest())

    def test_spanish_pronunciations_change_only_synthesizer_input(self):
        captured = {}

        def capture(request, manifest, model_root, voice, wav_path, speed, pause_seconds):
            captured["request"] = request
            captured["speed"] = speed
            captured["pauseSeconds"] = pause_seconds
            return fake_synthesizer(
                request, manifest, model_root, voice, wav_path, speed, pause_seconds
            )

        pronunciations = {
            "schemaVersion": 1,
            "version": 2,
            "overrides": {
                "es": [
                    {
                        "category": "player",
                        "written": "Caleb Williams",
                        "spoken": "Kéileb Uíliams",
                        "reason": "reviewed narration",
                    }
                ],
                "en": [],
            },
        }
        source = request_fixture()
        source["title"] = "Caleb Williams gana"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_root = root / "model"
            manifest = manifest_fixture(model_root)
            with patch("render_article_kokoro.run_ffmpeg", fake_ffmpeg), patch(
                "render_article_kokoro.probe_audio", fake_probe
            ):
                result = render_article(
                    source,
                    manifest,
                    model_root,
                    root / "result",
                    "em_alex",
                    3,
                    capture,
                    speed=1.02,
                    pause_seconds=0.16,
                    pronunciations=pronunciations,
                    pronunciation_version=2,
                )
        self.assertEqual(source["title"], "Caleb Williams gana")
        self.assertEqual(captured["request"]["title"], "Kéileb Uíliams gana")
        self.assertEqual(captured["speed"], 1.02)
        self.assertEqual(captured["pauseSeconds"], 0.16)
        self.assertEqual(result["pronunciationVersion"], 2)

    def test_failure_removes_staging_and_publishes_nothing(self):
        def failure(*args):
            raise RuntimeError("synthesis failed")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_root = root / "model"
            manifest = manifest_fixture(model_root)
            output = root / "result"
            with self.assertRaisesRegex(RuntimeError, "synthesis failed"):
                render_article(
                    request_fixture(),
                    manifest,
                    model_root,
                    output,
                    "ef_dora",
                    1,
                    failure,
                )
            self.assertFalse(output.exists())
            self.assertFalse(output.with_name("result.generating").exists())

    def test_existing_result_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_root = root / "model"
            manifest = manifest_fixture(model_root)
            output = root / "result"
            output.mkdir()
            with self.assertRaisesRegex(FileExistsError, "already exists"):
                render_article(
                    request_fixture(),
                    manifest,
                    model_root,
                    output,
                    "ef_dora",
                    1,
                    fake_synthesizer,
                )

    def test_locale_change_requires_matching_voice(self):
        request = request_fixture("en")
        changed = copy.deepcopy(request)
        self.assertEqual(changed["locale"], "en")
        validate_voice(changed["locale"], "af_bella")

    def test_pending_configuration_stops_before_voice_selection(self):
        configuration = {
            "schemaVersion": 1,
            "configurationVersion": 1,
            "status": "pending-owner-selection",
        }
        with self.assertRaisesRegex(ValueError, "not approved"):
            resolve_production_voice(configuration, "es", {})

    def test_selected_for_tuning_still_blocks_production(self):
        configuration = {
            "schemaVersion": 1,
            "configurationVersion": 2,
            "status": "selected-for-tuning",
            "localeVariants": {"es": "es-419", "en": "en-US"},
            "voices": {"es": "em_alex", "en": "af_heart"},
        }
        with self.assertRaisesRegex(ValueError, "not approved"):
            resolve_production_voice(configuration, "es", {})

    def test_broadcast_delivery_is_fixed_for_both_locales(self):
        configuration = {
            "delivery": {
                "es": {
                    "profile": "broadcast",
                    "speed": 1.02,
                    "pauseSeconds": 0.16,
                },
                "en": {
                    "profile": "broadcast",
                    "speed": 1.02,
                    "pauseSeconds": 0.16,
                },
            },
            "pronunciationVersion": 2,
        }
        self.assertEqual(resolve_delivery(configuration, "es"), (1.02, 0.16, 2))
        self.assertEqual(resolve_delivery(configuration, "en"), (1.02, 0.16, 2))

    def test_approved_configuration_resolves_fixed_locale_voice(self):
        manifest = {
            "repository": "hexgrad/Kokoro-82M",
            "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        }
        configuration = {
            "schemaVersion": 1,
            "configurationVersion": 2,
            "status": "approved",
            "model": manifest["repository"],
            "modelRevision": manifest["revision"],
            "localeVariants": {"es": "es-419", "en": "en-US"},
            "voices": {"es": "ef_dora", "en": "af_heart"},
            "encoding": {
                "codec": "mp3",
                "sampleRateHz": 48000,
                "channels": 1,
                "bitRate": 128000,
                "loudness": "EBU R128 I=-16 LUFS, TP=-1.5 dB, LRA=11 LU",
            },
        }
        self.assertEqual(
            resolve_production_voice(configuration, "en", manifest),
            ("af_heart", 2),
        )

    def test_configuration_rejects_cross_language_voice(self):
        manifest = {
            "repository": "hexgrad/Kokoro-82M",
            "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        }
        configuration = {
            "schemaVersion": 1,
            "configurationVersion": 2,
            "status": "approved",
            "model": manifest["repository"],
            "modelRevision": manifest["revision"],
            "localeVariants": {"es": "es-419", "en": "en-US"},
            "voices": {"es": "af_heart", "en": "af_bella"},
            "encoding": {
                "codec": "mp3",
                "sampleRateHz": 48000,
                "channels": 1,
                "bitRate": 128000,
                "loudness": "EBU R128 I=-16 LUFS, TP=-1.5 dB, LRA=11 LU",
            },
        }
        with self.assertRaisesRegex(ValueError, "not permitted"):
            resolve_production_voice(configuration, "es", manifest)

    def test_configuration_rejects_spain_spanish_variant(self):
        manifest = {
            "repository": "hexgrad/Kokoro-82M",
            "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        }
        configuration = {
            "schemaVersion": 1,
            "configurationVersion": 2,
            "status": "approved",
            "model": manifest["repository"],
            "modelRevision": manifest["revision"],
            "localeVariants": {"es": "es-ES", "en": "en-US"},
            "voices": {"es": "ef_dora", "en": "af_heart"},
            "encoding": {
                "codec": "mp3",
                "sampleRateHz": 48000,
                "channels": 1,
                "bitRate": 128000,
                "loudness": "EBU R128 I=-16 LUFS, TP=-1.5 dB, LRA=11 LU",
            },
        }
        with self.assertRaisesRegex(ValueError, "Latin American Spanish"):
            resolve_production_voice(configuration, "es", manifest)


if __name__ == "__main__":
    unittest.main()
