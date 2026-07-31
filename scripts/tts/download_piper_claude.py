#!/usr/bin/env python3
"""Download the pinned Piper Claude es-MX voice with checksum verification."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from download_kokoro_candidates import download_candidates


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    # Reuse the atomic downloader after locally constraining this manifest.
    if manifest.get("repository") != "rhasspy/piper-voices":
        raise ValueError("unexpected Piper repository")
    if manifest.get("revision") != "0d907f158acc877ddeebcbf827659ee13bea8bcd":
        raise ValueError("unexpected Piper revision")
    if manifest.get("license") != "Apache-2.0":
        raise ValueError("unexpected Piper voice license")
    expected = {
        "es/es_MX/claude/high/es_MX-claude-high.onnx",
        "es/es_MX/claude/high/es_MX-claude-high.onnx.json",
    }
    if {item.get("path") for item in manifest.get("files", [])} != expected:
        raise ValueError("unexpected Piper file set")

    # The shared downloader's transfer implementation is generic; temporarily
    # substitute its Kokoro-specific validator with this already checked value.
    import download_kokoro_candidates as downloader
    original = downloader.validate_manifest
    downloader.validate_manifest = lambda value: value
    try:
        download_candidates(manifest, args.target)
    finally:
        downloader.validate_manifest = original
    print(f"PASS: Verified Piper Claude voice installed at {args.target}")


if __name__ == "__main__":
    main()
