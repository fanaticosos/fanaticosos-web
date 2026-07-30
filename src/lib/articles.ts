import type { CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">;
export type ArticleLocale = "es" | "en";

export function isBuildEligible(article: Article): boolean {
  if (article.data.status === "published") return true;
  return import.meta.env.INCLUDE_DRAFT_FIXTURES === "true" && article.data.fixture === true;
}

export function articlePath(article: Article): string {
  return article.data.locale === "es"
    ? `/blog/${article.data.slug}/`
    : `/en/blog/${article.data.slug}/`;
}

export function indexPath(locale: ArticleLocale): string {
  return locale === "es" ? "/blog/" : "/en/blog/";
}

export function pairedArticle(article: Article, articles: Article[]): Article {
  const alternateLocale = article.data.locale === "es" ? "en" : "es";
  const pair = articles.find(
    (candidate) => candidate.data.articleId === article.data.articleId && candidate.data.locale === alternateLocale,
  );
  if (!pair) throw new Error(`Missing ${alternateLocale} pair for article ${article.data.articleId}`);
  return pair;
}
