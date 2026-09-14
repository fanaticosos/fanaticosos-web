import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { audioPolicyIsCurrent, narrationText, normalizePolicyRevisions, queueTts, queueTtsLocale, readTtsState, reconcileTts, sanitizeWorkerProgress, ttsPolicyRevision, ttsPolicyRevisions, ttsRequestsForDraft } from "../lib/tts-jobs.mjs";

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

test("legacy combined TTS policy revision is still computed for audio generated before the split", () => {
  const production = { configurationVersion: 5 };
  const first = ttsPolicyRevision(production, { version: 7 });
  const second = ttsPolicyRevision(production, { version: 8 });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.notEqual(ttsPolicyRevision(production, { version: 7 }, { version: 4 }), ttsPolicyRevision(production, { version: 7 }, { version: 5 }));
});

const approved = (entry) => ({ reason: "r", source: "s", sourceType: "owner-review", status: "approved", ...entry });
const policyInputs = () => ({
  production: { configurationVersion: 9, pronunciationVersion: 14, voices: { en: "af_heart" } },
  elevenLabs: { version: 5, pronunciationVersion: 14, voiceName: "Will - Relaxed Optimist", voiceSettings: { stability: 0.5 } },
  pronunciations: {
    version: 14,
    overrides: {
      es: [approved({ category: "team", canonical: "Bears", aliases: [], synthesis: { profile: "latino-em_alex", type: "text-substitution", text: "Bers" } })],
      en: [approved({ category: "player", canonical: "Coby Bryant", aliases: [], synthesis: { profile: "american-af-heart", type: "text-substitution", text: "Coe bee Bryant" } })],
    },
    providerOverrides: { elevenlabs: { es: [approved({ written: "Bears", synthesisText: "Bers" })], en: [] } },
  },
});

test("per-locale TTS policy revisions are separate sha256 values", () => {
  const revisions = ttsPolicyRevisions(policyInputs());
  assert.match(revisions.es, /^[0-9a-f]{64}$/);
  assert.match(revisions.en, /^[0-9a-f]{64}$/);
  assert.notEqual(revisions.es, revisions.en);
  assert.deepEqual(ttsPolicyRevisions(policyInputs()), revisions);
});

test("preflight references and pronunciation version bumps never invalidate generated audio", () => {
  const base = ttsPolicyRevisions(policyInputs());
  const bumped = policyInputs();
  bumped.pronunciations.version = 15;
  bumped.production.pronunciationVersion = 15;
  bumped.elevenLabs.pronunciationVersion = 15;
  assert.deepEqual(ttsPolicyRevisions(bumped), base);
  const reordered = policyInputs();
  reordered.production = { voices: { en: "af_heart" }, pronunciationVersion: 14, configurationVersion: 9 };
  assert.deepEqual(ttsPolicyRevisions(reordered), base);
  const pending = policyInputs();
  pending.pronunciations.providerOverrides.elevenlabs.es.push({ ...approved({ written: "Packers", synthesisText: "Pakers" }), status: "pending" });
  assert.deepEqual(ttsPolicyRevisions(pending), base);
});

test("each locale's TTS policy only follows its own generation inputs", () => {
  const base = ttsPolicyRevisions(policyInputs());
  const spanishVoice = policyInputs();
  spanishVoice.elevenLabs.voiceSettings.stability = 0.6;
  assert.notEqual(ttsPolicyRevisions(spanishVoice).es, base.es);
  assert.equal(ttsPolicyRevisions(spanishVoice).en, base.en);
  const spanishPronunciation = policyInputs();
  spanishPronunciation.pronunciations.providerOverrides.elevenlabs.es[0].synthesisText = "Beers";
  assert.notEqual(ttsPolicyRevisions(spanishPronunciation).es, base.es);
  assert.equal(ttsPolicyRevisions(spanishPronunciation).en, base.en);
  const englishVoice = policyInputs();
  englishVoice.production.voices.en = "am_adam";
  assert.equal(ttsPolicyRevisions(englishVoice).es, base.es);
  assert.notEqual(ttsPolicyRevisions(englishVoice).en, base.en);
  const englishPronunciation = policyInputs();
  englishPronunciation.pronunciations.overrides.en[0].synthesis.text = "Cobee Bryant";
  assert.equal(ttsPolicyRevisions(englishPronunciation).es, base.es);
  assert.notEqual(ttsPolicyRevisions(englishPronunciation).en, base.en);
  const sharedSpanish = policyInputs();
  sharedSpanish.pronunciations.overrides.es[0].synthesis.text = "Bears";
  assert.deepEqual(ttsPolicyRevisions(sharedSpanish), base);
});

