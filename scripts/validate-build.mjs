import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

const routes = [
  {
    route: "/",
    file: "index.html",
    title: "FanaticOSOS — BearDown Chicago Bears",
    lang: "es",
    canonical: "https://fanaticosos.com/",
    requiredLinks: ["/pages/contact", "/pages/terms"],
  },
  {
    route: "/pages/contact",
    file: "pages/contact/index.html",
    title: "Contacto — FanaticOSOS",
    lang: "es",
    canonical: "https://fanaticosos.com/pages/contact",
    requiredLinks: ["/", "/pages/contact", "/pages/terms"],
  },
  {
    route: "/pages/terms",
    file: "pages/terms/index.html",
    title: "Términos de Uso — FanaticOSOS",
    lang: "es",
    canonical: "https://fanaticosos.com/pages/terms",
    requiredLinks: ["/", "/pages/contact", "/pages/terms"],
  },
  {
    route: "/blog/",
    file: "blog/index.html",
    title: "Blog — FanaticOSOS",
    lang: "es",
    canonical: "https://fanaticosos.com/blog/",
    requiredLinks: ["/", "/en/blog/", "/pages/contact", "/pages/terms"],
    alternates: {
      es: "https://fanaticosos.com/blog/",
      en: "https://fanaticosos.com/en/blog/",
      "x-default": "https://fanaticosos.com/blog/",
    },
  },
  {
    route: "/en/blog/",
    file: "en/blog/index.html",
    title: "Blog — FanaticOSOS",
    lang: "en",
    canonical: "https://fanaticosos.com/en/blog/",
    requiredLinks: ["/", "/blog/", "/pages/contact", "/pages/terms"],
    alternates: {
      es: "https://fanaticosos.com/blog/",
      en: "https://fanaticosos.com/en/blog/",
      "x-default": "https://fanaticosos.com/blog/",
    },
  },
];

const failures = [];

function record(condition, message) {
  if (!condition) failures.push(message);
}

function decodeAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attributesFromTag(tag) {
  const attributes = new Map();
  const pattern = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

  for (const match of tag.matchAll(pattern)) {
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    attributes.set(name.toLowerCase(), decodeAttribute(doubleQuoted ?? singleQuoted ?? unquoted ?? ""));
  }

  return attributes;
}

