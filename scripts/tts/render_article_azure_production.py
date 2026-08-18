#!/usr/bin/env python3
"""Atomic production worker for Spanish Azure article narration."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from article_contract import text_hash, validate_request, validate_result
from benchmark_kokoro import probe_audio, sha256_file
from compile_azure_nfl_lexicon import load_configuration
from render_article_azure import build_chunks, build_ssml, synthesize


ENGINE = "Azure Speech"
MODEL_REVISION = "en-US-Brian:DragonHDLatestNeural"

SMALL_SPANISH = (
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
    "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
    "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
)
TENS_SPANISH = {30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta", 70: "setenta", 80: "ochenta", 90: "noventa"}


def spanish_cardinal(value: int) -> str:
    if value < 30:
        return SMALL_SPANISH[value]
    if value < 100:
        tens = value // 10 * 10
        return TENS_SPANISH[tens] if value == tens else f"{TENS_SPANISH[tens]} y {SMALL_SPANISH[value % 10]}"
    if value == 100:
        return "cien"
    if value < 200:
        return f"ciento {spanish_cardinal(value - 100)}"
    hundreds = {2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos", 6: "seiscientos", 7: "setecientos", 8: "ochocientos", 9: "novecientos"}
    if value < 1000:
        base = hundreds[value // 100]
        return base if value % 100 == 0 else f"{base} {spanish_cardinal(value % 100)}"
    raise ValueError("spoken score is outside the supported range")


def naturalize_spanish(text: str, configuration: dict, *, title: bool = False) -> str:
    if title:
        for team in configuration["teams"]:
            nickname = team["nickname"]
            canonical = team["canonical"]
            if canonical.casefold() not in text.casefold():
                text = re.sub(rf"\b{re.escape(nickname)}\b", canonical, text, flags=re.IGNORECASE)
        text = re.sub(r"\b([0-9]{1,3})\b", lambda match: spanish_cardinal(int(match.group(1))), text)
    return re.sub(
        r"\b([0-9]{1,3})-([0-9]{1,3})\b",
        lambda match: f"{spanish_cardinal(int(match.group(1)))} a {spanish_cardinal(int(match.group(2)))}",
        text,
    )


def normalize_mp3(source: Path, destination: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(source), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", "48000", "-ac", "1", "-b:a", "128k", str(destination),
        ],
        check=True,
    )


def render_production(
    request: dict,
    configuration: dict,
    output: Path,
    key: str,
    region: str,
    *,
    synthesizer: Callable[[bytes, str, str], bytes] = synthesize,
) -> dict:
    validate_request(request)
    if request["locale"] != "es":
        raise ValueError("Azure production worker accepts Spanish jobs only")
    if not key:
        raise ValueError("Azure Speech credential is required")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    staging = output.with_name(f"{output.name}.generating")
    if staging.exists():
        raise FileExistsError(f"staging output already exists: {staging}")
    staging.mkdir(parents=True, mode=0o700)
    file_name = f"es-{request['articleId']}.mp3"
    try:
        with tempfile.TemporaryDirectory(prefix="azure-tts-", dir=staging) as temp_name:
            temp = Path(temp_name)
            prepared_segments = [
                {"id": "title", "kind": "title", "text": naturalize_spanish(request["title"], configuration, title=True)},
                *[{**segment, "text": naturalize_spanish(segment["text"], configuration)} for segment in request["segments"]],
            ]
            chunks = build_chunks(prepared_segments)
            source_paths: list[Path] = []
            for index, chunk in enumerate(chunks, start=1):
                path = temp / f"{index:03d}.mp3"
                path.write_bytes(synthesizer(build_ssml(chunk, configuration), key, region))
                source_paths.append(path)
            concat = temp / "concat.txt"
            concat.write_text(
                "".join(f"file '{path.as_posix()}'\n" for path in source_paths),
                encoding="utf-8",
            )
            joined = temp / "joined.mp3"
            subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-f", "concat", "-safe", "0",
                 "-i", str(concat), "-c", "copy", str(joined)],
                check=True,
            )
            mp3_path = staging / file_name
            normalize_mp3(joined, mp3_path)
        probe = probe_audio(mp3_path)
        result = {
            "schemaVersion": 1,
            "articleId": request["articleId"],
            "locale": "es",
            "sourceRevision": request["sourceRevision"],
            "textHash": text_hash(request),
            "voice": configuration["voice"],
            "configurationVersion": configuration["version"],
            "deliveryProfile": "broadcast",
            "speed": 1.0,
            "pronunciationVersion": configuration["version"],
            "engine": ENGINE,
            "modelRevision": MODEL_REVISION,
            "file": file_name,
            "codec": probe["codec"],
            "sampleRateHz": probe["sampleRateHz"],
            "channels": probe["channels"],
            "bitRate": probe["bitRate"],
            "durationSeconds": probe["durationSeconds"],
            "sizeBytes": probe["sizeBytes"],
            "sha256": sha256_file(mp3_path),
            "generatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        }
        validate_result(
            request,
            result,
            expected_voice=configuration["voice"],
            expected_configuration_version=configuration["version"],
        )
        (staging / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    configuration = load_configuration(args.configuration)
    result = render_production(
        request,
        configuration,
        args.output,
        os.environ.get("AZURE_SPEECH_KEY", ""),
        os.environ.get("AZURE_SPEECH_REGION", "eastus"),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
