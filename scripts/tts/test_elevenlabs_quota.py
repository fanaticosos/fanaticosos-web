#!/usr/bin/env python3
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from elevenlabs_quota import (
    QuotaError, account_remaining, fetch_subscription, key_fingerprint, ledger_path,
    parse_key_limit, preflight, read_ledger, record_usage,
)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


class QuotaTests(unittest.TestCase):
    def test_subscription_is_sanitized_to_capacity_fields(self):
        payload = {"tier": "creator", "character_count": 12_000, "character_limit": 100_000,
                   "next_character_count_reset_unix": 1_760_000_000, "status": "active",
                   "xi_api_key": "leak", "billing_email": "leak@example.com"}
        seen = []
        def opener(request, timeout):
            seen.append((request.full_url, request.get_header("Xi-api-key"), timeout))
            return FakeResponse(json.dumps(payload).encode())
        subscription = fetch_subscription("secret-key", opener)
        self.assertNotIn("xi_api_key", subscription)
        self.assertNotIn("billing_email", subscription)
        self.assertEqual(account_remaining(subscription), 88_000)
        self.assertEqual(seen[0][0], "https://api.elevenlabs.io/v1/user/subscription")
        self.assertEqual(seen[0][1], "secret-key")

    def test_subscription_errors_are_sanitized_and_typed(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(
                json.dumps({"detail": {"status": "invalid_api_key", "message": "Invalid API key", "request_id": "private"}}).encode()))
        with self.assertRaisesRegex(QuotaError, "401: invalid_api_key: Invalid API key") as caught:
            fetch_subscription("secret-key", opener)
        self.assertNotIn("secret-key", str(caught.exception))
        self.assertNotIn("private", str(caught.exception))
        def offline(request, timeout):
            raise urllib.error.URLError("dns")
        with self.assertRaisesRegex(QuotaError, "network_unavailable"):
            fetch_subscription("secret-key", offline)
        with self.assertRaisesRegex(QuotaError, "credential is required"):
            fetch_subscription("", opener)

    def test_account_remaining_requires_complete_integer_data(self):
        self.assertIsNone(account_remaining({}))
        self.assertIsNone(account_remaining({"character_limit": "100", "character_count": 1}))
        self.assertIsNone(account_remaining({"character_limit": 100, "character_count": True}))
        self.assertEqual(account_remaining({"character_limit": 100, "character_count": 150}), 0)

    def test_key_limit_parsing(self):
        self.assertIsNone(parse_key_limit(None))
        self.assertIsNone(parse_key_limit(""))
        self.assertIsNone(parse_key_limit("0"))
        self.assertEqual(parse_key_limit("40000"), 40_000)
        self.assertEqual(parse_key_limit(" 40,000 "), 40_000)
        with self.assertRaisesRegex(ValueError, "whole number"):
            parse_key_limit("forty")

    def test_ledger_tracks_only_the_current_billing_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            self.assertEqual(read_ledger(cache, "k", 100)["characters"], 0)
            record_usage(cache, "k", 2_322, 100)
            ledger = record_usage(cache, "k", 300, 100)
            self.assertEqual(ledger["characters"], 2_622)
            self.assertEqual(ledger_path(cache, "k").stat().st_mode & 0o777, 0o600)
            self.assertNotIn("k", ledger_path(cache, "k").name.replace(key_fingerprint("k"), ""))
            self.assertEqual(read_ledger(cache, "k", 100)["characters"], 2_622)
            self.assertEqual(read_ledger(cache, "k", 200)["characters"], 0)
            self.assertEqual(read_ledger(cache, "k", None)["characters"], 2_622)
            self.assertEqual(read_ledger(cache, "other-key", 100)["characters"], 0)
            ledger_path(cache, "k").write_text("not json", encoding="utf-8")
            self.assertEqual(read_ledger(cache, "k", 100)["characters"], 0)
            with self.assertRaises(ValueError):
                record_usage(cache, "k", -1, 100)

    def test_preflight_refuses_before_spending_when_account_or_key_cannot_cover_the_job(self):
        subscription = {"character_limit": 40_000, "character_count": 39_932}
        ledger = {"characters": 0}
        refused = preflight(subscription=subscription, ledger=ledger, required_characters=2_322, key_limit=None)
        self.assertFalse(refused["allowed"])
        self.assertIn("se necesitan 2,322", refused["reason"])
        self.assertIn("quedan 68", refused["reason"])
        allowed = preflight(subscription={"character_limit": 100_000, "character_count": 10_000}, ledger=ledger, required_characters=2_322, key_limit=None)
        self.assertTrue(allowed["allowed"])
        self.assertIsNone(allowed["reason"])
        key_refused = preflight(subscription={"character_limit": 100_000, "character_count": 10_000}, ledger={"characters": 38_000}, required_characters=2_322, key_limit=40_000)
        self.assertFalse(key_refused["allowed"])
        self.assertIn("API key", key_refused["reason"])
        self.assertIn("38,000 de 40,000", key_refused["reason"])
        unknown = preflight(subscription={}, ledger=ledger, required_characters=10, key_limit=None)
        self.assertFalse(unknown["allowed"])
        self.assertIn("no informó", unknown["reason"])
        nothing = preflight(subscription={}, ledger=ledger, required_characters=0, key_limit=10)
        self.assertTrue(nothing["allowed"])
        with self.assertRaises(ValueError):
            preflight(subscription=subscription, ledger=ledger, required_characters=-1, key_limit=None)


if __name__ == "__main__":
    unittest.main()
