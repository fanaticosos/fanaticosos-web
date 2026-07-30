#!/usr/bin/env python3

import json
import tempfile
import unittest
from pathlib import Path

from benchmark_opus import (
    atomic_write_json,
    expected_protected_tokens,
    glossary_failures,
    preservation_failures,
    validate_inputs,
)


class BenchmarkTests(unittest.TestCase):
    def test_validation_rejects_duplicate_ids(self):
        benchmark = {
            "version": 1,
            "sourceLocale": "es",
            "targetLocale": "en",
            "cases": [
                {
                    "id": "same",
                    "category": "test",
                    "source": "Uno",
                    "mustPreserve": [],
                    "notes": "test",
                },
                {
                    "id": "same",
                    "category": "test",
                    "source": "Dos",
                    "mustPreserve": [],
                    "notes": "test",
                },
            ],
        }
        glossary = {
            "version": 1,
            "sourceLocale": "es",
            "targetLocale": "en",
            "protectedNames": [],
            "terms": [],
        }
        with self.assertRaisesRegex(ValueError, "duplicate benchmark case id"):
            validate_inputs(benchmark, glossary)

    def test_protected_tokens_are_deduplicated(self):
        actual = expected_protected_tokens(
            "América venció 2-1.", ["2-1", "América"], ["América"]
        )
        self.assertEqual(actual, ["2-1", "América"])

    def test_preservation_failures_are_exact(self):
        self.assertEqual(
            preservation_failures("América won 2-1.", ["América", "2-1"]), []
        )
        self.assertEqual(
            preservation_failures("America won 2-1.", ["América", "2-1"]),
            ["América"],
        )

    def test_glossary_failure_is_case_insensitive(self):
        terms = [{"source": "fuera de juego", "target": "offside"}]
        self.assertEqual(
            glossary_failures("Quedó en fuera de juego.", "He was OFFSIDE.", terms),
            [],
        )
        self.assertEqual(
            glossary_failures("Quedó en fuera de juego.", "He was misplaced.", terms),
            [{"source": "fuera de juego", "expectedTarget": "offside"}],
        )

    def test_atomic_json_write(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "nested" / "result.json"
            atomic_write_json(target, {"value": "México"})
            self.assertEqual(json.loads(target.read_text()), {"value": "México"})


if __name__ == "__main__":
    unittest.main()
