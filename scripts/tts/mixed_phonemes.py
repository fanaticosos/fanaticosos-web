#!/usr/bin/env python3
"""Build one phoneme stream from Spanish prose and protected English entities."""

from __future__ import annotations

import re
from typing import Any


def split_protected_spans(text: str, protected_names: list[str]) -> list[tuple[str, bool]]:
    names = sorted(set(protected_names), key=len, reverse=True)
    if not names:
        return [(text, False)]
    alternation = "|".join(re.escape(name) for name in names)
    pattern = re.compile(rf"(?<!\w)({alternation})(?!\w)")
    spans: list[tuple[str, bool]] = []
    cursor = 0
    for match in pattern.finditer(text):
        if match.start() > cursor:
            spans.append((text[cursor : match.start()], False))
        spans.append((match.group(0), True))
        cursor = match.end()
    if cursor < len(text):
        spans.append((text[cursor:], False))
    return [(value, protected) for value, protected in spans if value]


def phonemize_mixed(
    text: str,
    protected_names: list[str],
    spanish_pipeline: Any,
    english_pipeline: Any,
) -> str:
    phoneme_parts = []
    for value, protected in split_protected_spans(text, protected_names):
        if protected:
            _, tokens = english_pipeline.g2p(value)
            phonemes = english_pipeline.tokens_to_ps(tokens)
        else:
            phonemes, _ = spanish_pipeline.g2p(value)
        if phonemes and phonemes.strip():
            phoneme_parts.append(phonemes.strip())
    result = " ".join(phoneme_parts)
    if not result:
        raise ValueError("mixed phonemizer produced no phonemes")
    if len(result) > 510:
        raise ValueError("mixed diagnostic phonemes exceed Kokoro limit")
    return result
