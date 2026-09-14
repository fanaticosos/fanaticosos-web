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
import re
import tempfile
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Callable

from article_contract import text_hash, validate_request, validate_result
from benchmark_kokoro import probe_audio, sha256_file
from elevenlabs_quota import QuotaError, fetch_subscription, parse_key_limit, preflight, read_ledger, record_usage
from pronunciations import apply_pronunciations, validate_pronunciations


ENGINE = "ElevenLabs"
VOICE_ID = re.compile(r"^[A-Za-z0-9]{8,64}$")
RETRYABLE_HTTP = {429, 500, 502, 503, 504}
REQUEST_ATTEMPTS = 3


def write_progress(path: Path, *, stage: str, total_chunks: int, completed_chunks: int,
                   cache_hits: int, generated_chunks: int, quota: dict | None = None) -> None:
    """Publish sanitized, atomic progress without exposing narration or credentials."""
    value = {
        "schemaVersion": 1,
        "stage": stage,
        "totalChunks": total_chunks,
        "completedChunks": completed_chunks,
        "cacheHits": cache_hits,
        "generatedChunks": generated_chunks,
        "updatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
    }
    if quota is not None:
        value["quota"] = {
            name: quota.get(name)
            for name in ("requiredCharacters", "accountRemaining", "keyLimit", "keyUsedThisCycle")
            if isinstance(quota.get(name), int) and not isinstance(quota.get(name), bool)
        }
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.saving")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def api_request(url: str, key: str, payload: dict | None = None, *, attempts: int = REQUEST_ATTEMPTS, sleep: Callable = time.sleep) -> bytes:
    """Call ElevenLabs once; retry only transient failures (429/5xx/network) with backoff.

    A rejected request never bills, so retrying a 429 or 5xx is safe. Client
    errors such as 401/quota_exceeded are surfaced immediately and sanitized.
    """
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    for attempt in range(1, attempts + 1):
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
            if error.code in RETRYABLE_HTTP and attempt < attempts:
                sleep(2 ** attempt)
                continue
            raise RuntimeError(
                f"ElevenLabs HTTP {error.code}: {status}: {message}"
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < attempts:
                sleep(2 ** attempt)
                continue
            raise RuntimeError("ElevenLabs HTTP 0: network_unavailable: ElevenLabs did not respond") from None
    raise RuntimeError("ElevenLabs HTTP 0: network_unavailable: ElevenLabs did not respond")


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


def _identity_digest(value: dict) -> str:
    identity = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def chunk_identity(text: str, voice_id: str, configuration: dict, previous_text: str | None = None, next_text: str | None = None) -> str:
    """Cache identity of one paid block.

    The spoken text already carries every pronunciation substitution, so the
    pronunciation version counter is deliberately excluded: bumping it for an
    unrelated word must not re-bill blocks whose text did not change.
    """
    return _identity_digest({
        "schemaVersion": 2,
        "voiceId": voice_id,
        "model": configuration["model"],
        "outputFormat": configuration["outputFormat"],
        "voiceSettings": configuration["voiceSettings"],
        "text": text,
        "previousText": previous_text,
        "nextText": next_text,
    })


def legacy_chunk_identity(text: str, voice_id: str, configuration: dict, previous_text: str | None = None, next_text: str | None = None) -> str:
    """Identity used before 2026-09-14; kept so already paid blocks are migrated, not re-bought."""
    return _identity_digest({
        "schemaVersion": 1,
        "voiceId": voice_id,
        "model": configuration["model"],
        "outputFormat": configuration["outputFormat"],
        "voiceSettings": configuration["voiceSettings"],
        "pronunciationVersion": configuration["pronunciationVersion"],
        "text": text,
        "previousText": previous_text,
        "nextText": next_text,
    })


def _read_cached(cache: Path, digest: str) -> bytes | None:
    try:
        audio = (cache / f"{digest}.mp3").read_bytes()
    except FileNotFoundError:
        return None
    if not audio:
        raise ValueError("cached ElevenLabs chunk is empty")
    return audio


def _store_cached(cache: Path, digest: str, audio: bytes) -> None:
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = cache / f"{digest}.mp3"
    temporary = cache / f".{digest}.{uuid.uuid4().hex}.saving"
    temporary.write_bytes(audio)
    temporary.chmod(0o600)
    os.replace(temporary, target)


def cached_audio(text: str, voice_id: str, configuration: dict, cache: Path, previous_text: str | None = None, next_text: str | None = None) -> bytes | None:
    """Return the paid block if it is cached under the current or the legacy identity."""
    digest = chunk_identity(text, voice_id, configuration, previous_text, next_text)
    audio = _read_cached(cache, digest)
    if audio is not None:
        return audio
    legacy = _read_cached(cache, legacy_chunk_identity(text, voice_id, configuration, previous_text, next_text))
    if legacy is not None:
        _store_cached(cache, digest, legacy)
    return legacy


def chunk_is_cached(text: str, voice_id: str, configuration: dict, cache: Path, previous_text: str | None = None, next_text: str | None = None) -> bool:
    return cached_audio(text, voice_id, configuration, cache, previous_text, next_text) is not None


def cached_chunk(text: str, voice_id: str, key: str, configuration: dict, cache: Path, requester: Callable = api_request, previous_text: str | None = None, next_text: str | None = None) -> tuple[bytes, bool]:
    audio = cached_audio(text, voice_id, configuration, cache, previous_text, next_text)
    if audio is not None:
        return audio, True
    digest = chunk_identity(text, voice_id, configuration, previous_text, next_text)
    audio = synthesize_chunk(text, voice_id, key, configuration, requester, previous_text, next_text)
    if not audio:
        raise ValueError("ElevenLabs returned an empty audio chunk")
    _store_cached(cache, digest, audio)
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


def configured_voice_id(configuration: dict, key: str, requester: Callable = api_request) -> str:
    """Use the pinned voice ID when the configuration carries one; otherwise resolve by exact name."""
    pinned = configuration.get("voiceId")
    if pinned is not None:
        if not isinstance(pinned, str) or not VOICE_ID.fullmatch(pinned):
            raise ValueError("ElevenLabs voiceId is invalid")
        return pinned
    return resolve_voice_id(key, configuration["voiceName"], requester)


def quota_plan(chunks: list[dict], voice_id: str, configuration: dict, cache: Path) -> dict:
    """Characters that still have to be bought, after honouring the block cache."""
    pending = [
        chunk for chunk in chunks
        if not chunk_is_cached(chunk["text"], voice_id, configuration, cache, chunk["previousText"], chunk["nextText"])
    ]
    return {
        "totalChunks": len(chunks),
        "cachedChunks": len(chunks) - len(pending),
        "pendingChunks": len(pending),
        "requiredCharacters": sum(len(chunk["text"]) for chunk in pending),
    }


def render_production(request: dict, configuration: dict, pronunciations: dict, output: Path, cache: Path, key: str, *,
                      requester: Callable = api_request, subscription_fetcher: Callable = fetch_subscription,
                      environment: dict | None = None) -> dict:
    validate_request(request)
    if request["locale"] != "es":
        raise ValueError("ElevenLabs production worker accepts Spanish jobs only")
    if not key:
        raise ValueError("ElevenLabs credential is required")
    validate_pronunciations(pronunciations)
    if configuration.get("pronunciationVersion") != pronunciations["version"]:
        raise ValueError("ElevenLabs pronunciation configuration version is stale")
    key_limit = parse_key_limit((os.environ if environment is None else environment).get("ELEVENLABS_KEY_CHARACTER_LIMIT"))
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    file_name = f"es-{request['articleId']}.mp3"
    try:
        voice_id = configured_voice_id(configuration, key, requester)
        spoken_request = prepare_spoken_request(request, pronunciations)
        chunks = narration_chunks(spoken_request, configuration["maximumCharactersPerRequest"])
        progress_path = output.parent / "progress.json"
        # Quota preflight: nothing is bought until the whole remaining cost is
        # known to fit both the account balance and the key's configured limit.
        plan = quota_plan(chunks, voice_id, configuration, cache)
        quota = {"requiredCharacters": plan["requiredCharacters"], "accountRemaining": None, "keyLimit": key_limit, "keyUsedThisCycle": 0, "allowed": True, "reason": None}
        reset_unix = None
        write_progress(progress_path, stage="preflight", total_chunks=len(chunks), completed_chunks=0, cache_hits=plan["cachedChunks"], generated_chunks=0, quota=quota)
        if plan["pendingChunks"]:
            subscription = subscription_fetcher(key)
            reset_unix = subscription.get("next_character_count_reset_unix")
            ledger = read_ledger(cache, key, reset_unix)
            quota = preflight(subscription=subscription, ledger=ledger, required_characters=plan["requiredCharacters"], key_limit=key_limit)
            write_progress(progress_path, stage="preflight", total_chunks=len(chunks), completed_chunks=0, cache_hits=plan["cachedChunks"], generated_chunks=0, quota=quota)
            if not quota["allowed"]:
                raise QuotaError(quota["reason"])
        write_progress(progress_path, stage="generating", total_chunks=len(chunks), completed_chunks=0, cache_hits=0, generated_chunks=0, quota=quota)
        with tempfile.TemporaryDirectory(prefix="elevenlabs-tts-", dir=staging) as temp_name:
            temp = Path(temp_name)
            paths = []
            cache_hits = 0
            for index, chunk in enumerate(chunks, start=1):
                path = temp / f"{index:03d}.mp3"
                audio, reused = cached_chunk(chunk["text"], voice_id, key, configuration, cache, requester, previous_text=chunk["previousText"], next_text=chunk["nextText"])
                path.write_bytes(audio)
                cache_hits += int(reused)
                if not reused:
                    record_usage(cache, key, len(chunk["text"]), reset_unix)
                paths.append(path)
                write_progress(
                    progress_path,
                    stage="generating",
                    total_chunks=len(chunks),
                    completed_chunks=index,
                    cache_hits=cache_hits,
                    generated_chunks=index - cache_hits,
                    quota=quota,
                )
            concat = temp / "concat.txt"
            concat.write_text("".join(f"file '{path.as_posix()}'\n" for path in paths), encoding="utf-8")
            mp3_path = staging / file_name
            write_progress(progress_path, stage="assembling", total_chunks=len(chunks), completed_chunks=len(chunks), cache_hits=cache_hits, generated_chunks=len(chunks) - cache_hits, quota=quota)
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
            "quota": {
                "requiredCharacters": plan["requiredCharacters"],
                "accountRemainingBefore": quota.get("accountRemaining"),
                "keyLimit": key_limit,
                "keyUsedThisCycleBefore": quota.get("keyUsedThisCycle"),
            },
        }
        validate_result(request, result, expected_voice=configuration["voiceName"], expected_configuration_version=configuration["version"])
        (staging / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, output)
        write_progress(progress_path, stage="completed", total_chunks=len(chunks), completed_chunks=len(chunks), cache_hits=cache_hits, generated_chunks=len(chunks) - cache_hits, quota=quota)
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
            message = str(error) if isinstance(error, QuotaError) or str(error).startswith("ElevenLabs HTTP ") else "La generación de audio no pudo completarse."
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
