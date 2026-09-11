import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  completeDatabaseAudio, databaseAudioFile, failDatabaseAudio, listActiveDatabaseAudio,
  queueDatabaseAudio, queueDatabaseAudioLocale, readDatabaseAudioState, startDatabaseAudio,
} from "../lib/database-audio.mjs";
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

test("bilingual audio admission is atomic and idempotent by source and policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-admission-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const article = draft.articleId.replaceAll("-", "");
    const input = { draft, requests: { es: { sourceRevision: "a".repeat(64) }, en: { sourceRevision: "b".repeat(64) } }, policyRevision: "c".repeat(64), jobIds: { es: `tts-es-${article}-r1-1234abcd`, en: `tts-en-${article}-r1-87654321` }, workflow: "preview", now: new Date("2026-09-09T01:00:00.000Z") };
    const queued = queueDatabaseAudio(database, input);
    assert.equal(queued.status, "queued"); assert.equal(queued.jobs.es.status, "queued"); assert.equal(queued.jobs.en.status, "queued");
    assert.equal(listActiveDatabaseAudio(database).length, 2);
    const repeated = queueDatabaseAudio(database, { ...input, jobIds: { es: `tts-es-${article}-r1-aaaaaaaa`, en: `tts-en-${article}-r1-bbbbbbbb` } });
    assert.equal(repeated.jobs.es.jobId, input.jobIds.es); assert.equal(database.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 2);
  } finally { closeDatabase(database); }
});

test("audio lifecycle accepts verified artifacts and fails pending artifacts atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-lifecycle-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const article = draft.articleId.replaceAll("-", ""); const policyRevision = "c".repeat(64);
    const esJob = `tts-es-${article}-r1-1234abcd`; const enJob = `tts-en-${article}-r1-87654321`;
    queueDatabaseAudio(database, { draft, requests: { es: { sourceRevision: "a".repeat(64) }, en: { sourceRevision: "b".repeat(64) } }, policyRevision, jobIds: { es: esJob, en: enJob } });
    startDatabaseAudio(database, esJob, "worker", new Date("2026-09-09T03:00:00.000Z"), new Date("2026-09-09T02:00:00.000Z"));
    const completed = completeDatabaseAudio(database, { jobId: esJob, result: { locale: "es", sha256: "d".repeat(64) }, artifactPath: "/private/es.mp3", checksumSha256: "d".repeat(64), now: new Date("2026-09-09T02:30:00.000Z") });
    assert.equal(completed.status, "completed"); assert.equal(completed.artifact.status, "accepted");
    const failed = failDatabaseAudio(database, enJob, "worker failed", new Date("2026-09-09T02:30:00.000Z"));
    assert.equal(failed.status, "failed"); assert.equal(failed.artifact.status, "failed");
  } finally { closeDatabase(database); }
});

test("failed audio admits one retry while duplicate active requests remain idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-retry-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const article = draft.articleId.replaceAll("-", ""); const request = { sourceRevision: "a".repeat(64) }; const policyRevision = "b".repeat(64);
    const first = `tts-es-${article}-r1-1234abcd`;
    queueDatabaseAudioLocale(database, { draft, request, locale: "es", policyRevision, jobId: first });
    failDatabaseAudio(database, first, "provider rejected credential");
    const retry = `tts-es-${article}-r1-87654321`;
    let state = queueDatabaseAudioLocale(database, { draft, request, locale: "es", policyRevision, jobId: retry });
    assert.equal(state.jobs.es.jobId, retry); assert.equal(state.jobs.es.status, "queued");
    state = queueDatabaseAudioLocale(database, { draft, request, locale: "es", policyRevision, jobId: `tts-es-${article}-r1-aaaaaaaa` });
    assert.equal(state.jobs.es.jobId, retry);
  } finally { closeDatabase(database); }
});

test("single-locale regeneration preserves the accepted opposite locale", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-audio-regeneration-test-"));
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const article = draft.articleId.replaceAll("-", ""); const policyRevision = "c".repeat(64);
    const initial = { es: `tts-es-${article}-r1-1234abcd`, en: `tts-en-${article}-r1-87654321` };
    queueDatabaseAudio(database, { draft, requests: { es: { sourceRevision: "a".repeat(64) }, en: { sourceRevision: "b".repeat(64) } }, policyRevision, jobIds: initial });
    for (const [locale, jobId, hash] of [["es", initial.es, "d"], ["en", initial.en, "e"]]) {
      startDatabaseAudio(database, jobId, "worker", new Date(Date.now() + 60_000));
      completeDatabaseAudio(database, { jobId, result: { locale, sha256: hash.repeat(64) }, artifactPath: `/private/${locale}.mp3`, checksumSha256: hash.repeat(64) });
    }
    const replacement = `tts-en-${article}-r1-aaaaaaaa`;
    const queued = queueDatabaseAudioLocale(database, { draft, request: { sourceRevision: "f".repeat(64) }, locale: "en", policyRevision, jobId: replacement });
    assert.equal(queued.jobs.es.status, "completed"); assert.equal(queued.jobs.es.jobId, initial.es);
    assert.equal(queued.jobs.en.status, "queued"); assert.equal(queued.jobs.en.jobId, replacement);
  } finally { closeDatabase(database); }
});
