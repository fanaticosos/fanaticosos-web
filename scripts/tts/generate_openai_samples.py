#!/usr/bin/env python3
"""Generate two private, bounded OpenAI TTS samples without publishing."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.request
from pathlib import Path


def clean(markdown: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"(?:\*\*|__|[*_#>`])", "", markdown)).strip()


def sample(title: str, description: str, body: str) -> str:
    paragraphs = [clean(value) for value in body.split("\n\n") if clean(value)]
    return "\n\n".join([clean(title), clean(description), *paragraphs[:3]])[:2400]


def speech(api_key: str, text: str, instructions: str) -> bytes:
    payload = json.dumps({
        "model": "gpt-4o-mini-tts", "voice": "coral", "input": text,
        "instructions": instructions, "response_format": "mp3",
    }).encode()
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech", data=payload, method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draft", type=Path, required=True)
    parser.add_argument("--translation", type=Path)
    parser.add_argument("--locale", choices=("es", "en"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    draft = json.loads(args.draft.read_text(encoding="utf-8"))
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key.startswith("sk-"):
        raise ValueError("OpenAI credential is unavailable")
    if args.locale == "es":
        text = sample(draft["title"], draft["description"], draft["body"])
    else:
        if args.translation is None:
            raise ValueError("English generation requires a translation state")
        state = json.loads(args.translation.read_text(encoding="utf-8"))
        if state.get("status") != "completed" or state.get("draftRevision") != draft.get("revision"):
            raise ValueError("a completed current English translation is required")
        text = sample(state["result"]["title"], state["result"]["description"], state["result"]["body"])
    instructions = {
        "es": "Narración periodística deportiva en español latino, cálida y natural. Pronuncia los nombres de la NFL con precisión. Sin voz exagerada de anunciador.",
        "en": "Natural Chicago sports-podcast narration, warm and reflective. Pronounce NFL names accurately. Avoid an exaggerated announcer voice.",
    }
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    audio = speech(key, text, instructions[args.locale])
    target = args.output / f"sample-{args.locale}.mp3"
    target.write_bytes(audio); target.chmod(0o600)
    result = {"file": target.name, "characters": len(text), "sha256": hashlib.sha256(audio).hexdigest()}
    (args.output / "summary.json").write_text(json.dumps({"model": "gpt-4o-mini-tts", "voice": "coral", "locale": args.locale, "sample": result}, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
