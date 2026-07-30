#!/usr/bin/env python3
"""Apply reviewed narration-only pronunciation substitutions."""

from __future__ import annotations

import re
from typing import Any


ALLOWED_CATEGORIES = {"city", "division", "player", "stadium", "team", "term"}


def validate_pronunciations(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("pronunciation schema version must be 1")
    version = value.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ValueError("pronunciation version must be a positive integer")
    overrides = value.get("overrides")
    if not isinstance(overrides, dict) or set(overrides) != {"es", "en"}:
        raise ValueError("pronunciations must define es and en")
    for locale, entries in overrides.items():
        if not isinstance(entries, list):
            raise ValueError(f"{locale} pronunciation overrides must be a list")
        seen = set()
        for item in entries:
            if not isinstance(item, dict):
                raise ValueError("pronunciation override must be an object")
            category = item.get("category")
            if category not in ALLOWED_CATEGORIES:
                raise ValueError("pronunciation override category is invalid")
            written = item.get("written")
            spoken = item.get("spoken")
            if not isinstance(written, str) or not written.strip() or written != written.strip():
                raise ValueError("written pronunciation term is invalid")
            if not isinstance(spoken, str) or not spoken.strip() or spoken != spoken.strip():
                raise ValueError("spoken pronunciation term is invalid")
            if written in seen:
                raise ValueError(f"duplicate pronunciation override: {written}")
            seen.add(written)
            reason = item.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("pronunciation override requires a reason")
    return value


def apply_pronunciations(text: str, locale: str, configuration: dict[str, Any]) -> str:
    validate_pronunciations(configuration)
    if locale not in {"es", "en"}:
        raise ValueError("locale must be es or en")
    spoken_text = text
    entries = sorted(
        configuration["overrides"][locale],
        key=lambda item: len(item["written"]),
        reverse=True,
    )
    for item in entries:
        pattern = rf"(?<!\w){re.escape(item['written'])}(?!\w)"
        spoken_text = re.sub(pattern, item["spoken"], spoken_text)
    return spoken_text
