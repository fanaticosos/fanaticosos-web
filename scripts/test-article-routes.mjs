import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const astro = path.join(projectRoot, "node_modules/.bin/astro");

function build(environment) {
  const result = spawnSync(astro, ["build"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Astro fixture build failed with status ${result.status}`);
  }
}

function attribute(html, selectorPattern, attributeName) {
  const tag = html.match(selectorPattern)?.[0];
  return tag?.match(new RegExp(`${attributeName}="([^"]*)"`, "i"))?.[1];
}

async function verifyPage({ file, lang, canonical, alternate, alternateLang, title }) {
  const html = await readFile(path.join(projectRoot, "dist", file), "utf8");
  assert.match(html, new RegExp(`<html lang="${lang}"`));
  assert.match(html, new RegExp(`<title>${title} — FanaticOSOS</title>`));
  assert.equal(attribute(html, /<link\b[^>]*rel="canonical"[^>]*>/i, "href"), canonical);
  assert.match(html, new RegExp(`href="${alternate}"[^>]*hreflang="${alternateLang}"`));
  for (const hreflang of ["es", "en", "x-default"]) {
    assert.match(html, new RegExp(`<link\\b[^>]*hreflang="${hreflang}"[^>]*>`));
  }
}

let failure;
try {
  build({ ...process.env, INCLUDE_DRAFT_FIXTURES: "true" });
  await verifyPage({
    file: "blog/articulo-de-prueba/index.html",
    lang: "es",
    canonical: "https://fanaticosos.com/blog/articulo-de-prueba/",
    alternate: "/en/blog/unpublished-test-article/",
    alternateLang: "en",
    title: "Artículo de prueba no publicado",
  });
  await verifyPage({
    file: "en/blog/unpublished-test-article/index.html",
    lang: "en",
    canonical: "https://fanaticosos.com/en/blog/unpublished-test-article/",
    alternate: "/blog/articulo-de-prueba/",
    alternateLang: "es",
    title: "Unpublished test article",
  });
  console.log("Validated bilingual fixture routes, reciprocal language links, canonicals, and hreflang metadata.");
} catch (error) {
  failure = error;
} finally {
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.INCLUDE_DRAFT_FIXTURES;
  build(cleanEnvironment);
}

if (failure) throw failure;
