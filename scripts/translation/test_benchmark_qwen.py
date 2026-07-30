#!/usr/bin/env python3

import unittest

from benchmark_qwen import build_prompt, extract_translations


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


if __name__ == "__main__":
    unittest.main()
