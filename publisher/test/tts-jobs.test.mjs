import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { audioFileForState, queueTts, readTtsState, reconcileTts, ttsPolicyRevision, ttsRequestsForDraft } from "../lib/tts-jobs.mjs";

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001", revision: 4,
  title: "Los Bears ganan", description: "Resumen del partido.",
  body: "## Primer cuarto\n\nCaleb Williams lanzó un touchdown.",
};
const translation = {
  status: "completed", draftRevision: 4, sourceRevision: "a".repeat(64),
  result: { title: "The Bears win", description: "Game summary.", body: "## First quarter\n\nCaleb Williams threw a touchdown." },
};
const policyRevision = "f".repeat(64);

test("TTS policy revision changes when pronunciation policy changes", () => {
  const production = { configurationVersion: 5 };
  const first = ttsPolicyRevision(production, { version: 7 });
  const second = ttsPolicyRevision(production, { version: 8 });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});

test("TTS requests bind approved Spanish and English text to one revision", () => {
  const requests = ttsRequestsForDraft(draft, translation);
  assert.equal(requests.es.locale, "es");
  assert.equal(requests.en.locale, "en");
  assert.match(requests.en.sourceRevision, /^[0-9a-f]{64}$/);
  assert.notEqual(requests.en.sourceRevision, translation.sourceRevision);
  assert.equal(requests.es.segments[1].text, "Primer cuarto");
  assert.equal(requests.en.segments[2].text, "Caleb Williams threw a touchdown.");
  const corrected = structuredClone(translation);
  corrected.result.body += " Correction.";
  assert.notEqual(ttsRequestsForDraft(draft, corrected).en.sourceRevision, requests.en.sourceRevision);
});

test("two private TTS jobs reconcile only after both MP3 files validate", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const jobsRoot = join(root, "jobs");
  const state = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision });
  assert.equal(state.status, "queued");
  assert.equal(state.policyRevision, policyRevision);
  for (const locale of ["es", "en"]) {
    const job = state.jobs[locale];
    assert.equal((await stat(join(queueRoot, job.jobId, "request.json"))).mode & 0o777, 0o600);
    const audioRoot = join(jobsRoot, job.jobId, "audio");
    await mkdir(audioRoot, { recursive: true });
    const file = `${locale}-${draft.articleId}.mp3`;
    await writeFile(join(audioRoot, file), "audio");
    await writeFile(join(audioRoot, "result.json"), JSON.stringify({ file, sizeBytes: 5 }));
  }
  let completed = 0;
  await reconcileTts({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  const result = await readTtsState(statesRoot, draft.articleId);
  assert.equal(result.status, "completed");
  assert.equal(audioFileForState(result, "es", jobsRoot).endsWith(`es-${draft.articleId}.mp3`), true);
  await reconcileTts({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  assert.equal(completed, 1);
  const regenerated = await queueTts({
    draft,
    translation,
    queueRoot,
    statesRoot,
    policyRevision: "e".repeat(64),
  });
  assert.equal(regenerated.status, "queued");
  assert.equal(regenerated.policyRevision, "e".repeat(64));
});