test("audio policy currency accepts per-locale, legacy, and string revisions and ignores uploads", () => {
  const es = "1".repeat(64); const en = "2".repeat(64); const legacy = "3".repeat(64);
  const current = { es, en, legacy };
  assert.equal(audioPolicyIsCurrent({ jobs: { es: { policyRevision: es } } }, "es", current), true);
  assert.equal(audioPolicyIsCurrent({ policyRevisions: { en } }, "en", current), true);
  assert.equal(audioPolicyIsCurrent({ policyRevision: legacy }, "es", current), true);
  assert.equal(audioPolicyIsCurrent({ policyRevision: legacy }, "en", current), true);
  assert.equal(audioPolicyIsCurrent({ policyRevision: "4".repeat(64) }, "es", current), false);
  assert.equal(audioPolicyIsCurrent({ jobs: { es: { policyRevision: en } } }, "es", current), false);
  assert.equal(audioPolicyIsCurrent({ jobs: { es: { policyRevision: "old", uploaded: true } } }, "es", current), true);
  assert.equal(audioPolicyIsCurrent({ policyRevision: "abc" }, "es", "abc"), true);
  assert.equal(audioPolicyIsCurrent({}, "es", current), false);
  assert.deepEqual(normalizePolicyRevisions(es), { es, en: es });
  assert.deepEqual(normalizePolicyRevisions({ es, en, legacy }), { es, en });
  assert.throws(() => normalizePolicyRevisions({ es }), /invalid/);
  assert.throws(() => normalizePolicyRevisions("short"), /invalid/);
});

test("queued audio records the policy revision of each locale", async () => {
  const queueRoot = await mkdtemp(join(tmpdir(), "tts-policy-queue-"));
  const statesRoot = await mkdtemp(join(tmpdir(), "tts-policy-states-"));
  const es = "5".repeat(64); const en = "6".repeat(64);
  const state = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision: { es, en, legacy: "7".repeat(64) } });
  assert.deepEqual(state.policyRevisions, { es, en });
  assert.equal(state.policyRevision, undefined);
  assert.equal(state.jobs.es.policyRevision, es);
  assert.equal(state.jobs.en.policyRevision, en);
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
  assert.equal(requests.es.segments[0].text, "Primer cuarto");
  assert.equal(requests.es.segments[0].kind, "narrative");
  assert.equal(requests.es.segments[1].kind, "narrative");
  assert.equal(requests.en.segments[1].text, "Caleb Williams threw a touchdown.");
  const corrected = structuredClone(translation);
  corrected.result.body += " Correction.";
  assert.notEqual(ttsRequestsForDraft(draft, corrected).en.sourceRevision, requests.en.sourceRevision);
});

test("explicit narration scripts isolate audio from editorial article changes", () => {
  const scriptedDraft = { ...draft, narrationEs: "Guion español.\n<pause=0.7s>\nFinal." , narrationEn: "English script.\n<pause=0.9s>\nEnd." };
  const first = ttsRequestsForDraft(scriptedDraft, translation);
  const edited = ttsRequestsForDraft({ ...scriptedDraft, revision: 5, body: "Artículo editorial completamente modificado." }, { ...translation, draftRevision: 5 });
  assert.equal(edited.es.sourceRevision, first.es.sourceRevision);
  assert.equal(edited.en.sourceRevision, first.en.sourceRevision);
  assert.equal(first.es.segments[0].pauseAfterMs, 700);
  assert.equal(first.en.segments[0].pauseAfterMs, 900);
});

test("SEO and social summaries are never narrated or included in TTS source revisions", () => {
  const requests = ttsRequestsForDraft(draft, translation);
  const changedDraft = { ...draft, description: "Un resumen completamente diferente." };
  const changedTranslation = structuredClone(translation);
  changedTranslation.result.description = "A completely different summary.";
  const changed = ttsRequestsForDraft(changedDraft, changedTranslation);
  assert.equal(changed.es.sourceRevision, requests.es.sourceRevision);
  assert.equal(changed.en.sourceRevision, requests.en.sourceRevision);
  assert.equal(requests.es.segments.some(({ text }) => text.includes("Resumen")), false);
  assert.equal(requests.en.segments.some(({ text }) => text.includes("summary")), false);
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
    "Porque los Bears necesitan un quarterback.",
    "Go Bears!",
  ]);
  assert.deepEqual(requests.en.segments.map(({ text }) => text), [
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
    "El mensaje", "Texto I. permanece intacto.", "La respuesta",
  ]);
  assert.deepEqual(requests.en.segments.map(({ text }) => text), [
    "The message", "Text I. remains intact.", "The response",
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
    requests.en.segments[0].text,
    "Luther Burden the Third met Robert Griffin the Second. Rocky III remains a title.",
  );
});

