import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  completeDatabaseAudio, databaseAudioFile, failDatabaseAudio, listActiveDatabaseAudio,
  queueDatabaseAudio, queueDatabaseAudioLocale, readDatabaseAudioState, startDatabaseAudio,
} from "./database-audio.mjs";
import { saveSpanishAudio, writeSpanishAudioJob } from "./spanish-audio-upload.mjs";
import { audioFileForState, queueTts, queueTtsLocale, readTtsState, reconcileTts, ttsRequestsForDraft } from "./tts-jobs.mjs";

const TIMEOUT_MS = 17 * 60 * 1000;

export function filesystemAudioStore({ queueRoot, statesRoot, jobsRoot }) {
  return {
    queue: (value) => queueTts({ ...value, queueRoot, statesRoot }),
    queueLocale: (value) => queueTtsLocale({ ...value, queueRoot, statesRoot }),
    read: (articleId) => readTtsState(statesRoot, articleId),
    file: (state, locale) => audioFileForState(state, locale, jobsRoot),
    reconcile: (callbacks) => reconcileTts({ statesRoot, jobsRoot, ...callbacks }),
    uploadSpanish: (value) => saveSpanishAudio({ ...value, jobsRoot, statesRoot }),
  };
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function writeRequest(queueRoot, jobId, request) {
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    await writeFile(join(temporary, "request.json"), `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, join(queueRoot, jobId));
    await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function preserveArtifact(artifactsRoot, active, result, sourcePath) {
  if (basename(result.file ?? "") !== result.file || result.locale !== active.locale || result.sourceRevision !== active.sourceRevision) {
    throw new Error("audio result identity is invalid");
  }
  const metadata = await stat(sourcePath);
  if (!metadata.isFile() || metadata.size !== result.sizeBytes || await sha256(sourcePath) !== result.sha256) {
    throw new Error("audio result checksum is invalid");
  }
  const directory = join(artifactsRoot, active.articleId);
  const path = join(directory, `${active.locale}-${active.sourceRevision}-${result.sha256}.mp3`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await stat(path);
    if (!existing.isFile() || existing.size !== result.sizeBytes || await sha256(path) !== result.sha256) throw new Error("audio artifact differs");
    return path;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await copyFile(sourcePath, path, constants.COPYFILE_EXCL); await chmod(path, 0o600);
  return path;
}

export function databaseAudioStore({ database, queueRoot, jobsRoot, artifactsRoot }) {
  return {
    async queue({ draft, translation, policyRevision, workflow = "manual" }) {
      const requests = ttsRequestsForDraft(draft, translation); const article = draft.articleId.replaceAll("-", "");
      const jobIds = { es: `tts-es-${article}-r${draft.revision}-${randomUUID().slice(0, 8)}`, en: `tts-en-${article}-r${draft.revision}-${randomUUID().slice(0, 8)}` };
      const state = queueDatabaseAudio(database, { draft, requests, policyRevision, jobIds, workflow });
      for (const locale of ["es", "en"]) {
        if (state.jobs[locale].jobId !== jobIds[locale]) continue;
        try { await writeRequest(queueRoot, jobIds[locale], requests[locale]); }
        catch (error) { failDatabaseAudio(database, jobIds[locale], "audio request could not be queued"); throw error; }
      }
      return readDatabaseAudioState(database, draft.articleId);
    },
    async queueLocale({ draft, translation, locale, policyRevision }) {
      const requests = ttsRequestsForDraft(draft, translation); const existing = readDatabaseAudioState(database, draft.articleId);
      const preserved = locale === "es" ? "en" : "es";
      if (existing.jobs?.[preserved]?.status !== "completed" || existing.sourceRevisions?.[preserved] !== requests[preserved].sourceRevision) {
        throw new Error("the preserved audio is stale; regenerate both audios");
      }
      const jobId = `tts-${locale}-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
      const state = queueDatabaseAudioLocale(database, { draft, request: requests[locale], locale, policyRevision, jobId });
      if (state.jobs[locale].jobId === jobId) {
        try { await writeRequest(queueRoot, jobId, requests[locale]); }
        catch (error) { failDatabaseAudio(database, jobId, "audio request could not be queued"); throw error; }
      }
      return readDatabaseAudioState(database, draft.articleId);
    },
    async uploadSpanish({ draft, translation, buffer, policyRevision, now = new Date(), probe }) {
      const written = await writeSpanishAudioJob({ draft, translation, buffer, jobsRoot, now, probe });
      queueDatabaseAudioLocale(database, { draft, request: written.request, locale: "es", policyRevision,
        jobId: written.jobId, workflow: "spanish-upload", uploaded: true, now });
      startDatabaseAudio(database, written.jobId, "owner-upload", new Date(now.getTime() + TIMEOUT_MS), now);
      const active = listActiveDatabaseAudio(database).find(({ jobId }) => jobId === written.jobId);
      const artifactPath = await preserveArtifact(artifactsRoot, active, { ...written.result, sourceRevision: written.request.sourceRevision }, written.path);
      completeDatabaseAudio(database, { jobId: written.jobId, result: written.result, artifactPath, checksumSha256: written.result.sha256, now });
      return readDatabaseAudioState(database, draft.articleId);
    },
    async read(articleId) { return readDatabaseAudioState(database, articleId); },
    file(state, locale) { return databaseAudioFile(state, locale); },
    async reconcile({ onComplete, onFailure, now = new Date() }) {
      for (const active of listActiveDatabaseAudio(database)) {
        const root = join(jobsRoot, active.jobId); const result = await optionalJson(join(root, "audio", "result.json"));
        if (result) {
          if (active.status === "queued") startDatabaseAudio(database, active.jobId, "systemd", new Date(now.getTime() + TIMEOUT_MS), now);
          const sourcePath = join(root, "audio", basename(result.file));
          const artifactPath = await preserveArtifact(artifactsRoot, active, result, sourcePath);
          completeDatabaseAudio(database, { jobId: active.jobId, result, artifactPath, checksumSha256: result.sha256, now });
          const state = readDatabaseAudioState(database, active.articleId);
          if (state.status === "completed") await onComplete?.(state);
          continue;
        }
        const failure = await optionalJson(join(root, "failure.json"));
        if (failure) {
          failDatabaseAudio(database, active.jobId, failure.error || "La generación de audio no pudo completarse.", now);
          await onFailure?.(readDatabaseAudioState(database, active.articleId));
          continue;
        }
        if (active.status === "queued" && await optionalJson(join(root, "request.json"))) startDatabaseAudio(database, active.jobId, "systemd", new Date(now.getTime() + TIMEOUT_MS), now);
        if (now.getTime() - new Date(active.createdAt).getTime() > TIMEOUT_MS) {
          failDatabaseAudio(database, active.jobId, "La generación de audio excedió su límite automático y fue detenida.", now);
          await onFailure?.(readDatabaseAudioState(database, active.articleId));
        }
      }
    },
  };
}
