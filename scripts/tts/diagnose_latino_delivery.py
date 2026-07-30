#!/usr/bin/env python3
"""Generate one Spanish-forward Latino NFL delivery diagnostic."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from benchmark_kokoro import concatenate_audio, probe_audio, run_ffmpeg, sha256_file
from pronunciations import apply_pronunciations, validate_pronunciations


TEXT = (
    "Los Minnesota Vikings visitan a los Chicago Bears en Soldier Field. "
    "Detroit Lions sigue compitiendo dentro de la NFC North."
)
VOICE = "em_alex"
SPEED = 1.02


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pronunciations", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"output already exists: {args.output}")
    staging = args.output.with_name(f"{args.output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    pronunciations = validate_pronunciations(
        json.loads(args.pronunciations.read_text(encoding="utf-8"))
    )
    spoken_text = apply_pronunciations(TEXT, "es", pronunciations)
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
        pipeline = KPipeline(
            "e", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu"
        )
        voice_path = args.model_root / "voices" / f"{VOICE}.pt"
        chunks = [
            item.audio
            for item in pipeline(spoken_text, voice=str(voice_path), speed=SPEED)
            if item.audio is not None
        ]
        audio = concatenate_audio(chunks, torch)
        wav = staging / "diagnostic.wav"
        mp3 = staging / "latino-em_alex-broadcast-v4.mp3"
        soundfile.write(wav, audio.numpy(), 24000, subtype="PCM_16")
        run_ffmpeg(wav, mp3)
        wav.unlink()
        metadata = {
            "writtenText": TEXT,
            "spokenText": spoken_text,
            "voice": VOICE,
            "speed": SPEED,
            "pronunciationVersion": pronunciations["version"],
            "audio": {**probe_audio(mp3), "sha256": sha256_file(mp3)},
        }
        (staging / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, args.output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f"PASS: Latino delivery diagnostic generated at {args.output}")


if __name__ == "__main__":
    main()
