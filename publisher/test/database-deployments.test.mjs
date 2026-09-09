import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeDatabaseDeployment, queueDatabaseDeployment, readDatabaseDeploymentState, startDatabaseDeployment } from "../lib/database-deployments.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { completeDatabaseRelease, queueDatabaseRelease, startDatabaseRelease } from "../lib/database-releases.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

function accepted(database, revisionId, id, type, locale, sha256) {
  const timestamp = "2026-09-09T00:00:00.000Z";
  database.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path, checksum_sha256,
    created_at, updated_at, accepted_at) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`)
    .run(id, revisionId, type, locale, sha256, `/artifacts/${id}`, sha256, timestamp, timestamp, timestamp);
  return { id, sha256 };
}

test("SQLite deployment admission publishes one validated release transactionally", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-deployment-test-")); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const revisionId = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId).current_revision_id;
    const translation = { artifact: accepted(database, revisionId, "translation", "translation", "en", "a".repeat(64)) };
    const audio = { jobs: {
      es: { result: { sha256: "b".repeat(64) }, artifact: accepted(database, revisionId, "audio-es", "audio", "es", "b".repeat(64)) },
      en: { result: { sha256: "c".repeat(64) }, artifact: accepted(database, revisionId, "audio-en", "audio", "en", "c".repeat(64)) },
    } };
    const releaseJobId = `release-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    queueDatabaseRelease(database, { draft, translation, audio, jobId: releaseJobId, path: join(root, "release"), settings: { schemaVersion: 1 }, publishedAt: "2026-09-09T01:00:00Z", now: new Date("2026-09-09T01:00:00Z") });
    startDatabaseRelease(database, releaseJobId, new Date("2026-09-09T01:10:00Z"), new Date("2026-09-09T01:01:00Z"));
    completeDatabaseRelease(database, releaseJobId, { schemaVersion: 1, articleId: draft.articleId }, "d".repeat(64), new Date("2026-09-09T01:02:00Z"));
    const queued = queueDatabaseDeployment(database, { articleId: draft.articleId, draftRevision: 1, releaseJobId, now: new Date("2026-09-09T01:03:00Z") });
    assert.equal(queued.status, "queued");
    assert.equal(queueDatabaseDeployment(database, { articleId: draft.articleId, draftRevision: 1, releaseJobId, now: new Date("2026-09-09T01:03:30Z") }).jobId, queued.jobId);
    startDatabaseDeployment(database, queued.jobId, new Date("2026-09-09T01:04:00Z"));
    const receipt = { schemaVersion: 1, environment: "production", jobId: releaseJobId, url: "https://deployment-id.fanaticosos-web.pages.dev", validatedAt: "2026-09-09T01:05:00Z" };
    const completed = completeDatabaseDeployment(database, queued.jobId, receipt, new Date("2026-09-09T01:06:00Z"));
    assert.equal(completed.status, "completed"); assert.deepEqual(completed.receipt, receipt);
    assert.deepEqual(readDatabaseDeploymentState(database, draft.articleId).receipt, receipt);
    assert.equal(database.prepare("SELECT status FROM jobs WHERE id = ?").get(queued.jobId).status, "completed");
  } finally { closeDatabase(database); }
});
