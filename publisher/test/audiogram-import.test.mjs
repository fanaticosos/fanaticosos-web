import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyAudiogramImport, previewAudiogramImport } from "../lib/audiogram-import.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

test("audiogram import preview verifies completed video artifacts and writes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "audiogram-import-test-")); const statesRoot = join(root, "states"); const jobsRoot = join(root, "jobs");
  const databasePath = join(root, "publisher.sqlite"); const database = await openDatabase(databasePath);
  const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} }); closeDatabase(database);
  const jobId = `audiogram-es-${draft.articleId.replaceAll("-", "")}-r1-abcdef12`; const video = Buffer.from("video"); const sha256 = createHash("sha256").update(video).digest("hex");
  await mkdir(statesRoot); await mkdir(join(jobsRoot, jobId, "video"), { recursive: true });
  await writeFile(join(jobsRoot, jobId, "video", "audiogram.mp4"), video);
  await writeFile(join(statesRoot, `audiogram-${draft.articleId}.json`), JSON.stringify({ schemaVersion: 1, articleId: draft.articleId, draftRevision: 1, jobId, status: "completed", audioSha256: "a".repeat(64), createdAt: "2026-09-09T01:00:00Z", updatedAt: "2026-09-09T01:01:00Z", result: { file: "audiogram.mp4", sizeBytes: video.length, sha256, generatedAt: "2026-09-09T01:01:00Z" } }));
  assert.deepEqual(await previewAudiogramImport({ databasePath, statesRoot, jobsRoot }), { count: 1, completed: 1, failed: 0, active: 0, verifiedArtifacts: 1 });
  const inspected = new (await import("node:sqlite")).DatabaseSync(databasePath, { readOnly: true });
  assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE type = 'audiogram'").get().count, 0); inspected.close();
  const applied = await applyAudiogramImport({ databasePath, statesRoot, jobsRoot, artifactsRoot: join(root, "artifacts") });
  assert.deepEqual(applied, { inserted: 1, unchanged: 0 });
  assert.deepEqual(await applyAudiogramImport({ databasePath, statesRoot, jobsRoot, artifactsRoot: join(root, "artifacts") }), { inserted: 0, unchanged: 1 });
});
