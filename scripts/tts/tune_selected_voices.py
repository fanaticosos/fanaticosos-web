#!/usr/bin/env python3
"""Generate the fixed delivery matrix for the owner-selected voices."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from benchmark_kokoro import probe_audio, run_ffmpeg, sha256_file
from mixed_phonemes import phonemize_mixed


SAMPLE_RATE = 24_000
EXPECTED_PROFILES = [
    {"id": "natural", "speed": 0.97, "pauseSeconds": 0.22},
    {"id": "relaxed", "speed": 0.92, "pauseSeconds": 0.32},
    {"id": "broadcast", "speed": 1.02, "pauseSeconds": 0.16},
]
TEXT = {
    "es": [
        "Los Chicago Bears y Caleb Williams enfrentan a Green Bay Packers en Soldier Field.",
        "El partido de la NFC North terminó 27 a 24 con un gol de campo de último segundo.",
    ],
    "en": [
        "The Chicago Bears and Caleb Williams face the Green Bay Packers at Soldier Field.",
        "The NFC North game ended 27 to 24 on a last-second field goal.",
    ],
}


def validate_matrix(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("tuning matrix schema version must be 1")
    if value.get("version") != 1:
        raise ValueError("tuning matrix version must be 1")
    if value.get("voices") != {"es": "em_alex", "en": "af_heart"}:
        raise ValueError("tuning matrix voices do not match owner selection")
    if value.get("profiles") != EXPECTED_PROFILES:
        raise ValueError("tuning matrix profiles do not match version 1")
    return value


def join_with_pause(chunks: list[Any], pause_seconds: float, torch_module: Any) -> Any:
    if not chunks:
        raise ValueError("TTS produced no audio")
    silence = torch_module.zeros(int(SAMPLE_RATE * pause_seconds))
    values = []
    for index, chunk in enumerate(chunks):
        chunk = chunk.detach().cpu().flatten()
        if chunk.numel() == 0:
            raise ValueError("TTS produced an empty audio chunk")
        if index:
            values.append(silence)
        values.append(chunk)
    return torch_module.cat(values)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", required=True, type=Path)
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"output already exists: {args.output}")
    staging = args.output.with_name(f"{args.output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    matrix = validate_matrix(json.loads(args.matrix.read_text(encoding="utf-8")))
    glossary = json.loads(args.glossary.read_text(encoding="utf-8"))
    staging.mkdir(parents=True, mode=0o700)
    try:
        import soundfile
        import torch
        from kokoro import KModel, KPipeline

        torch.manual_seed(20260730)
        torch.set_num_threads(min(12, os.cpu_count() or 1))
        model = KModel(
            repo_id="hexgrad/Kokoro-82M",
            config=str(args.model_root / "config.json"),
            model=str(args.model_root / "kokoro-v1_0.pth"),
        ).to("cpu").eval()
        pipelines = {
            "es": KPipeline("e", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu"),
            "en": KPipeline("a", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu"),
        }
        english_phonemizer = KPipeline(
            "a", repo_id="hexgrad/Kokoro-82M", model=False, device="cpu"
        )
        results = []
        for locale, voice in matrix["voices"].items():
            pipeline = pipelines[locale]
            voice_path = args.model_root / "voices" / f"{voice}.pt"
            for profile in matrix["profiles"]:
                started = time.monotonic()
                chunks = []
                for sentence in TEXT[locale]:
                    if locale == "es":
                        phonemes = phonemize_mixed(
                            sentence,
                            glossary["protectedNames"],
                            pipeline,
                            english_phonemizer,
                        )
                        generated = pipeline.generate_from_tokens(
                            phonemes,
                            voice=str(voice_path),
                            speed=profile["speed"],
                            model=model,
                        )
                    else:
                        generated = pipeline(
                            sentence,
                            voice=str(voice_path),
                            speed=profile["speed"],
                            model=model,
                        )
                    chunks.extend(
                        item.audio for item in generated if item.audio is not None
                    )
                audio = join_with_pause(
                    chunks, profile["pauseSeconds"], torch
                )
                name = f"{locale}-{voice}-{profile['id']}"
                wav = staging / f"{name}.wav"
                mp3 = staging / f"{name}.mp3"
                soundfile.write(wav, audio.numpy(), SAMPLE_RATE, subtype="PCM_16")
                run_ffmpeg(wav, mp3)
                wav.unlink()
                results.append(
                    {
                        "locale": locale,
                        "voice": voice,
                        **profile,
                        "generationSeconds": round(time.monotonic() - started, 3),
                        "file": mp3.name,
                        "sha256": sha256_file(mp3),
                        **probe_audio(mp3),
                    }
                )
        (staging / "metrics.json").write_text(
            json.dumps(
                {"schemaVersion": 1, "matrixVersion": 1, "text": TEXT, "results": results},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, args.output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f"PASS: Selected-voice tuning matrix generated at {args.output}")


if __name__ == "__main__":
    main()
