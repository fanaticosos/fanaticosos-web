#!/usr/bin/env python3

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from render_article_kokoro import render_article, validate_voice


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


def fake_synthesizer(request, manifest, model_root, voice, wav_path):
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


if __name__ == "__main__":
    unittest.main()
