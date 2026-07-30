import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultContentRoot = path.join(projectRoot, "src/content/articles");
const locales = ["es", "en"];

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return JSON.stringify(value);
}

export function validateArticles(articles) {
  const failures = [];
  const identities = new Set();
  const slugs = new Set();
  const pairs = new Map();

  for (const article of articles) {
    const { data, file, fileLocale, filename } = article;
    const identity = `${data.locale}:${data.articleId}`;
    const localizedSlug = `${data.locale}:${data.slug}`;

    if (data.locale !== fileLocale) failures.push(`${file}: locale must match its ${fileLocale} directory`);
    if (filename !== data.articleId) failures.push(`${file}: filename must equal articleId`);
    if (identities.has(identity)) failures.push(`${file}: duplicate article identity ${identity}`);
    if (slugs.has(localizedSlug)) failures.push(`${file}: duplicate localized slug ${localizedSlug}`);
    identities.add(identity);
    slugs.add(localizedSlug);

    const pair = pairs.get(data.articleId) ?? {};
    if (pair[data.locale]) failures.push(`${file}: duplicate ${data.locale} member for articleId ${data.articleId}`);
    pair[data.locale] = article;
    pairs.set(data.articleId, pair);
  }

  for (const [articleId, pair] of pairs) {
    for (const locale of locales) {
      if (!pair[locale]) failures.push(`${articleId}: missing ${locale} article`);
    }
    if (!pair.es || !pair.en) continue;

    const es = pair.es.data;
    const en = pair.en.data;
    for (const field of ["author", "publishedAt", "status", "sourceRevision", "fixture"]) {
      if (comparable(es[field]) !== comparable(en[field])) {
        failures.push(`${articleId}: paired field ${field} does not match`);
      }
    }

    if (comparable(es.featuredImage?.src) !== comparable(en.featuredImage?.src)) {
      failures.push(`${articleId}: paired featured-image source does not match`);
    }
    if (!en.translation) failures.push(`${articleId}: English article is missing translation provenance`);
    if (en.translation?.sourceRevision !== es.sourceRevision) {
      failures.push(`${articleId}: English translation is stale for Spanish source revision ${es.sourceRevision}`);
    }
  }

  return failures;
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const data = yaml.load(match[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${file}: frontmatter must be a YAML object`);
  }
  return data;
}

export async function loadArticles(contentRoot = defaultContentRoot) {
  const articles = [];
  for (const locale of locales) {
    const directory = path.join(contentRoot, locale);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
      const absoluteFile = path.join(directory, entry.name);
      const relativeFile = path.relative(projectRoot, absoluteFile);
      const source = await readFile(absoluteFile, "utf8");
      articles.push({
        data: parseFrontmatter(source, relativeFile),
        file: relativeFile,
        fileLocale: locale,
        filename: entry.name.replace(/\.mdx?$/, ""),
      });
    }
  }
  return articles;
}

async function main() {
  const articles = await loadArticles();
  const failures = validateArticles(articles);
  if (failures.length > 0) {
    console.error("Content-pair validation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${articles.length} article files in ${articles.length / 2} bilingual pair(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
