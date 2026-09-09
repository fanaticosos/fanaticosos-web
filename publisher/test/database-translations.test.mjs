import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import {
  completeDatabaseTranslation, correctDatabaseTranslation, failDatabaseTranslation, listActiveDatabaseTranslations, queueDatabaseTranslation,
  readDatabaseTranslationState, startDatabaseTranslation,
} from "../lib/database-translations.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { claimDatabaseJob } from "../lib/database-dispatch.mjs";

const owner = {
  title: "Los Bears ganan", description: "Resumen del partido",
  body: "## Primer cuarto\n\nCaleb Williams lanzó un touchdown.",
  category: "Chicago Bears", season: 2026, tags: ["NFL"], status: "draft", featuredImage: {},
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-database-translation-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  const draft = createDatabaseDraft(database, owner, new Date("2026-09-09T00:00:00.000Z"));
  return { database, draft };
}

test("translation admission is transactional and idempotent by source dependency", async () => {
  const { database, draft } = await fixture();
  try {
    const request = {
      draft, jobId: `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`,
      workflow: "preview", bodyLayout: [{ id: "body-001", prefix: "## " }],
      now: new Date("2026-09-09T01:00:00.000Z"),
    };
    const queued = queueDatabaseTranslation(database, request);
    assert.equal(queued.status, "queued");
    assert.equal(queued.workflow, "preview");
    assert.match(queued.sourceRevision, /^[0-9a-f]{64}$/);
    const repeated = queueDatabaseTranslation(database, { ...request, jobId: request.jobId.replace("1234abcd", "87654321") });
    assert.equal(repeated.jobId, queued.jobId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM artifacts").get().count, 1);
    assert.equal(listActiveDatabaseTranslations(database).length, 1);
  } finally {
    closeDatabase(database);
  }
});

test("dispatcher atomically leases an admitted SQLite job before process launch", async () => {
  const { database, draft } = await fixture();
  try {
    const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    queueDatabaseTranslation(database, { draft, jobId, bodyLayout: [] });
    assert.deepEqual(claimDatabaseJob(database, jobId, new Date("2026-09-09T01:00:00Z")), { jobId, type: "translation", status: "leased" });
    const row = database.prepare("SELECT status, attempt, lease_owner, lease_expires_at FROM jobs WHERE id = ?").get(jobId);
    assert.equal(row.status, "leased"); assert.equal(row.attempt, 1); assert.equal(row.lease_owner, "systemd");
    assert.equal(row.lease_expires_at, "2026-09-09T01:35:00.000Z");
    assert.throws(() => claimDatabaseJob(database, jobId), /not available/);
  } finally { closeDatabase(database); }
});

test("owner correction creates a new accepted artifact and supersedes the old one", async () => {
  const { database, draft } = await fixture();
  try {
    const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    queueDatabaseTranslation(database, { draft, jobId, bodyLayout: [] });
    startDatabaseTranslation(database, jobId, "worker-1", new Date("2026-09-09T02:00:00.000Z"), new Date("2026-09-09T01:00:00.000Z"));
    const original = completeDatabaseTranslation(database, {
      jobId, result: { title: "Title", description: "Description", body: "Body" },
      provenance: { engine: "qwen" }, artifactPath: "/private/original.json",
      checksumSha256: "a".repeat(64), now: new Date("2026-09-09T01:30:00.000Z"),
    });
    const corrected = correctDatabaseTranslation(database, {
      draft, result: { title: "Owner title", description: "Owner description", body: "Owner body" },
      artifactPath: "/private/corrected.json", checksumSha256: "b".repeat(64),
      now: new Date("2026-09-09T01:45:00.000Z"),
    });
    assert.equal(corrected.result.title, "Owner title");
    assert.equal(corrected.ownerRevision, 1);
    assert.equal(database.prepare("SELECT status FROM artifacts WHERE id = ?").get(original.artifact.id).status, "superseded");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE status = 'accepted'").get().count, 1);
  } finally {
    closeDatabase(database);
  }
});

test("translation lifecycle accepts one immutable verified artifact", async () => {
  const { database, draft } = await fixture();
  try {
    const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    queueDatabaseTranslation(database, { draft, jobId, bodyLayout: [] });
    startDatabaseTranslation(database, jobId, "worker-1", new Date("2026-09-09T02:00:00.000Z"), new Date("2026-09-09T01:00:00.000Z"));
    assert.equal(readDatabaseTranslationState(database, draft.articleId).status, "running");
    const completed = completeDatabaseTranslation(database, {
      jobId,
      result: { title: "The Bears win", description: "Game summary", body: "Article" },
      provenance: { engine: "qwen" },
      artifactPath: "/private/artifacts/translation.json",
      checksumSha256: "a".repeat(64),
      now: new Date("2026-09-09T01:30:00.000Z"),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.title, "The Bears win");
    assert.equal(completed.artifact.status, "accepted");
    assert.throws(() => database.prepare("UPDATE artifacts SET checksum_sha256 = ? WHERE id = ?").run("b".repeat(64), completed.artifact.id), /immutable/);
    assert.throws(() => database.prepare("DELETE FROM artifacts WHERE id = ?").run(completed.artifact.id), /cannot be deleted/);
  } finally {
    closeDatabase(database);
  }
});

test("translation failure atomically fails its pending artifact", async () => {
  const { database, draft } = await fixture();
  try {
    const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
    queueDatabaseTranslation(database, { draft, jobId, bodyLayout: [] });
    const failed = failDatabaseTranslation(database, jobId, "model output was invalid");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "model output was invalid");
    assert.equal(failed.artifact.status, "failed");
  } finally {
    closeDatabase(database);
  }
});
