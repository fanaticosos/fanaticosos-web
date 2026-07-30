#!/usr/bin/env python3

import copy
import json
import unittest
from pathlib import Path

from tune_selected_voices import EXPECTED_PROFILES, join_with_pause, validate_matrix


ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "config" / "tts" / "tuning-matrix.json"


class FakeTensor:
    def __init__(self, values):
        self.values = list(values)

    def detach(self): return self
    def cpu(self): return self
    def flatten(self): return self
    def numel(self): return len(self.values)


class FakeTorch:
    @staticmethod
    def zeros(count): return FakeTensor([0] * count)

    @staticmethod
    def cat(values):
        return FakeTensor(item for value in values for item in value.values)


class SelectedVoiceTuningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = json.loads(MATRIX.read_text(encoding="utf-8"))

    def test_repository_matrix_is_valid(self):
        self.assertEqual(validate_matrix(self.matrix), self.matrix)
        self.assertEqual(self.matrix["profiles"], EXPECTED_PROFILES)

    def test_matrix_uses_owner_selected_voices_only(self):
        self.assertEqual(self.matrix["voices"], {"es": "em_alex", "en": "af_heart"})

    def test_changed_profile_is_rejected(self):
        invalid = copy.deepcopy(self.matrix)
        invalid["profiles"][0]["speed"] = 0.5
        with self.assertRaisesRegex(ValueError, "profiles"):
            validate_matrix(invalid)

    def test_join_uses_requested_pause(self):
        result = join_with_pause(
            [FakeTensor([1]), FakeTensor([2])], 0.1, FakeTorch
        )
        self.assertEqual(len(result.values), 1 + 2400 + 1)


if __name__ == "__main__":
    unittest.main()
