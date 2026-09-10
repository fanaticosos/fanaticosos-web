#!/usr/bin/env python3
"""Print a sanitized ElevenLabs subscription-capacity summary."""

import json
import os
import urllib.error
import urllib.request


def fetch(key):
    request = urllib.request.Request(
        "https://api.elevenlabs.io/v1/user/subscription",
        headers={"xi-api-key": key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw).get("detail", {})
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
            detail = {}
        raise SystemExit(json.dumps({
            "httpStatus": error.code,
            "status": detail.get("status") or detail.get("code") or "provider_error",
            "message": detail.get("message") or "ElevenLabs rejected the status request",
        }))
    allowed = (
        "tier",
        "character_count",
        "character_limit",
        "can_extend_character_limit",
        "next_character_count_reset_unix",
        "status",
    )
    return {name: body.get(name) for name in allowed if name in body}


if __name__ == "__main__":
    print(json.dumps(fetch(os.environ["ELEVENLABS_API_KEY"]), indent=2))
