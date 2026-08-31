#!/usr/bin/env python3
"""Route a validated production TTS request to its approved locale engine."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from article_contract import validate_request


KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"


def worker_arguments(request: dict, repository: Path, output: Path) -> list[str]:
    validate_request(request)
    request_path = output.parent / "request.json"
    if request["locale"] == "es":
        return [
            sys.executable,
            str(repository / "scripts/tts/render_article_elevenlabs.py"),
            "--request", str(request_path),
            "--configuration", str(repository / "config/tts/elevenlabs-production.json"),
            "--output", str(output),
        ]
    return [
        sys.executable,
        str(repository / "scripts/tts/render_article_kokoro.py"),
        "--request", str(request_path),
        "--manifest", str(repository / "config/tts/kokoro-candidate-files.json"),
        "--model-root", f"/opt/fanaticosos-blog/models/kokoro-82m/{KOKORO_REVISION}",
        "--output", str(output),
        "--configuration", str(repository / "config/tts/production.json"),
        "--pronunciations", str(repository / "config/tts/pronunciations.json"),
    ]


def worker_environment(locale: str, environment: dict[str, str]) -> dict[str, str]:
    selected = dict(environment)
    if locale == "en":
        selected.pop("AZURE_SPEECH_KEY", None)
        selected.pop("AZURE_SPEECH_REGION", None)
        selected.pop("ELEVENLABS_API_KEY", None)
    else:
        selected.pop("AZURE_SPEECH_KEY", None)
        selected.pop("AZURE_SPEECH_REGION", None)
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    command = worker_arguments(request, args.repository, args.output)
    os.execve(command[0], command, worker_environment(request["locale"], os.environ))


if __name__ == "__main__":
    main()
