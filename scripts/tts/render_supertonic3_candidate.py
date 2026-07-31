#!/usr/bin/env python3
"""Render one validated Spanish article in Supertonic Spanish and fallback modes."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from article_contract import canonical_text, validate_request


EXPECTED_PACKAGE = "supertonic"
EXPECTED_VERSION = "1.3.1"
EXPECTED_MODEL = "Supertone/supertonic-3"
EXPECTED_REVISION = "3cadd1ee6394adea1bd021217a0e650ede09a323"


def load_candidate(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    expected = {
        "schemaVersion": 1,
        "package": EXPECTED_PACKAGE,
        "packageVersion": EXPECTED_VERSION,
        "packageWheelSha256": "0079c9d4166008b8a6eeae95f20c092148786b7232192dd3dd9f358960c6c077",
        "model": EXPECTED_MODEL,
        "modelRevision": EXPECTED_REVISION,
        "modelLicense": "OpenRAIL",
        "voice": "M1",
        "languages": ["es", "na"],
        "steps": 12,
        "speed": 1.02,
        "maxChunkLength": 300,
        "silenceDuration": 0.2,
    }
    if value != expected:
        raise ValueError("Supertonic candidate configuration is unexpected")
    return value


def normalize_mp3(wav: Path, mp3: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(wav),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-b:a",
            "128k",
            str(mp3),
        ],
        check=True,
    )


def render(
    request: dict[str, Any],
    candidate: dict[str, Any],
    model_dir: Path,
    output: Path,
) -> dict[str, Any]:
    validate_request(request)
    if request["locale"] != "es":
        raise ValueError("Supertonic candidate requires the Spanish article request")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    try:
        from supertonic import TTS
        import supertonic

        if supertonic.__version__ != candidate["packageVersion"]:
            raise ValueError("installed Supertonic version is unexpected")
        engine = TTS(
            model_dir=model_dir,
            auto_download=False,
            intra_op_num_threads=min(12, os.cpu_count() or 1),
            inter_op_num_threads=1,
        )
        style = engine.get_voice_style(voice_name=candidate["voice"])
        text = canonical_text(request)
        results = []
        for language in candidate["languages"]:
            wav, duration = engine.synthesize(
                text=text,
                lang=language,
                voice_style=style,
                total_steps=candidate["steps"],
                speed=candidate["speed"],
                max_chunk_length=candidate["maxChunkLength"],
                silence_duration=candidate["silenceDuration"],
                verbose=False,
            )
            wav_path = staging / f"supertonic3-{language}.wav"
            mp3_path = staging / f"supertonic3-{language}-M1.mp3"
            engine.save_audio(wav, wav_path)
            normalize_mp3(wav_path, mp3_path)
            wav_path.unlink()
            results.append(
                {
                    "language": language,
                    "voice": candidate["voice"],
                    "durationSeconds": round(float(duration[0]), 3),
                    "file": mp3_path.name,
                    "sizeBytes": mp3_path.stat().st_size,
                }
            )
        summary = {
            "schemaVersion": 1,
            "articleId": request["articleId"],
            "engine": "Supertonic 3",
            "packageVersion": candidate["packageVersion"],
            "model": candidate["model"],
            "modelRevision": candidate["modelRevision"],
            "results": results,
        }
        (staging / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path in staging.iterdir():
            path.chmod(0o600)
        os.replace(staging, output)
        return summary
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    candidate = load_candidate(args.candidate)
    render(request, candidate, args.model_dir, args.output)


if __name__ == "__main__":
    main()
