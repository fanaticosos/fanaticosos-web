import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { databaseTranslationStore } from "../lib/translation-store.mjs";

const owner = { title: "Título", description: "Descripción", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: {} };

test("SQLite translation store owns state while filesystem carries only worker payloads and artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-store-test-"));
  const queueRoot = join(root, "queue");
  const jobsRoot = join(root, "jobs");
  const statesRoot = join(root, "states");
  const artifactsRoot = join(root, "artifacts");
  await mkdir(jobsRoot);
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const draft = createDatabaseDraft(database, owner);
    const store = databaseTranslationStore({ database, queueRoot, jobsRoot, artifactsRoot });
    const queued = await store.queue({ draft, workflow: "preview" });
    assert.equal(queued.status, "queued");
    await assert.rejects(access(statesRoot), /ENOENT/);
    await rename(join(queueRoot, queued.jobId), join(jobsRoot, queued.jobId));
    const request = JSON.parse(await readFile(join(jobsRoot, queued.jobId, "request.json"), "utf8"));
    await writeFile(join(jobsRoot, queued.jobId, "result.json"), JSON.stringify({
      sourceRevision: queued.sourceRevision,
      segments: request.segments.map(({ id, text }) => ({ id, translation: `EN:${text}` })),
      engine: "qwen", model: "test", generatedAt: "2026-09-09T01:00:00.000Z",
    }));
    let completedCount = 0;
    await store.reconcile({ onComplete: () => { completedCount += 1; } });
    const completed = await store.read(draft.articleId);
    assert.equal(completed.status, "completed");
    assert.equal(completedCount, 1);
    assert.equal((await readFile(completed.artifact.path, "utf8")).includes("EN:Título"), true);
    await store.reconcile({ onComplete: () => { completedCount += 1; } });
    assert.equal(completedCount, 1);
    const corrected = await store.update(draft.articleId, draft.revision, {
      title: "Owner title", description: "Owner description", body: "Owner body",
    }, draft);
    assert.equal(corrected.ownerRevision, 1);
    assert.equal(corrected.result.title, "Owner title");
    await assert.rejects(access(statesRoot), /ENOENT/);
  } finally {
    closeDatabase(database);
  }
});
