#!/usr/bin/env python3
"""Apply reviewed narration-only pronunciation substitutions."""

from __future__ import annotations

import re
from typing import Any


ALLOWED_CATEGORIES = {"city", "division", "player", "stadium", "team", "term"}
ALLOWED_SOURCE_TYPES = {"official", "mexican-broadcast", "owner-review"}
ALLOWED_STATUSES = {"approved", "pending"}


def validate_pronunciations(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        raise ValueError("pronunciation schema version must be 2")
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
            aliases = item.get("aliases")
            if not isinstance(aliases, list) or any(
                not isinstance(alias, str)
                or not alias.strip()
                or alias != alias.strip()
                for alias in aliases
            ):
                raise ValueError("pronunciation aliases must be a list of non-empty strings")
            terms = [written, *aliases]
            normalized_terms = [term.casefold() for term in terms]
            if len(normalized_terms) != len(set(normalized_terms)):
                raise ValueError("pronunciation entry contains duplicate aliases")
            for term, normalized in zip(terms, normalized_terms):
                if normalized in seen:
                    raise ValueError(f"duplicate pronunciation term or alias: {term}")
                seen.add(normalized)
            reason = item.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("pronunciation override requires a reason")
            source = item.get("source")
            if not isinstance(source, str) or not source.strip():
                raise ValueError("pronunciation override requires a source")
            if item.get("sourceType") not in ALLOWED_SOURCE_TYPES:
                raise ValueError("pronunciation override source type is invalid")
            if item.get("status") not in ALLOWED_STATUSES:
                raise ValueError("pronunciation override status is invalid")
    return value


def apply_pronunciations(text: str, locale: str, configuration: dict[str, Any]) -> str:
    validate_pronunciations(configuration)
    if locale not in {"es", "en"}:
        raise ValueError("locale must be es or en")
    spoken_text = text
    replacements = [
        (term, item["spoken"])
        for item in configuration["overrides"][locale]
        if item["status"] == "approved"
        for term in [item["written"], *item["aliases"]]
    ]
    for written, spoken in sorted(replacements, key=lambda value: len(value[0]), reverse=True):
        pattern = rf"(?<!\w){re.escape(written)}(?!\w)"
        spoken_text = re.sub(pattern, spoken, spoken_text, flags=re.IGNORECASE)
    return spoken_text
