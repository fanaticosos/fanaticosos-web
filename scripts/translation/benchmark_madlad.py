#!/usr/bin/env python3
"""Run the Fanaticosos Spanish-to-English MADLAD benchmark offline."""

from __future__ import annotations

import argparse
import os
import platform
import resource
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


def tag_source(source: str) -> str:
    return f"<2en> {source}"


def translate_case(model: Any, tokenizer: Any, torch: Any, source: str) -> tuple[str, float]:
    started = time.perf_counter()
    inputs = tokenizer(tag_source(source), return_tensors="pt")
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            num_beams=4,
            max_new_tokens=256,
        )
    translation = tokenizer.decode(generated[0], skip_special_tokens=True)
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
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    torch.set_num_threads(max(1, min(args.threads, os.cpu_count() or 1)))
    torch.manual_seed(0)
    process = psutil.Process()

    load_started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model_dir, local_files_only=True)
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
        "engine": "transformers-t5",
        "model": "google/madlad400-3b-mt",
        "modelRevision": args.model_revision,
        "benchmarkVersion": benchmark["version"],
        "glossaryVersion": glossary["version"],
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "threads": torch.get_num_threads(),
            "dtype": str(next(model.parameters()).dtype),
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
