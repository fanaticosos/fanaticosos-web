import assert from "node:assert/strict";
import test from "node:test";

import settings from "../../config/publisher/defaults.json" with { type: "json" };
import { previewPage } from "../lib/preview.mjs";

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
  assert.match(english, /lang="en"/);
  assert.match(english, /The Bears win/);
  assert.match(english, /Thank you for joining us!/);
  assert.match(english, /audio\/en/);
});
