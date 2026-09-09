import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  completeDatabaseTranslation, correctDatabaseTranslation, failDatabaseTranslation,
  listActiveDatabaseTranslations, queueDatabaseTranslation, readDatabaseTranslationState,
  startDatabaseTranslation,
} from "./database-translations.mjs";
import { writeTranslationArtifact } from "./translation-artifacts.mjs";
import {
  queueTranslation, readTranslationState, reconcileTranslations, renderEnglish,
  translationRequestForDraft, updateTranslationResult, writeTranslationRequest,
} from "./translation-jobs.mjs";

const TIMEOUT_MS = 62 * 60 * 1000;

export function filesystemTranslationStore({ queueRoot, statesRoot, jobsRoot }) {
  return {
    queue: ({ draft, workflow }) => queueTranslation({ draft, queueRoot, statesRoot, workflow }),
    read: (articleId) => readTranslationState(statesRoot, articleId),
    update: (articleId, revision, result) => updateTranslationResult(statesRoot, articleId, revision, result),
    reconcile: ({ onComplete, onFailure }) => reconcileTranslations({ statesRoot, jobsRoot, onComplete, onFailure }),
  };
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function artifactValue(state, result, provenance, now, owner = {}) {
  return {
    schemaVersion: 1, articleId: state.articleId, sourceRevision: state.sourceRevision,
    result, provenance, ownerRevision: owner.ownerRevision ?? 0,
    ownerReviewedAt: owner.ownerReviewedAt ?? null, acceptedAt: now.toISOString(),
  };
}

export function databaseTranslationStore({ database, queueRoot, jobsRoot, artifactsRoot }) {
  return {
    async queue({ draft, workflow = "manual" }) {
      const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
      const { request, bodyLayout } = translationRequestForDraft(draft);
      const state = queueDatabaseTranslation(database, { draft, jobId, workflow, bodyLayout });
      if (state.jobId !== jobId) return state;
      try { await writeTranslationRequest({ request, jobId, queueRoot }); }
      catch (error) { failDatabaseTranslation(database, jobId, "translation request could not be queued"); throw error; }
      return state;
    },
    async read(articleId) { return readDatabaseTranslationState(database, articleId); },
    async update(articleId, revision, result, draft) {
      if (draft.articleId !== articleId || draft.revision !== revision) throw new Error("English translation is stale for this draft");
      const previous = readDatabaseTranslationState(database, articleId);
      const now = new Date();
      const ownerRevision = (previous.ownerRevision ?? 0) + 1;
      const value = artifactValue(previous, result, previous.provenance, now, { ownerRevision, ownerReviewedAt: now.toISOString() });
      const artifact = await writeTranslationArtifact(artifactsRoot, value);
      return correctDatabaseTranslation(database, { draft, result, artifactPath: artifact.path, checksumSha256: artifact.checksumSha256, now });
    },
    async reconcile({ onComplete, onFailure, now = new Date() }) {
      for (const state of listActiveDatabaseTranslations(database)) {
        const root = join(jobsRoot, state.jobId);
        const result = await optionalJson(join(root, "result.json"));
        if (result) {
          if (state.status === "queued") startDatabaseTranslation(database, state.jobId, "systemd", new Date(now.getTime() + TIMEOUT_MS), now);
          if (result.sourceRevision !== state.sourceRevision) throw new Error("translation result source revision is invalid");
          const rendered = renderEnglish(result, state);
          const value = artifactValue(state, rendered, {
            engine: result.engine, model: result.model, modelRevision: result.modelRevision,
            runtimeVersion: result.runtimeVersion, configurationVersion: result.configurationVersion,
            glossaryVersion: result.glossaryVersion, generatedAt: result.generatedAt,
          }, now);
          const artifact = await writeTranslationArtifact(artifactsRoot, value);
          const completed = completeDatabaseTranslation(database, { jobId: state.jobId, result: rendered,
            provenance: value.provenance, artifactPath: artifact.path, checksumSha256: artifact.checksumSha256, now });
          await onComplete?.(completed);
          continue;
        }
        const failure = await optionalJson(join(root, "failed-output.json"));
        if (failure) { const failed = failDatabaseTranslation(database, state.jobId, failure.error || "La traducción no pasó la validación.", now); await onFailure?.(failed); continue; }
        if (state.status === "queued" && await optionalJson(join(root, "request.json"))) {
          startDatabaseTranslation(database, state.jobId, "systemd", new Date(now.getTime() + TIMEOUT_MS), now);
        }
        if (now.getTime() - new Date(state.createdAt).getTime() > TIMEOUT_MS) {
          const failed = failDatabaseTranslation(database, state.jobId, "La traducción excedió su límite automático y fue detenida.", now);
          await onFailure?.(failed);
        }
      }
    },
  };
}
