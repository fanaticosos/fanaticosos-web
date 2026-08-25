import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { queueTranslation, readTranslationState, reconcileTranslations, translationRequestForDraft, updateTranslationResult } from "../lib/translation-jobs.mjs";

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001", revision: 3,
  title: "Los Bears ganan", description: "Resumen del partido",
  body: "## Primer cuarto\n\nCaleb Williams lanzó un touchdown.\n\n- La defensa respondió.",
};

test("draft becomes ordered translation segments without losing Markdown layout", () => {
  const value = translationRequestForDraft(draft);
  assert.deepEqual(value.request.segments.map(({ id, kind }) => ({ id, kind })), [
    { id: "title", kind: "title" }, { id: "description", kind: "description" },
    { id: "body-001", kind: "heading" }, { id: "body-002", kind: "paragraph" },
    { id: "body-003", kind: "list-item" },
  ]);
  assert.equal(value.request.segments[2].text, "Primer cuarto");
});

test("translation queue and completed result remain private and reconstruct Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-translation-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const jobsRoot = join(root, "jobs");
  const state = await queueTranslation({ draft, queueRoot, statesRoot });
  assert.equal(state.status, "queued");
  assert.equal((await stat(join(queueRoot, state.jobId, "request.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(statesRoot, `${draft.articleId}.json`))).mode & 0o777, 0o600);
  await mkdir(join(jobsRoot, state.jobId), { recursive: true });
  const request = JSON.parse(await readFile(join(queueRoot, state.jobId, "request.json"), "utf8"));
  await writeFile(join(jobsRoot, state.jobId, "result.json"), JSON.stringify({
    sourceRevision: "a".repeat(64),
    segments: request.segments.map((segment) => ({ id: segment.id, translation: `EN:${segment.text}` })),
  }));
  let completed = 0;
  await reconcileTranslations({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  const result = await readTranslationState(statesRoot, draft.articleId);
  assert.equal(result.status, "completed");
  assert.equal(result.result.body, "## EN:Primer cuarto\n\nEN:Caleb Williams lanzó un touchdown.\n\n- EN:La defensa respondió.");
  await reconcileTranslations({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  assert.equal(completed, 1);
  const corrected = await updateTranslationResult(statesRoot, draft.articleId, draft.revision, {
    title: "Owner title", description: "Owner description", body: "Owner body",
  });
  assert.equal(corrected.result.title, "Owner title");
  assert.equal(corrected.ownerRevision, 1);
  assert.ok(corrected.ownerReviewedAt);
});

test("translation queue records the requested automatic preview workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-translation-workflow-"));
  const state = await queueTranslation({
    draft,
    queueRoot: join(root, "queue"),
    statesRoot: join(root, "states"),
    workflow: "preview",
  });
  assert.equal(state.workflow, "preview");
  await assert.rejects(
    queueTranslation({
      draft: { ...draft, articleId: "00000000-0000-4000-8000-000000000002" },
      queueRoot: join(root, "queue"),
      statesRoot: join(root, "states"),
      workflow: "publish",
    }),
    /workflow is invalid/,
  );
});

test("simultaneous translation requests admit only one model job", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-race-"));
  const queueRoot = join(root, "queue"); const statesRoot = join(root, "states");
  const results = await Promise.allSettled([
    queueTranslation({ draft, queueRoot, statesRoot }),
    queueTranslation({ draft, queueRoot, statesRoot }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
});
