#!/usr/bin/env python3
"""Generate one short mixed-G2P Spanish diagnostic sample."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from benchmark_kokoro import concatenate_audio, probe_audio, run_ffmpeg, sha256_file
from mixed_phonemes import phonemize_mixed


TEXT = (
    "Los Chicago Bears y Caleb Williams enfrentan a Green Bay Packers en "
    "Soldier Field dentro de la NFC North."
)
VOICE = "ef_dora"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glossary", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"output already exists: {args.output}")
    staging = args.output.with_name(f"{args.output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    try:
        import soundfile
        import torch
        from kokoro import KModel, KPipeline

        glossary = json.loads(args.glossary.read_text(encoding="utf-8"))
        protected_names = glossary["protectedNames"]
        torch.set_num_threads(min(12, os.cpu_count() or 1))
        model = KModel(
            repo_id="hexgrad/Kokoro-82M",
            config=str(args.model_root / "config.json"),
            model=str(args.model_root / "kokoro-v1_0.pth"),
        ).to("cpu").eval()
        spanish = KPipeline("e", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu")
        english = KPipeline("a", repo_id="hexgrad/Kokoro-82M", model=False, device="cpu")
        phonemes = phonemize_mixed(TEXT, protected_names, spanish, english)
        voice_path = args.model_root / "voices" / f"{VOICE}.pt"
        chunks = [
            result.audio
            for result in spanish.generate_from_tokens(
                phonemes, voice=str(voice_path), model=model
            )
            if result.audio is not None
        ]
        audio = concatenate_audio(chunks, torch)
        wav = staging / "diagnostic.wav"
        mp3 = staging / "spanglish-ef_dora.mp3"
        soundfile.write(wav, audio.numpy(), 24000, subtype="PCM_16")
        run_ffmpeg(wav, mp3)
        wav.unlink()
        metadata = {
            "text": TEXT,
            "voice": VOICE,
            "protectedNames": protected_names,
            "phonemes": phonemes,
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
    print(f"PASS: Mixed-G2P diagnostic generated at {args.output}")


if __name__ == "__main__":
    main()
