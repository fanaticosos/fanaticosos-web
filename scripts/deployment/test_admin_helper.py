#!/usr/bin/env python3

import re
import shlex
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
                "download-kokoro-candidates",
                "migrate-to-opt",
                "release-layout-status",
                "finalize-opt-layout",
                "run-kokoro-benchmark",
                "kokoro-benchmark-status",
                "install-kokoro-english-model",
                "export-kokoro-samples",
                "verify-tts-template",
            ],
        )

    def test_kokoro_installer_has_fixed_scope(self):
        self.assertIn(
            'readonly kokoro_venv="$data_root/runtimes/tts-benchmark-kokoro-v1"',
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

    def test_inline_python_verification_commands_parse(self):
        commands = re.findall(r"\n\s+'(import importlib\.metadata as m;[^']+)'", self.helper)
        self.assertEqual(len(commands), 2)
        for command in commands:
            compile(shlex.split(shlex.quote(command))[0], "<admin-helper>", "exec")

    def test_runtime_status_reports_phonemizer_dependencies(self):
        self.assertIn('m.version("misaki")', self.helper)
        self.assertIn('m.version("spacy")', self.helper)
        self.assertIn('spacy.util.get_installed_models()', self.helper)

    def test_helper_validates_commit_and_job_identifiers(self):
        self.assertIn("^[0-9a-f]{7,40}$", self.helper)
        self.assertIn("^[a-z0-9]+(-[a-z0-9]+)*$", self.helper)
        self.assertNotIn("eval ", self.helper)

    def test_release_inventory_has_fixed_read_only_scope(self):
        self.assertIn("command_release_layout_status()", self.helper)
        self.assertIn("/srv/fanaticosos-blog/releases", self.helper)
        self.assertIn("/opt/fanaticosos-blog/releases", self.helper)
        inventory = self.helper.split("command_release_layout_status()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertNotIn("rm ", inventory)
        self.assertNotIn("mv ", inventory)

    def test_layout_finalizer_requires_empty_fixed_legacy_directory(self):
        finalizer = self.helper.split("command_finalize_opt_layout()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('local legacy_root="/srv/fanaticosos-blog"', finalizer)
        self.assertIn('find "$legacy_releases" -mindepth 1 -print -quit', finalizer)
        self.assertIn('[[ ! -e "$target_releases" ]]', finalizer)
        self.assertIn('rmdir "$legacy_root"', finalizer)
        self.assertNotIn("rm ", finalizer)

    def test_kokoro_benchmark_is_fixed_bounded_and_offline(self):
        runner = self.helper.split("command_run_kokoro_benchmark()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('RuntimeMaxSec=15min', runner)
        self.assertIn('MemoryMax=8G', runner)
        self.assertIn('MemorySwapMax=1G', runner)
        self.assertIn('PrivateNetwork=yes', runner)
        self.assertIn('ProtectSystem=strict', runner)
        self.assertIn('HF_HUB_OFFLINE=1', runner)
        self.assertIn('ReadWritePaths=$data_root/work', runner)
        self.assertNotIn('"$2"', runner)

    def test_spacy_model_installer_is_pinned_and_verified(self):
        installer = self.helper.split(
            "command_install_kokoro_english_model()", 1
        )[1].split("\n}\n", 1)[0]
        self.assertIn("en_core_web_sm-3.8.0-py3-none-any.whl", installer)
        self.assertIn("12806118", installer)
        self.assertIn(
            "1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85",
            installer,
        )
        self.assertIn("--no-deps", installer)
        self.assertIn("en_core_web_sm-3.8.0-py3-none-any.whl", installer)
        self.assertIn("cleanup_spacy_install", installer)
        self.assertIn("Legacy spaCy staging file has unexpected checksum", installer)
        self.assertNotIn('"$2"', installer)

    def test_sample_export_has_fixed_scope(self):
        exporter = self.helper.split("command_export_kokoro_samples()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('/home/sysadmin/fanaticosos-tts-samples', exporter)
        for sample in (
            "es-ef_dora.mp3",
            "es-em_alex.mp3",
            "es-em_santa.mp3",
            "en-af_heart.mp3",
            "en-af_bella.mp3",
        ):
            self.assertIn(sample, exporter)
        self.assertIn('[[ ! -e "$export_root" ]]', exporter)
        self.assertNotIn('"$2"', exporter)

    def test_tts_template_verification_has_fixed_scope(self):
        verifier = self.helper.split("command_verify_tts_template()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('systemd-analyze verify "$tts_source_unit"', verifier)
        self.assertNotIn('"$2"', verifier)

    def test_installer_refuses_overwrite(self):
        self.assertIn('if [[ -e "$target" ]]', self.installer)
        self.assertIn("visudo -cf", self.installer)


if __name__ == "__main__":
    unittest.main()
