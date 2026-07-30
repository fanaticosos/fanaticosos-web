#!/usr/bin/env python3

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREFLIGHT = ROOT / "scripts" / "deployment" / "preflight_translation_acceptance.sh"


class PreflightTranslationAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = PREFLIGHT.read_text(encoding="utf-8")

    def test_compares_full_commit_hash(self):
        self.assertIn('git -C "$repository" rev-parse HEAD', self.script)
        self.assertNotIn('git -C "$repository" rev-parse --short HEAD', self.script)
        self.assertIn('[[ "$current_commit" != "$expected_commit" ]]', self.script)

    def test_displays_short_hash_without_shortening_compared_value(self):
        self.assertIn('echo "Repository commit: ${current_commit:0:7}"', self.script)


if __name__ == "__main__":
    unittest.main()
