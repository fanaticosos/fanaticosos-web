import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

export function ttsPolicyRevision(production, pronunciations, azureEntities = {}, spanishTerms = {}) {
  return digest({ production, pronunciations, azureEntities, spanishTerms });
}

export function narrationText(markdown) {
  return markdown
    .replace(/🐻(?:\uFE0F)?⬇(?:\uFE0F)?/gu, "Bear Down")
    // Emoji are visual decoration. Narrating their Unicode names creates a
    // second, synthetic-sounding voice and duplicates a written “Bear Down.”
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*{}\[\]()#+.!_>-])/g, "$1")
    .trim();
}

function narrationHeading(markdown) {
  return narrationText(markdown).replace(/^(?:[IVXLCDM]+|\d+)[.)]\s+/i, "");
}

function englishNameSuffixes(text) {
  const ordinals = { II: "the Second", III: "the Third", IV: "the Fourth" };
  return text.replace(
    /\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)+)\s+(II|III|IV)\b/gu,
    (_, name, suffix) => `${name} ${ordinals[suffix]}`,
  );
}

function narrationSegments(description, body) {
  const spoken = (text) => englishNameSuffixes(text);
  const segments = [{ id: "description", kind: "description", text: spoken(narrationText(description)) }];
  let sequence = 0;
  for (const part of body.split(/\n\s*\n/)) {
    if (!part.trim()) continue;
    sequence += 1;
    const marker = /^(#{1,6}\s+|>\s*|(?:[-*+]\s+)|(?:\d+[.)]\s+))/.exec(part);
    const kind = marker?.[0]?.startsWith("#") ? "heading" : "paragraph";
    const content = part.slice(marker?.[0]?.length ?? 0);
    segments.push({
      id: `body-${String(sequence).padStart(3, "0")}`,
      kind,
      text: spoken(kind === "heading" ? narrationHeading(content) : narrationText(content)),
    });
  }
  if (segments.length > 250) throw new Error("the article has too many audio segments");
  if (segments.some((segment) => segment.text.length > 8_000)) throw new Error("an article paragraph is too long for audio generation");
  if (segments.reduce((total, segment) => total + segment.text.length, 0) > 100_000) throw new Error("the article is too long for audio generation");
  return segments;
}

export function ttsRequestsForDraft(draft, translation) {
  if (translation.status !== "completed" || translation.draftRevision !== draft.revision) {
    throw new Error("the current draft revision needs an accepted English translation");
  }
  const source = { articleId: draft.articleId, revision: draft.revision, title: draft.title, description: draft.description, body: draft.body };
  const englishSource = { articleId: draft.articleId, revision: draft.revision, ...translation.result };
  return {
    es: {
      schemaVersion: 1, articleId: draft.articleId, locale: "es", sourceRevision: digest(source),
      title: draft.title, segments: narrationSegments(draft.description, draft.body, "es"),
    },
    en: {
      schemaVersion: 1, articleId: draft.articleId, locale: "en", sourceRevision: digest(englishSource),
      title: translation.result.title,
      segments: narrationSegments(translation.result.description, translation.result.body, "en"),
    },
  };
}

export async function queueTts({ draft, translation, queueRoot, statesRoot, policyRevision, workflow = "manual", now = new Date() }) {
  if (ttsQueueBusy) throw new Error("audio generation is already running");
  ttsQueueBusy = true;
  try {
  if (!["manual", "preview"].includes(workflow)) throw new Error("audio workflow is invalid");
  if (!/^[0-9a-f]{64}$/.test(policyRevision ?? "")) throw new Error("TTS policy revision is invalid");
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  const requests = ttsRequestsForDraft(draft, translation);
  const sourceRevisions = { es: requests.es.sourceRevision, en: requests.en.sourceRevision };
  try {
    const existing = JSON.parse(await readFile(statePath, "utf8"));
    if (["queued", "running"].includes(existing.status)) throw new Error("audio generation is already running");
    if (existing.status === "completed" && existing.draftRevision === draft.revision && existing.policyRevision === policyRevision && JSON.stringify(existing.sourceRevisions) === JSON.stringify(sourceRevisions)) throw new Error("this draft revision already has audio for the current TTS policy");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let existingSpanish = { status: "awaiting-upload" };
  try {
    const existing = JSON.parse(await readFile(statePath, "utf8"));
    if (existing.draftRevision === draft.revision && existing.sourceRevisions?.es === sourceRevisions.es && existing.jobs?.es?.status === "completed") existingSpanish = existing.jobs.es;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const jobs = { es: existingSpanish };
  for (const locale of ["en"]) {
    const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
    if (!JOB_ID.test(jobId)) throw new Error("TTS job identity is invalid");
    const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
    await mkdir(temporary, { mode: 0o700 });
    await atomicJson(join(temporary, "request.json"), requests[locale]);
    await rename(temporary, join(queueRoot, jobId));
    jobs[locale] = { jobId, status: "queued" };
  }
  const state = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    status: "queued", workflow, createdAt: now.toISOString(), updatedAt: now.toISOString(), sourceRevisions, policyRevision, jobs,
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
  if (locale !== "en") throw new Error("Spanish audio must be uploaded as an MP3");
  if (!/^[0-9a-f]{64}$/.test(policyRevision ?? "")) throw new Error("TTS policy revision is invalid");
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  const existing = JSON.parse(await readFile(statePath, "utf8"));
  if (existing.status !== "completed" || existing.draftRevision !== draft.revision || existing.jobs?.es?.status !== "completed" || existing.jobs?.en?.status !== "completed") {
    throw new Error("completed bilingual audio is required before regenerating one language");
  }
  const requests = ttsRequestsForDraft(draft, translation);
  const preservedLocale = "es";
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
    status: "queued", workflow: "audio-regeneration", regeneratedLocale: locale,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), policyRevision,
    sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision },
    jobs: { ...existing.jobs, [locale]: { jobId, status: "queued" } },
  };
  await atomicJson(statePath, state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
  } finally {
    ttsQueueBusy = false;
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
    if (!["queued", "running"].includes(state.status)) continue;
    let completed = 0;
    for (const locale of ["es", "en"]) {
      const job = state.jobs[locale];
      if (!job || job.status === "awaiting-upload") continue;
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
        } catch (requestError) {
          if (requestError.code !== "ENOENT") throw requestError;
        }
      }
    }
    state.status = completed === 2 ? "completed" : state.jobs.en?.status === "completed" ? "awaiting-upload" : "running";
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
