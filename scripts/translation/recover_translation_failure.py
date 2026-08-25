#!/usr/bin/env python3
"""Recover a completed translation array from a failed model artifact."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from article_contract import source_revision, validate_translation_request, validate_translation_result
from benchmark_opus import atomic_write_json
from benchmark_qwen import extract_translations
from translate_article_qwen import ENGINE, MODEL, validate_segment_translation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--failure", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.output.exists():
        raise ValueError("output file already exists")
    request = validate_translation_request(json.loads(args.request.read_text(encoding="utf-8")))
    failure = json.loads(args.failure.read_text(encoding="utf-8"))
    glossary = json.loads(args.glossary.read_text(encoding="utf-8"))
    expected_ids = [segment["id"] for segment in request["segments"]]
    values = extract_translations(failure["lastRawOutput"], expected_ids)
    segments = []
    for segment in request["segments"]:
        translation = values[segment["id"]]
        validate_segment_translation(segment, translation, glossary)
        segments.append({"id": segment["id"], "translation": translation})
    result = validate_translation_result({
        "schemaVersion": 1,
        "articleId": request["articleId"],
        "sourceRevision": source_revision(request),
        "engine": ENGINE,
        "model": MODEL,
        "modelRevision": "7c41481f57cb95916b40956ab2f0b139b296d974",
        "runtimeVersion": "b10195-47f686f53",
        "configurationVersion": "9-recovered-json",
        "glossaryVersion": glossary["version"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "segments": segments,
    }, request)
    atomic_write_json(args.output, result)
    os.chmod(args.output, 0o600)
    print(f"Recovered {len(segments)} translated segments.")


if __name__ == "__main__":
    main()
