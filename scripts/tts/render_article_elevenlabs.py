#!/usr/bin/env python3
"""Generate one validated Spanish article with ElevenLabs Multilingual v2."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from article_contract import canonical_text, text_hash, validate_request, validate_result
from benchmark_kokoro import probe_audio, sha256_file


ENGINE = "ElevenLabs"


def api_request(url: str, key: str, payload: dict | None = None) -> bytes:
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        return response.read()


def resolve_voice_id(key: str, voice_name: str, requester: Callable = api_request) -> str:
    raw = requester(
        "https://api.elevenlabs.io/v2/voices?page_size=100&search="
        + urllib.parse.quote(voice_name),
        key,
    )
    voices = json.loads(raw).get("voices", [])
    voice = next((item for item in voices if item.get("name") == voice_name), None)
    if not voice or not voice.get("voice_id"):
        raise ValueError(f"ElevenLabs voice was not found: {voice_name}")
    return voice["voice_id"]


def split_text(text: str, maximum: int) -> list[str]:
    if maximum < 1000:
        raise ValueError("ElevenLabs chunk limit is too small")
    chunks: list[str] = []
    current = ""
    for paragraph in text.strip().split("\n\n"):
        pieces = [paragraph]
        if len(paragraph) > maximum:
            pieces = []
            remaining = paragraph
            while remaining:
                boundary = remaining.rfind(". ", 0, maximum)
                if boundary < maximum // 3:
                    boundary = remaining.rfind(" ", 0, maximum)
                if boundary < 1:
                    boundary = maximum
                else:
                    boundary += 1
                pieces.append(remaining[:boundary].strip())
                remaining = remaining[boundary:].strip()
        for piece in pieces:
            candidate = f"{current}\n\n{piece}".strip() if current else piece
            if len(candidate) > maximum and current:
                chunks.append(current)
                current = piece
            else:
                current = candidate
    if current:
        chunks.append(current)
    if not chunks or any(len(chunk) > maximum for chunk in chunks):
        raise ValueError("ElevenLabs article chunking failed")
    return chunks


def synthesize_chunk(text: str, voice_id: str, key: str, configuration: dict, requester: Callable = api_request) -> bytes:
    url = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        f"?output_format={configuration['outputFormat']}"
    )
    return requester(url, key, {
        "text": text,
        "model_id": configuration["model"],
        "voice_settings": configuration["voiceSettings"],
    })


def render_production(request: dict, configuration: dict, output: Path, key: str) -> dict:
    validate_request(request)
    if request["locale"] != "es":
        raise ValueError("ElevenLabs production worker accepts Spanish jobs only")
    if not key:
        raise ValueError("ElevenLabs credential is required")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    file_name = f"es-{request['articleId']}.mp3"
    try:
        voice_id = resolve_voice_id(key, configuration["voiceName"])
        chunks = split_text(canonical_text(request), configuration["maximumCharactersPerRequest"])
        with tempfile.TemporaryDirectory(prefix="elevenlabs-tts-", dir=staging) as temp_name:
            temp = Path(temp_name)
            paths = []
            for index, chunk in enumerate(chunks, start=1):
                path = temp / f"{index:03d}.mp3"
                path.write_bytes(synthesize_chunk(chunk, voice_id, key, configuration))
                paths.append(path)
            concat = temp / "concat.txt"
            concat.write_text("".join(f"file '{path.as_posix()}'\n" for path in paths), encoding="utf-8")
            joined = temp / "joined.mp3"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(joined)], check=True)
            mp3_path = staging / file_name
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(joined), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "1", "-b:a", "128k", str(mp3_path)], check=True)
        probe = probe_audio(mp3_path)
        result = {
            "schemaVersion": 1, "articleId": request["articleId"], "locale": "es",
            "sourceRevision": request["sourceRevision"], "textHash": text_hash(request),
            "voice": configuration["voiceName"], "configurationVersion": configuration["version"],
            "deliveryProfile": "broadcast", "pronunciationVersion": configuration["version"],
            "engine": ENGINE, "modelRevision": configuration["model"], "file": file_name,
            "codec": probe["codec"], "sampleRateHz": probe["sampleRateHz"], "channels": probe["channels"],
            "bitRate": probe["bitRate"], "durationSeconds": probe["durationSeconds"],
            "sizeBytes": probe["sizeBytes"], "sha256": sha256_file(mp3_path),
            "generatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            "chunks": len(chunks),
        }
        validate_result(request, result, expected_voice=configuration["voiceName"], expected_configuration_version=configuration["version"])
        (staging / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, output)
        return result
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    configuration = json.loads(args.configuration.read_text(encoding="utf-8"))
    result = render_production(request, configuration, args.output, os.environ.get("ELEVENLABS_API_KEY", ""))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
