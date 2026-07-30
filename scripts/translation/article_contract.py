#!/usr/bin/env python3
"""Validate bounded Spanish-to-English article translation job data."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from typing import Any

SCHEMA_VERSION = 1
SOURCE_LOCALE = "es"
TARGET_LOCALE = "en"
MAX_SEGMENTS = 512
MAX_SEGMENT_CHARACTERS = 12_000
MAX_ARTICLE_CHARACTERS = 250_000

SEGMENT_KINDS = {
    "title",
    "description",
    "heading",
    "paragraph",
    "quote",
    "list-item",
    "caption",
}
SEGMENT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_exact_keys(
    value: dict[str, Any], required: set[str], optional: set[str], label: str
) -> None:
    missing = required - value.keys()
    unknown = value.keys() - required - optional
    if missing:
        raise ValueError(f"{label} is missing fields: {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"{label} has unknown fields: {', '.join(sorted(unknown))}")


def _validate_article_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("articleId must be a UUID string")
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise ValueError("articleId must be a valid UUID") from error
    if str(parsed) != value:
        raise ValueError("articleId must use canonical lowercase UUID form")
    return value


def _validate_preserve(value: Any, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{label} preserve must be an array")
    if not all(isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"{label} preserve values must be nonempty text")
    normalized = [item.strip() for item in value]
    if len(normalized) != len(set(normalized)):
        raise ValueError(f"{label} preserve values must be unique")
    return normalized


def validate_translation_request(value: Any) -> dict[str, Any]:
    request = _require_object(value, "translation request")
    _require_exact_keys(
        request,
        {"schemaVersion", "articleId", "sourceLocale", "targetLocale", "segments"},
        set(),
        "translation request",
    )
    if request["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}")
    _validate_article_id(request["articleId"])
    if request["sourceLocale"] != SOURCE_LOCALE:
        raise ValueError(f"sourceLocale must be {SOURCE_LOCALE}")
    if request["targetLocale"] != TARGET_LOCALE:
        raise ValueError(f"targetLocale must be {TARGET_LOCALE}")

    segments = request["segments"]
    if not isinstance(segments, list) or not segments:
        raise ValueError("segments must be a nonempty array")
    if len(segments) > MAX_SEGMENTS:
        raise ValueError(f"segments cannot exceed {MAX_SEGMENTS} entries")

    seen_ids: set[str] = set()
    total_characters = 0
    normalized_segments: list[dict[str, Any]] = []
    for index, raw_segment in enumerate(segments):
        label = f"segments[{index}]"
        segment = _require_object(raw_segment, label)
        _require_exact_keys(segment, {"id", "kind", "text"}, {"preserve"}, label)
        segment_id = segment["id"]
        if not isinstance(segment_id, str) or not SEGMENT_ID_PATTERN.fullmatch(segment_id):
            raise ValueError(f"{label} id must be a lowercase kebab-case identifier")
        if segment_id in seen_ids:
            raise ValueError(f"duplicate segment id: {segment_id}")
        seen_ids.add(segment_id)
        if segment["kind"] not in SEGMENT_KINDS:
            raise ValueError(f"{label} kind is unsupported")
        text = segment["text"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"{label} text must be nonempty")
        if len(text) > MAX_SEGMENT_CHARACTERS:
            raise ValueError(
                f"{label} text cannot exceed {MAX_SEGMENT_CHARACTERS} characters"
            )
        total_characters += len(text)
        preserve = _validate_preserve(segment.get("preserve"), label)
        normalized_segments.append(
            {"id": segment_id, "kind": segment["kind"], "text": text, "preserve": preserve}
        )

    if total_characters > MAX_ARTICLE_CHARACTERS:
        raise ValueError(
            f"article text cannot exceed {MAX_ARTICLE_CHARACTERS} characters"
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "articleId": request["articleId"],
        "sourceLocale": SOURCE_LOCALE,
        "targetLocale": TARGET_LOCALE,
        "segments": normalized_segments,
    }


def source_revision(request: dict[str, Any]) -> str:
    normalized = validate_translation_request(request)
    serialized = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def validate_translation_result(
    value: Any, request: dict[str, Any]
) -> dict[str, Any]:
    normalized_request = validate_translation_request(request)
    result = _require_object(value, "translation result")
    _require_exact_keys(
        result,
        {
            "schemaVersion",
            "articleId",
            "sourceRevision",
            "engine",
            "model",
            "modelRevision",
            "runtimeVersion",
            "configurationVersion",
            "glossaryVersion",
            "generatedAt",
            "segments",
        },
        set(),
        "translation result",
    )
    if result["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError(f"result schemaVersion must be {SCHEMA_VERSION}")
    if result["articleId"] != normalized_request["articleId"]:
        raise ValueError("result articleId does not match request")
    expected_revision = source_revision(normalized_request)
    if result["sourceRevision"] != expected_revision:
        raise ValueError("result sourceRevision does not match request")
    if not SHA256_PATTERN.fullmatch(result["sourceRevision"]):
        raise ValueError("result sourceRevision must be a lowercase SHA-256 value")

    for field in (
        "engine",
        "model",
        "modelRevision",
        "runtimeVersion",
        "configurationVersion",
        "generatedAt",
    ):
        if not isinstance(result[field], str) or not result[field].strip():
            raise ValueError(f"result {field} must be nonempty text")
    if not isinstance(result["glossaryVersion"], int) or result["glossaryVersion"] < 1:
        raise ValueError("result glossaryVersion must be a positive integer")

    result_segments = result["segments"]
    if not isinstance(result_segments, list):
        raise ValueError("result segments must be an array")
    expected_ids = [segment["id"] for segment in normalized_request["segments"]]
    actual_ids: list[str] = []
    for index, raw_segment in enumerate(result_segments):
        label = f"result segments[{index}]"
        segment = _require_object(raw_segment, label)
        _require_exact_keys(segment, {"id", "translation"}, set(), label)
        if not isinstance(segment["id"], str):
            raise ValueError(f"{label} id must be text")
        if not isinstance(segment["translation"], str) or not segment["translation"].strip():
            raise ValueError(f"{label} translation must be nonempty text")
        actual_ids.append(segment["id"])
    if actual_ids != expected_ids:
        raise ValueError(
            f"result segment ids/order mismatch: expected {expected_ids}, got {actual_ids}"
        )
    return result
