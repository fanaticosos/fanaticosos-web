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
        commands = re.findall(r"^  ([a-z][a-z0-9-]*)\)", case_block, re.MULTILINE)
        self.assertEqual(
            commands,
            [
                "sync",
                "preflight",
                "install-translation-template",
                "import-job-request",
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
                "run-spanglish-diagnostic",
                "export-spanglish-diagnostic",
                "run-tts-tuning-matrix",
                "export-tts-tuning-matrix",
                "run-latino-diagnostic",
                "export-latino-diagnostic",
                "run-tts-long-form-review",
                "export-tts-long-form-review",
                "run-nfl-name-review",
                "export-nfl-name-review",
                "install-piper-claude",
                "run-claude-nfl-review",
                "export-claude-nfl-review",
                "install-tts-template",
                "install-azure-speech-credential",
                "azure-speech-credential-status",
                "install-publisher",
                "publisher-status",
                "prepare-tts-demo",
                "start-tts",
                "tts-status",
                "export-tts-result",
                "install-supertonic3",
                "run-supertonic3-article",
                "export-supertonic3-article",
            ],
        )

    def test_job_import_is_fixed_scoped_and_validated(self):
        importer = self.helper.split("command_import_job_request()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn(
            'import_file="/home/sysadmin/fanaticosos-job-$job_id.json"',
            importer,
        )
        self.assertIn('[[ "$kind" == "translation" || "$kind" == "tts" ]]', importer)
        self.assertIn("validate_translation_request", importer)
        self.assertIn("validate_request", importer)
        self.assertIn('sha256sum "$import_file"', importer)
        self.assertIn('[[ "$(stat -c %U "$import_file")" == "sysadmin" ]]', importer)
        self.assertIn('[[ ! -e "$job_dir" ]]', importer)
        self.assertIn('"$job_dir/request.json.importing"', importer)
        self.assertIn("trap cleanup_failed_import ERR", importer)
        self.assertIn('mv "$job_dir/request.json.importing" "$job_dir/request.json"', importer)
        self.assertNotIn("eval ", importer)

    def test_real_tts_commands_are_fixed_scoped(self):
        installer = self.helper.split("command_install_tts_template()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('systemd-analyze verify "$tts_source_unit"', installer)
        self.assertIn('install -o root -g root -m 0644', installer)

        starter = self.helper.split("command_start_tts()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('systemctl start --wait "$unit"', starter)
        self.assertIn('exactly one MP3', starter)

        exporter = self.helper.split("command_export_tts_result()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('/home/sysadmin/fanaticosos-tts-result-', exporter)
        self.assertNotIn('"$2"', exporter)

    def test_azure_credential_installer_is_stdin_only_and_root_scoped(self):
        installer = self.helper.split(
            "command_install_azure_speech_credential()", 1
        )[1].split("\n}\n", 1)[0]
        self.assertIn("IFS= read -r speech_key", installer)
        self.assertIn('install -d -o root -g root -m 0700', installer)
        self.assertIn('chmod 0600 "$temporary"', installer)
        self.assertIn('AZURE_SPEECH_REGION=eastus', installer)
        self.assertNotIn('echo "$speech_key"', installer)

    def test_publisher_installer_is_netbird_scoped(self):
        installer = self.helper.split("command_install_publisher()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('systemd-analyze verify "$publisher_source_unit"', installer)
        self.assertIn('install -d -o "$service_account"', installer)
        self.assertIn("systemctl enable --now fanaticosos-publisher.service", installer)
        self.assertIn('cmp -s "$publisher_source_unit"', installer)

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
        self.assertEqual(len(commands), 3)
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

    def test_spanglish_diagnostic_has_private_temporary_directory(self):
        diagnostic = self.helper.split(
            "command_run_spanglish_diagnostic()", 1
        )[1].split("\n}\n", 1)[0]
        self.assertIn('PrivateTmp=yes', diagnostic)

    def test_tuning_matrix_has_fixed_automatic_limits(self):
        tuning = self.helper.split("command_run_tts_tuning_matrix()", 1)[1].split(
            "\n}\n", 1
        )[0]
        for value in (
            "RuntimeMaxSec=10min",
            "MemoryMax=4G",
            "MemorySwapMax=512M",
            "PrivateTmp=yes",
            "PrivateNetwork=yes",
        ):
            self.assertIn(value, tuning)
        self.assertNotIn('"$2"', tuning)

    def test_latino_diagnostic_has_fixed_automatic_limits(self):
        diagnostic = self.helper.split(
            "command_run_latino_diagnostic()", 1
        )[1].split("\n}\n", 1)[0]
        for value in (
            "RuntimeMaxSec=5min",
            "MemoryMax=4G",
            "MemorySwapMax=512M",
            "PrivateTmp=yes",
            "PrivateNetwork=yes",
        ):
            self.assertIn(value, diagnostic)
        self.assertIn("diagnose_latino_delivery.py", diagnostic)
        self.assertNotIn('"$2"', diagnostic)

    def test_long_form_review_has_fixed_automatic_limits(self):
        review = self.helper.split(
            "command_run_tts_long_form_review()", 1
        )[1].split("\n}\n", 1)[0]
        for value in (
            "RuntimeMaxSec=10min",
            "MemoryMax=8G",
            "MemorySwapMax=1G",
            "PrivateTmp=yes",
            "PrivateNetwork=yes",
        ):
            self.assertIn(value, review)
        self.assertIn("long-form-review.json", review)
        self.assertNotIn('"$2"', review)

    def test_nfl_name_review_has_fixed_automatic_limits(self):
        review = self.helper.split(
            "command_run_nfl_name_review()", 1
        )[1].split("\n}\n", 1)[0]
        for value in (
            "RuntimeMaxSec=10min",
            "MemoryMax=4G",
            "MemorySwapMax=512M",
            "PrivateTmp=yes",
            "PrivateNetwork=yes",
        ):
            self.assertIn(value, review)
        self.assertIn("nfl-name-review.json", review)
        self.assertNotIn('"$2"', review)

    def test_claude_review_has_fixed_automatic_limits(self):
        review = self.helper.split(
            "command_run_claude_nfl_review()", 1
        )[1].split("\n}\n", 1)[0]
        for value in ("RuntimeMaxSec=10min", "MemoryMax=2G", "PrivateNetwork=yes"):
            self.assertIn(value, review)
        self.assertNotIn('"$2"', review)

    def test_installer_refuses_overwrite(self):
        self.assertIn('if [[ -e "$target" ]]', self.installer)
        self.assertIn("visudo -cf", self.installer)

    def test_supertonic_candidate_is_pinned_bounded_and_isolated(self):
        installer = self.helper.split("command_install_supertonic3()", 1)[1].split(
            "\n}\n", 1
        )[0]
        self.assertIn('"supertonic==1.3.1"', installer)
        self.assertIn("3cadd1ee6394adea1bd021217a0e650ede09a323", installer)
        self.assertIn("HF_HUB_DISABLE_XET=1", installer)
        runner = self.helper.split("command_run_supertonic3_article()", 1)[1].split(
            "\n}\n", 1
        )[0]
        for value in (
            "RuntimeMaxSec=10min",
            "MemoryMax=8G",
            "MemorySwapMax=1G",
            "PrivateNetwork=yes",
            "ProtectSystem=strict",
        ):
            self.assertIn(value, runner)
        self.assertIn("render_supertonic3_candidate.py", runner)


if __name__ == "__main__":
    unittest.main()
