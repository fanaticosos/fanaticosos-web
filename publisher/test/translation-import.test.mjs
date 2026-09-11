import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { applyTranslationImport, previewTranslationImport } from "../lib/translation-import.mjs";
import { translationSourceRevision } from "../lib/translation-jobs.mjs";

const owner = { title: "Título", description: "Descripción", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} };

test("translation import preview validates completed legacy state and writes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-import-test-"));
  const statesRoot = join(root, "states");
  const databasePath = join(root, "publisher.sqlite");
  await mkdir(statesRoot);
  const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, owner);
  closeDatabase(database);
  const state = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: 1,
    jobId: `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`,
    status: "completed", workflow: "preview", sourceRevision: translationSourceRevision(draft),
    bodyLayout: [], result: { title: "Title", description: "Description", body: "Article" },
    provenance: { engine: "qwen" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await writeFile(join(statesRoot, `${draft.articleId}.json`), JSON.stringify(state));
  const preview = await previewTranslationImport({ statesRoot, databasePath });
  assert.equal(preview.insert, 1);
  assert.equal(preview.conflicts, 0);
  const inspected = await openDatabase(databasePath);
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 0);
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM artifacts").get().count, 0);
  closeDatabase(inspected);
});

test("translation import writes verified immutable artifacts and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-import-apply-test-"));
  const statesRoot = join(root, "states");
  const artifactsRoot = join(root, "artifacts");
  const databasePath = join(root, "publisher.sqlite");
  await mkdir(statesRoot);
  const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, owner);
  closeDatabase(database);
  const state = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: 1,
    jobId: `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`, status: "completed",
    workflow: "preview", sourceRevision: translationSourceRevision(draft), bodyLayout: [],
    result: { title: "Title", description: "Description", body: "Article" }, provenance: { engine: "qwen" },
    createdAt: "2026-09-09T01:00:00.000Z", updatedAt: "2026-09-09T02:00:00.000Z",
  };
  const legacyPath = join(statesRoot, `${draft.articleId}.json`);
  await writeFile(legacyPath, JSON.stringify(state));
  const legacyBefore = await readFile(legacyPath);
  const applied = await applyTranslationImport({ statesRoot, artifactsRoot, databasePath });
  assert.equal(applied.inserted, 1);
  const artifactPath = join(artifactsRoot, draft.articleId, `${state.sourceRevision}.json`);
  const artifact = await readFile(artifactPath);
  assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
  const inspected = await openDatabase(databasePath);
  const row = inspected.prepare("SELECT status, checksum_sha256 FROM artifacts").get();
  assert.equal(row.status, "accepted");
  assert.equal(row.checksum_sha256, createHash("sha256").update(artifact).digest("hex"));
  closeDatabase(inspected);
  assert.deepEqual(await readFile(legacyPath), legacyBefore);
  const repeated = await applyTranslationImport({ statesRoot, artifactsRoot, databasePath });
  assert.equal(repeated.insert, 0);
  assert.equal(repeated.unchanged, 1);
});
