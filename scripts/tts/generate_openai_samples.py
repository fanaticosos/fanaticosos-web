#!/usr/bin/env python3
"""Generate two private, bounded OpenAI TTS samples without publishing."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
import urllib.request
from pathlib import Path


def clean(markdown: str) -> str:
    value = re.sub(r"fanaticosos", "fanaticosos", markdown, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", re.sub(r"(?:\*\*|__|[*_#>`])", "", value)).strip()


def sample(title: str, description: str, body: str) -> str:
    paragraphs = [clean(value) for value in body.split("\n\n") if clean(value)]
    return "\n\n".join([clean(title), clean(description), *paragraphs[:3]])[:2400]


def speech(api_key: str, text: str, instructions: str) -> bytes:
    payload = json.dumps({
        "model": "gpt-4o-mini-tts", "voice": "marin", "input": text,
        "instructions": instructions, "response_format": "mp3",
    }).encode()
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech", data=payload, method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def transcribe(api_key: str, audio: bytes) -> str:
    boundary = f"fanaticosos-{uuid.uuid4().hex}"
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-4o-mini-transcribe\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sample.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n".encode(),
        audio, f"\r\n--{boundary}--\r\n".encode(),
    ]
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions", data=b"".join(parts), method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read())["text"]


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
        "es": "Voz humana, cálida y conversacional de podcast deportivo latino. Pronuncia 'fanaticosos' exactamente como se escribe en español, como una sola palabra; jamás deletrees S-O-S. Pronuncia naturalmente en inglés los nombres y frases inglesas como Chicago Bears, Super Bowl y NFL. Evita voz robótica, cadencia de asistente y tono exagerado de anunciador.",
        "en": "Natural Chicago sports-podcast narration, warm and reflective. Pronounce NFL names accurately. Avoid an exaggerated announcer voice.",
    }
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    audio = speech(key, text, instructions[args.locale])
    transcript = transcribe(key, audio)
    if args.locale == "es" and "fanaticosos" not in transcript.casefold():
        raise ValueError("automatic QA rejected the brand pronunciation")
    target = args.output / f"sample-{args.locale}.mp3"
    target.write_bytes(audio); target.chmod(0o600)
    result = {"file": target.name, "characters": len(text), "sha256": hashlib.sha256(audio).hexdigest(), "transcript": transcript}
    (args.output / "summary.json").write_text(json.dumps({"model": "gpt-4o-mini-tts", "voice": "marin", "locale": args.locale, "sample": result}, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
