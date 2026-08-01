import type { CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">;
export type ArticleLocale = "es" | "en";

export function isBuildEligible(article: Article): boolean {
  if (article.data.status === "published") return true;
  return import.meta.env?.INCLUDE_DRAFT_FIXTURES === "true" && article.data.fixture === true;
}

export function articlePath(article: Article): string {
  return article.data.locale === "es"
    ? `/blog/${article.data.slug}/`
    : `/en/blog/${article.data.slug}/`;
}

export function indexPath(locale: ArticleLocale): string {
  return locale === "es" ? "/blog/" : "/en/blog/";
}

export function categorySlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function categoryPath(locale: ArticleLocale, label: string): string {
  const slug = categorySlug(label);
  return locale === "es" ? `/blog/categoria/${slug}/` : `/en/blog/category/${slug}/`;
}

export function pairedArticle(article: Article, articles: Article[]): Article {
  const alternateLocale = article.data.locale === "es" ? "en" : "es";
  const pair = articles.find(
    (candidate) => candidate.data.articleId === article.data.articleId && candidate.data.locale === alternateLocale,
  );
  if (!pair) throw new Error(`Missing ${alternateLocale} pair for article ${article.data.articleId}`);
  return pair;
}

export function latestArticleForLocale(articles: Article[], locale: ArticleLocale): Article | undefined {
  return articles
    .filter((article) => article.data.locale === locale && isBuildEligible(article))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf())[0];
}

export function relatedArticlesFor(article: Article, articles: Article[], limit = 3): Article[] {
  return articles
    .filter((candidate) => candidate.data.locale === article.data.locale && candidate.data.articleId !== article.data.articleId && isBuildEligible(candidate))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf())
    .slice(0, limit);
}
