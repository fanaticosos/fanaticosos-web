import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { completeDatabaseRelease, queueDatabaseRelease, readDatabaseReleaseState, startDatabaseRelease } from "../lib/database-releases.mjs";

test("SQLite release admission captures an ordered catalog and completes one verified manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-release-test-")); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const jobId = `release-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    const input = { draft, translation: { artifact: { sha256: "a".repeat(64) } }, audio: { jobs: { es: { result: { sha256: "b".repeat(64) } }, en: { result: { sha256: "c".repeat(64) } } } }, jobId, path: join(root, "release"), settings: { schemaVersion: 1 }, publishedAt: "2026-09-09T01:00:00Z", now: new Date("2026-09-09T01:00:00Z") };
    const queued = queueDatabaseRelease(database, input); assert.equal(queued.status, "queued");
    const repeated = queueDatabaseRelease(database, { ...input, jobId: jobId.replace("1234abcd", "87654321") }); assert.equal(repeated.jobId, jobId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM article_catalog_entries").get().count, 1);
    startDatabaseRelease(database, jobId, new Date("2026-09-09T03:00:00Z"), new Date("2026-09-09T02:00:00Z"));
    const completed = completeDatabaseRelease(database, jobId, { articleId: draft.articleId }, "d".repeat(64), new Date("2026-09-09T02:30:00Z"));
    assert.equal(completed.status, "completed"); assert.equal(readDatabaseReleaseState(database, draft.articleId).manifest.articleId, draft.articleId);
  } finally { closeDatabase(database); }
});
