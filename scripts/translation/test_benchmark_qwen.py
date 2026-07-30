#!/usr/bin/env python3

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from benchmark_qwen import build_prompt, extract_translations, run_llama


class QwenBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.benchmark = {
            "cases": [
                {"id": "one", "source": "Los Bears ganaron."},
                {"id": "two", "source": "Hubo un balón suelto."},
            ]
        }
        self.glossary = {
            "terms": [{"source": "balón suelto", "target": "fumble"}],
            "protectedNames": ["Bears"],
        }

    def test_prompt_contains_glossary_and_no_think(self):
        prompt = build_prompt(self.benchmark, self.glossary)
        self.assertIn("balón suelto = fumble", prompt)
        self.assertIn("Protected names: Bears", prompt)
        self.assertIn("/no_think", prompt)

    def test_extracts_exact_json(self):
        actual = extract_translations(
            '{"translations":[{"id":"one","translation":"One"},'
            '{"id":"two","translation":"Two"}]}',
            ["one", "two"],
        )
        self.assertEqual(actual, {"one": "One", "two": "Two"})

    def test_extracts_fenced_json_after_thinking(self):
        raw = (
            "<think>ignored</think>\n```json\n"
            '{"translations":[{"id":"one","translation":"One"}]}\n```'
        )
        self.assertEqual(extract_translations(raw, ["one"]), {"one": "One"})

    def test_rejects_wrong_order(self):
        raw = (
            '{"translations":[{"id":"two","translation":"Two"},'
            '{"id":"one","translation":"One"}]}'
        )
        with self.assertRaisesRegex(ValueError, "ids/order mismatch"):
            extract_translations(raw, ["one", "two"])

    def test_run_llama_does_not_buffer_process_streams(self):
        def fake_run(command, **kwargs):
            self.assertIs(kwargs["stdin"], __import__("subprocess").DEVNULL)
            self.assertIs(kwargs["stdout"], __import__("subprocess").DEVNULL)
            self.assertTrue(hasattr(kwargs["stderr"], "write"))
            output_path = Path(command[command.index("--output") + 1])
            output_path.write_text('{"translations":[]}', encoding="utf-8")
            kwargs["stderr"].write(b"bounded diagnostic")
            return SimpleNamespace(returncode=0)

        with patch("benchmark_qwen.subprocess.run", side_effect=fake_run):
            output, stderr, _ = run_llama(
                Path("/test/llama-cli"),
                Path("/test/model.gguf"),
                "prompt",
                2,
                4096,
                1024,
            )

        self.assertEqual(output, '{"translations":[]}')
        self.assertEqual(stderr, "bounded diagnostic")


if __name__ == "__main__":
    unittest.main()