test("bilingual TTS queues Spanish and English automatically", async () => {
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
  assert.equal(result.status, "running");
  assert.equal(result.jobs.es.status, "queued");
  assert.match(result.jobs.es.jobId, /^tts-es-/);
  assert.equal(result.jobs.es.createdAt, result.createdAt);
  assert.equal(result.jobs.en.createdAt, result.createdAt);
  await reconcileTts({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  assert.equal(completed, 0);
  await assert.rejects(
    () => queueTts({
      draft,
      translation,
      queueRoot,
      statesRoot,
      policyRevision: "e".repeat(64),
    }),
    /audio generation is already running/,
  );
});

test("running Spanish audio exposes sanitized worker progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-progress-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const jobsRoot = join(root, "jobs");
  const state = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision });
  const job = state.jobs.es;
  await mkdir(join(jobsRoot, job.jobId), { recursive: true });
  await writeFile(join(jobsRoot, job.jobId, "request.json"), "{}\n");
  await writeFile(join(jobsRoot, job.jobId, "progress.json"), JSON.stringify({
    schemaVersion: 1, stage: "generating", totalChunks: 10, completedChunks: 4,
    cacheHits: 3, generatedChunks: 1, updatedAt: "2026-09-14T20:46:00Z",
  }));
  await reconcileTts({ statesRoot, jobsRoot });
  const reconciled = await readTtsState(statesRoot, draft.articleId);
  assert.equal(reconciled.jobs.es.status, "running");
  assert.equal(reconciled.jobs.es.progress.completedChunks, 4);
  assert.equal(reconciled.jobs.es.progress.cacheHits, 3);
});

test("worker progress is sanitized to stage, counters, and quota numbers", () => {
  const base = { schemaVersion: 1, stage: "preflight", totalChunks: 10, completedChunks: 0, cacheHits: 3, generatedChunks: 0, updatedAt: "2026-09-14T20:46:00Z" };
  const sanitized = sanitizeWorkerProgress({ ...base, text: "narración privada", quota: { requiredCharacters: 12_345, accountRemaining: 68, keyLimit: null, keyUsedThisCycle: 7, apiKey: "secret" } });
  assert.deepEqual(sanitized, { ...base, quota: { requiredCharacters: 12_345, accountRemaining: 68, keyUsedThisCycle: 7 } });
  assert.equal(sanitizeWorkerProgress({ ...base, stage: "unknown" }), null);
  assert.equal(sanitizeWorkerProgress({ ...base, completedChunks: 11 }), null);
  assert.equal(sanitizeWorkerProgress({ ...base, quota: { requiredCharacters: "12" } }).quota, undefined);
  assert.equal(sanitizeWorkerProgress(null), null);
});

test("English completion is reconciled after Spanish is uploaded first", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-awaiting-english-"));
  const statesRoot = join(root, "states");
  const jobsRoot = join(root, "jobs");
  const englishJobId = "tts-en-awaiting-english";
  const englishAudioRoot = join(jobsRoot, englishJobId, "audio");
  await mkdir(statesRoot, { recursive: true });
  await mkdir(englishAudioRoot, { recursive: true });
  await writeFile(join(englishAudioRoot, "en.mp3"), "audio");
  await writeFile(join(englishAudioRoot, "result.json"), JSON.stringify({ file: "en.mp3", sizeBytes: 5 }));
  await writeFile(join(statesRoot, `audio-${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1,
    articleId: draft.articleId,
    draftRevision: draft.revision,
    status: "awaiting-english",
    createdAt: new Date().toISOString(),
    jobs: {
      es: { jobId: "upload-es", status: "completed", result: { file: "es.mp3" } },
      en: { jobId: englishJobId, status: "queued" },
    },
  }));
  let completed = 0;
  await reconcileTts({ statesRoot, jobsRoot, onComplete: () => { completed += 1; } });
  const result = await readTtsState(statesRoot, draft.articleId);
  assert.equal(result.status, "completed");
  assert.equal(result.jobs.en.status, "completed");
  assert.equal(completed, 1);
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

test("simultaneous audio requests admit only one English TTS job", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-tts-race-"));
  const queueRoot = join(root, "queue"); const statesRoot = join(root, "states");
  const results = await Promise.allSettled([
    queueTts({ draft, translation, queueRoot, statesRoot, policyRevision }),
    queueTts({ draft, translation, queueRoot, statesRoot, policyRevision }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
});

test("Spanish regeneration preserves completed English audio", async () => {
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
  const state = await queueTtsLocale({ draft, translation, locale: "es", queueRoot, statesRoot, policyRevision });
  assert.equal(state.status, "queued");
  assert.equal(state.jobs.en.jobId, "old-en");
  assert.equal(state.jobs.en.status, "completed");
  assert.match(state.jobs.es.jobId, /^tts-es-/);
  assert.equal(state.jobs.es.createdAt, state.createdAt);
  assert.equal(state.regeneratedLocale, "es");
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
  assert.equal(state.jobs.en.createdAt, state.createdAt);
  assert.equal(state.regeneratedLocale, "en");
});
