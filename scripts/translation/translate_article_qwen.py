#!/usr/bin/env python3
"""Translate a validated article request with local Qwen and atomic output."""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from article_contract import (
    source_revision,
    validate_translation_request,
    validate_translation_result,
)
from benchmark_opus import atomic_write_json, glossary_failures, read_json
from benchmark_qwen import extract_translations, run_llama

ENGINE = "llama.cpp"
MODEL = "Qwen/Qwen3-8B-GGUF"
NUMBER_PATTERN = re.compile(r"(?<!\w)\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?%?(?!\w)")


def create_batches(
    segments: list[dict[str, Any]], max_batch_characters: int
) -> list[list[dict[str, Any]]]:
    if max_batch_characters < 1:
        raise ValueError("max batch characters must be positive")
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_characters = 0
    for segment in segments:
        size = len(segment["text"])
        if size > max_batch_characters:
            raise ValueError(
                f"{segment['id']}: segment exceeds model batch limit of "
                f"{max_batch_characters} characters"
            )
        if current and current_characters + size > max_batch_characters:
            batches.append(current)
            current = []
            current_characters = 0
        current.append(segment)
        current_characters += size
    if current:
        batches.append(current)
    return batches


def build_prompt(
    segments: list[dict[str, Any]], glossary: dict[str, Any]
) -> str:
    mappings = "\n".join(
        f"- {term['source']} = {term['target']}" for term in glossary["terms"]
    )
    protected = ", ".join(glossary["protectedNames"])
    payload = json.dumps(
        [
            {"id": segment["id"], "kind": segment["kind"], "text": segment["text"]}
            for segment in segments
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return f"""<|im_start|>system
You are the English copy editor for Fanaticosos, an NFL and Chicago Bears publication.
Translate every Spanish segment into natural, publication-quality American English.
Do not add, omit, summarize, explain, or alter facts.
Preserve names, teams, scores, numbers, statistics, and Markdown punctuation.
Apply the NFL terminology mappings naturally, including grammatical inflection.
Protected names: {protected}

Terminology mappings:
{mappings}

Return only valid JSON with this exact shape:
{{"translations":[{{"id":"segment-id","translation":"English text"}}]}}
Return every input id exactly once and in its original order. Do not use Markdown fences.
<|im_end|>
<|im_start|>user
Translate these ordered segments:
{payload}
/no_think
<|im_end|>
<|im_start|>assistant
"""


def expected_preserved_values(
    segment: dict[str, Any], protected_names: list[str]
) -> list[str]:
    source = segment["text"]
    values = list(segment.get("preserve", []))
    values.extend(name for name in protected_names if name in source)
    values.extend(NUMBER_PATTERN.findall(source))
    return list(dict.fromkeys(values))


def validate_segment_translation(
    segment: dict[str, Any],
    translation: str,
    glossary: dict[str, Any],
) -> None:
    missing = [
        value
        for value in expected_preserved_values(segment, glossary["protectedNames"])
        if value not in translation
    ]
    if missing:
        raise ValueError(
            f"{segment['id']}: missing protected values: {', '.join(missing)}"
        )
    failures = glossary_failures(segment["text"], translation, glossary["terms"])
    if failures:
        details = ", ".join(
            f"{failure['source']} -> {failure['expectedTarget']}"
            for failure in failures
        )
        raise ValueError(f"{segment['id']}: glossary validation failed: {details}")


def translate_request(
    request: dict[str, Any],
    glossary: dict[str, Any],
    invoke: Callable[[str], str],
    *,
    model_revision: str,
    runtime_version: str,
    configuration_version: str,
    max_batch_characters: int,
) -> dict[str, Any]:
    normalized = validate_translation_request(request)
    if not isinstance(glossary.get("version"), int) or glossary["version"] < 1:
        raise ValueError("glossary version must be a positive integer")
    if not isinstance(glossary.get("terms"), list):
        raise ValueError("glossary terms must be an array")
    if not isinstance(glossary.get("protectedNames"), list):
        raise ValueError("glossary protectedNames must be an array")

    translated: list[dict[str, str]] = []
    for batch in create_batches(normalized["segments"], max_batch_characters):
        expected_ids = [segment["id"] for segment in batch]
        raw_output = invoke(build_prompt(batch, glossary))
        values = extract_translations(raw_output, expected_ids)
        for segment in batch:
            translation = values[segment["id"]]
            validate_segment_translation(segment, translation, glossary)
            translated.append({"id": segment["id"], "translation": translation})

    result = {
        "schemaVersion": 1,
        "articleId": normalized["articleId"],
        "sourceRevision": source_revision(normalized),
        "engine": ENGINE,
        "model": MODEL,
        "modelRevision": model_revision,
        "runtimeVersion": runtime_version,
        "configurationVersion": configuration_version,
        "glossaryVersion": glossary["version"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "segments": translated,
    }
    return validate_translation_result(result, normalized)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--llama-cli", required=True, type=Path)
    parser.add_argument("--model-file", required=True, type=Path)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--runtime-version", required=True)
    parser.add_argument("--configuration-version", default="1")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--threads", type=int, default=12)
    parser.add_argument("--context", type=int, default=8192)
    parser.add_argument("--output-tokens", type=int, default=2048)
    parser.add_argument("--max-batch-characters", type=int, default=6_000)
    return parser.parse_args()


def main() -> None:
    os.umask(0o077)
    args = parse_args()
    if args.output.exists():
        raise ValueError("output file already exists")
    if not args.llama_cli.is_file() or not os.access(args.llama_cli, os.X_OK):
        raise ValueError("llama-cli must be an executable file")
    if not args.model_file.is_file():
        raise ValueError("model file does not exist")

    request = read_json(args.request)
    glossary = read_json(args.glossary)

    def invoke(prompt: str) -> str:
        output, _, _ = run_llama(
            args.llama_cli,
            args.model_file,
            prompt,
            args.threads,
            args.context,
            args.output_tokens,
        )
        return output

    result = translate_request(
        request,
        glossary,
        invoke,
        model_revision=args.model_revision,
        runtime_version=args.runtime_version,
        configuration_version=args.configuration_version,
        max_batch_characters=args.max_batch_characters,
    )
    atomic_write_json(args.output, result)
    os.chmod(args.output, 0o600)
    print(f"Article: {result['articleId']}")
    print(f"Source revision: {result['sourceRevision']}")
    print(f"Segments: {len(result['segments'])}")
    print(f"Result: {args.output}")


if __name__ == "__main__":
    main()
