#!/usr/bin/env python3

import json
import tempfile
import unittest
from pathlib import Path

from review_long_form import generate_review, validate_review


ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / "benchmarks" / "tts" / "long-form-review.json"
CONFIGURATION = ROOT / "config" / "tts" / "production.json"
PRONUNCIATIONS = ROOT / "config" / "tts" / "pronunciations.json"


class LongFormReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = json.loads(REVIEW.read_text(encoding="utf-8"))
        cls.configuration = json.loads(CONFIGURATION.read_text(encoding="utf-8"))
        cls.pronunciations = json.loads(PRONUNCIATIONS.read_text(encoding="utf-8"))

    def test_repository_fixture_is_valid_and_bilingual(self):
        self.assertEqual(validate_review(self.review), self.review)
        self.assertEqual(
            {request["locale"] for request in self.review["requests"]},
            {"es", "en"},
        )

    def test_review_uses_fixed_settings_and_publishes_atomically(self):
        calls = []

        def renderer(request, manifest, model_root, output, voice, version, **settings):
            calls.append((request["locale"], voice, version, settings))
            output.mkdir()
            result = {
                "locale": request["locale"],
                "voice": voice,
                "configurationVersion": version,
            }
            (output / "result.json").write_text(json.dumps(result), encoding="utf-8")
            return result

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "review"
            summary = generate_review(
                self.review,
                self.configuration,
                self.pronunciations,
                {},
                Path(directory) / "model",
                output,
                renderer,
            )
            self.assertTrue((output / "summary.json").is_file())
            self.assertFalse(output.with_name("review.generating").exists())
        self.assertEqual(
            [(locale, voice) for locale, voice, _, _ in calls],
            [("es", "em_alex"), ("en", "af_heart")],
        )
        for _, _, version, settings in calls:
            self.assertEqual(version, 4)
            self.assertEqual(settings["speed"], 1.02)
            self.assertEqual(settings["pause_seconds"], 0.16)
            self.assertEqual(settings["pronunciation_version"], 7)
        self.assertEqual(summary["configurationVersion"], 4)

    def test_failure_removes_combined_staging_output(self):
        def failure(*args, **kwargs):
            raise RuntimeError("render failed")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "review"
            with self.assertRaisesRegex(RuntimeError, "render failed"):
                generate_review(
                    self.review,
                    self.configuration,
                    self.pronunciations,
                    {},
                    Path(directory) / "model",
                    output,
                    failure,
                )
            self.assertFalse(output.exists())
            self.assertFalse(output.with_name("review.generating").exists())


if __name__ == "__main__":
    unittest.main()
