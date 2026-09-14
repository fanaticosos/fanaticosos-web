#!/usr/bin/env python3
"""ElevenLabs quota preflight: account subscription plus a private per-key ledger.

ElevenLabs exposes the account-wide character balance through its subscription
endpoint, but it does not expose the optional per-API-key character limit. The
key limit is therefore enforced locally: the owner records the configured limit
in the credential file (``ELEVENLABS_KEY_CHARACTER_LIMIT``) and every generated
block is added to a ledger keyed by a fingerprint of the API key. The ledger
resets whenever the subscription's billing cycle advances. It only counts what
this pipeline generated, so it is a lower bound on the key's real usage; the
account balance remains the authoritative guard.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
import urllib.error
import urllib.request
import datetime as dt
from pathlib import Path
from typing import Any, Callable


SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription"
SUBSCRIPTION_FIELDS = (
    "tier",
    "character_count",
    "character_limit",
    "can_extend_character_limit",
    "next_character_count_reset_unix",
    "status",
)
LEDGER_SCHEMA_VERSION = 1


class QuotaError(RuntimeError):
    """Raised before any paid request when the estimated cost cannot be covered."""


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


def fetch_subscription(key: str, opener: Callable = urllib.request.urlopen) -> dict[str, Any]:
    if not key:
        raise QuotaError("ElevenLabs credential is required")
    request = urllib.request.Request(
        SUBSCRIPTION_URL,
        headers={"xi-api-key": key, "Accept": "application/json"},
    )
    try:
        with opener(request, timeout=30) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw).get("detail", {})
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
            detail = {}
        detail = detail if isinstance(detail, dict) else {}
        status = detail.get("status") or detail.get("code") or "provider_error"
        message = detail.get("message") or "ElevenLabs rejected the subscription request"
        raise QuotaError(f"ElevenLabs HTTP {error.code}: {status}: {message}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise QuotaError("ElevenLabs HTTP 0: network_unavailable: the subscription status could not be read") from None
    if not isinstance(body, dict):
        raise QuotaError("ElevenLabs subscription response is invalid")
    return {name: body.get(name) for name in SUBSCRIPTION_FIELDS if name in body}


def _non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def account_remaining(subscription: dict[str, Any]) -> int | None:
    limit = _non_negative_int(subscription.get("character_limit"))
    count = _non_negative_int(subscription.get("character_count"))
    if limit is None or count is None:
        return None
    return max(limit - count, 0)


def parse_key_limit(value: Any) -> int | None:
    """``ELEVENLABS_KEY_CHARACTER_LIMIT``: empty or 0 means the key is unlimited."""
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace("_", "")
    if not text:
        return None
    if not text.isdigit():
        raise ValueError("ELEVENLABS_KEY_CHARACTER_LIMIT must be a whole number of characters")
    limit = int(text)
    return limit or None


def key_fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def ledger_path(cache: Path, key: str) -> Path:
    return cache / "usage" / f"{key_fingerprint(key)}.json"


def _fresh_ledger(reset_unix: int | None) -> dict[str, Any]:
    return {"schemaVersion": LEDGER_SCHEMA_VERSION, "resetUnix": reset_unix, "characters": 0, "updatedAt": _now()}


def read_ledger(cache: Path, key: str, reset_unix: int | None) -> dict[str, Any]:
    """Return the current-cycle ledger, starting a new one when the cycle advanced."""
    reset_unix = _non_negative_int(reset_unix)
    try:
        value = json.loads(ledger_path(cache, key).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return _fresh_ledger(reset_unix)
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != LEDGER_SCHEMA_VERSION
        or _non_negative_int(value.get("characters")) is None
    ):
        return _fresh_ledger(reset_unix)
    stored_reset = _non_negative_int(value.get("resetUnix"))
    if reset_unix is not None and stored_reset != reset_unix:
        return _fresh_ledger(reset_unix)
    return {**value, "resetUnix": stored_reset if reset_unix is None else reset_unix}


def record_usage(cache: Path, key: str, characters: int, reset_unix: int | None) -> dict[str, Any]:
    if isinstance(characters, bool) or not isinstance(characters, int) or characters < 0:
        raise ValueError("recorded characters must be a non-negative integer")
    ledger = read_ledger(cache, key, reset_unix)
    ledger = {**ledger, "characters": ledger["characters"] + characters, "updatedAt": _now()}
    path = ledger_path(cache, key)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.saving")
    temporary.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)
    return ledger


def preflight(*, subscription: dict[str, Any], ledger: dict[str, Any], required_characters: int, key_limit: int | None) -> dict[str, Any]:
    """Decide whether a job that still needs ``required_characters`` may start."""
    if isinstance(required_characters, bool) or not isinstance(required_characters, int) or required_characters < 0:
        raise ValueError("required characters must be a non-negative integer")
    remaining = account_remaining(subscription)
    used = _non_negative_int(ledger.get("characters")) or 0
    result: dict[str, Any] = {
        "requiredCharacters": required_characters,
        "accountRemaining": remaining,
        "keyLimit": key_limit,
        "keyUsedThisCycle": used,
        "allowed": True,
        "reason": None,
    }
    if required_characters == 0:
        return result
    if remaining is None:
        result.update(allowed=False, reason="ElevenLabs no informó el saldo de caracteres de la cuenta; no se inició la generación.")
    elif required_characters > remaining:
        result.update(allowed=False, reason=(
            f"ElevenLabs no tiene créditos suficientes en la cuenta: se necesitan {required_characters:,} caracteres "
            f"y quedan {remaining:,}. No se consumió ningún crédito."
        ))
    elif key_limit is not None and used + required_characters > key_limit:
        result.update(allowed=False, reason=(
            f"La API key de ElevenLabs alcanzaría su límite: se necesitan {required_characters:,} caracteres y esta "
            f"canalización ya registró {used:,} de {key_limit:,} en el ciclo actual. No se consumió ningún crédito."
        ))
    return result
