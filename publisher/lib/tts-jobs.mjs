import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { translationSourceRevision } from "./translation-jobs.mjs";
import { markdownToNarrationScript, narrationSegmentsFromScript, normalizeNarrationCadence, normalizeNarrationScript, plainNarrationText } from "./narration-scripts.mjs";

const JOB_TIMEOUT_MS = 17 * 60 * 1000;
const JOB_ID = /^tts-(es|en)-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
let ttsQueueBusy = false;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const SHA256 = /^[0-9a-f]{64}$/;
const LOCALES = ["es", "en"];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

// Legacy combined revision. It hashed preflight references (NFL entity
// database, Azure entities, Spanish terms) together with generation settings,
// so a roster update marked every accepted audio stale. It is kept only so
// audio generated before the split is still recognised as current.
export function ttsPolicyRevision(production, pronunciations, azureEntities = {}, spanishTerms = {}, spanishProvider = {}) {
  return digest({ production, pronunciations, azureEntities, spanishTerms, spanishProvider });
}

function withoutPronunciationVersion(configuration) {
  const { pronunciationVersion, ...rest } = configuration ?? {};
  return rest;
}

function approvedProviderPronunciations(pronunciations, provider, locale) {
  return (pronunciations?.providerOverrides?.[provider]?.[locale] ?? [])
    .filter((entry) => entry?.status === "approved")
    .map(({ written, synthesisText }) => ({ written, synthesisText }))
    .sort((left, right) => left.written.localeCompare(right.written));
}

function approvedSharedPronunciations(pronunciations, locale) {
  return (pronunciations?.overrides?.[locale] ?? [])
    .filter((entry) => entry?.status === "approved")
    .map(({ canonical, synthesis, aliases }) => ({
      canonical, text: synthesis?.text ?? null,
      aliases: (aliases ?? []).map(({ written, synthesisText }) => ({ written, synthesisText })),
    }))
    .sort((left, right) => left.canonical.localeCompare(right.canonical));
}

// Per-locale generation policy. Each locale's revision covers only what its
// worker actually reads: the Spanish ElevenLabs worker uses the ElevenLabs
// configuration and the approved ElevenLabs Spanish substitutions; the English
// Kokoro worker uses the production configuration and the approved shared
// English substitutions. Preflight references never enter, and the
// pronunciation version counter is excluded because the substitutions
// themselves are hashed.
export function ttsPolicyRevisions({ production = {}, pronunciations = {}, elevenLabs = {} } = {}) {
  return {
    es: canonicalDigest({
      provider: "elevenlabs",
      configuration: withoutPronunciationVersion(elevenLabs),
      pronunciations: approvedProviderPronunciations(pronunciations, "elevenlabs", "es"),
    }),
    en: canonicalDigest({
      provider: "kokoro",
      configuration: withoutPronunciationVersion(production),
      pronunciations: approvedSharedPronunciations(pronunciations, "en"),
    }),
  };
}

// Accept the historical single string or the per-locale object everywhere a
// policy revision is stored, so callers and tests written for either shape work.
export function normalizePolicyRevisions(value) {
  if (typeof value === "string") {
    if (!SHA256.test(value)) throw new Error("TTS policy revision is invalid");
    return { es: value, en: value };
  }
  if (value && typeof value === "object") {
    const normalized = {};
    for (const locale of LOCALES) {
      if (!SHA256.test(value[locale] ?? "")) throw new Error("TTS policy revision is invalid");
      normalized[locale] = value[locale];
    }
    return normalized;
  }
  throw new Error("TTS policy revision is invalid");
}

export function policyRevisionFor(value, locale) {
  if (!LOCALES.includes(locale)) throw new Error("audio locale is invalid");
  return normalizePolicyRevisions(value)[locale];
}

export function storedAudioPolicyRevision(audio, locale) {
  return audio?.jobs?.[locale]?.policyRevision ?? audio?.policyRevisions?.[locale] ?? audio?.policyRevision;
}

// Owner-uploaded audio never depends on synthesis policy. Generated audio is
// current when its stored revision equals the locale's current revision, or the
// legacy combined revision that predates the per-locale split.
export function audioPolicyIsCurrent(audio, locale, current) {
  if (audio?.jobs?.[locale]?.uploaded) return true;
  const stored = storedAudioPolicyRevision(audio, locale);
  if (stored === undefined || stored === null) return false;
  if (typeof current === "string") return stored === current;
  if (!current || typeof current !== "object") return false;
  return stored === current[locale] || (typeof current.legacy === "string" && stored === current.legacy);
}

export function narrationText(markdown) {
  return plainNarrationText(markdown);
}

function englishNameSuffixes(text) {
  const ordinals = { II: "the Second", III: "the Third", IV: "the Fourth" };
  return text.replace(
    /\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)+)\s+(II|III|IV)\b/gu,
    (_, name, suffix) => `${name} ${ordinals[suffix]}`,
  );
}

