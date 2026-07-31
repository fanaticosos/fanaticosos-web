#!/usr/bin/env python3
"""Generate the eight NFL name review groups with Piper Claude es-MX."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import wave
from pathlib import Path

from benchmark_kokoro import probe_audio, run_ffmpeg, sha256_file
from review_nfl_names import validate_inventory


DIVISION_SPOKEN = {
    "nfc": "ene efe ce",
    "afc": "a efe ce",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    inventory = validate_inventory(json.loads(args.inventory.read_text(encoding="utf-8")))
    if args.output.exists():
        raise FileExistsError(f"output already exists: {args.output}")
    staging = args.output.with_name(f"{args.output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    try:
        from piper import PiperVoice

        voice = PiperVoice.load(str(args.model), use_cuda=False)
        results = []
        for division in inventory["divisions"]:
            conference, direction = division["id"].split("-", 1)
            team_names = ", ".join(entry["spoken"] for entry in division["teams"])
            markets = ", ".join(entry["marketSpoken"] for entry in division["teams"])
            text = f"{DIVISION_SPOKEN[conference]} {direction}. Equipos: {team_names}. Ciudades: {markets}."
            wav_path = staging / f"{division['id']}.wav"
            mp3_path = staging / f"{division['id']}.mp3"
            with wave.open(str(wav_path), "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
            run_ffmpeg(wav_path, mp3_path)
            wav_path.unlink()
            results.append({
                "division": division["id"], "file": mp3_path.name, "text": text,
                "sha256": sha256_file(mp3_path), **probe_audio(mp3_path),
            })
        (staging / "summary.json").write_text(
            json.dumps({"schemaVersion": 1, "engine": "Piper", "voice": "es_MX-claude-high", "results": results}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, args.output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f"PASS: Eight Claude NFL name review files generated at {args.output}")


if __name__ == "__main__":
    main()
