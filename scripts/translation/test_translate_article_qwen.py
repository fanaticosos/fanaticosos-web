#!/usr/bin/env python3

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

from translate_article_qwen import (
    build_prompt,
    create_batches,
    glossary_term_occurs,
    translate_request,
    validate_segment_translation,
    write_failure_artifact,
)


class TranslateArticleQwenTests(unittest.TestCase):
    def setUp(self):
        self.request = {
            "schemaVersion": 1,
            "articleId": "00000000-0000-4000-8000-000000000001",
            "sourceLocale": "es",
            "targetLocale": "en",
            "segments": [
                {
                    "id": "title",
                    "kind": "title",
                    "text": "Los Bears ganan 27-24 en Chicago",
                    "preserve": ["Bears", "Chicago"],
                },
                {
                    "id": "body-001",
                    "kind": "paragraph",
                    "text": "Caleb Williams lanzó dos pases de anotación.",
                },
            ],
        }
        self.glossary = {
            "version": 3,
            "protectedNames": ["Bears", "Chicago", "Caleb Williams"],
            "terms": [
                {"source": "pase de anotación", "target": "touchdown pass"}
            ],
        }

    def test_batches_preserve_order(self):
        batches = create_batches(self.request["segments"], 60)
        self.assertEqual([[item["id"] for item in batch] for batch in batches], [["title"], ["body-001"]])

    def test_rejects_oversized_single_segment(self):
        with self.assertRaisesRegex(ValueError, "segment exceeds model batch limit"):
            create_batches(self.request["segments"], 10)

    def test_prompt_contains_contract_and_no_think(self):
        prompt = build_prompt(self.request["segments"], self.glossary)
        self.assertIn("pase de anotación = touchdown pass", prompt)
        self.assertIn('"id":"title"', prompt)
        self.assertIn("/no_think", prompt)
        self.assertNotIn('"id":"segment-id"', prompt)
        self.assertIn("Every `translation` value must be English", prompt)

    def test_prompt_includes_only_batch_relevant_glossary_terms(self):
        glossary = copy.deepcopy(self.glossary)
        glossary["terms"].append(
            {"source": "zona roja", "target": "red zone"}
        )
        prompt = build_prompt([self.request["segments"][1]], glossary)
        self.assertIn("pase de anotación = touchdown pass", prompt)
        self.assertNotIn("zona roja = red zone", prompt)

    def test_glossary_relevance_handles_plural_and_accents(self):
        self.assertTrue(
            glossary_term_occurs(
                "formación nickel",
                "Chicago alternó formaciones nickel en defensa.",
            )
        )
        self.assertFalse(
            glossary_term_occurs(
                "zona roja",
                "Chicago alternó formaciones nickel en defensa.",
            )
        )

    def test_translates_batches_and_builds_provenance(self):
        responses = iter(
            [
                {
                    "translations": [
                        {
                            "id": "title",
                            "translation": "The Bears win 27-24 in Chicago",
                        }
                    ]
                },
                {
                    "translations": [
                        {
                            "id": "body-001",
                            "translation": "Caleb Williams threw two touchdown passes.",
                        }
                    ]
                },
            ]
        )

        result = translate_request(
            self.request,
            self.glossary,
            lambda _: json.dumps(next(responses)),
            model_revision="model-revision",
            runtime_version="runtime-version",
            configuration_version="1",
            max_batch_characters=60,
        )

        self.assertEqual(result["engine"], "llama.cpp")
        self.assertEqual(result["glossaryVersion"], 3)
        self.assertEqual([item["id"] for item in result["segments"]], ["title", "body-001"])
        self.assertEqual(len(result["sourceRevision"]), 64)

    def test_rejects_missing_protected_name_or_score(self):
        segment = self.request["segments"][0]
        with self.assertRaisesRegex(ValueError, "missing protected values"):
            validate_segment_translation(segment, "They win in the city", self.glossary)

    def test_rejects_missing_glossary_translation(self):
        segment = copy.deepcopy(self.request["segments"][1])
        segment["text"] = "Caleb Williams lanzó un pase de anotación."
        with self.assertRaisesRegex(ValueError, "glossary validation failed"):
            validate_segment_translation(
                segment,
                "Caleb Williams threw two scoring throws.",
                self.glossary,
            )

    def test_rejects_output_that_remains_spanish(self):
        segment = self.request["segments"][0]
        with self.assertRaisesRegex(ValueError, "appears to remain Spanish"):
            validate_segment_translation(
                segment,
                "Los Bears ganan 27-24 en Chicago",
                self.glossary,
            )

    def test_failure_does_not_return_partial_result(self):
        invalid = copy.deepcopy(self.request)
        invalid["segments"][1]["text"] = (
            "Los Bears ganaron 20-17 después de una gran remontada."
        )
        calls = 0

        def invoke(_: str) -> str:
            nonlocal calls
            calls += 1
            if calls == 1:
                return json.dumps(
                    {
                        "translations": [
                            {
                                "id": "title",
                                "translation": "The Bears win 27-24 in Chicago",
                            }
                        ]
                    }
                )
            return json.dumps(
                {
                    "translations": [
                        {"id": "body-001", "translation": "They won."}
                    ]
                }
            )

        with self.assertRaisesRegex(ValueError, "missing protected values"):
            translate_request(
                invalid,
                self.glossary,
                invoke,
                model_revision="model-revision",
                runtime_version="runtime-version",
                configuration_version="1",
                max_batch_characters=60,
            )

    def test_failure_artifact_is_private_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "failed-output.json"
            write_failure_artifact(path, ValueError("invalid response"), "x" * 1_000_010)
            with path.open(encoding="utf-8") as handle:
                artifact = json.load(handle)
            self.assertEqual(artifact["errorType"], "ValueError")
            self.assertEqual(artifact["error"], "invalid response")
            self.assertEqual(len(artifact["lastRawOutput"]), 1_000_000)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