export function ttsRequestsForDraft(draft, translation) {
  const translationMatchesDraft = translation.draftRevision === draft.revision
    || translation.sourceRevision === translationSourceRevision(draft);
  if (translation.status !== "completed" || !translationMatchesDraft) {
    throw new Error("the current draft revision needs an accepted English translation");
  }
  const spanishScript = normalizeNarrationCadence(normalizeNarrationScript(draft.narrationEs ?? "")
    || markdownToNarrationScript(draft.body, narrationText, { quoteCadence: true }));
  const englishScript = normalizeNarrationScript(draft.narrationEn ?? "")
    || normalizeNarrationScript(translation.result.narrationScript ?? "")
    || markdownToNarrationScript(translation.result.body, narrationText);
  const spanishSegments = narrationSegmentsFromScript(spanishScript);
  const englishSegments = narrationSegmentsFromScript(englishScript)
    .map((segment) => ({ ...segment, text: englishNameSuffixes(segment.text) }));
  const source = { articleId: draft.articleId, title: draft.title, narrationScript: spanishScript };
  const englishSource = { articleId: draft.articleId, title: translation.result.title, narrationScript: englishScript };
  return {
    es: {
      schemaVersion: 1, articleId: draft.articleId, locale: "es", sourceRevision: digest(source),
      title: draft.title, narrationScript: spanishScript, segments: spanishSegments,
    },
    en: {
      schemaVersion: 1, articleId: draft.articleId, locale: "en", sourceRevision: digest(englishSource),
      title: translation.result.title,
      narrationScript: englishScript, segments: englishSegments,
    },
  };
}

export async function queueTts({ draft, translation, queueRoot, statesRoot, policyRevision, workflow = "manual", now = new Date() }) {
  if (ttsQueueBusy) throw new Error("audio generation is already running");
  ttsQueueBusy = true;
  try {
  if (!["manual", "preview"].includes(workflow)) throw new Error("audio workflow is invalid");
  const policyRevisions = normalizePolicyRevisions(policyRevision);
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  const requests = ttsRequestsForDraft(draft, translation);
  const sourceRevisions = { es: requests.es.sourceRevision, en: requests.en.sourceRevision };
  try {
    const existing = JSON.parse(await readFile(statePath, "utf8"));
    if (["queued", "running"].includes(existing.status)) throw new Error("audio generation is already running");
    const policyUnchanged = LOCALES.every((locale) => storedAudioPolicyRevision(existing, locale) === policyRevisions[locale]);
    if (existing.status === "completed" && existing.draftRevision === draft.revision && policyUnchanged && JSON.stringify(existing.sourceRevisions) === JSON.stringify(sourceRevisions)) throw new Error("this draft revision already has audio for the current TTS policy");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const jobs = {};
  for (const locale of ["es", "en"]) {
    const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
    if (!JOB_ID.test(jobId)) throw new Error("TTS job identity is invalid");
    const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
    await mkdir(temporary, { mode: 0o700 });
    await atomicJson(join(temporary, "request.json"), requests[locale]);
    await rename(temporary, join(queueRoot, jobId));
    jobs[locale] = { jobId, status: "queued", createdAt: now.toISOString(), policyRevision: policyRevisions[locale] };
  }
  const state = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    status: "queued", workflow, createdAt: now.toISOString(), updatedAt: now.toISOString(), sourceRevisions,
    ...(typeof policyRevision === "string" ? { policyRevision } : {}), policyRevisions, jobs,
  };
  await atomicJson(statePath, state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
  } finally {
    ttsQueueBusy = false;
  }
}

export async function queueTtsLocale({ draft, translation, locale, queueRoot, statesRoot, policyRevision, now = new Date() }) {
  if (ttsQueueBusy) throw new Error("audio generation is already running");
  ttsQueueBusy = true;
  try {
  if (!["es", "en"].includes(locale)) throw new Error("audio locale is invalid");
  const policyRevisions = normalizePolicyRevisions(policyRevision);
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  const existing = JSON.parse(await readFile(statePath, "utf8"));
  const requests = ttsRequestsForDraft(draft, translation);
  const preservedLocale = locale === "es" ? "en" : "es";
  if (existing.jobs?.[preservedLocale]?.status !== "completed") throw new Error(`completed ${preservedLocale} audio is required`);
  if (existing.sourceRevisions?.[preservedLocale] !== requests[preservedLocale].sourceRevision) {
    throw new Error("the preserved audio is stale; regenerate both audios");
  }
  const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
  if (!JOB_ID.test(jobId)) throw new Error("TTS job identity is invalid");
  const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { mode: 0o700 });
  await atomicJson(join(temporary, "request.json"), requests[locale]);
  await rename(temporary, join(queueRoot, jobId));
  const state = {
    ...existing,
    status: "queued", workflow: existing.status === "awaiting-upload" && locale === "es" && existing.workflow === "preview" ? "preview" : "audio-regeneration", regeneratedLocale: locale,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    ...(typeof policyRevision === "string" ? { policyRevision } : {}),
    policyRevisions: { ...(existing.policyRevisions ?? {}), [locale]: policyRevisions[locale] },
    sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision },
    jobs: { ...existing.jobs, [locale]: { jobId, status: "queued", createdAt: now.toISOString(), policyRevision: policyRevisions[locale] } },
  };
  await atomicJson(statePath, state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
  } finally {
    ttsQueueBusy = false;
  }
}

