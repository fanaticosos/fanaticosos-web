import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { previewReleaseImport } from "../lib/release-import.mjs";

test("release import preview excludes fixtures and verifies the published catalog and assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-import-test-")); const statesRoot = join(root, "states"); const releasesRoot = join(root, "releases");
  await mkdir(statesRoot); await mkdir(releasesRoot); const databasePath = join(root, "publisher.sqlite"); const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
  const revisionId = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId).current_revision_id;
  for (const [locale, hash] of [["es", "a"], ["en", "b"]]) database.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path, checksum_sha256, created_at, updated_at, accepted_at) VALUES (?, ?, 'audio', ?, ?, 'accepted', ?, ?, ?, ?, ?)`)
    .run(`${locale}-audio`, revisionId, locale, hash.repeat(64), `/private/${locale}.mp3`, hash.repeat(64), "2026-09-09T01:00:00Z", "2026-09-09T01:00:00Z", "2026-09-09T01:00:00Z");
  closeDatabase(database);
  const jobId = `release-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`; const releaseRoot = join(releasesRoot, jobId, "release");
  await mkdir(join(releaseRoot, "src/content/articles/es"), { recursive: true }); await mkdir(join(releaseRoot, "public/images"), { recursive: true });
  await writeFile(join(releaseRoot, "src/content/articles/es", `${draft.articleId}.md`), `---\narticleId: ${draft.articleId}\nstatus: published\n---\n\nArticle\n`);
  await writeFile(join(releaseRoot, "src/content/articles/es/00000000-0000-4000-8000-000000000001.md"), "---\narticleId: 00000000-0000-4000-8000-000000000001\nstatus: draft\nfixture: true\n---\n\nFixture\n");
  const image = Buffer.from("image"); await writeFile(join(releaseRoot, "public/images/image.webp"), image); const imageHash = createHash("sha256").update(image).digest("hex");
  const manifest = { schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, assets: { esAudio: { sha256: "a".repeat(64) }, enAudio: { sha256: "b".repeat(64) }, image: { path: "public/images/image.webp", sha256: imageHash } } };
  await writeFile(join(releaseRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(statesRoot, `release-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, jobId, status: "completed", manifest }));
  const preview = await previewReleaseImport({ statesRoot, releasesRoot, databasePath });
  assert.equal(preview.total, 1); assert.equal(preview.missingCatalog, 0); assert.equal(preview.missingAudio, 0); assert.equal(preview.invalidImages, 0); assert.equal(preview.releases[0].catalogCount, 1);
});

test("release import preview skips only undeployed state whose retained directory is gone", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-import-unretained-test-")); const statesRoot = join(root, "states"); const releasesRoot = join(root, "releases");
  await mkdir(statesRoot); await mkdir(releasesRoot); const databasePath = join(root, "publisher.sqlite"); const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} }); closeDatabase(database);
  const jobId = `release-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
  await writeFile(join(statesRoot, `release-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, jobId, status: "completed", manifest: {} }));
  const preview = await previewReleaseImport({ statesRoot, releasesRoot, databasePath });
  assert.equal(preview.skipped, 1); assert.equal(preview.insert, 0); assert.equal(preview.releases[0].action, "skip-unretained");
  await writeFile(join(statesRoot, `deployment-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, releaseJobId: jobId, status: "completed" }));
  await assert.rejects(previewReleaseImport({ statesRoot, releasesRoot, databasePath }), /deployed release directory is missing/);
});
