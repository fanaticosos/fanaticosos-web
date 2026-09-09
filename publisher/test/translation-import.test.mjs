import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { previewTranslationImport } from "../lib/translation-import.mjs";
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