const PROGRESS_STAGES = ["preflight", "generating", "assembling", "completed"];
const QUOTA_FIELDS = ["requiredCharacters", "accountRemaining", "keyLimit", "keyUsedThisCycle"];

// Sanitized worker progress: only stage, block counters, and quota numbers.
// Anything else the worker might write is dropped before it reaches the UI.
export function sanitizeWorkerProgress(progress) {
  if (
    progress?.schemaVersion !== 1
    || !PROGRESS_STAGES.includes(progress.stage)
    || !Number.isInteger(progress.totalChunks)
    || !Number.isInteger(progress.completedChunks)
    || progress.totalChunks <= 0
    || progress.completedChunks < 0
    || progress.completedChunks > progress.totalChunks
  ) return null;
  const sanitized = {
    schemaVersion: 1, stage: progress.stage,
    totalChunks: progress.totalChunks, completedChunks: progress.completedChunks,
    ...(Number.isInteger(progress.cacheHits) ? { cacheHits: progress.cacheHits } : {}),
    ...(Number.isInteger(progress.generatedChunks) ? { generatedChunks: progress.generatedChunks } : {}),
    ...(typeof progress.updatedAt === "string" ? { updatedAt: progress.updatedAt } : {}),
  };
  if (progress.quota && typeof progress.quota === "object") {
    const quota = Object.fromEntries(QUOTA_FIELDS.filter((name) => Number.isInteger(progress.quota[name])).map((name) => [name, progress.quota[name]]));
    if (Object.keys(quota).length) sanitized.quota = quota;
  }
  return sanitized;
}

export async function readWorkerProgress(jobsRoot, jobId) {
  try {
    return sanitizeWorkerProgress(JSON.parse(await readFile(join(jobsRoot, jobId, "progress.json"), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return null;
  }
}

export async function readTtsState(statesRoot, articleId) {
  return JSON.parse(await readFile(join(statesRoot, `audio-${articleId}.json`), "utf8"));
}

export async function reconcileTts({ statesRoot, jobsRoot, onComplete, onFailure, now = new Date() }) {
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const names = (await readdir(statesRoot)).filter((name) => /^audio-[0-9a-f-]{36}\.json$/.test(name));
  for (const name of names) {
    const path = join(statesRoot, name);
    const state = JSON.parse(await readFile(path, "utf8"));
    if (!["queued", "running", "awaiting-english"].includes(state.status)) continue;
    let completed = 0;
    for (const locale of ["es", "en"]) {
      const job = state.jobs[locale];
      if (!job) continue;
      if (job.status === "completed") { completed += 1; continue; }
      try {
        const result = JSON.parse(await readFile(join(jobsRoot, job.jobId, "audio", "result.json"), "utf8"));
        const audioPath = join(jobsRoot, job.jobId, "audio", basename(result.file));
        const metadata = await stat(audioPath);
        if (!metadata.isFile() || metadata.size !== result.sizeBytes) throw new Error("audio result file is invalid");
        job.status = "completed";
        job.result = result;
        completed += 1;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        try {
          await readFile(join(jobsRoot, job.jobId, "request.json"));
          job.status = "running";
          const progress = await readWorkerProgress(jobsRoot, job.jobId);
          if (progress) job.progress = progress;
        } catch (requestError) {
          if (requestError.code !== "ENOENT") throw requestError;
        }
      }
    }
    state.status = completed === 2 ? "completed" : "running";
    if (state.status === "running" && now.getTime() - new Date(state.createdAt).getTime() > JOB_TIMEOUT_MS) {
      state.status = "failed";
      state.error = "La generación de audio excedió su límite automático y fue detenida.";
    }
    state.updatedAt = now.toISOString();
    await atomicJson(path, state);
    if (state.status === "completed") await onComplete?.(state);
    if (state.status === "failed") await onFailure?.(state);
  }
}

export function audioFileForState(state, locale, jobsRoot) {
  if (!["es", "en"].includes(locale) || state.jobs?.[locale]?.status !== "completed") throw new Error("audio is not ready");
  const job = state.jobs[locale];
  return join(jobsRoot, job.jobId, "audio", basename(job.result.file));
}
