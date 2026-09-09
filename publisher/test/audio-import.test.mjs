import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { previewAudioImport } from "../lib/audio-import.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { queueDatabaseTranslation, startDatabaseTranslation, completeDatabaseTranslation } from "../lib/database-translations.mjs";
import { translationRequestForDraft, translationSourceRevision } from "../lib/translation-jobs.mjs";
import { ttsRequestsForDraft } from "../lib/tts-jobs.mjs";

test("audio import preview verifies both locale files and writes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-import-test-"));
  const statesRoot = join(root, "states"); const jobsRoot = join(root, "jobs");
  const databasePath = join(root, "publisher.sqlite"); await mkdir(statesRoot); await mkdir(jobsRoot);
  const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
  const translation = { status: "completed", draftRevision: 1, sourceRevision: translationSourceRevision(draft), result: { title: "Title", description: "Summary", body: "Article" } };
  const translationJob = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
  queueDatabaseTranslation(database, { draft, jobId: translationJob, bodyLayout: translationRequestForDraft(draft).bodyLayout });
  startDatabaseTranslation(database, translationJob, "worker", new Date(Date.now() + 60_000));
  completeDatabaseTranslation(database, { jobId: translationJob, result: translation.result, provenance: {}, artifactPath: "/private/translation.json", checksumSha256: "a".repeat(64) });
  const requests = ttsRequestsForDraft(draft, translation); const jobs = {};
  for (const locale of ["es", "en"]) {
    const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r1-${locale === "es" ? "1234abcd" : "87654321"}`;
    const audioRoot = join(jobsRoot, jobId, "audio"); await mkdir(audioRoot, { recursive: true });
    const bytes = Buffer.from(`audio-${locale}`); const file = `${locale}.mp3`;
    await writeFile(join(audioRoot, file), bytes);
    jobs[locale] = { jobId, status: "completed", result: { locale, file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
  }
  await writeFile(join(statesRoot, `audio-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, status: "completed", policyRevision: "f".repeat(64), sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision }, jobs }));
  closeDatabase(database);
  const preview = await previewAudioImport({ statesRoot, jobsRoot, databasePath });
  assert.equal(preview.total, 2); assert.equal(preview.insert, 2); assert.equal(preview.conflicts, 0);
  assert.equal(preview.current, 2); assert.equal(preview.historic, 0);
  const inspected = await openDatabase(databasePath);
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM jobs WHERE type IN ('tts_es','tts_en')").get().count, 0);
  closeDatabase(inspected);
});

test("audio import preview preserves verified historic dependencies without relabeling them", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-import-historic-test-"));
  const statesRoot = join(root, "states"); const jobsRoot = join(root, "jobs");
  const databasePath = join(root, "publisher.sqlite"); await mkdir(statesRoot); await mkdir(jobsRoot);
  const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
  const translation = { status: "completed", draftRevision: 1, sourceRevision: translationSourceRevision(draft), result: { title: "Title", description: "Summary", body: "Article" } };
  const translationJob = `translation-${draft.articleId.replaceAll("-", "")}-r1-1234abcd`;
  queueDatabaseTranslation(database, { draft, jobId: translationJob, bodyLayout: translationRequestForDraft(draft).bodyLayout });
  startDatabaseTranslation(database, translationJob, "worker", new Date(Date.now() + 60_000));
  completeDatabaseTranslation(database, { jobId: translationJob, result: translation.result, provenance: {}, artifactPath: "/private/translation.json", checksumSha256: "a".repeat(64) });
  const jobs = {}; const historic = { es: "b".repeat(64), en: "c".repeat(64) };
  for (const locale of ["es", "en"]) {
    const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r1-${locale === "es" ? "1234abcd" : "87654321"}`;
    const audioRoot = join(jobsRoot, jobId, "audio"); await mkdir(audioRoot, { recursive: true });
    const bytes = Buffer.from(`historic-audio-${locale}`); const file = `${locale}.mp3`;
    await writeFile(join(audioRoot, file), bytes);
    jobs[locale] = { jobId, status: "completed", result: { locale, file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
  }
  await writeFile(join(statesRoot, `audio-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, status: "completed", policyRevision: "f".repeat(64), sourceRevisions: historic, jobs }));
  closeDatabase(database);
  const preview = await previewAudioImport({ statesRoot, jobsRoot, databasePath });
  assert.equal(preview.current, 0); assert.equal(preview.historic, 2);
  assert.deepEqual(preview.audio.map(({ sourceRevision }) => sourceRevision), [historic.es, historic.en]);
  assert.ok(preview.audio.every(({ sourceCurrent, currentSourceRevision }) => !sourceCurrent && /^[0-9a-f]{64}$/.test(currentSourceRevision)));
});
