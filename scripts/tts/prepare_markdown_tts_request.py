#!/usr/bin/env python3
"""Convert an exported Markdown article into a Fanaticosos TTS request."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def markdown_paragraphs(source: str) -> list[str]:
    source = re.sub(r"\[\s*!\[[^]]*\]\([^)]*\)\s*\]\([^)]*\)", "", source)
    source = re.sub(r"!\[[^]]*\]\([^)]*\)", "", source)
    source = re.sub(r"<sup>.*?</sup>", "", source, flags=re.DOTALL | re.IGNORECASE)
    source = re.sub(r"\[([^]]+)]\([^)]*\)", r"\1", source)

    paragraphs: list[str] = []
    current: list[str] = []
    for raw_line in source.splitlines():
        line = raw_line.replace("\u00a0", " ").strip()
        line = re.sub(r"^#{1,6}\s+", "", line)
        line = re.sub(r"^(?:[-*+]\s+|\d+[.)]\s+)", "", line)
        line = line.replace("**", "").replace("__", "").replace("`", "")
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(line)
    if current:
        paragraphs.append(" ".join(current))
    return [paragraph for paragraph in paragraphs if paragraph]


def prepare(source_path: Path, title: str) -> dict:
    source = source_path.read_text(encoding="utf-8")
    paragraphs = markdown_paragraphs(source)
    return {
        "schemaVersion": 1,
        "articleId": hashlib.sha256(source.encode("utf-8")).hexdigest()[:32],
        "locale": "es",
        "sourceRevision": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "title": title,
        "segments": [
            {"id": f"section-{index:02d}", "text": paragraph}
            for index, paragraph in enumerate(paragraphs, start=1)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    value = prepare(args.source, args.title)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(value['segments'])} segments.")


if __name__ == "__main__":
    main()
