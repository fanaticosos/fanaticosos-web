#!/usr/bin/env python3

import unittest

from review_nfl_names_claude import DIVISION_SPOKEN


class ClaudeNFLNameReviewTests(unittest.TestCase):
    def test_conference_acronyms_are_spelled_in_spanish(self):
        self.assertEqual(DIVISION_SPOKEN["nfc-north"], "ene efe ce norte")
        self.assertEqual(DIVISION_SPOKEN["afc-west"], "a efe ce oeste")
        self.assertEqual(len(DIVISION_SPOKEN), 8)


if __name__ == "__main__":
    unittest.main()
