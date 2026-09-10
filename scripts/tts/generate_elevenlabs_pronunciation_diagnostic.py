#!/usr/bin/env python3
"""Generate short, private ElevenLabs pronunciation samples for one NFL term."""

import argparse
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


VOICE_NAME = "Will - Relaxed Optimist"
MODEL_ID = "eleven_multilingual_v2"
CANDIDATES = (
    ("baseline", "Los Bears llegan."),
    ("accented", "Los Bérs llegan."),
    ("phonetic-z", "Los Berz llegan."),
)


def api(url, key, data=None):
    request = urllib.request.Request(
        url,
        data=None if data is None else json.dumps(data).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def generate(output, key):
    raw = api(
        "https://api.elevenlabs.io/v2/voices?page_size=100&search="
        + urllib.parse.quote(VOICE_NAME),
        key,
    )
    voices = json.loads(raw).get("voices", [])
    voice = next((item for item in voices if item.get("name") == VOICE_NAME), None)
    if not voice:
        raise SystemExit(f"{VOICE_NAME} voice was not found")

    voice_id = voice["voice_id"]
    settings = json.loads(
        api(f"https://api.elevenlabs.io/v1/voices/{voice_id}/settings", key)
    )
    output.mkdir(parents=True, mode=0o700)

    manifest = {
        "schemaVersion": 1,
        "voice": VOICE_NAME,
        "voiceId": voice_id,
        "model": MODEL_ID,
        "samples": [],
    }
    for label, text in CANDIDATES:
        audio = api(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
            "?output_format=mp3_44100_128",
            key,
            {"text": text, "model_id": MODEL_ID, "voice_settings": settings},
        )
        filename = f"bears-{label}.mp3"
        target = output / filename
        target.write_bytes(audio)
        target.chmod(0o600)
        manifest["samples"].append(
            {"label": label, "text": text, "file": filename, "bytes": len(audio)}
        )

    summary = output / "summary.json"
    summary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    summary.chmod(0o600)
    print(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.output, os.environ["ELEVENLABS_API_KEY"])


if __name__ == "__main__":
    main()
