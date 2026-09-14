#!/usr/bin/env python3
"""Generate one validated Spanish article with ElevenLabs Multilingual v2."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Callable

from article_contract import text_hash, validate_request, validate_result
from benchmark_kokoro import probe_audio, sha256_file
from pronunciations import apply_pronunciations, validate_pronunciations


ENGINE = "ElevenLabs"


def api_request(url: str, key: str, payload: dict | None = None) -> bytes:
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {}
        detail = body.get("detail") if isinstance(body, dict) else None
        detail = detail if isinstance(detail, dict) else {}
        status = detail.get("status") or detail.get("code") or "provider_error"
        message = detail.get("message") or "ElevenLabs rejected the request"
        raise RuntimeError(
            f"ElevenLabs HTTP {error.code}: {status}: {message}"
        ) from None


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


def synthesize_chunk(text: str, voice_id: str, key: str, configuration: dict, requester: Callable = api_request, previous_text: str | None = None, next_text: str | None = None) -> bytes:
    url = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        f"?output_format={configuration['outputFormat']}"
    )
    payload = {
        "text": text,
        "model_id": configuration["model"],
        "voice_settings": configuration["voiceSettings"],
    }
    if previous_text:
        payload["previous_text"] = previous_text
    if next_text:
        payload["next_text"] = next_text
    return requester(url, key, payload)


def cached_chunk(text: str, voice_id: str, key: str, configuration: dict, cache: Path, requester: Callable = api_request, previous_text: str | None = None, next_text: str | None = None) -> tuple[bytes, bool]:
    identity = json.dumps({
        "schemaVersion": 1,
        "voiceId": voice_id,
        "model": configuration["model"],
        "outputFormat": configuration["outputFormat"],
        "voiceSettings": configuration["voiceSettings"],
        "pronunciationVersion": configuration["pronunciationVersion"],
        "text": text,
        "previousText": previous_text,
        "nextText": next_text,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    target = cache / f"{digest}.mp3"
    try:
        audio = target.read_bytes()
        if not audio:
            raise ValueError("cached ElevenLabs chunk is empty")
        return audio, True
    except FileNotFoundError:
        pass
    audio = synthesize_chunk(text, voice_id, key, configuration, requester, previous_text, next_text)
    if not audio:
        raise ValueError("ElevenLabs returned an empty audio chunk")
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = cache / f".{digest}.{uuid.uuid4().hex}.saving"
    temporary.write_bytes(audio)
    temporary.chmod(0o600)
    os.replace(temporary, target)
    return audio, False


def narration_chunks(request: dict, maximum: int) -> list[dict]:
    units = [{"text": request["title"], "pauseAfterMs": 700}, *request["segments"]]
    sections = []
    section = []
    for index, unit in enumerate(units):
        pause_ms = unit.get("pauseAfterMs", 0)
        if pause_ms and (not isinstance(pause_ms, int) or isinstance(pause_ms, bool) or not 1 <= pause_ms <= 3000):
            raise ValueError("ElevenLabs pauses must be whole milliseconds between 1 and 3000")
        if index and pause_ms == 900 and section:
            sections.append("\n\n".join(section))
            section = []
        break_tag = f'<break time="{pause_ms / 1000:g}s" />' if pause_ms and index + 1 < len(units) else ""
        pieces = split_text(unit["text"], maximum - len(break_tag) - 2)
        if break_tag:
            pieces[-1] = f"{pieces[-1]}\n\n{break_tag}"
        section.extend(pieces)
    if section:
        sections.append("\n\n".join(section))
    return [
        {"text": text, "previousText": None, "nextText": None}
        for section_text in sections
        for text in split_text(section_text, maximum)
    ]


def prepare_spoken_request(request: dict, pronunciations: dict) -> dict:
    validate_request(request)
    validate_pronunciations(pronunciations)
    spoken = copy.deepcopy(request)
    spoken["title"] = apply_pronunciations(request["title"], request["locale"], pronunciations, provider="elevenlabs")
    for source, target in zip(request["segments"], spoken["segments"]):
        target["text"] = apply_pronunciations(source["text"], request["locale"], pronunciations, provider="elevenlabs")
    return spoken


def render_production(request: dict, configuration: dict, pronunciations: dict, output: Path, cache: Path, key: str) -> dict:
    validate_request(request)
    if request["locale"] != "es":
        raise ValueError("ElevenLabs production worker accepts Spanish jobs only")
    if not key:
        raise ValueError("ElevenLabs credential is required")
    validate_pronunciations(pronunciations)
    if configuration.get("pronunciationVersion") != pronunciations["version"]:
        raise ValueError("ElevenLabs pronunciation configuration version is stale")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    file_name = f"es-{request['articleId']}.mp3"
    try:
        voice_id = resolve_voice_id(key, configuration["voiceName"])
        spoken_request = prepare_spoken_request(request, pronunciations)
        chunks = narration_chunks(spoken_request, configuration["maximumCharactersPerRequest"])
        with tempfile.TemporaryDirectory(prefix="elevenlabs-tts-", dir=staging) as temp_name:
            temp = Path(temp_name)
            paths = []
            cache_hits = 0
            for index, chunk in enumerate(chunks, start=1):
                path = temp / f"{index:03d}.mp3"
                audio, reused = cached_chunk(chunk["text"], voice_id, key, configuration, cache, previous_text=chunk["previousText"], next_text=chunk["nextText"])
                path.write_bytes(audio)
                cache_hits += int(reused)
                paths.append(path)
            concat = temp / "concat.txt"
            concat.write_text("".join(f"file '{path.as_posix()}'\n" for path in paths), encoding="utf-8")
            mp3_path = staging / file_name
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "1", "-b:a", "128k", str(mp3_path)], check=True)
        probe = probe_audio(mp3_path)
        result = {
            "schemaVersion": 1, "articleId": request["articleId"], "locale": "es",
            "sourceRevision": request["sourceRevision"], "textHash": text_hash(request),
            "voice": configuration["voiceName"], "configurationVersion": configuration["version"],
            "deliveryProfile": "broadcast", "pronunciationVersion": pronunciations["version"],
            "engine": ENGINE, "modelRevision": configuration["model"], "file": file_name,
            "codec": probe["codec"], "sampleRateHz": probe["sampleRateHz"], "channels": probe["channels"],
            "bitRate": probe["bitRate"], "durationSeconds": probe["durationSeconds"],
            "sizeBytes": probe["sizeBytes"], "sha256": sha256_file(mp3_path),
            "generatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            "chunks": len(chunks), "cacheHits": cache_hits, "generatedChunks": len(chunks) - cache_hits,
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
    parser.add_argument("--pronunciations", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    configuration = json.loads(args.configuration.read_text(encoding="utf-8"))
    pronunciations = json.loads(args.pronunciations.read_text(encoding="utf-8"))
    try:
        result = render_production(request, configuration, pronunciations, args.output, args.cache, os.environ.get("ELEVENLABS_API_KEY", ""))
        print(json.dumps(result, indent=2))
    except Exception as error:
        failure = args.output.parent / "failure.json"
        if not failure.exists():
            message = str(error) if str(error).startswith("ElevenLabs HTTP ") else "La generación de audio no pudo completarse."
            temporary = failure.with_name(f".{failure.name}.{uuid.uuid4().hex}.saving")
            temporary.write_text(json.dumps({
                "schemaVersion": 1,
                "error": message,
                "failedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            os.replace(temporary, failure)
        raise


if __name__ == "__main__":
    main()
