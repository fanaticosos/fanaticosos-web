#!/usr/bin/env python3
"""Render a Fanaticosos Spanish article with Azure Speech and NFL pronunciation rules."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from compile_azure_nfl_lexicon import load_configuration, voice_segments


def build_chunks(segments: list[dict[str, str]], maximum_characters: int = 2600) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_length = 0
    for segment in segments:
        text = segment["text"].strip()
        if not text:
            continue
        addition = len(text) + (2 if current else 0)
        if current and current_length + addition > maximum_characters:
            chunks.append("\n\n".join(current))
            current = []
            current_length = 0
        if len(text) > maximum_characters:
            raise ValueError(f"segment exceeds Azure chunk limit: {segment['id']}")
        current.append(text)
        current_length += len(text) + (2 if len(current) > 1 else 0)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def build_ssml(text: str, configuration: dict) -> bytes:
    voices: list[str] = []
    for segment in voice_segments(text, configuration):
        voices.append(
            f'<voice name="{segment["voice"]}">'
            f'{segment["markup"]}</voice>'
        )
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{configuration["locale"]}">'
        f'{"".join(voices)}</speak>'
    )
    ET.fromstring(ssml)
    return ssml.encode("utf-8")


def synthesize(ssml: bytes, key: str, region: str) -> bytes:
    endpoint = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    for attempt in range(1, 4):
        request = urllib.request.Request(
            endpoint,
            data=ssml,
            method="POST",
            headers={
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
                "User-Agent": "FanaticososBlogTTS",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace").strip()
            if error.code < 500 or attempt == 3:
                raise RuntimeError(
                    f"Azure Speech returned HTTP {error.code}: {details or 'no response details'}"
                ) from error
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt == 3:
                raise RuntimeError("Azure Speech remained unavailable after three attempts") from error
        time.sleep(attempt * 2)
    raise RuntimeError("Azure Speech synthesis retry loop ended unexpectedly")


def render(request_path: Path, configuration_path: Path, output_path: Path) -> dict:
    key = os.environ.get("AZURE_SPEECH_KEY", "")
    region = os.environ.get("AZURE_SPEECH_REGION", "eastus")
    if not key:
        raise ValueError("AZURE_SPEECH_KEY is required")
    request_value = json.loads(request_path.read_text(encoding="utf-8"))
    configuration = load_configuration(configuration_path)
    chunks = build_chunks(request_value["segments"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fanaticosos-azure-tts-") as temp_name:
        temp = Path(temp_name)
        chunk_paths: list[Path] = []
        for index, chunk in enumerate(chunks, start=1):
            path = temp / f"{index:03d}.mp3"
            path.write_bytes(synthesize(build_ssml(chunk, configuration), key, region))
            chunk_paths.append(path)
        concat_path = temp / "concat.txt"
        concat_path.write_text(
            "".join(f"file '{path.as_posix()}'\n" for path in chunk_paths),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-f", "concat", "-safe", "0",
                "-i", str(concat_path), "-c", "copy", "-y", str(output_path),
            ],
            check=True,
        )
    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    return {
        "file": str(output_path),
        "chunks": len(chunks),
        "characters": sum(len(segment["text"]) for segment in request_value["segments"]),
        "bytes": output_path.stat().st_size,
        "sha256": digest,
        "voice": configuration["voice"],
        "rate": configuration["broadcastRate"],
        "lexiconVersion": configuration["version"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    metadata = render(args.request, args.configuration, args.output)
    args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
