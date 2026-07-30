import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { articlePath, isBuildEligible } from "../../lib/articles";

export const GET: APIRoute = async (context) => {
  const articles = (await getCollection("articles"))
    .filter((article) => article.data.locale === "en" && isBuildEligible(article))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());

  return rss({
    title: "FanaticOSOS",
    description: "FanaticOSOS sports journalism and analysis in English.",
    site: context.site ?? "https://fanaticosos.com",
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.publishedAt,
      link: articlePath(article),
      categories: [article.data.category, ...article.data.tags],
    })),
    customData: "<language>en</language>",
  });
};
