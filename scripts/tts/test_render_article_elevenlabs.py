#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_article_elevenlabs import resolve_voice_id, split_text


class ElevenLabsProductionTests(unittest.TestCase):
    def test_long_articles_are_split_without_losing_text(self):
        text = "\n\n".join(["A" * 2000, "B" * 2000, "C" * 2000])
        chunks = split_text(text, 4500)
        self.assertEqual(chunks, ["A" * 2000 + "\n\n" + "B" * 2000, "C" * 2000])
        self.assertTrue(all(len(chunk) <= 4500 for chunk in chunks))

    def test_voice_resolution_requires_the_approved_exact_name(self):
        payload = b'{"voices":[{"name":"Other","voice_id":"bad"},{"name":"Will - Relaxed Optimist","voice_id":"approved"}]}'
        requester = lambda url, key: payload
        self.assertEqual(resolve_voice_id("key", "Will - Relaxed Optimist", requester), "approved")
        with self.assertRaisesRegex(ValueError, "voice was not found"):
            resolve_voice_id("key", "Missing", requester)


if __name__ == "__main__":
    unittest.main()
