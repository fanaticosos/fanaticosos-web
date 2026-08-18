#!/usr/bin/env python3
"""Atomic production worker for Spanish Azure article narration."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
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
MODEL_REVISION = "en-US-BrianMultilingualNeural"


def normalize_mp3(source: Path, destination: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(source), "-af", "atempo=1.08,loudnorm=I=-16:TP=-1.5:LRA=11",
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
            chunks = build_chunks(
                [{"id": "title", "text": request["title"]}, *request["segments"]]
            )
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
            "speed": 1.08,
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
