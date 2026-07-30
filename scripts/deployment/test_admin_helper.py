#!/usr/bin/env python3

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "deploy" / "admin" / "fanaticosos-blog-admin"
SUDOERS = ROOT / "deploy" / "admin" / "fanaticosos-blog-admin.sudoers"
INSTALLER = ROOT / "deploy" / "admin" / "install-fanaticosos-blog-admin.sh"


class AdminHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = HELPER.read_text(encoding="utf-8")
        cls.sudoers = SUDOERS.read_text(encoding="utf-8")
        cls.installer = INSTALLER.read_text(encoding="utf-8")

    def test_sudoers_allows_only_fixed_root_owned_helper(self):
        active = [
            line.strip()
            for line in self.sudoers.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.assertEqual(
            active,
            [
                "sysadmin ALL=(root) NOPASSWD: "
                "/usr/local/sbin/fanaticosos-blog-admin *"
            ],
        )

    def test_helper_has_no_shell_or_arbitrary_command_subcommand(self):
        case_block = self.helper.split('case "$command" in', 1)[1]
        commands = re.findall(r"^  ([a-z][a-z-]*)\)", case_block, re.MULTILINE)
        self.assertEqual(
            commands,
            [
                "sync",
                "preflight",
                "install-translation-template",
                "prepare-acceptance-job",
                "start-translation",
                "translation-status",
                "translation-result",
                "translation-failure",
                "host-health",
                "update-admin",
                "install-kokoro-runtime",
                "kokoro-runtime-status",
            ],
        )

    def test_kokoro_installer_has_fixed_scope(self):
        self.assertIn(
            'readonly kokoro_venv="/var/lib/fanaticosos-blog/venvs/tts-benchmark-kokoro-v1"',
            self.helper,
        )
        self.assertIn(
            'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends espeak-ng',
            self.helper,
        )
        self.assertIn('[[ ! -e "$kokoro_venv" ]]', self.helper)
        self.assertIn("cleanup_incomplete_kokoro_runtime", self.helper)
        self.assertIn('rm -rf -- "$kokoro_venv"', self.helper)
        self.assertIn("trap cleanup_incomplete_kokoro_runtime EXIT", self.helper)
        self.assertIn("trap - EXIT", self.helper)
        self.assertNotIn("pip install kokoro", self.helper)

    def test_kokoro_requirements_force_cpu_torch(self):
        requirements = (
            ROOT / "config" / "tts" / "kokoro-benchmark-requirements.txt"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "--extra-index-url https://download.pytorch.org/whl/cpu",
            requirements,
        )
        self.assertIn("torch==2.13.0+cpu", requirements)

    def test_helper_validates_commit_and_job_identifiers(self):
        self.assertIn("^[0-9a-f]{7,40}$", self.helper)
        self.assertIn("^[a-z0-9]+(-[a-z0-9]+)*$", self.helper)
        self.assertNotIn("eval ", self.helper)

    def test_installer_refuses_overwrite(self):
        self.assertIn('if [[ -e "$target" ]]', self.installer)
        self.assertIn("visudo -cf", self.installer)


if __name__ == "__main__":
    unittest.main()
