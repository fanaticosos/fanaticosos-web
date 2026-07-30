#!/usr/bin/env python3
"""Generate the fixed Kokoro listening set from pinned local files."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from download_kokoro_candidates import validate_manifest
from validate_benchmark import validate_benchmark


SAMPLE_RATE = 24_000
MP3_SAMPLE_RATE = 48_000
MP3_BITRATE = "128k"
SILENCE_SECONDS = 0.2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_candidate_files(manifest: dict[str, Any], model_root: Path) -> None:
    validate_manifest(manifest)
    for item in manifest["files"]:
        path = model_root / item["path"]
        if not path.is_file():
            raise FileNotFoundError(f"candidate file is missing: {item['path']}")
        if path.stat().st_size != item["size"]:
            raise ValueError(f"{item['path']}: size mismatch")
        if sha256_file(path) != item["sha256"]:
            raise ValueError(f"{item['path']}: SHA-256 mismatch")


def concatenate_audio(chunks: list[Any], torch_module: Any) -> Any:
    if not chunks:
        raise ValueError("Kokoro produced no audio")
    normalized = [chunk.detach().cpu().flatten() for chunk in chunks]
    silence = torch_module.zeros(int(SAMPLE_RATE * SILENCE_SECONDS))
    joined: list[Any] = []
    for index, chunk in enumerate(normalized):
        if chunk.numel() == 0:
            raise ValueError("Kokoro produced an empty audio chunk")
        if index:
            joined.append(silence)
        joined.append(chunk)
    return torch_module.cat(joined)


def run_ffmpeg(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(wav_path),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar",
            str(MP3_SAMPLE_RATE),
            "-ac",
            "1",
            "-b:a",
            MP3_BITRATE,
            str(mp3_path),
        ],
        check=True,
    )


def probe_audio(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate:format=duration,size",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    value = json.loads(completed.stdout)
    streams = value.get("streams")
    if not isinstance(streams, list) or len(streams) != 1:
        raise ValueError(f"{path.name}: expected exactly one audio stream")
    stream = streams[0]
    audio_format = value.get("format", {})
    result = {
        "codec": stream.get("codec_name"),
        "sampleRateHz": int(stream.get("sample_rate", 0)),
        "channels": int(stream.get("channels", 0)),
        "bitRate": int(stream.get("bit_rate", 0)),
        "durationSeconds": round(float(audio_format.get("duration", 0)), 3),
        "sizeBytes": int(audio_format.get("size", 0)),
    }
    if result["codec"] != "mp3":
        raise ValueError(f"{path.name}: codec is not MP3")
    if result["sampleRateHz"] != MP3_SAMPLE_RATE or result["channels"] != 1:
        raise ValueError(f"{path.name}: unexpected sample rate or channel count")
    if result["durationSeconds"] <= 0 or result["sizeBytes"] <= 0:
        raise ValueError(f"{path.name}: empty audio")
    return result


def generate_benchmark(
    benchmark: dict[str, Any],
    manifest: dict[str, Any],
    model_root: Path,
    output: Path,
) -> None:
    validate_benchmark(benchmark)
    verify_candidate_files(manifest, model_root)
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)

    try:
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
        samples = {sample["locale"]: sample for sample in benchmark["samples"]}
        results = []

        for locale, voices in benchmark["candidates"].items():
            sample = samples[locale]
            pipeline = KPipeline(
                lang_code=sample["languageCode"],
                repo_id=manifest["repository"],
                model=model,
                device="cpu",
            )
            for voice in voices:
                voice_path = model_root / "voices" / f"{voice}.pt"
                started = time.monotonic()
                chunks = [
                    result.audio
                    for result in pipeline(
                        sample["text"],
                        voice=str(voice_path),
                        speed=1,
                    )
                    if result.audio is not None
                ]
                audio = concatenate_audio(chunks, torch)
                generation_seconds = time.monotonic() - started
                wav_path = staging / f"{locale}-{voice}.wav"
                mp3_path = staging / f"{locale}-{voice}.mp3"
                soundfile.write(wav_path, audio.numpy(), SAMPLE_RATE, subtype="PCM_16")
                run_ffmpeg(wav_path, mp3_path)
                wav_path.unlink()
                probe = probe_audio(mp3_path)
                probe.update(
                    {
                        "locale": locale,
                        "voice": voice,
                        "file": mp3_path.name,
                        "sha256": sha256_file(mp3_path),
                        "generationSeconds": round(generation_seconds, 3),
                        "realTimeFactor": round(
                            generation_seconds / probe["durationSeconds"], 3
                        ),
                    }
                )
                results.append(probe)

        metrics = {
            "schemaVersion": 1,
            "benchmarkVersion": benchmark["version"],
            "model": manifest["repository"],
            "modelRevision": manifest["revision"],
            "modelLoadSeconds": round(model_load_seconds, 3),
            "peakResidentMemoryKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "sampleRateHz": SAMPLE_RATE,
            "normalization": "EBU R128 I=-16 LUFS, TP=-1.5 dB, LRA=11 LU",
            "results": results,
        }
        metrics_path = staging / "metrics.json"
        metrics_path.write_text(
            json.dumps(metrics, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    with args.benchmark.open(encoding="utf-8") as handle:
        benchmark = json.load(handle)
    with args.manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    generate_benchmark(benchmark, manifest, args.model_root, args.output)
    print(f"PASS: Kokoro listening benchmark generated at {args.output}")


if __name__ == "__main__":
    main()
