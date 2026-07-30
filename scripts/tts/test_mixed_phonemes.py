#!/usr/bin/env python3

import unittest

from mixed_phonemes import phonemize_mixed, split_protected_spans


class FakeSpanish:
    def __init__(self):
        self.calls = []

    def g2p(self, text):
        self.calls.append(text)
        return f"ES<{text.strip()}>", []


class FakeEnglish:
    def __init__(self):
        self.calls = []

    def g2p(self, text):
        self.calls.append(text)
        return text, [f"token:{text}"]

    def tokens_to_ps(self, tokens):
        return f"EN<{tokens[0].split(':', 1)[1]}>"


class MixedPhonemeTests(unittest.TestCase):
    def test_longest_protected_name_wins(self):
        spans = split_protected_spans(
            "Green Bay Packers venció a Green Bay.",
            ["Green Bay", "Green Bay Packers"],
        )
        self.assertEqual(
            spans,
            [
                ("Green Bay Packers", True),
                (" venció a ", False),
                ("Green Bay", True),
                (".", False),
            ],
        )

    def test_word_boundaries_prevent_partial_match(self):
        self.assertEqual(
            split_protected_spans("NotBearsTeam", ["Bears"]),
            [("NotBearsTeam", False)],
        )

    def test_mixed_phonemes_preserve_call_order(self):
        spanish = FakeSpanish()
        english = FakeEnglish()
        result = phonemize_mixed(
            "Los Bears y Caleb Williams ganaron.",
            ["Bears", "Caleb Williams"],
            spanish,
            english,
        )
        self.assertEqual(english.calls, ["Bears", "Caleb Williams"])
        self.assertEqual(spanish.calls, ["Los ", " y ", " ganaron."])
        self.assertEqual(
            result,
            "ES<Los> EN<Bears> ES<y> EN<Caleb Williams> ES<ganaron.>",
        )

    def test_original_text_can_be_reconstructed_exactly(self):
        text = "Chicago Bears juega en Soldier Field."
        spans = split_protected_spans(text, ["Chicago", "Chicago Bears", "Soldier Field"])
        self.assertEqual("".join(value for value, _ in spans), text)


if __name__ == "__main__":
    unittest.main()
