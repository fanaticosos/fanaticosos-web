import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { narrationText, queueTts, queueTtsLocale, readTtsState, reconcileTts, ttsPolicyRevision, ttsRequestsForDraft } from "../lib/tts-jobs.mjs";

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

test("TTS policy revision changes when Azure entity pronunciations change", () => {
  const production = { configurationVersion: 5 };
  const pronunciations = { version: 8 };
  const first = ttsPolicyRevision(production, pronunciations, { version: 4 });
  const second = ttsPolicyRevision(production, pronunciations, { version: 5 });
  assert.notEqual(first, second);
});

test("TTS policy revision changes when the Spanish NFL reference changes", () => {
  const production = { configurationVersion: 5 };
  const pronunciations = { version: 8 };
  const entities = { version: 5 };
  const first = ttsPolicyRevision(production, pronunciations, entities, { version: 1 });
  const second = ttsPolicyRevision(production, pronunciations, entities, { version: 2 });
  assert.notEqual(first, second);
});

test("narration text removes Markdown without removing its spoken words", () => {
  assert.equal(narrationText("**necesitan un quarterback**."), "necesitan un quarterback.");
  assert.equal(narrationText("**Go Bears!**"), "Go Bears!");
  assert.equal(narrationText("Un [enlace](https://example.com) y `código`."), "Un enlace y código.");
  assert.equal(narrationText("~~tachado~~ y *énfasis*."), "tachado y énfasis.");
  assert.equal(narrationText("🐻⬇️"), "Bear Down");
  assert.equal(narrationText("**Bear Down.** 🐻🏈"), "Bear Down.");
});

test("TTS requests bind approved Spanish and English text to one revision", () => {
  const requests = ttsRequestsForDraft(draft, translation);
  assert.equal(requests.es.locale, "es");
  assert.equal(requests.en.locale, "en");
  assert.match(requests.en.sourceRevision, /^[0-9a-f]{64}$/);
  assert.notEqual(requests.en.sourceRevision, translation.sourceRevision);
  assert.equal(requests.es.segments[1].text, "Primer cuarto");
  assert.equal(requests.es.segments[0].kind, "description");
  assert.equal(requests.es.segments[1].kind, "heading");
  assert.equal(requests.es.segments[2].kind, "paragraph");
  assert.equal(requests.en.segments[2].text, "Caleb Williams threw a touchdown.");
  const corrected = structuredClone(translation);
  corrected.result.body += " Correction.";
  assert.notEqual(ttsRequestsForDraft(draft, corrected).en.sourceRevision, requests.en.sourceRevision);
});

test("TTS requests never send inline Markdown to either narrator", () => {
  const formattedDraft = {
    ...draft,
    description: "Resumen con **énfasis**.",
    body: "Porque los Bears **necesitan un quarterback**.\n\n**Go Bears!**",
  };
  const formattedTranslation = {
    ...translation,
    result: {
      ...translation.result,
      description: "Summary with **emphasis**.",
      body: "The Bears **need a quarterback**.\n\n**Go Bears!**",
    },
  };
  const requests = ttsRequestsForDraft(formattedDraft, formattedTranslation);
  assert.deepEqual(requests.es.segments.map(({ text }) => text), [
    "Resumen con énfasis.",
    "Porque los Bears necesitan un quarterback.",
    "Go Bears!",
  ]);
  assert.deepEqual(requests.en.segments.map(({ text }) => text), [
    "Summary with emphasis.",
    "The Bears need a quarterback.",
    "Go Bears!",
  ]);
  assert.equal(requests.es.segments.some(({ text }) => text.includes("*")), false);
  assert.equal(requests.en.segments.some(({ text }) => text.includes("*")), false);
});

test("section numbers remain visual and are omitted from bilingual narration", () => {
  const numberedDraft = {
    ...draft,
    body: "## I. El mensaje\n\nTexto I. permanece intacto.\n\n## 2. La respuesta",
  };
  const numberedTranslation = {
    ...translation,
    result: {
      ...translation.result,
      body: "## I. The message\n\nText I. remains intact.\n\n## 2. The response",
    },
  };
  const requests = ttsRequestsForDraft(numberedDraft, numberedTranslation);
  assert.deepEqual(requests.es.segments.map(({ text }) => text), [
    "Resumen del partido.", "El mensaje", "Texto I. permanece intacto.", "La respuesta",
  ]);
  assert.deepEqual(requests.en.segments.map(({ text }) => text), [
    "Game summary.", "The message", "Text I. remains intact.", "The response",
  ]);
});

test("English player-name suffixes are spoken as ordinals", () => {
  const suffixTranslation = {
    ...translation,
    result: {
      ...translation.result,
      body: "Luther Burden III met Robert Griffin II. Rocky III remains a title.",
    },
  };
  const requests = ttsRequestsForDraft(draft, suffixTranslation);
  assert.equal(
    requests.en.segments[1].text,
    "Luther Burden the Third met Robert Griffin the Second. Rocky III remains a title.",
  );
});

test("English TTS waits for the owner-provided Spanish MP3", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const jobsRoot = join(root, "jobs");
  const state = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision });
  assert.equal(state.status, "queued");
  assert.equal(state.policyRevision, policyRevision);
  for (const locale of ["en"]) {
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
  assert.equal(result.status, "awaiting-upload");
  assert.equal(result.jobs.es.status, "awaiting-upload");
  await reconcileTts({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  assert.equal(completed, 0);
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

test("audio queue preserves the automatic preview workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-workflow-"));
  const state = await queueTts({
    draft,
    translation,
    queueRoot: join(root, "queue"),
    statesRoot: join(root, "states"),
    policyRevision,
    workflow: "preview",
  });
  assert.equal(state.workflow, "preview");
});

test("Spanish regeneration is replaced by MP3 upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-es-only-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  await mkdir(statesRoot, { recursive: true });
  const requests = ttsRequestsForDraft(draft, translation);
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, status: "completed",
    policyRevision: "a".repeat(64), sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision },
    jobs: { es: { jobId: "old-es", status: "completed", result: { file: "old-es.mp3" } }, en: { jobId: "old-en", status: "completed", result: { file: "old-en.mp3" } } },
  }));
  await assert.rejects(() => queueTtsLocale({ draft, translation, locale: "es", queueRoot, statesRoot, policyRevision }), /uploaded as an MP3/);
});

test("English regeneration preserves completed Spanish audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-en-only-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  await mkdir(statesRoot, { recursive: true });
  const requests = ttsRequestsForDraft(draft, translation);
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, status: "completed",
    policyRevision: "a".repeat(64), sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision },
    jobs: { es: { jobId: "old-es", status: "completed", result: { file: "old-es.mp3" } }, en: { jobId: "old-en", status: "completed", result: { file: "old-en.mp3" } } },
  }));
  const state = await queueTtsLocale({ draft, translation, locale: "en", queueRoot, statesRoot, policyRevision });
  assert.equal(state.status, "queued");
  assert.equal(state.jobs.es.jobId, "old-es");
  assert.equal(state.jobs.es.status, "completed");
  assert.match(state.jobs.en.jobId, /^tts-en-/);
  assert.equal(state.regeneratedLocale, "en");
});
