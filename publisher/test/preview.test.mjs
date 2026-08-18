import assert from "node:assert/strict";
import test from "node:test";

import settings from "../../config/publisher/defaults.json" with { type: "json" };
import { previewPage, renderMarkdown } from "../lib/preview.mjs";

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001", revision: 1,
  title: "Los Bears <ganan>", description: "Resumen & análisis", body: "## Encabezado\n\nTexto <script>alert(1)</script>.",
  category: "Chicago Bears", season: 2026, tags: ["#BearDown"], featuredImage: {},
};
const translation = {
  status: "completed", draftRevision: 1,
  result: { title: "The Bears win", description: "Summary", body: "## Heading\n\nStory." },
};
const audio = { status: "completed", draftRevision: 1 };

test("private preview switches the complete article and escapes owner text", () => {
  const spanish = previewPage({ draft, translation, audio, locale: "es", settings });
  const english = previewPage({ draft, translation, audio, locale: "en", settings });
  assert.match(spanish, /lang="es"/);
  assert.match(spanish, /Los Bears &lt;ganan&gt;/);
  assert.doesNotMatch(spanish, /<script>/);
  assert.match(spanish, /¡Gracias por acompañarnos!/);
  assert.match(spanish, /class="social-bar"/);
  assert.match(spanish, /English version →/);
  assert.match(english, /lang="en"/);
  assert.match(english, /The Bears win/);
  assert.match(english, /Thank you for joining us!/);
  assert.match(english, /← Versión en español/);
  assert.match(english, /audio\/en/);
  assert.match(spanish, /audio\/es/);
});

test("article Markdown renders headings, paragraphs, emphasis, lists, and quotes safely", () => {
  const html = renderMarkdown("## Una defensa\n\nPrimer párrafo.\n\n**Importante**\n\n- Uno\n- Dos\n\n> Una cita\n\n<script>alert(1)</script>");
  assert.match(html, /<h2>Una defensa<\/h2>/);
  assert.match(html, /<p>Primer párrafo\.<\/p>/);
  assert.match(html, /<strong>Importante<\/strong>/);
  assert.match(html, /<ul><li>Uno<\/li><li>Dos<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>Una cita<\/p><\/blockquote>/);
  assert.doesNotMatch(html, /<script>/);
});
