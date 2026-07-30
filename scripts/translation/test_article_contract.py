#!/usr/bin/env python3

import copy
import unittest

from article_contract import (
    source_revision,
    validate_translation_request,
    validate_translation_result,
)


class ArticleContractTests(unittest.TestCase):
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
                    "text": "Los Bears ganan en Chicago",
                    "preserve": ["Bears", "Chicago"],
                },
                {
                    "id": "body-001",
                    "kind": "paragraph",
                    "text": "Caleb Williams lanzó dos pases de anotación.",
                },
            ],
        }

    def result(self):
        return {
            "schemaVersion": 1,
            "articleId": self.request["articleId"],
            "sourceRevision": source_revision(self.request),
            "engine": "llama.cpp",
            "model": "Qwen/Qwen3-8B-GGUF",
            "modelRevision": "revision",
            "runtimeVersion": "runtime",
            "configurationVersion": "1",
            "glossaryVersion": 3,
            "generatedAt": "2026-07-30T00:00:00+00:00",
            "segments": [
                {"id": "title", "translation": "The Bears win in Chicago"},
                {
                    "id": "body-001",
                    "translation": "Caleb Williams threw two touchdown passes.",
                },
            ],
        }

    def test_normalizes_and_hashes_valid_request(self):
        normalized = validate_translation_request(self.request)
        self.assertEqual(normalized["segments"][1]["preserve"], [])
        self.assertEqual(len(source_revision(self.request)), 64)
        self.assertEqual(source_revision(self.request), source_revision(normalized))

    def test_rejects_duplicate_segment_ids(self):
        invalid = copy.deepcopy(self.request)
        invalid["segments"][1]["id"] = "title"
        with self.assertRaisesRegex(ValueError, "duplicate segment id"):
            validate_translation_request(invalid)

    def test_rejects_unknown_fields(self):
        invalid = copy.deepcopy(self.request)
        invalid["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "unknown fields"):
            validate_translation_request(invalid)

    def test_rejects_wrong_language_direction(self):
        invalid = copy.deepcopy(self.request)
        invalid["targetLocale"] = "fr"
        with self.assertRaisesRegex(ValueError, "targetLocale must be en"):
            validate_translation_request(invalid)

    def test_accepts_matching_result(self):
        self.assertEqual(
            validate_translation_result(self.result(), self.request)["articleId"],
            self.request["articleId"],
        )

    def test_rejects_stale_result(self):
        stale = self.result()
        stale["sourceRevision"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "sourceRevision does not match"):
            validate_translation_result(stale, self.request)

    def test_rejects_missing_or_reordered_result_segments(self):
        invalid = self.result()
        invalid["segments"].reverse()
        with self.assertRaisesRegex(ValueError, "ids/order mismatch"):
            validate_translation_result(invalid, self.request)


if __name__ == "__main__":
    unittest.main()
