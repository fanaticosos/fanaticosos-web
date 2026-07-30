#!/usr/bin/env python3

import copy
import json
import unittest
from pathlib import Path

from validate_benchmark import EXPECTED_VOICES, validate_benchmark


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "benchmarks" / "tts" / "es-en.json"


class TtsBenchmarkValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_repository_fixture_is_valid(self):
        self.assertEqual(validate_benchmark(self.fixture), self.fixture)

    def test_candidate_set_is_fixed(self):
        self.assertEqual(self.fixture["candidates"], EXPECTED_VOICES)

    def test_rejects_missing_pronunciation_target(self):
        invalid = copy.deepcopy(self.fixture)
        invalid["samples"][0]["pronunciationTargets"].append("Not in sample")
        with self.assertRaisesRegex(ValueError, "targets missing from text"):
            validate_benchmark(invalid)

    def test_rejects_wrong_language_code(self):
        invalid = copy.deepcopy(self.fixture)
        invalid["samples"][1]["languageCode"] = "b"
        with self.assertRaisesRegex(ValueError, "incorrect Kokoro language code"):
            validate_benchmark(invalid)


if __name__ == "__main__":
    unittest.main()
