import assert from "node:assert/strict";
import test from "node:test";

import settings from "../../config/publisher/defaults.json" with { type: "json" };
import { previewPage, renderMarkdown } from "../lib/preview.mjs";

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001", revision: 1,
  title: "Los Bears <ganan>", description: "Resumen & análisis", body: "## Encabezado\n\nTexto <script>alert(1)</script>.",
  category: "Chicago Bears", season: 2026, tags: ["#BearDown"], featuredImage: { path: "/uploads/test.png", alt: "" },
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
  assert.match(spanish, /alt="Los Bears &lt;ganan&gt;"/);
  assert.doesNotMatch(spanish, /<script>/);
  assert.match(spanish, /¡Gracias por acompañarnos!/);
  assert.match(spanish, /class="social-bar"/);
  assert.match(spanish, /ES → EN/);
  assert.match(english, /lang="en"/);
  assert.match(english, /The Bears win/);
  assert.match(english, /alt="The Bears win"/);
  assert.match(english, /Thank you for joining us!/);
  assert.match(english, /EN → ES/);
  assert.match(english, /audio\/en/);
  assert.match(spanish, /audio\/es/);
  assert.match(spanish, /Volver al editor/);
  assert.match(english, /Back to editor/);
  assert.match(spanish, /\?draft=00000000-0000-4000-8000-000000000001/);
});

test("article Markdown renders headings, paragraphs, emphasis, lists, and quotes safely", () => {
  const html = renderMarkdown("## Una defensa\n\nPrimer párrafo.\n\n**Importante**\n\n- Uno\n- Dos\n\n> Una cita\n\n<script>alert(1)</script>");
  assert.match(html, /<h2>Una defensa<\/h2>/);
  assert.match(html, /<p>Primer párrafo\.<\/p>/);
  assert.match(html, /<strong>Importante<\/strong>/);
  assert.match(html, /<ul>[\s\S]*<li>Uno<\/li>[\s\S]*<li>Dos<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<blockquote>[\s\S]*<p>Una cita<\/p>[\s\S]*<\/blockquote>/);
  assert.doesNotMatch(html, /<script>/);
});

test("article Markdown renders multi-paragraph quote boxes and repairs duplicated list markers", () => {
  const html = renderMarkdown(`> “Así queremos vernos.”\n>\n> — **Caleb Williams**\n\n1. 1. Primera jugada\n2. Segunda jugada`);
  assert.match(html, /<blockquote>[\s\S]*<p>“Así queremos vernos\.”<\/p>[\s\S]*<p>— <strong>Caleb Williams<\/strong><\/p>[\s\S]*<\/blockquote>/);
  assert.match(html, /<ol>[\s\S]*<li>Primera jugada<\/li>[\s\S]*<li>Segunda jugada<\/li>[\s\S]*<\/ol>/);
  assert.doesNotMatch(html, /&gt;/);
  assert.doesNotMatch(html, /<li>1\. Primera jugada<\/li>/);
});

test("article Markdown renders comparison tables instead of pipe-delimited prose", () => {
  const html = renderMarkdown(`## El enfrentamiento\n\n| Factor | Bears | Panthers |\n|---|---|---|\n| **Quarterback** | Williams improvisa. | Young protege el balón. |\n| *Defensa* | Presiona. | <script>alert(1)</script> |`);
  assert.match(html, /<div class="table-scroll"><table>/);
  assert.match(html, /<th>Factor<\/th>/);
  assert.match(html, /<td><strong>Quarterback<\/strong><\/td>/);
  assert.match(html, /<td><em>Defensa<\/em><\/td>/);
  assert.match(html, /<td>Williams improvisa\.<\/td>/);
  assert.doesNotMatch(html, /\|---\|/);
  assert.doesNotMatch(html, /<script>/);
});

test("article Markdown supports standard links, nested lists, code, rules, and escaped raw HTML", () => {
  const html = renderMarkdown(`Texto con [fuente](https://example.com) y \`código\`.\n\n- Uno\n  - Anidado\n\n---\n\n<script>alert(1)</script>\n\n[Peligro](javascript:alert(1))`);
  assert.match(html, /<a href="https:\/\/example\.com">fuente<\/a>/);
  assert.match(html, /<code>código<\/code>/);
  assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*Anidado/);
  assert.match(html, /<hr>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
});
