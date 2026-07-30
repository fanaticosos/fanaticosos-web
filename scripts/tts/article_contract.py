#!/usr/bin/env python3
"""Validation contract for one locale-specific article TTS job."""

from __future__ import annotations

import hashlib
import re
import uuid
from typing import Any


LOCALES = {"es", "en"}
SEGMENT_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_SEGMENTS = 250
MAX_SEGMENT_CHARACTERS = 8_000
MAX_ARTICLE_CHARACTERS = 100_000


def _required_string(value: Any, field: str, maximum: int = 512) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    if value != value.strip():
        raise ValueError(f"{field} must not have surrounding whitespace")
    if len(value) > maximum:
        raise ValueError(f"{field} exceeds {maximum} characters")
    return value


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("request schema version must be 1")
    try:
        uuid.UUID(_required_string(value.get("articleId"), "articleId"))
    except (ValueError, AttributeError) as exc:
        raise ValueError("articleId must be a UUID") from exc
    locale = value.get("locale")
    if locale not in LOCALES:
        raise ValueError("locale must be es or en")
    source_revision = value.get("sourceRevision")
    if not isinstance(source_revision, str) or not SHA256.fullmatch(source_revision):
        raise ValueError("sourceRevision must be a lowercase SHA-256")
    _required_string(value.get("title"), "title", 300)
    segments = value.get("segments")
    if not isinstance(segments, list) or not 1 <= len(segments) <= MAX_SEGMENTS:
        raise ValueError(f"segments must contain 1-{MAX_SEGMENTS} entries")
    seen = set()
    total = 0
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise ValueError(f"segments[{index}] must be an object")
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not SEGMENT_ID.fullmatch(segment_id):
            raise ValueError(f"segments[{index}].id is invalid")
        if segment_id in seen:
            raise ValueError(f"duplicate segment id: {segment_id}")
        seen.add(segment_id)
        text = _required_string(
            segment.get("text"),
            f"segments[{index}].text",
            MAX_SEGMENT_CHARACTERS,
        )
        total += len(text)
    if total > MAX_ARTICLE_CHARACTERS:
        raise ValueError("article exceeds maximum character count")
    return value


def canonical_text(request: dict[str, Any]) -> str:
    validate_request(request)
    values = [request["title"], *(segment["text"] for segment in request["segments"])]
    return "\n\n".join(values) + "\n"


def text_hash(request: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_text(request).encode("utf-8")).hexdigest()


def validate_result(
    request: dict[str, Any],
    result: Any,
    *,
    expected_voice: str,
    expected_configuration_version: int,
) -> dict[str, Any]:
    validate_request(request)
    if not isinstance(result, dict) or result.get("schemaVersion") != 1:
        raise ValueError("result schema version must be 1")
    for field in ("articleId", "locale", "sourceRevision"):
        if result.get(field) != request[field]:
            raise ValueError(f"result {field} does not match request")
    if result.get("textHash") != text_hash(request):
        raise ValueError("result textHash does not match canonical article text")
    if result.get("voice") != expected_voice:
        raise ValueError("result voice does not match configured voice")
    if result.get("configurationVersion") != expected_configuration_version:
        raise ValueError("result configuration version is stale")
    _required_string(result.get("engine"), "engine", 100)
    _required_string(result.get("modelRevision"), "modelRevision", 100)
    file_name = result.get("file")
    expected_file = f"{request['locale']}-{request['articleId']}.mp3"
    if file_name != expected_file:
        raise ValueError("result file name is not deterministic")
    if result.get("codec") != "mp3":
        raise ValueError("result codec must be mp3")
    if result.get("sampleRateHz") != 48_000 or result.get("channels") != 1:
        raise ValueError("result must be 48 kHz mono")
    if result.get("bitRate") != 128_000:
        raise ValueError("result bitrate must be 128000")
    duration = result.get("durationSeconds")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
        raise ValueError("result duration must be positive")
    size = result.get("sizeBytes")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValueError("result size must be positive")
    checksum = result.get("sha256")
    if not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
        raise ValueError("result sha256 must be a lowercase SHA-256")
    _required_string(result.get("generatedAt"), "generatedAt", 64)
    return result
