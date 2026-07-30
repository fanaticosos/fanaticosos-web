#!/usr/bin/env python3
"""Generate division-grouped audio for proposed NFL names and markets."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any

from benchmark_kokoro import probe_audio, run_ffmpeg, sha256_file
from tune_selected_voices import join_with_pause


EXPECTED_DIVISIONS = {
    "nfc-north", "nfc-east", "nfc-south", "nfc-west",
    "afc-north", "afc-east", "afc-south", "afc-west",
}


def validate_inventory(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("NFL name review schema version must be 1")
    if value.get("version") != 1 or value.get("status") != "pending-owner-review":
        raise ValueError("NFL name review version or status is unexpected")
    if value.get("locale") != "es-419":
        raise ValueError("NFL name review locale must be es-419")
    divisions = value.get("divisions")
    if not isinstance(divisions, list) or len(divisions) != 8:
        raise ValueError("NFL name review must contain eight divisions")
    if {division.get("id") for division in divisions} != EXPECTED_DIVISIONS:
        raise ValueError("NFL division inventory is incomplete")
    teams = []
    for division in divisions:
        entries = division.get("teams")
        if not isinstance(entries, list) or len(entries) != 4:
            raise ValueError("each NFL division must contain four teams")
        for entry in entries:
            for field in ("written", "spoken", "marketWritten", "marketSpoken"):
                item = entry.get(field)
                if not isinstance(item, str) or not item.strip() or item != item.strip():
                    raise ValueError(f"NFL name review field is invalid: {field}")
            teams.append(entry["written"])
    if len(teams) != 32 or len(set(teams)) != 32:
        raise ValueError("NFL name review must contain 32 unique teams")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
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
        pipeline = KPipeline("e", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu")
        voice = args.model_root / "voices" / "em_alex.pt"
        results = []
        for division in inventory["divisions"]:
            team_names = ", ".join(entry["spoken"] for entry in division["teams"])
            markets = ", ".join(entry["marketSpoken"] for entry in division["teams"])
            text = f"{division['label']}. Equipos: {team_names}. Ciudades: {markets}."
            chunks = [
                item.audio
                for item in pipeline(text, voice=str(voice), speed=1.02)
                if item.audio is not None
            ]
            audio = join_with_pause(chunks, 0.16, torch)
            wav = staging / f"{division['id']}.wav"
            mp3 = staging / f"{division['id']}.mp3"
            soundfile.write(wav, audio.numpy(), 24_000, subtype="PCM_16")
            run_ffmpeg(wav, mp3)
            wav.unlink()
            results.append({
                "division": division["id"], "file": mp3.name, "text": text,
                "sha256": sha256_file(mp3), **probe_audio(mp3),
            })
        (staging / "summary.json").write_text(
            json.dumps({"schemaVersion": 1, "inventoryVersion": 1, "results": results}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, args.output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f"PASS: Eight NFL name review files generated at {args.output}")


if __name__ == "__main__":
    main()
