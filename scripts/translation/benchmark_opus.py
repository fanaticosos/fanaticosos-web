#!/usr/bin/env python3
"""Run the Fanaticosos Spanish-to-English OPUS-MT benchmark offline."""

from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be an object")
    return value


def validate_inputs(benchmark: dict[str, Any], glossary: dict[str, Any]) -> None:
    if not isinstance(benchmark.get("version"), int) or benchmark["version"] < 1:
        raise ValueError("benchmark version must be a positive integer")
    if not isinstance(glossary.get("version"), int) or glossary["version"] < 1:
        raise ValueError("glossary version must be a positive integer")
    if benchmark.get("sourceLocale") != "es" or benchmark.get("targetLocale") != "en":
        raise ValueError("benchmark must define es-to-en translation")
    if glossary.get("sourceLocale") != "es" or glossary.get("targetLocale") != "en":
        raise ValueError("glossary must define es-to-en translation")

    cases = benchmark.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("benchmark cases must be a nonempty array")

    seen_ids: set[str] = set()
    for item in cases:
        if not isinstance(item, dict):
            raise ValueError("each benchmark case must be an object")
        case_id = item.get("id")
        if not isinstance(case_id, str) or not case_id:
            raise ValueError("each benchmark case requires an id")
        if case_id in seen_ids:
            raise ValueError(f"duplicate benchmark case id: {case_id}")
        seen_ids.add(case_id)
        if not isinstance(item.get("source"), str) or not item["source"].strip():
            raise ValueError(f"{case_id}: source must be nonempty text")
        if not isinstance(item.get("category"), str) or not item["category"].strip():
            raise ValueError(f"{case_id}: category must be nonempty text")
        if not isinstance(item.get("notes"), str) or not item["notes"].strip():
            raise ValueError(f"{case_id}: notes must be nonempty text")
        if not isinstance(item.get("mustPreserve"), list):
            raise ValueError(f"{case_id}: mustPreserve must be an array")
        if not all(isinstance(token, str) and token for token in item["mustPreserve"]):
            raise ValueError(f"{case_id}: mustPreserve values must be nonempty text")

    if not isinstance(glossary.get("protectedNames"), list):
        raise ValueError("glossary protectedNames must be an array")
    if not isinstance(glossary.get("terms"), list):
        raise ValueError("glossary terms must be an array")
    for term in glossary["terms"]:
        if not isinstance(term, dict) or not all(
            isinstance(term.get(key), str) and term[key] for key in ("source", "target")
        ):
            raise ValueError("each glossary term requires source and target text")


def expected_protected_tokens(
    source: str, case_tokens: list[str], protected_names: list[str]
) -> list[str]:
    values = list(case_tokens)
    values.extend(name for name in protected_names if name in source)
    return list(dict.fromkeys(values))


def preservation_failures(translation: str, expected: list[str]) -> list[str]:
    return [token for token in expected if token not in translation]


def glossary_failures(
    source: str, translation: str, terms: list[dict[str, str]]
) -> list[dict[str, str]]:
    failures = []
    source_folded = source.casefold()
    translation_folded = translation.casefold()
    for term in terms:
        source_term = term["source"]
        target_term = term["target"]
        if source_term.casefold() in source_folded and target_term.casefold() not in translation_folded:
            failures.append({"source": source_term, "expectedTarget": target_term})
    return failures


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def translate_case(model: Any, tokenizer: Any, torch: Any, source: str) -> tuple[str, float]:
    started = time.perf_counter()
    inputs = tokenizer([source], return_tensors="pt")
    with torch.inference_mode():
        generated = model.generate(**inputs, num_beams=4)
    translation = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
    return translation, time.perf_counter() - started


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--threads", type=int, default=12)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    benchmark = read_json(args.benchmark)
    glossary = read_json(args.glossary)
    validate_inputs(benchmark, glossary)

    import psutil
    import torch
    import transformers
    from transformers import MarianMTModel, MarianTokenizer

    torch.set_num_threads(max(1, min(args.threads, os.cpu_count() or 1)))
    torch.manual_seed(0)
    process = psutil.Process()

    load_started = time.perf_counter()
    tokenizer = MarianTokenizer.from_pretrained(args.model_dir, local_files_only=True)
    model = MarianMTModel.from_pretrained(args.model_dir, local_files_only=True)
    model.eval()
    load_seconds = time.perf_counter() - load_started

    protected_names = glossary.get("protectedNames", [])
    terms = glossary.get("terms", [])
    results: list[dict[str, Any]] = []

    for item in benchmark["cases"]:
        first_translation, first_seconds = translate_case(
            model, tokenizer, torch, item["source"]
        )
        second_translation, warm_seconds = translate_case(
            model, tokenizer, torch, item["source"]
        )
        expected = expected_protected_tokens(
            item["source"], item["mustPreserve"], protected_names
        )
        results.append(
            {
                "id": item["id"],
                "category": item["category"],
                "source": item["source"],
                "translation": first_translation,
                "firstRunSeconds": round(first_seconds, 6),
                "warmRunSeconds": round(warm_seconds, 6),
                "deterministic": first_translation == second_translation,
                "expectedProtectedTokens": expected,
                "missingProtectedTokens": preservation_failures(first_translation, expected),
                "glossaryFailures": glossary_failures(item["source"], first_translation, terms),
                "reviewNotes": item["notes"],
            }
        )

    output = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": "transformers-marian",
        "model": "Helsinki-NLP/opus-mt-es-en",
        "modelRevision": args.model_revision,
        "benchmarkVersion": benchmark["version"],
        "glossaryVersion": glossary["version"],
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "threads": torch.get_num_threads(),
        },
        "measurements": {
            "modelLoadSeconds": round(load_seconds, 6),
            "totalFirstRunSeconds": round(sum(x["firstRunSeconds"] for x in results), 6),
            "totalWarmRunSeconds": round(sum(x["warmRunSeconds"] for x in results), 6),
            "maximumResidentSetKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "residentSetAtCompletionBytes": process.memory_info().rss,
        },
        "summary": {
            "caseCount": len(results),
            "nondeterministicCases": sum(not x["deterministic"] for x in results),
            "protectedTokenFailureCases": sum(bool(x["missingProtectedTokens"]) for x in results),
            "glossaryFailureCases": sum(bool(x["glossaryFailures"]) for x in results),
        },
        "cases": results,
    }
    atomic_write_json(args.output, output)

    print(f"Cases: {output['summary']['caseCount']}")
    print(f"Model load: {output['measurements']['modelLoadSeconds']:.3f}s")
    print(f"First pass: {output['measurements']['totalFirstRunSeconds']:.3f}s")
    print(f"Warm pass: {output['measurements']['totalWarmRunSeconds']:.3f}s")
    print(f"Peak RSS: {output['measurements']['maximumResidentSetKiB']} KiB")
    print(
        "Protected-token failure cases: "
        f"{output['summary']['protectedTokenFailureCases']}"
    )
    print(f"Glossary failure cases: {output['summary']['glossaryFailureCases']}")
    print(f"Results: {args.output}")


if __name__ == "__main__":
    main()
