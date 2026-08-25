#!/usr/bin/env python3
"""Run the Fanaticosos NFL translation benchmark with local Qwen GGUF."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import resource
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from benchmark_opus import (
    atomic_write_json,
    expected_protected_tokens,
    glossary_failures,
    preservation_failures,
    read_json,
    validate_inputs,
)


def build_prompt(benchmark: dict[str, Any], glossary: dict[str, Any]) -> str:
    mappings = "\n".join(
        f"- {term['source']} = {term['target']}" for term in glossary["terms"]
    )
    protected = ", ".join(glossary["protectedNames"])
    cases = json.dumps(
        [{"id": item["id"], "source": item["source"]} for item in benchmark["cases"]],
        ensure_ascii=False,
        indent=2,
    )
    return f"""<|im_start|>system
You are the English copy editor for Fanaticosos, an NFL and Chicago Bears sports publication.
Translate Spanish sports journalism into natural American English suitable for publication.
Do not add, omit, summarize, explain, or alter facts.
Preserve names, teams, scores, numbers, statistics, and quotations exactly.
Use the terminology mappings as editorial guidance, inflecting grammar naturally when needed.
Protected names: {protected}

Terminology mappings:
{mappings}

Return only one valid JSON array.
Every array item must contain exactly two string fields named `id` and `translation`.
Return one entry for every input id, in the original order. Do not use Markdown fences.
<|im_end|>
<|im_start|>user
Translate these cases from Spanish to English:
{cases}
/no_think
<|im_end|>
<|im_start|>assistant
"""


def extract_translations(raw_output: str, expected_ids: list[str]) -> dict[str, str]:
    text = raw_output.strip()
    if "<think>" in text and "</think>" in text:
        text = text.split("</think>", 1)[1].strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    if "Assistant:" in text:
        text = text.rsplit("Assistant:", 1)[1].strip()

    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    try:
        direct, _ = decoder.raw_decode(text)
    except json.JSONDecodeError:
        direct = None
    if isinstance(direct, list):
        candidates.append({"translations": direct})
    elif isinstance(direct, dict) and isinstance(direct.get("translations"), list):
        candidates.append(direct)

    # Long local-model responses occasionally reach the token limit after
    # closing the translations array but before the wrapper's final `}`.
    # The array is still complete and safe to validate against every expected
    # id, so recover it instead of throwing away a finished translation.
    translations_marker = re.search(r'"translations"\s*:\s*', text)
    if translations_marker is not None:
        array_start = text.find("[", translations_marker.end())
        if array_start >= 0:
            try:
                decoded_array, _ = decoder.raw_decode(text[array_start:])
            except json.JSONDecodeError:
                decoded_array = None
            if isinstance(decoded_array, list):
                candidates.append({"translations": decoded_array})

    # Some model builds prefix a complete bare array with commentary or
    # thinking text. Scan for decodable arrays just as we scan for wrapped
    # objects below; the expected-id validation later prevents an unrelated
    # array from being accepted.
    position = 0
    while True:
        start = text.find("[", position)
        if start < 0:
            break
        try:
            decoded, consumed = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            position = start + 1
            continue
        if isinstance(decoded, list):
            candidates.append({"translations": decoded})
        position = start + max(consumed, 1)

    position = 0
    while True:
        start = text.find("{", position)
        if start < 0:
            break
        try:
            decoded, consumed = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            position = start + 1
            continue
        if isinstance(decoded, dict) and isinstance(decoded.get("translations"), list):
            candidates.append(decoded)
        position = start + max(consumed, 1)

    if not candidates:
        raise ValueError("model output does not contain a translations JSON object")
    value = candidates[-1]
    for candidate in reversed(candidates):
        candidate_entries = candidate.get("translations")
        candidate_ids = [
            entry.get("id")
            for entry in candidate_entries
            if isinstance(entry, dict)
        ]
        if candidate_ids == expected_ids:
            value = candidate
            break
    entries = value.get("translations") if isinstance(value, dict) else None
    if not isinstance(entries, list):
        raise ValueError("model output must contain a translations array")

    translations: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("each translation must be an object")
        case_id = entry.get("id")
        translation = entry.get("translation")
        if not isinstance(case_id, str) or case_id in translations:
            raise ValueError("translation ids must be unique strings")
        if not isinstance(translation, str) or not translation.strip():
            raise ValueError(f"{case_id}: translation must be nonempty text")
        translations[case_id] = translation.strip()

    if list(translations) != expected_ids:
        raise ValueError(
            f"translation ids/order mismatch: expected {expected_ids}, got {list(translations)}"
        )
    return translations


def run_llama(
    llama_cli: Path,
    model_file: Path,
    prompt: str,
    threads: int,
    context: int,
    output_tokens: int,
) -> tuple[str, str, float]:
    with tempfile.TemporaryDirectory(prefix="fanaticosos-qwen-") as directory:
        output_path = Path(directory) / "output.txt"
        stderr_path = Path(directory) / "stderr.txt"
        started = time.perf_counter()
        with stderr_path.open("wb") as stderr_file:
            completed = subprocess.run(
                [
                    str(llama_cli),
                    "-m",
                    str(model_file),
                    "-t",
                    str(threads),
                    "-c",
                    str(context),
                    "-n",
                    str(output_tokens),
                    "--temp",
                    "0",
                    "--top-k",
                    "1",
                    "--seed",
                    "0",
                    "--no-display-prompt",
                    "--no-warmup",
                    "--no-conversation",
                    "--single-turn",
                    "--simple-io",
                    "--log-disable",
                    "--output",
                    str(output_path),
                    "-p",
                    prompt,
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=stderr_file,
                env={
                    **os.environ,
                    "NO_COLOR": "1",
                    "OMP_NUM_THREADS": str(threads),
                },
                check=False,
            )
        elapsed = time.perf_counter() - started
        with stderr_path.open("rb") as stderr_file:
            stderr_file.seek(0, os.SEEK_END)
            stderr_size = stderr_file.tell()
            stderr_file.seek(max(0, stderr_size - 65_536))
            stderr = stderr_file.read().decode("utf-8", errors="replace")
        if completed.returncode != 0:
            raise RuntimeError(
                f"llama-cli exited {completed.returncode}: {stderr.strip()}"
            )
        if not output_path.is_file():
            raise RuntimeError("llama-cli did not create its explicit output file")
        output = output_path.read_text(encoding="utf-8")
        if not output.strip():
            raise RuntimeError("llama-cli explicit output file is empty")
        return output, stderr, elapsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--llama-cli", required=True, type=Path)
    parser.add_argument("--model-file", required=True, type=Path)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--runtime-version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--threads", type=int, default=12)
    parser.add_argument("--context", type=int, default=8192)
    parser.add_argument("--output-tokens", type=int, default=2048)
    return parser.parse_args()


def main() -> None:
    os.umask(0o077)
    args = parse_args()
    benchmark = read_json(args.benchmark)
    glossary = read_json(args.glossary)
    validate_inputs(benchmark, glossary)

    if not args.llama_cli.is_file() or not os.access(args.llama_cli, os.X_OK):
        raise ValueError("llama-cli must be an executable file")
    if not args.model_file.is_file():
        raise ValueError("model file does not exist")
    if args.output.exists():
        raise ValueError("output file already exists")

    prompt = build_prompt(benchmark, glossary)
    expected_ids = [item["id"] for item in benchmark["cases"]]

    first_raw, first_stderr, first_seconds = run_llama(
        args.llama_cli,
        args.model_file,
        prompt,
        args.threads,
        args.context,
        args.output_tokens,
    )
    first = extract_translations(first_raw, expected_ids)

    second_raw, second_stderr, second_seconds = run_llama(
        args.llama_cli,
        args.model_file,
        prompt,
        args.threads,
        args.context,
        args.output_tokens,
    )
    second = extract_translations(second_raw, expected_ids)

    protected_names = glossary["protectedNames"]
    terms = glossary["terms"]
    results = []
    for item in benchmark["cases"]:
        case_id = item["id"]
        translation = first[case_id]
        expected = expected_protected_tokens(
            item["source"], item["mustPreserve"], protected_names
        )
        results.append(
            {
                "id": case_id,
                "category": item["category"],
                "source": item["source"],
                "translation": translation,
                "deterministic": translation == second[case_id],
                "expectedProtectedTokens": expected,
                "missingProtectedTokens": preservation_failures(translation, expected),
                "glossaryFailures": glossary_failures(item["source"], translation, terms),
                "reviewNotes": item["notes"],
            }
        )

    child_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": "llama.cpp",
        "runtimeVersion": args.runtime_version,
        "model": "Qwen/Qwen3-8B-GGUF",
        "modelFile": args.model_file.name,
        "modelRevision": args.model_revision,
        "benchmarkVersion": benchmark["version"],
        "glossaryVersion": glossary["version"],
        "runtime": {
            "python": platform.python_version(),
            "threads": args.threads,
            "context": args.context,
            "outputTokens": args.output_tokens,
            "temperature": 0,
        },
        "measurements": {
            "firstRunSeconds": round(first_seconds, 6),
            "secondRunSeconds": round(second_seconds, 6),
            "maximumChildResidentSetKiB": child_usage.ru_maxrss,
        },
        "summary": {
            "caseCount": len(results),
            "nondeterministicCases": sum(not item["deterministic"] for item in results),
            "protectedTokenFailureCases": sum(
                bool(item["missingProtectedTokens"]) for item in results
            ),
            "glossaryFailureCases": sum(bool(item["glossaryFailures"]) for item in results),
        },
        "raw": {
            "firstOutput": first_raw,
            "secondOutput": second_raw,
            "firstStderr": first_stderr,
            "secondStderr": second_stderr,
        },
        "cases": results,
    }
    atomic_write_json(args.output, output)
    os.chmod(args.output, 0o600)

    print(f"Cases: {output['summary']['caseCount']}")
    print(f"First run: {output['measurements']['firstRunSeconds']:.3f}s")
    print(f"Second run: {output['measurements']['secondRunSeconds']:.3f}s")
    print(f"Peak child RSS: {output['measurements']['maximumChildResidentSetKiB']} KiB")
    print(f"Nondeterministic cases: {output['summary']['nondeterministicCases']}")
    print(
        "Protected-token failure cases: "
        f"{output['summary']['protectedTokenFailureCases']}"
    )
    print(f"Glossary failure cases: {output['summary']['glossaryFailureCases']}")
    print(f"Results: {args.output}")


if __name__ == "__main__":
    main()
