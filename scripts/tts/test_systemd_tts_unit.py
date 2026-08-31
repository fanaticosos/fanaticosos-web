#!/usr/bin/env python3

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "deploy" / "systemd" / "fanaticosos-tts@.service"


class TtsSystemdUnitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.unit = UNIT.read_text(encoding="utf-8")

    def test_unit_has_fixed_worker_and_configuration(self):
        self.assertIn("scripts/tts/render_article_production.py", self.unit)
        self.assertIn("--repository /opt/fanaticosos-blog/repository", self.unit)
        self.assertIn("EnvironmentFile=-/etc/fanaticosos-blog/azure-speech.env", self.unit)
        self.assertIn("EnvironmentFile=-/etc/fanaticosos-blog/elevenlabs.env", self.unit)
        self.assertNotIn("--voice", self.unit)

    def test_unit_has_automatic_resource_boundaries(self):
        self.assertIn("Type=exec", self.unit)
        self.assertNotIn("Type=oneshot", self.unit)
        for directive in (
            "RuntimeMaxSec=15min",
            "MemoryMax=8G",
            "MemorySwapMax=1G",
            "KillMode=control-group",
            "Restart=no",
        ):
            self.assertIn(directive, self.unit)

    def test_unit_is_write_restricted(self):
        for directive in (
            "ProtectSystem=strict",
            "ProtectHome=yes",
            "NoNewPrivileges=yes",
            "ReadWritePaths=/opt/fanaticosos-blog/jobs/%i",
            "UMask=0077",
        ):
            self.assertIn(directive, self.unit)

    def test_network_is_available_for_bounded_spanish_elevenlabs_jobs(self):
        self.assertNotIn("PrivateNetwork=yes", self.unit)

    def test_unit_uses_service_account_and_fixed_job_paths(self):
        self.assertIn("User=fanaticosos-blog", self.unit)
        self.assertIn("Group=fanaticosos-blog", self.unit)
        self.assertIn("/opt/fanaticosos-blog/jobs/%i/request.json", self.unit)
        self.assertIn("/opt/fanaticosos-blog/jobs/%i/audio", self.unit)


if __name__ == "__main__":
    unittest.main()
