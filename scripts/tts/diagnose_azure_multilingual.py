#!/usr/bin/env python3
"""Generate short, single-speaker Spanish/English-name Azure comparisons."""

from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path

from render_article_azure import synthesize


VOICES = (
    "es-MX-Tristan:DragonHDLatestNeural",
)

SPANISH = (
    "Chicago Bears, treinta y cuatro; Cleveland Browns, diez: fiesta en Soldier Field "
    "y treinta y cuatro puntos sin respuesta. Los Chicago Bears vencieron treinta y "
    "cuatro a diez a los Cleveland Browns con treinta y cuatro puntos sin respuesta. "
    "Case Keenum, Kaden Davis y Beanie Bishop destacaron en el debut de pretemporada."
)


def ssml(voice: str, language_switch: bool) -> bytes:
    if language_switch:
        body = (
            '<lang xml:lang="en-US">Chicago Bears</lang>, treinta y cuatro; '
            '<lang xml:lang="en-US">Cleveland Browns</lang>, diez: fiesta en '
            '<lang xml:lang="en-US">Soldier Field</lang> y treinta y cuatro puntos sin '
            "respuesta. Los "
            '<lang xml:lang="en-US">Chicago Bears</lang> vencieron treinta y cuatro a '
            "diez a los "
            '<lang xml:lang="en-US">Cleveland Browns</lang> con treinta y cuatro puntos '
            'sin respuesta. <lang xml:lang="en-US">Case Keenum, Kaden Davis y Beanie Bishop</lang> '
            "destacaron en el debut de pretemporada."
        )
    else:
        body = html.escape(SPANISH)
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-MX">'
        f'<voice name="{voice}">{body}</voice></speak>'
    ).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    key = os.environ.get("AZURE_SPEECH_KEY", "")
    region = os.environ.get("AZURE_SPEECH_REGION", "eastus")
    if not key:
        raise ValueError("AZURE_SPEECH_KEY is required")
    args.output.mkdir(parents=True, exist_ok=False)
    results = []
    for voice in VOICES:
        for switched in (False, True):
            mode = "lang-switch" if switched else "automatic"
            filename = f"{voice}-{mode}.mp3"
            data = synthesize(ssml(voice, switched), key, region)
            (args.output / filename).write_bytes(data)
            results.append({"voice": voice, "mode": mode, "file": filename, "bytes": len(data)})
    (args.output / "summary.json").write_text(
        json.dumps({"text": SPANISH, "results": results}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
