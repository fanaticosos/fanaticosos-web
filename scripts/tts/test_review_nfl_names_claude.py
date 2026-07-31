#!/usr/bin/env python3

import unittest

from review_nfl_names_claude import DIVISION_SPOKEN


class ClaudeNFLNameReviewTests(unittest.TestCase):
    def test_conference_acronyms_are_spelled_in_spanish(self):
        self.assertEqual(DIVISION_SPOKEN, {"nfc": "ene efe ce", "afc": "a efe ce"})


if __name__ == "__main__":
    unittest.main()
