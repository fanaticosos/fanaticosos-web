#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { serializeArticlePair } from "../../publisher/lib/release.mjs";
import { closeDatabase, openDatabase } from "../../publisher/lib/database.mjs";
import { readDatabaseDraft } from "../../publisher/lib/database-drafts.mjs";
import { readDatabaseTranslationState } from "../../publisher/lib/database-translations.mjs";
import { readDatabaseAudioState } from "../../publisher/lib/database-audio.mjs";
import { readDatabaseReleaseImageArtifact } from "../../publisher/lib/database-releases.mjs";

const execute = promisify(execFile);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(process.argv[index + 1]);
}

function optionalArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : resolve(process.argv[index + 1]);
}

function validateRequest(value) {
  if (value?.schemaVersion !== 1) throw new Error("release request schemaVersion must be 1");
  if (!/^[0-9a-f-]{36}$/.test(value.articleId)) throw new Error("release articleId is invalid");
  if (!Number.isInteger(value.draftRevision) || value.draftRevision < 1) throw new Error("release draftRevision is invalid");
  if (typeof value.publishedAt !== "string" || Number.isNaN(Date.parse(value.publishedAt))) throw new Error("release publishedAt is invalid");
  return value;
}

async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }
async function optionalFile(path) {
  return readFile(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function main() {
  const requestPath = argument("--request");
  const repository = argument("--repository");
  const publisherRoot = argument("--publisher-root");
  const jobsRoot = argument("--jobs-root");
  const releasesRoot = argument("--releases-root");
  const output = argument("--output");
  const databasePath = optionalArgument("--database");
  const request = validateRequest(await json(requestPath));
  if (process.argv.includes("--validate-only")) return;
  let draft; let translation; let audio; let imageArtifact;
  if (databasePath) {
    const database = await openDatabase(databasePath);
    try {
      draft = readDatabaseDraft(database, request.articleId);
      translation = readDatabaseTranslationState(database, request.articleId);
      audio = readDatabaseAudioState(database, request.articleId);
      imageArtifact = readDatabaseReleaseImageArtifact(database, basename(dirname(requestPath)));
    } finally { closeDatabase(database); }
  } else {
    draft = await json(join(publisherRoot, "drafts", `${request.articleId}.json`));
    translation = await json(join(publisherRoot, "states", `${request.articleId}.json`));
    audio = await json(join(publisherRoot, "states", `audio-${request.articleId}.json`));
  }
  const settings = await json(join(repository, "config", "publisher", "defaults.json"));
  if (draft.revision !== request.draftRevision) throw new Error("release request is stale");
  const release = serializeArticlePair({ draft, translation, audio, settings, publishedAt: request.publishedAt });
  await lstat(output).then(() => { throw new Error("release output already exists"); }, (error) => { if (error.code !== "ENOENT") throw error; });
  const temporary = `${output}.building`;
  await lstat(temporary).then(() => { throw new Error("release staging already exists"); }, (error) => { if (error.code !== "ENOENT") throw error; });
  await cp(repository, temporary, {
    recursive: true,
    filter: (source) => ![".git", ".astro", "node_modules", "dist"].includes(basename(source)),
  });
  const selected = join(releasesRoot, "current");
  const hasSelectedRelease = await lstat(selected).then((value) => value.isSymbolicLink()).catch((error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (hasSelectedRelease) {
    for (const relative of ["src/content/articles", "public/audio", "public/images", "public/uploads"]) {
      const source = join(selected, relative);
      const exists = await lstat(source).then(() => true).catch((error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (exists) await cp(source, join(temporary, relative), { recursive: true, force: true });
    }
  }
  const stageModules = join(temporary, "node_modules");
  const repositoryModules = join(repository, "node_modules");
  await mkdir(stageModules, { mode: 0o700 });
  for (const entry of await readdir(repositoryModules)) {
    if ([".astro", ".vite"].includes(entry)) continue;
    await symlink(join(repositoryModules, entry), join(stageModules, entry));
  }
  for (const [relative, contents] of Object.entries(release.files)) {
    const target = join(temporary, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
  }
  const siteSettings = await optionalFile(join(publisherRoot, "site-settings.json"));
  if (siteSettings) {
    await writeFile(join(temporary, "src", "data", "site-settings.json"), siteSettings, { mode: 0o600 });
  }
  const copiedAssets = {};
  for (const [key, asset] of Object.entries(release.assets)) {
    let source;
    if (key === "image") {
      if (databasePath) {
        const allowed = join(publisherRoot, "artifacts", "images") + "/";
        source = resolve(imageArtifact?.path ?? "");
        if (!imageArtifact || !source.startsWith(allowed)) throw new Error("accepted image is outside the private artifact store");
      } else {
        const uploadName = basename(asset.sourcePath);
        if (asset.sourcePath !== `/uploads/${uploadName}`) throw new Error("featured image is outside the private upload store");
        source = join(publisherRoot, "uploads", uploadName);
      }
    } else if (asset.sourcePath) {
      const allowed = join(publisherRoot, "artifacts", "audio") + "/";
      source = resolve(asset.sourcePath);
      if (!source.startsWith(allowed)) throw new Error("accepted audio is outside the private artifact store");
    } else {
      source = join(jobsRoot, asset.sourceJobId, "audio", asset.file);
    }
    const target = join(temporary, asset.publicPath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { force: true });
    copiedAssets[key] = { path: asset.publicPath, sha256: await sha256(target) };
  }
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    FANATICOSOS_PRIVATE_RELEASE_BUILD: "1",
    FANATICOSOS_RELEASE_ARTICLE_ID: request.articleId,
  };
  const { stdout, stderr } = await execute("/opt/nodejs/current/bin/npm", ["run", "build"], { cwd: temporary, env: environment, maxBuffer: 10_000_000 });
  const slugs = {
    es: Object.keys(release.files).length && release.files[`src/content/articles/es/${request.articleId}.md`].match(/\nslug: ([^\n]+)/)?.[1],
    en: release.files[`src/content/articles/en/${request.articleId}.md`].match(/\nslug: ([^\n]+)/)?.[1],
  };
  for (const route of [join(temporary, "dist", "blog", slugs.es, "index.html"), join(temporary, "dist", "en", "blog", slugs.en, "index.html")]) {
    const metadata = await lstat(route);
    if (!metadata.isFile()) throw new Error(`release route is missing: ${route}`);
  }
  const { stdout: commit } = await execute("git", ["-C", repository, "rev-parse", "HEAD"]);
  const manifest = {
    schemaVersion: 1, articleId: request.articleId, draftRevision: request.draftRevision,
    publishedAt: request.publishedAt, timezone: settings.timezone, commit: commit.trim(),
    routes: { es: `/blog/${slugs.es}/`, en: `/en/blog/${slugs.en}/` },
    assets: copiedAssets,
    homepageSha256: await sha256(join(temporary, "dist", "index.html")),
    buildCompletedAt: new Date().toISOString(),
    buildLog: `${stdout}${stderr}`.slice(-20_000), deployment: "disabled",
  };
  await writeFile(join(temporary, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await rename(temporary, output);
  console.log(`PASS: Private release built for ${request.articleId}.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
