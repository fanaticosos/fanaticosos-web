#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import generate_elevenlabs_pronunciation_diagnostic as diagnostic


class ElevenLabsPronunciationDiagnosticTests(unittest.TestCase):
    def test_generates_only_bounded_phrase_samples(self):
        requests = []

        def fake_api(url, key, data=None):
            requests.append((url, key, data))
            if "/v2/voices" in url:
                return json.dumps(
                    {"voices": [{"name": diagnostic.VOICE_NAME, "voice_id": "voice-1"}]}
                ).encode()
            if url.endswith("/settings"):
                return json.dumps({"stability": 0.5}).encode()
            return b"private-audio"

        with tempfile.TemporaryDirectory() as directory, patch.object(
            diagnostic, "api", side_effect=fake_api
        ):
            output = Path(directory) / "diagnostic"
            diagnostic.generate(output, "secret-key")
            summary = json.loads((output / "summary.json").read_text())

            self.assertEqual(
                [sample["text"] for sample in summary["samples"]],
                [text for _, text in diagnostic.CANDIDATES],
            )
            self.assertEqual(len(summary["samples"]), 3)
            self.assertEqual(len([call for call in requests if call[2] is not None]), 3)
            self.assertNotIn("secret-key", (output / "summary.json").read_text())
            for sample in summary["samples"]:
                self.assertEqual((output / sample["file"]).read_bytes(), b"private-audio")
                self.assertEqual((output / sample["file"]).stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
