#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { serializeArticlePair } from "../../publisher/lib/release.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const articleId = argument("--article-id");
const publisherRoot = argument("--publisher-root");
const repository = argument("--repository");
const draftPath = join(publisherRoot, "drafts", `${articleId}.json`);
const statesRoot = join(publisherRoot, "states");
const [draft, translation, audio, releaseState, settings] = await Promise.all([
  readFile(draftPath, "utf8").then(JSON.parse),
  readFile(join(statesRoot, `${articleId}.json`), "utf8").then(JSON.parse),
  readFile(join(statesRoot, `audio-${articleId}.json`), "utf8").then(JSON.parse),
  readFile(join(statesRoot, `release-${articleId}.json`), "utf8").then(JSON.parse),
  readFile(join(repository, "config", "publisher", "defaults.json"), "utf8").then(JSON.parse),
]);
if (releaseState.status !== "completed" || translation.status !== "completed" || audio.status !== "completed") throw new Error("completed translation, audio, and release are required");
const artifactRevision = releaseState.draftRevision;
if (translation.draftRevision !== artifactRevision || audio.draftRevision !== artifactRevision || draft.revision !== artifactRevision + 1) throw new Error("only one no-op revision can be repaired");
if (releaseState.manifest?.assets?.esAudio?.sha256 !== audio.jobs?.es?.result?.sha256 || releaseState.manifest?.assets?.enAudio?.sha256 !== audio.jobs?.en?.result?.sha256) throw new Error("release audio does not match current completed audio");
const candidate = serializeArticlePair({ draft: { ...draft, revision: artifactRevision }, translation, audio, settings, publishedAt: releaseState.manifest.publishedAt });
const releaseRoot = join(publisherRoot, "releases", releaseState.jobId, "release");
for (const [relative, expected] of Object.entries(candidate.files)) {
  const actual = await readFile(join(releaseRoot, relative), "utf8");
  if (actual !== expected) throw new Error(`draft content differs from completed release: ${relative}`);
}
if (draft.featuredImage?.path && basename(draft.featuredImage.path) !== basename(candidate.assets.image?.sourcePath ?? "")) throw new Error("draft image differs from completed release");
const repaired = { ...draft, revision: artifactRevision };
const temporary = `${draftPath}.${randomUUID()}.repairing`;
await writeFile(temporary, `${JSON.stringify(repaired, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, draftPath);
console.log(`PASS: Restored unchanged draft ${articleId} to revision ${artifactRevision}.`);
