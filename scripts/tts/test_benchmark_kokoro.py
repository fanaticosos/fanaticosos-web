#!/usr/bin/env python3

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from benchmark_kokoro import concatenate_audio, probe_audio


class FakeTensor:
    def __init__(self, values):
        self.values = list(values)

    def detach(self):
        return self

    def cpu(self):
        return self

    def flatten(self):
        return self

    def numel(self):
        return len(self.values)


class FakeTorch:
    @staticmethod
    def zeros(count):
        return FakeTensor([0] * count)

    @staticmethod
    def cat(values):
        return FakeTensor(item for value in values for item in value.values)


class KokoroBenchmarkTests(unittest.TestCase):
    def test_concatenates_chunks_with_fixed_silence(self):
        result = concatenate_audio([FakeTensor([1, 2]), FakeTensor([3])], FakeTorch)
        self.assertEqual(len(result.values), 2 + 4800 + 1)
        self.assertEqual(result.values[:2], [1, 2])
        self.assertEqual(result.values[-1], 3)

    def test_rejects_missing_audio(self):
        with self.assertRaisesRegex(ValueError, "no audio"):
            concatenate_audio([], FakeTorch)

    def test_probe_requires_mp3_mono_48khz(self):
        payload = {
            "streams": [
                {
                    "codec_name": "mp3",
                    "sample_rate": "48000",
                    "channels": 1,
                    "bit_rate": "128000",
                }
            ],
            "format": {"duration": "3.024", "size": "49000"},
        }
        completed = subprocess.CompletedProcess([], 0, json.dumps(payload), "")
        with patch("benchmark_kokoro.subprocess.run", return_value=completed):
            result = probe_audio(Path("sample.mp3"))
        self.assertEqual(result["codec"], "mp3")
        self.assertEqual(result["sampleRateHz"], 48000)
        self.assertEqual(result["channels"], 1)

    def test_probe_rejects_wrong_codec(self):
        payload = {
            "streams": [
                {
                    "codec_name": "aac",
                    "sample_rate": "48000",
                    "channels": 1,
                    "bit_rate": "128000",
                }
            ],
            "format": {"duration": "3", "size": "100"},
        }
        completed = subprocess.CompletedProcess([], 0, json.dumps(payload), "")
        with patch("benchmark_kokoro.subprocess.run", return_value=completed):
            with self.assertRaisesRegex(ValueError, "codec is not MP3"):
                probe_audio(Path("sample.mp3"))

    def test_repository_runner_does_not_leave_test_files(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
