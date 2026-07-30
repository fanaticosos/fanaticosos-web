import assert from "node:assert/strict";
import { validateArticles } from "./validate-content.mjs";

const articleId = "00000000-0000-4000-8000-000000000001";
const shared = {
  articleId,
  author: "Fanaticosos",
  publishedAt: new Date("2026-07-29T17:00:00.000Z"),
  status: "draft",
  sourceRevision: "fixture-es-v1",
  fixture: true,
};

function entry(locale, overrides = {}) {
  return {
    file: `src/content/articles/${locale}/${articleId}.md`,
    fileLocale: locale,
    filename: articleId,
    data: {
      ...shared,
      locale,
      slug: locale === "es" ? "articulo-de-prueba" : "unpublished-test-article",
      ...(locale === "en" ? { translation: { sourceRevision: shared.sourceRevision } } : {}),
      ...overrides,
    },
  };
}

const validPair = [entry("es"), entry("en")];
assert.deepEqual(validateArticles(validPair), []);

const failureCases = [
  { name: "missing translation", articles: [entry("es")], expected: "missing en article" },
  { name: "duplicate identity", articles: [...validPair, entry("en")], expected: "duplicate article identity" },
  {
    name: "duplicate slug",
    articles: [...validPair, entry("es", { articleId: "00000000-0000-4000-8000-000000000002" })],
    expected: "duplicate localized slug",
  },
  {
    name: "mismatched shared metadata",
    articles: [entry("es"), entry("en", { author: "Different author" })],
    expected: "paired field author does not match",
  },
  {
    name: "stale translation",
    articles: [entry("es"), entry("en", { translation: { sourceRevision: "older-revision" } })],
    expected: "English translation is stale",
  },
];

for (const testCase of failureCases) {
  const failures = validateArticles(testCase.articles);
  assert(failures.some((failure) => failure.includes(testCase.expected)), `${testCase.name} was not rejected`);
}

console.log(`Passed valid-pair test and ${failureCases.length} rejection tests.`);
