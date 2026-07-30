#!/usr/bin/env python3
"""Render one locale-specific article with pinned local Kokoro files."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import resource
import shutil
import time
from pathlib import Path
from typing import Any, Callable

from article_contract import text_hash, validate_request, validate_result
from benchmark_kokoro import (
    SAMPLE_RATE,
    concatenate_audio,
    probe_audio,
    run_ffmpeg,
    sha256_file,
    verify_candidate_files,
)
from download_kokoro_candidates import validate_manifest
from pronunciations import apply_pronunciations, validate_pronunciations


ALLOWED_VOICES = {
    "es": {"ef_dora", "em_alex", "em_santa"},
    "en": {"af_heart", "af_bella"},
}
LANGUAGE_CODES = {"es": "e", "en": "a"}
EXPECTED_MODEL = "hexgrad/Kokoro-82M"
EXPECTED_MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"


def validate_voice(locale: str, voice: str) -> None:
    if voice not in ALLOWED_VOICES.get(locale, set()):
        raise ValueError(f"voice {voice!r} is not permitted for locale {locale!r}")


def resolve_production_voice(
    configuration: Any,
    locale: str,
    manifest: dict[str, Any],
) -> tuple[str, int]:
    if not isinstance(configuration, dict) or configuration.get("schemaVersion") != 1:
        raise ValueError("TTS configuration schema version must be 1")
    version = configuration.get("configurationVersion")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ValueError("TTS configuration version must be a positive integer")
    if configuration.get("status") != "approved":
        raise ValueError("TTS production voices are not approved")
    if configuration.get("model") != EXPECTED_MODEL:
        raise ValueError("TTS configuration model is unexpected")
    if configuration.get("modelRevision") != EXPECTED_MODEL_REVISION:
        raise ValueError("TTS configuration model revision is unexpected")
    if manifest.get("repository") != configuration["model"] or manifest.get(
        "revision"
    ) != configuration["modelRevision"]:
        raise ValueError("TTS configuration does not match candidate manifest")
    if configuration.get("localeVariants") != {"es": "es-419", "en": "en-US"}:
        raise ValueError("TTS locale variants must be Latin American Spanish and US English")
    voices = configuration.get("voices")
    if not isinstance(voices, dict) or set(voices) != {"es", "en"}:
        raise ValueError("TTS configuration must contain Spanish and English voices")
    voice = voices.get(locale)
    validate_voice(locale, voice)
    encoding = configuration.get("encoding")
    expected_encoding = {
        "codec": "mp3",
        "sampleRateHz": 48000,
        "channels": 1,
        "bitRate": 128000,
        "loudness": "EBU R128 I=-16 LUFS, TP=-1.5 dB, LRA=11 LU",
    }
    if encoding != expected_encoding:
        raise ValueError("TTS encoding configuration is unexpected")
    return voice, version


def resolve_delivery(configuration: Any, locale: str) -> tuple[float, float, int]:
    delivery = configuration.get("delivery") if isinstance(configuration, dict) else None
    if not isinstance(delivery, dict) or set(delivery) != {"es", "en"}:
        raise ValueError("TTS configuration must define Spanish and English delivery")
    selected = delivery.get(locale)
    expected = {"profile": "broadcast", "speed": 1.02, "pauseSeconds": 0.16}
    if selected != expected:
        raise ValueError(f"TTS {locale} delivery configuration is unexpected")
    pronunciation_version = configuration.get("pronunciationVersion")
    if not isinstance(pronunciation_version, int) or isinstance(
        pronunciation_version, bool
    ) or pronunciation_version < 1:
        raise ValueError("TTS pronunciation version must be a positive integer")
    return selected["speed"], selected["pauseSeconds"], pronunciation_version


def synthesize_kokoro(
    request: dict[str, Any],
    manifest: dict[str, Any],
    model_root: Path,
    voice: str,
    wav_path: Path,
    speed: float,
    pause_seconds: float,
) -> dict[str, Any]:
    import soundfile
    import torch
    from kokoro import KModel, KPipeline

    torch.set_num_threads(min(12, os.cpu_count() or 1))
    model_started = time.monotonic()
    model = KModel(
        repo_id=manifest["repository"],
        config=str(model_root / "config.json"),
        model=str(model_root / "kokoro-v1_0.pth"),
    ).to("cpu").eval()
    model_load_seconds = time.monotonic() - model_started
    pipeline = KPipeline(
        lang_code=LANGUAGE_CODES[request["locale"]],
        repo_id=manifest["repository"],
        model=model,
        device="cpu",
    )
    voice_path = model_root / "voices" / f"{voice}.pt"
    started = time.monotonic()
    generated = [
        result.audio
        for result in pipeline(
            [request["title"], *(item["text"] for item in request["segments"])],
            voice=str(voice_path),
            speed=speed,
        )
        if result.audio is not None
    ]
    silence = torch.zeros(round(SAMPLE_RATE * pause_seconds))
    chunks = []
    for index, chunk in enumerate(generated):
        if index:
            chunks.append(silence)
        chunks.append(chunk)
    audio = concatenate_audio(chunks, torch)
    generation_seconds = time.monotonic() - started
    soundfile.write(wav_path, audio.numpy(), SAMPLE_RATE, subtype="PCM_16")
    return {
        "modelLoadSeconds": round(model_load_seconds, 3),
        "generationSeconds": round(generation_seconds, 3),
        "peakResidentMemoryKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }


def render_article(
    request: dict[str, Any],
    manifest: dict[str, Any],
    model_root: Path,
    output: Path,
    voice: str,
    configuration_version: int,
    synthesizer: Callable[..., dict[str, Any]] = synthesize_kokoro,
    *,
    speed: float = 1.0,
    pause_seconds: float = 0.0,
    pronunciations: dict[str, Any] | None = None,
    pronunciation_version: int | None = None,
) -> dict[str, Any]:
    validate_request(request)
    validate_manifest(manifest)
    validate_voice(request["locale"], voice)
    if not isinstance(configuration_version, int) or configuration_version < 1:
        raise ValueError("configuration version must be a positive integer")
    if not isinstance(speed, (int, float)) or isinstance(speed, bool) or speed <= 0:
        raise ValueError("speed must be positive")
    if not isinstance(pause_seconds, (int, float)) or isinstance(
        pause_seconds, bool
    ) or pause_seconds < 0:
        raise ValueError("pause seconds must not be negative")
    spoken_request = copy.deepcopy(request)
    if pronunciations is not None:
        validate_pronunciations(pronunciations)
        if pronunciation_version != pronunciations["version"]:
            raise ValueError("pronunciation configuration version is stale")
        spoken_request["title"] = apply_pronunciations(
            request["title"], request["locale"], pronunciations
        )
        for source, spoken in zip(request["segments"], spoken_request["segments"]):
            spoken["text"] = apply_pronunciations(
                source["text"], request["locale"], pronunciations
            )
    verify_candidate_files(manifest, model_root)
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)

    file_name = f"{request['locale']}-{request['articleId']}.mp3"
    wav_path = staging / "audio.wav"
    mp3_path = staging / file_name
    try:
        runtime_metrics = synthesizer(
            spoken_request,
            manifest,
            model_root,
            voice,
            wav_path,
            speed,
            pause_seconds,
        )
        if not wav_path.is_file() or wav_path.stat().st_size <= 0:
            raise ValueError("synthesizer did not produce a WAV file")
        run_ffmpeg(wav_path, mp3_path)
        wav_path.unlink()
        probe = probe_audio(mp3_path)
        result = {
            "schemaVersion": 1,
            "articleId": request["articleId"],
            "locale": request["locale"],
            "sourceRevision": request["sourceRevision"],
            "textHash": text_hash(request),
            "voice": voice,
            "configurationVersion": configuration_version,
            "deliveryProfile": "broadcast" if speed == 1.02 else "custom",
            "speed": speed,
            "pauseSeconds": pause_seconds,
            "pronunciationVersion": pronunciation_version,
            "engine": "Kokoro",
            "modelRevision": manifest["revision"],
            "file": file_name,
            "codec": probe["codec"],
            "sampleRateHz": probe["sampleRateHz"],
            "channels": probe["channels"],
            "bitRate": probe["bitRate"],
            "durationSeconds": probe["durationSeconds"],
            "sizeBytes": probe["sizeBytes"],
            "sha256": sha256_file(mp3_path),
            "generatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            "runtime": runtime_metrics,
        }
        validate_result(
            request,
            result,
            expected_voice=voice,
            expected_configuration_version=configuration_version,
        )
        result_path = staging / "result.json"
        result_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, output)
        return result
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--voice")
    selection.add_argument("--configuration", type=Path)
    parser.add_argument("--configuration-version", type=int)
    parser.add_argument("--pronunciations", type=Path)
    args = parser.parse_args()
    with args.request.open(encoding="utf-8") as handle:
        request = json.load(handle)
    with args.manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if args.configuration is not None:
        if args.configuration_version is not None:
            parser.error("--configuration-version cannot accompany --configuration")
        with args.configuration.open(encoding="utf-8") as handle:
            configuration = json.load(handle)
        voice, configuration_version = resolve_production_voice(
            configuration, request["locale"], manifest
        )
        speed, pause_seconds, pronunciation_version = resolve_delivery(
            configuration, request["locale"]
        )
        if args.pronunciations is None:
            parser.error("--pronunciations is required with --configuration")
        with args.pronunciations.open(encoding="utf-8") as handle:
            pronunciations = json.load(handle)
    else:
        if args.configuration_version is None:
            parser.error("--configuration-version is required with --voice")
        voice = args.voice
        configuration_version = args.configuration_version
        speed = 1.0
        pause_seconds = 0.0
        pronunciation_version = None
        pronunciations = None
    render_article(
        request,
        manifest,
        args.model_root,
        args.output,
        voice,
        configuration_version,
        speed=speed,
        pause_seconds=pause_seconds,
        pronunciations=pronunciations,
        pronunciation_version=pronunciation_version,
    )
    print(f"PASS: Kokoro article audio generated at {args.output}")


if __name__ == "__main__":
    main()
