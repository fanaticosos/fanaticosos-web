#!/usr/bin/env python3

import copy
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from download_kokoro_candidates import download_candidates, validate_manifest


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "config" / "tts" / "kokoro-candidate-files.json"


class DownloadKokoroCandidatesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    def test_repository_manifest_is_valid(self):
        self.assertEqual(validate_manifest(self.manifest), self.manifest)

    def test_rejects_path_traversal(self):
        invalid = copy.deepcopy(self.manifest)
        invalid["files"][0]["path"] = "../config.json"
        with self.assertRaisesRegex(ValueError, "unsafe file path"):
            validate_manifest(invalid)

    def test_rejects_wrong_revision(self):
        invalid = copy.deepcopy(self.manifest)
        invalid["revision"] = "0" * 40
        with self.assertRaisesRegex(ValueError, "unexpected model revision"):
            validate_manifest(invalid)

    def test_failure_removes_staging_and_publishes_nothing(self):
        manifest = copy.deepcopy(self.manifest)
        payloads = {}
        for item in manifest["files"]:
            content = item["path"].encode()
            item["size"] = len(content)
            item["sha256"] = hashlib.sha256(content).hexdigest()
            payloads[item["path"]] = content
        manifest["files"][-1]["sha256"] = "0" * 64

        def opener(url: str):
            path = url.split(f"/{manifest['revision']}/", 1)[1]
            return io.BytesIO(payloads[path])

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model"
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                download_candidates(manifest, target, opener)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name("model.installing").exists())


if __name__ == "__main__":
    unittest.main()
