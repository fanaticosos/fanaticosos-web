#!/usr/bin/env python3

import unittest

from benchmark_madlad import tag_source


class MadladBenchmarkTests(unittest.TestCase):
    def test_adds_english_target_tag(self):
        self.assertEqual(tag_source("Los Bears ganaron."), "<2en> Los Bears ganaron.")

    def test_preserves_source_characters(self):
        self.assertEqual(
            tag_source("Chicago ganó 20-17."),
            "<2en> Chicago ganó 20-17.",
        )


if __name__ == "__main__":
    unittest.main()
