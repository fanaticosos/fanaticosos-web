#!/usr/bin/env python3
"""Print a sanitized ElevenLabs capacity summary: account balance and key ledger."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from elevenlabs_quota import QuotaError, account_remaining, fetch_subscription, parse_key_limit, read_ledger


def summary(key: str, cache: Path | None, key_limit_value: str | None) -> dict:
    subscription = fetch_subscription(key)
    value = dict(subscription)
    value["accountRemaining"] = account_remaining(subscription)
    key_limit = parse_key_limit(key_limit_value)
    value["keyCharacterLimit"] = key_limit
    if cache is not None:
        ledger = read_ledger(cache, key, subscription.get("next_character_count_reset_unix"))
        value["keyUsedThisCycle"] = ledger["characters"]
        value["keyRemainingThisCycle"] = None if key_limit is None else max(key_limit - ledger["characters"], 0)
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, help="ElevenLabs block cache root holding the private usage ledger")
    args = parser.parse_args()
    try:
        print(json.dumps(summary(os.environ["ELEVENLABS_API_KEY"], args.cache, os.environ.get("ELEVENLABS_KEY_CHARACTER_LIMIT")), indent=2))
    except QuotaError as error:
        raise SystemExit(json.dumps({"error": str(error)}))


if __name__ == "__main__":
    main()
