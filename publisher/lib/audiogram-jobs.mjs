import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { slugify } from "./release.mjs";

const JOB_TIMEOUT_MS = 35 * 60 * 1000;
const JOB_ID = /^audiogram-es-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
let audiogramQueueBusy = false;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export async function queueAudiogram({ draft, audio, queueRoot, statesRoot, now = new Date() }) {
  if (audiogramQueueBusy) throw new Error("Ya hay un video preparándose.");
  audiogramQueueBusy = true;
  try {
  if (audio.status !== "completed" || audio.draftRevision !== draft.revision || audio.jobs?.es?.status !== "completed") {
    throw new Error("completed current Spanish audio is required for the audiogram");
  }
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  try {
    const existing = JSON.parse(await readFile(join(statesRoot, `audiogram-${draft.articleId}.json`), "utf8"));
    if (["queued", "running"].includes(existing.status)) throw new Error("Ya hay un video preparándose.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const jobId = `audiogram-es-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
  if (!JOB_ID.test(jobId)) throw new Error("audiogram job identity is invalid");
  const canonicalUrl = `https://fanaticosos.com/blog/${slugify(draft.title)}/`;
  const request = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    title: draft.title, description: draft.description, author: "Antonio Contreras",
    canonicalUrl, tags: draft.tags, featuredImage: draft.featuredImage?.path || null,
    audioJobId: audio.jobs.es.jobId, audioFile: basename(audio.jobs.es.result.file),
    audioSha256: audio.jobs.es.result.sha256,
  };
  const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { mode: 0o700 });
  await atomicJson(join(temporary, "request.json"), request);
  await rename(temporary, join(queueRoot, jobId));
  const state = { schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, jobId, status: "queued", audioSha256: request.audioSha256, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await atomicJson(join(statesRoot, `audiogram-${draft.articleId}.json`), state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
  } finally {
    audiogramQueueBusy = false;
  }
}

export async function readAudiogramState(statesRoot, articleId) {
  return JSON.parse(await readFile(join(statesRoot, `audiogram-${articleId}.json`), "utf8"));
}

export async function reconcileAudiograms({ statesRoot, jobsRoot, onComplete, onFailure, now = new Date() }) {
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  for (const name of (await readdir(statesRoot)).filter((value) => /^audiogram-[0-9a-f-]{36}\.json$/.test(value))) {
    const path = join(statesRoot, name); const state = JSON.parse(await readFile(path, "utf8"));
    if (!["queued", "running"].includes(state.status)) continue;
    try {
      const result = JSON.parse(await readFile(join(jobsRoot, state.jobId, "video", "result.json"), "utf8"));
      const metadata = await stat(join(jobsRoot, state.jobId, "video", basename(result.file)));
      if (!metadata.isFile() || metadata.size !== result.sizeBytes) throw new Error("audiogram result file is invalid");
      state.status = "completed"; state.result = result;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state.status = "running";
      if (now.getTime() - new Date(state.createdAt).getTime() > JOB_TIMEOUT_MS) { state.status = "failed"; state.error = "El audiograma excedió su límite automático."; }
    }
    state.updatedAt = now.toISOString(); await atomicJson(path, state);
    if (state.status === "completed") await onComplete?.(state);
    if (state.status === "failed") await onFailure?.(state);
  }
}

export function audiogramFileForState(state, jobsRoot) {
  if (state.status !== "completed") throw new Error("audiogram is not ready");
  return join(jobsRoot, state.jobId, "video", basename(state.result.file));
}
