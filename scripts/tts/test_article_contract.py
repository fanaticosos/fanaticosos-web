#!/usr/bin/env python3

import copy
import unittest

from article_contract import canonical_text, text_hash, validate_request, validate_result


ARTICLE_ID = "00000000-0000-4000-8000-000000000001"
REVISION = "1" * 64


def request_fixture():
    return {
        "schemaVersion": 1,
        "articleId": ARTICLE_ID,
        "locale": "es",
        "sourceRevision": REVISION,
        "title": "Los Bears ganan en Chicago",
        "segments": [
            {"id": "summary", "text": "Chicago completó la remontada."},
            {"id": "body-001", "text": "La defensa forzó un balón suelto."},
        ],
    }


def result_fixture(request):
    return {
        "schemaVersion": 1,
        "articleId": request["articleId"],
        "locale": request["locale"],
        "sourceRevision": request["sourceRevision"],
        "textHash": text_hash(request),
        "voice": "test-voice",
        "configurationVersion": 1,
        "engine": "Kokoro",
        "modelRevision": "f3ff357",
        "file": f"es-{ARTICLE_ID}.mp3",
        "codec": "mp3",
        "sampleRateHz": 48000,
        "channels": 1,
        "bitRate": 128000,
        "durationSeconds": 42.5,
        "sizeBytes": 680000,
        "sha256": "2" * 64,
        "generatedAt": "2026-07-30T23:00:00Z",
    }


class TtsArticleContractTests(unittest.TestCase):
    def test_valid_request_and_result(self):
        request = request_fixture()
        result = result_fixture(request)
        self.assertEqual(validate_request(request), request)
        self.assertEqual(
            validate_result(
                request,
                result,
                expected_voice="test-voice",
                expected_configuration_version=1,
            ),
            result,
        )

    def test_canonical_text_preserves_order(self):
        request = request_fixture()
        self.assertEqual(
            canonical_text(request),
            "Los Bears ganan en Chicago\n\nChicago completó la remontada.\n\n"
            "La defensa forzó un balón suelto.\n",
        )

    def test_reordering_changes_hash(self):
        request = request_fixture()
        changed = copy.deepcopy(request)
        changed["segments"].reverse()
        self.assertNotEqual(text_hash(request), text_hash(changed))

    def test_duplicate_segment_is_rejected(self):
        request = request_fixture()
        request["segments"][1]["id"] = "summary"
        with self.assertRaisesRegex(ValueError, "duplicate segment"):
            validate_request(request)

    def test_stale_source_revision_is_rejected(self):
        request = request_fixture()
        result = result_fixture(request)
        result["sourceRevision"] = "3" * 64
        with self.assertRaisesRegex(ValueError, "sourceRevision"):
            validate_result(
                request,
                result,
                expected_voice="test-voice",
                expected_configuration_version=1,
            )

    def test_wrong_voice_is_rejected(self):
        request = request_fixture()
        result = result_fixture(request)
        with self.assertRaisesRegex(ValueError, "configured voice"):
            validate_result(
                request,
                result,
                expected_voice="another-voice",
                expected_configuration_version=1,
            )

    def test_wrong_audio_format_is_rejected(self):
        request = request_fixture()
        result = result_fixture(request)
        result["channels"] = 2
        with self.assertRaisesRegex(ValueError, "48 kHz mono"):
            validate_result(
                request,
                result,
                expected_voice="test-voice",
                expected_configuration_version=1,
            )

    def test_nondeterministic_file_name_is_rejected(self):
        request = request_fixture()
        result = result_fixture(request)
        result["file"] = "article.mp3"
        with self.assertRaisesRegex(ValueError, "deterministic"):
            validate_result(
                request,
                result,
                expected_voice="test-voice",
                expected_configuration_version=1,
            )


if __name__ == "__main__":
    unittest.main()
