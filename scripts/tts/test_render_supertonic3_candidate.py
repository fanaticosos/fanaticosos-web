#!/usr/bin/env python3

import json
import tempfile
import unittest
from pathlib import Path

from render_supertonic3_candidate import load_candidate


ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / "config" / "tts" / "supertonic3-candidate.json"


class SupertonicCandidateTests(unittest.TestCase):
    def test_versioned_candidate_is_exact(self):
        value = load_candidate(CANDIDATE)
        self.assertEqual(value["packageVersion"], "1.3.1")
        self.assertEqual(
            value["modelRevision"],
            "3cadd1ee6394adea1bd021217a0e650ede09a323",
        )
        self.assertEqual(value["languages"], ["es", "na"])
        self.assertEqual(value["steps"], 12)
        self.assertEqual(value["voice"], "M1")

    def test_rejects_candidate_drift(self):
        value = json.loads(CANDIDATE.read_text(encoding="utf-8"))
        value["steps"] = 8
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected"):
                load_candidate(path)


if __name__ == "__main__":
    unittest.main()
