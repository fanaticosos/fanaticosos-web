#!/usr/bin/env python3
import unittest
from pathlib import Path
from speech_normalization import normalize_speech

CONFIG = Path(__file__).parents[2] / "config/tts/speech-normalizations.json"

class Tests(unittest.TestCase):
    def test_brand_visual_spellings_share_one_spoken_form(self):
        for value in ("FanaticOSOS", "Fanatic-OSOS", "Fanatic OSOS", "fanaticosos"):
            self.assertEqual(normalize_speech(value, "es", CONFIG), "fanaticosos")

if __name__ == "__main__": unittest.main()
