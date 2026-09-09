import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { databaseAudioFile, readDatabaseAudioState } from "../lib/database-audio.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

test("SQLite reconstructs bilingual accepted audio state and immutable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const revision = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId).current_revision_id;
    for (const [locale, type, hash] of [["es", "tts_es", "a"], ["en", "tts_en", "b"]]) {
      const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r1-${locale === "es" ? "1234abcd" : "87654321"}`;
      const artifactId = `legacy:${jobId}`; const path = join(root, `${locale}.mp3`);
      database.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path, checksum_sha256, created_at, updated_at, accepted_at)
        VALUES (?, ?, 'audio', ?, ?, 'accepted', ?, ?, ?, ?, ?)`)
        .run(artifactId, revision, locale, hash.repeat(64), path, hash.repeat(64), "2026-09-09T01:00:00.000Z", "2026-09-09T02:00:00.000Z", "2026-09-09T02:00:00.000Z");
      database.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash, status, checkpoint_json, available_at, created_at, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
        .run(jobId, type, revision, artifactId, `audio:${locale}:${draft.articleId}`, hash.repeat(64), JSON.stringify({ schemaVersion: 1, workflow: "preview", sourceRevision: hash.repeat(64), policyRevision: "c".repeat(64), result: { locale, file: `${locale}.mp3`, sha256: hash.repeat(64) } }), "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z", "2026-09-09T02:00:00.000Z");
    }
    const state = readDatabaseAudioState(database, draft.articleId);
    assert.equal(state.status, "completed"); assert.equal(state.workflow, "preview");
    assert.equal(state.jobs.es.status, "completed"); assert.equal(state.jobs.en.status, "completed");
    assert.equal(databaseAudioFile(state, "es"), join(root, "es.mp3"));
    assert.throws(() => databaseAudioFile(state, "fr"), /not ready/);
  } finally { closeDatabase(database); }
});

test("missing SQLite audio state has filesystem-compatible ENOENT semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-missing-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try { assert.throws(() => readDatabaseAudioState(database, "00000000-0000-4000-8000-000000000000"), { code: "ENOENT" }); }
  finally { closeDatabase(database); }
});
