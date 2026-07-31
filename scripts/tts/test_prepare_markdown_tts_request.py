#!/usr/bin/env python3

import tempfile
import sys
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from prepare_markdown_tts_request import markdown_paragraphs, prepare


class MarkdownTtsRequestTests(unittest.TestCase):
    def test_markdown_is_reduced_to_spoken_paragraphs(self):
        source = """![](https://example.com/image.png)

**Resumen** del juego.

1. **Defensa:** Dos fumbles.
"""
        self.assertEqual(
            markdown_paragraphs(source),
            ["Resumen del juego.", "Defensa: Dos fumbles."],
        )

    def test_article_id_is_a_deterministic_uuid(self):
        with tempfile.TemporaryDirectory() as name:
            source = Path(name) / "article.md"
            source.write_text("Texto del artículo.\n", encoding="utf-8")
            first = prepare(source, "Título")
            second = prepare(source, "Título")
        uuid.UUID(first["articleId"])
        self.assertEqual(first["articleId"], second["articleId"])
        self.assertEqual(len(first["sourceRevision"]), 64)


if __name__ == "__main__":
    unittest.main()
