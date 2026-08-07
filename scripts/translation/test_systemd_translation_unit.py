#!/usr/bin/env python3

import configparser
import unittest
from pathlib import Path


UNIT_PATH = (
    Path(__file__).resolve().parents[2]
    / "deploy"
    / "systemd"
    / "fanaticosos-translation@.service"
)


class TranslationSystemdUnitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = UNIT_PATH.read_text(encoding="utf-8")
        cls.parser = configparser.ConfigParser(
            strict=False,
            interpolation=None,
            empty_lines_in_values=False,
        )
        cls.parser.optionxform = str
        cls.parser.read_string(cls.text)

    def test_unit_is_an_on_demand_template(self):
        self.assertIn("%i", self.parser["Unit"]["Description"])
        self.assertIn("%i/request.json", self.parser["Unit"]["ConditionPathExists"])
        self.assertEqual(
            self.parser["Service"]["ExecCondition"],
            "/usr/bin/test -f /opt/fanaticosos-blog/jobs/%i/request.json",
        )
        self.assertNotIn("WantedBy", self.parser["Install"])

    def test_runs_as_dedicated_account_with_private_output(self):
        service = self.parser["Service"]
        self.assertEqual(service["User"], "fanaticosos-blog")
        self.assertEqual(service["Group"], "fanaticosos-blog")
        self.assertEqual(service["UMask"], "0077")
        self.assertIn("%i/result.json", service["ExecStart"])

    def test_enforces_resource_and_process_limits(self):
        service = self.parser["Service"]
        self.assertEqual(service["RuntimeMaxSec"], "12min")
        self.assertEqual(service["TimeoutStopSec"], "30s")
        self.assertEqual(service["KillMode"], "control-group")
        self.assertEqual(service["MemoryMax"], "16G")
        self.assertEqual(service["MemorySwapMax"], "1G")
        self.assertEqual(service["Restart"], "no")

    def test_blocks_network_and_host_mutation(self):
        service = self.parser["Service"]
        for directive in (
            "NoNewPrivileges",
            "PrivateDevices",
            "PrivateNetwork",
            "PrivateTmp",
            "ProtectControlGroups",
            "ProtectKernelModules",
            "ProtectKernelTunables",
        ):
            self.assertEqual(service[directive], "yes")
        self.assertEqual(service["ProtectSystem"], "strict")
        self.assertEqual(
            service["ReadWritePaths"], "/opt/fanaticosos-blog/jobs/%i"
        )

    def test_pins_model_runtime_and_worker_configuration(self):
        command = self.parser["Service"]["ExecStart"]
        self.assertIn("translate_article_qwen.py", command)
        self.assertIn("Qwen3-8B-Q4_K_M.gguf", command)
        self.assertIn("7c41481f57cb95916b40956ab2f0b139b296d974", command)
        self.assertIn("b10195-47f686f53", command)
        self.assertIn("--configuration-version 8", command)
        self.assertIn("%i/failed-output.json", command)
        self.assertIn("--output-tokens 4096", command)
        self.assertIn("--max-batch-characters 12000", command)


if __name__ == "__main__":
    unittest.main()
