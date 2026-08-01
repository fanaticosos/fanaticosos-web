import assert from "node:assert/strict";

const { latestArticleForLocale, relatedArticlesFor } = await import("../src/lib/articles.ts");

const article = (articleId, locale, publishedAt, status = "published") => ({
  data: { articleId, locale, publishedAt: new Date(publishedAt), status, fixture: status !== "published" },
});
const articles = [
  article("current", "es", "2026-07-31"),
  article("older", "es", "2026-07-01"),
  article("newest", "es", "2026-08-01"),
  article("english", "en", "2026-08-02"),
  article("archived", "es", "2026-09-01", "archived"),
];

assert.equal(latestArticleForLocale(articles, "es").data.articleId, "newest");
assert.deepEqual(relatedArticlesFor(articles[0], articles).map((item) => item.data.articleId), ["newest", "older"]);
assert.equal(relatedArticlesFor(articles[0], articles).some((item) => item.data.locale !== "es"), false);
console.log("Validated latest and related article selection.");
