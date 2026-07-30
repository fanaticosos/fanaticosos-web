#!/usr/bin/env python3
"""Render one locale-specific article with pinned local Kokoro files."""

from __future__ import annotations

import argparse
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


ALLOWED_VOICES = {
    "es": {"ef_dora", "em_alex", "em_santa"},
    "en": {"af_heart", "af_bella"},
}
LANGUAGE_CODES = {"es": "e", "en": "a"}


def validate_voice(locale: str, voice: str) -> None:
    if voice not in ALLOWED_VOICES.get(locale, set()):
        raise ValueError(f"voice {voice!r} is not permitted for locale {locale!r}")


def synthesize_kokoro(
    request: dict[str, Any],
    manifest: dict[str, Any],
    model_root: Path,
    voice: str,
    wav_path: Path,
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
    chunks = [
        result.audio
        for result in pipeline(
            [request["title"], *(item["text"] for item in request["segments"])],
            voice=str(voice_path),
            speed=1,
        )
        if result.audio is not None
    ]
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
) -> dict[str, Any]:
    validate_request(request)
    validate_manifest(manifest)
    validate_voice(request["locale"], voice)
    if not isinstance(configuration_version, int) or configuration_version < 1:
        raise ValueError("configuration version must be a positive integer")
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
            request,
            manifest,
            model_root,
            voice,
            wav_path,
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
    parser.add_argument("--voice", required=True)
    parser.add_argument("--configuration-version", required=True, type=int)
    args = parser.parse_args()
    with args.request.open(encoding="utf-8") as handle:
        request = json.load(handle)
    with args.manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    render_article(
        request,
        manifest,
        args.model_root,
        args.output,
        args.voice,
        args.configuration_version,
    )
    print(f"PASS: Kokoro article audio generated at {args.output}")


if __name__ == "__main__":
    main()
