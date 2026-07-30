#!/usr/bin/env python3
"""Validate the fixed bilingual TTS listening benchmark."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_LOCALES = {"es": "e", "en": "a"}
EXPECTED_VOICES = {
    "es": ["ef_dora", "em_alex", "em_santa"],
    "en": ["af_heart", "af_bella"],
}


def validate_benchmark(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("benchmark must be an object")
    if value.get("version") != 1:
        raise ValueError("benchmark version must be 1")
    if value.get("sampleRateHz") != 24000:
        raise ValueError("sample rate must be 24000 Hz")
    if value.get("candidates") != EXPECTED_VOICES:
        raise ValueError("candidate voice set does not match version 1")

    samples = value.get("samples")
    if not isinstance(samples, list) or len(samples) != 2:
        raise ValueError("benchmark must contain one Spanish and one English sample")

    locales = set()
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError("each sample must be an object")
        locale = sample.get("locale")
        if locale not in EXPECTED_LOCALES or locale in locales:
            raise ValueError("sample locales must be unique Spanish and English")
        locales.add(locale)
        if sample.get("languageCode") != EXPECTED_LOCALES[locale]:
            raise ValueError(f"{locale}: incorrect Kokoro language code")
        text = sample.get("text")
        if not isinstance(text, str) or not 500 <= len(text) <= 900:
            raise ValueError(f"{locale}: sample must contain 500-900 characters")
        targets = sample.get("pronunciationTargets")
        if not isinstance(targets, list) or len(targets) < 8:
            raise ValueError(f"{locale}: at least eight pronunciation targets required")
        missing = [target for target in targets if target not in text]
        if missing:
            raise ValueError(f"{locale}: targets missing from text: {', '.join(missing)}")

    if locales != set(EXPECTED_LOCALES):
        raise ValueError("both Spanish and English samples are required")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("benchmark", type=Path)
    args = parser.parse_args()
    with args.benchmark.open(encoding="utf-8") as handle:
        benchmark = validate_benchmark(json.load(handle))
    print(
        "Validated TTS benchmark version "
        f"{benchmark['version']} with {len(benchmark['samples'])} languages and "
        f"{sum(len(voices) for voices in benchmark['candidates'].values())} voices."
    )


if __name__ == "__main__":
    main()
