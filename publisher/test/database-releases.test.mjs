import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { completeDatabaseRelease, queueDatabaseRelease, readDatabaseReleaseState, startDatabaseRelease } from "../lib/database-releases.mjs";

function acceptedArtifact(database, revisionId, { id, type, locale, sha256 }) {
  const now = "2026-09-09T00:00:00.000Z";
  database.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path,
    checksum_sha256, created_at, updated_at, accepted_at) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`)
    .run(id, revisionId, type, locale, sha256, join("/artifacts", id), sha256, now, now, now);
  return { id, sha256 };
}

test("SQLite release admission captures an ordered catalog and completes one verified manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-release-test-")); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const revisionId = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId).current_revision_id;
    const translationArtifact = acceptedArtifact(database, revisionId, { id: "translation-artifact", type: "translation", locale: "en", sha256: "a".repeat(64) });
    const esArtifact = acceptedArtifact(database, revisionId, { id: "es-artifact", type: "audio", locale: "es", sha256: "b".repeat(64) });
    const enArtifact = acceptedArtifact(database, revisionId, { id: "en-artifact", type: "audio", locale: "en", sha256: "c".repeat(64) });
    const jobId = `release-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    const input = { draft, translation: { artifact: translationArtifact }, audio: { jobs: { es: { result: { sha256: esArtifact.sha256 }, artifact: esArtifact }, en: { result: { sha256: enArtifact.sha256 }, artifact: enArtifact } } }, jobId, path: join(root, "release"), settings: { schemaVersion: 1 }, publishedAt: "2026-09-09T01:00:00Z", now: new Date("2026-09-09T01:00:00Z") };
    const queued = queueDatabaseRelease(database, input); assert.equal(queued.status, "queued");
    const repeated = queueDatabaseRelease(database, { ...input, jobId: jobId.replace("1234abcd", "87654321") }); assert.equal(repeated.jobId, jobId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM article_catalog_entries").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM release_artifacts").get().count, 3);
    startDatabaseRelease(database, jobId, new Date("2026-09-09T03:00:00Z"), new Date("2026-09-09T02:00:00Z"));
    const completed = completeDatabaseRelease(database, jobId, { articleId: draft.articleId }, "d".repeat(64), new Date("2026-09-09T02:30:00Z"));
    assert.equal(completed.status, "completed"); assert.equal(readDatabaseReleaseState(database, draft.articleId).manifest.articleId, draft.articleId);
  } finally { closeDatabase(database); }
});