function tagsNamed(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => ({
    tag: match[0],
    attributes: attributesFromTag(match[0]),
  }));
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function outputCandidates(urlPath) {
  if (urlPath === "/") return [path.join(distRoot, "index.html")];

  const relativePath = urlPath.replace(/^\//, "").replace(/\/$/, "");
  return [
    path.join(distRoot, `${relativePath}.html`),
    path.join(distRoot, relativePath, "index.html"),
    path.join(distRoot, relativePath),
  ];
}

async function validateLocalReference(route, reference) {
  if (!reference.startsWith("/") || reference.startsWith("//")) return;

  const cleanPath = reference.split(/[?#]/, 1)[0] || "/";
  const candidates = outputCandidates(cleanPath);
  const exists = (await Promise.all(candidates.map(fileExists))).some(Boolean);
  record(exists, `${route}: local reference does not exist in dist: ${reference}`);
}

for (const page of routes) {
  const absoluteFile = path.join(distRoot, page.file);
  record(await fileExists(absoluteFile), `${page.route}: missing output file ${page.file}`);
  if (!(await fileExists(absoluteFile))) continue;

  const html = await readFile(absoluteFile, "utf8");
  const htmlTags = tagsNamed(html, "html");
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const metaTags = tagsNamed(html, "meta");
  const linkTags = tagsNamed(html, "link");
  const anchorTags = tagsNamed(html, "a");
  const imageTags = tagsNamed(html, "img");

  record(/^<!doctype html>/i.test(html), `${page.route}: missing HTML5 doctype`);
  record(htmlTags.length === 1, `${page.route}: expected one html element`);
  record(htmlTags[0]?.attributes.get("lang") === page.lang, `${page.route}: html lang must be ${page.lang}`);
  record(titleMatch?.[1] === page.title, `${page.route}: unexpected page title`);

  const viewport = metaTags.find((entry) => entry.attributes.get("name") === "viewport");
  const description = metaTags.find((entry) => entry.attributes.get("name") === "description");
  const ogTitle = metaTags.find((entry) => entry.attributes.get("property") === "og:title");
  const ogDescription = metaTags.find((entry) => entry.attributes.get("property") === "og:description");
  const ogImage = metaTags.find((entry) => entry.attributes.get("property") === "og:image");
  const ogUrl = metaTags.find((entry) => entry.attributes.get("property") === "og:url");
  const twitterCard = metaTags.find((entry) => entry.attributes.get("name") === "twitter:card");
  const canonicals = linkTags.filter((entry) => entry.attributes.get("rel") === "canonical");
  const sitemapLinks = linkTags.filter((entry) => entry.attributes.get("rel") === "sitemap");
  const feedLinks = linkTags.filter(
    (entry) => entry.attributes.get("rel") === "alternate" && entry.attributes.get("type") === "application/rss+xml",
  );

  record(viewport?.attributes.get("content") === "width=device-width, initial-scale=1.0", `${page.route}: invalid viewport metadata`);
  record(Boolean(description?.attributes.get("content")), `${page.route}: missing meta description`);
  record(ogTitle?.attributes.get("content") === page.title, `${page.route}: invalid og:title`);
  record(Boolean(ogDescription?.attributes.get("content")), `${page.route}: missing og:description`);
  record(ogImage?.attributes.get("content") === "https://fanaticosos.com/logo.png", `${page.route}: invalid og:image`);
  record(ogUrl?.attributes.get("content") === page.canonical, `${page.route}: invalid og:url`);
  record(twitterCard?.attributes.get("content") === "summary_large_image", `${page.route}: invalid Twitter card metadata`);
  record(canonicals.length === 1, `${page.route}: expected exactly one canonical link`);
  record(canonicals[0]?.attributes.get("href") === page.canonical, `${page.route}: invalid canonical URL`);
  record(sitemapLinks.length === 1, `${page.route}: expected one sitemap discovery link`);
  record(sitemapLinks[0]?.attributes.get("href") === "/sitemap-index.xml", `${page.route}: invalid sitemap discovery link`);
  record(feedLinks.length === 1, `${page.route}: expected one RSS discovery link`);
  record(
    feedLinks[0]?.attributes.get("href") === (page.lang === "es" ? "https://fanaticosos.com/rss.xml" : "https://fanaticosos.com/en/rss.xml"),
    `${page.route}: invalid localized RSS discovery link`,
  );

  if (page.alternates) {
    const alternates = linkTags.filter((entry) => entry.attributes.get("rel") === "alternate");
    for (const [hreflang, href] of Object.entries(page.alternates)) {
      record(
        alternates.some((entry) => entry.attributes.get("hreflang") === hreflang && entry.attributes.get("href") === href),
        `${page.route}: missing ${hreflang} alternate ${href}`,
      );
    }
  }

  const hrefs = anchorTags.map((entry) => entry.attributes.get("href")).filter(Boolean);
  for (const requiredLink of page.requiredLinks) {
    record(hrefs.includes(requiredLink), `${page.route}: missing required link ${requiredLink}`);
  }

  for (const href of hrefs) await validateLocalReference(page.route, href);

  for (const image of imageTags) {
    const source = image.attributes.get("src");
    const alt = image.attributes.get("alt");
    record(Boolean(source), `${page.route}: image is missing src`);
    record(Boolean(alt), `${page.route}: image ${source ?? "(unknown)"} is missing alt text`);
    if (source) await validateLocalReference(page.route, source);
  }

  record(!html.includes("127.0.0.1"), `${page.route}: local preview address leaked into output`);
  record(!html.includes(projectRoot), `${page.route}: local filesystem path leaked into output`);
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }

  return files;
}

const outputFiles = await listFiles(distRoot);
const forbiddenNames = /(^|\/)(\.env(?:\.|$)|node_modules|.*\.(?:key|pem|psd|map|pyc))$/i;
const forbiddenGeneratedMedia = /\.(?:mp3|wav|flac)$/i;

for (const outputFile of outputFiles) {
  record(!forbiddenNames.test(outputFile), `dist contains forbidden private or development file: ${outputFile}`);
  record(!forbiddenGeneratedMedia.test(outputFile), `Phase 1 dist unexpectedly contains generated audio: ${outputFile}`);
}

async function requireOutput(relativeFile, expectedPatterns) {
  const absoluteFile = path.join(distRoot, relativeFile);
  record(await fileExists(absoluteFile), `missing required generated file: ${relativeFile}`);
  if (!(await fileExists(absoluteFile))) return;
  const content = await readFile(absoluteFile, "utf8");
  for (const pattern of expectedPatterns) {
    record(pattern.test(content), `${relativeFile}: missing expected content ${pattern}`);
  }
}

await requireOutput("rss.xml", [/<language>es<\/language>/, /<title>FanaticOSOS<\/title>/]);
await requireOutput("en/rss.xml", [/<language>en<\/language>/, /<title>FanaticOSOS<\/title>/]);
await requireOutput("robots.txt", [/User-agent: \*/, /Sitemap: https:\/\/fanaticosos\.com\/sitemap-index\.xml/]);
await requireOutput("sitemap-index.xml", [/https:\/\/fanaticosos\.com\/sitemap-0\.xml/]);
await requireOutput("sitemap-0.xml", [
  /https:\/\/fanaticosos\.com\/blog\//,
  /https:\/\/fanaticosos\.com\/en\/blog\//,
]);

if (failures.length > 0) {
  console.error("Static build validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${routes.length} routes and ${outputFiles.length} output files.`);
