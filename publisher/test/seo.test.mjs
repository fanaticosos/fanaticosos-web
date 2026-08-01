import assert from "node:assert/strict";
import test from "node:test";

import { generateSeoPreview, seoSlug } from "../public/seo.js";

test("SEO preview is generated deterministically from owner fields", () => {
  const seo = generateSeoPreview({
    title: "Bears 2026: comienza la prueba de fuego",
    description: "Los Chicago Bears comienzan la temporada 2026 con grandes expectativas y varias incógnitas para Caleb Williams y Ben Johnson.",
    category: "Chicago Bears",
    season: 2026,
    tags: ["#BearDown", "#ChicagoBears"],
    imagePath: "/uploads/bears.webp",
  });
  assert.equal(seo.slug, "bears-2026-comienza-la-prueba-de-fuego");
  assert.equal(seo.canonicalUrl, "https://fanaticosos.com/blog/bears-2026-comienza-la-prueba-de-fuego/");
  assert.deepEqual(seo.keywords, ["Chicago Bears", "2026", "BearDown", "ChicagoBears"]);
  assert.equal(seo.warnings.length, 0);
});

test("SEO preview provides review warnings without blocking publication", () => {
  const seo = generateSeoPreview({ title: "Bears", description: "Resumen", category: "", season: 2026 });
  assert.equal(seoSlug("México y Chicago"), "mexico-y-chicago");
  assert.ok(seo.warnings.length >= 3);
});
