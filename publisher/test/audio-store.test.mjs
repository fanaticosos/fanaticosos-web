import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { databaseAudioStore } from "../lib/audio-store.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

test("SQLite audio store owns state while filesystem carries only worker payloads and immutable audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-store-test-"));
  const queueRoot = join(root, "queue"); const jobsRoot = join(root, "jobs");
  const statesRoot = join(root, "states"); const artifactsRoot = join(root, "artifacts");
  await mkdir(jobsRoot); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} });
    const translation = { status: "completed", draftRevision: 1, sourceRevision: "a".repeat(64), result: { title: "Title", description: "Summary", body: "Article" } };
    const store = databaseAudioStore({ database, queueRoot, jobsRoot, artifactsRoot });
    const queued = await store.queue({ draft, translation, policyRevision: "b".repeat(64), workflow: "preview" });
    assert.equal(queued.status, "queued"); await assert.rejects(access(statesRoot), /ENOENT/);
    for (const locale of ["es", "en"]) {
      const jobId = queued.jobs[locale].jobId;
      await rename(join(queueRoot, jobId), join(jobsRoot, jobId));
      const request = JSON.parse(await readFile(join(jobsRoot, jobId, "request.json"), "utf8"));
      const audioRoot = join(jobsRoot, jobId, "audio"); await mkdir(audioRoot);
      const bytes = Buffer.from(`audio-${locale}`); const file = `${locale}-${draft.articleId}.mp3`;
      await writeFile(join(audioRoot, file), bytes);
      await writeFile(join(audioRoot, "result.json"), JSON.stringify({
        schemaVersion: 1, articleId: draft.articleId, locale, sourceRevision: request.sourceRevision,
        file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
        generatedAt: "2026-09-09T01:00:00.000Z",
      }));
    }
    let completedCount = 0; await store.reconcile({ onComplete: () => { completedCount += 1; } });
    const completed = await store.read(draft.articleId);
    assert.equal(completed.status, "completed"); assert.equal(completedCount, 1);
    assert.equal((await readFile(store.file(completed, "es"))).toString(), "audio-es");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE type = 'audio' AND status = 'accepted'").get().count, 2);
    await store.reconcile({ onComplete: () => { completedCount += 1; } }); assert.equal(completedCount, 1);
    await assert.rejects(access(statesRoot), /ENOENT/);
  } finally { closeDatabase(database); }
});
