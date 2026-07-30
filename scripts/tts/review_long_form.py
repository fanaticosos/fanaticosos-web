#!/usr/bin/env python3
"""Generate the fixed bilingual long-form TTS listening review."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any, Callable

from article_contract import validate_request
from render_article_kokoro import render_article, resolve_delivery, validate_voice


EXPECTED_VOICES = {"es": "em_alex", "en": "af_heart"}


def validate_review(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("review schema version must be 1")
    if value.get("version") != 1:
        raise ValueError("review version must be 1")
    requests = value.get("requests")
    if not isinstance(requests, list) or len(requests) != 2:
        raise ValueError("review must contain two requests")
    for request in requests:
        validate_request(request)
    if {request["locale"] for request in requests} != {"es", "en"}:
        raise ValueError("review must contain Spanish and English")
    return value


def generate_review(
    review: dict[str, Any],
    configuration: dict[str, Any],
    pronunciations: dict[str, Any],
    manifest: dict[str, Any],
    model_root: Path,
    output: Path,
    renderer: Callable[..., dict[str, Any]] = render_article,
) -> dict[str, Any]:
    validate_review(review)
    if configuration.get("configurationVersion") != 3:
        raise ValueError("review requires TTS configuration version 3")
    if configuration.get("status") not in {"selected-for-tuning", "approved"}:
        raise ValueError("TTS configuration is not eligible for review")
    if configuration.get("voices") != EXPECTED_VOICES:
        raise ValueError("review voices do not match owner selection")
    if pronunciations.get("version") != configuration.get("pronunciationVersion"):
        raise ValueError("review pronunciation version is stale")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    results = []
    try:
        for request in review["requests"]:
            locale = request["locale"]
            voice = EXPECTED_VOICES[locale]
            validate_voice(locale, voice)
            speed, pause_seconds, pronunciation_version = resolve_delivery(
                configuration, locale
            )
            rendered = renderer(
                request,
                manifest,
                model_root,
                staging / locale,
                voice,
                configuration["configurationVersion"],
                speed=speed,
                pause_seconds=pause_seconds,
                pronunciations=pronunciations,
                pronunciation_version=pronunciation_version,
            )
            results.append(rendered)
        summary = {
            "schemaVersion": 1,
            "reviewVersion": review["version"],
            "configurationVersion": configuration["configurationVersion"],
            "pronunciationVersion": pronunciations["version"],
            "results": results,
        }
        (staging / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.rglob("*"):
            path.chmod(0o700 if path.is_dir() else 0o600)
        os.replace(staging, output)
        return summary
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--configuration", required=True, type=Path)
    parser.add_argument("--pronunciations", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    values = []
    for path in (
        args.review,
        args.configuration,
        args.pronunciations,
        args.manifest,
    ):
        values.append(json.loads(path.read_text(encoding="utf-8")))
    generate_review(*values, args.model_root, args.output)
    print(f"PASS: Bilingual long-form review generated at {args.output}")


if __name__ == "__main__":
    main()
