import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readDatabaseDraft } from "./database-drafts.mjs";
import { readDatabaseTranslationState } from "./database-translations.mjs";
import { ttsRequestsForDraft } from "./tts-jobs.mjs";

const STATE_FILE = /^audio-([0-9a-f-]{36})\.json$/;
const JOB_ID = /^(?:tts-(?:es|en)|upload-es)-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function dependencyKey(state, locale, job) {
  const uploaded = locale === "es" && job.jobId.startsWith("upload-es-");
  return uploaded
    ? `audio:${locale}:${state.articleId}:${state.sourceRevisions[locale]}:owner-upload`
    : `audio:${locale}:${state.articleId}:${state.sourceRevisions[locale]}:${state.policyRevision}`;
}

async function candidates(statesRoot, jobsRoot, database) {
  const names = (await readdir(statesRoot)).filter((name) => STATE_FILE.test(name)).sort();
  if (names.length === 0) throw new Error("no legacy audio states were found");
  const values = [];
  for (const name of names) {
    const articleId = name.match(STATE_FILE)[1];
    const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
    if (state.schemaVersion !== 1 || state.articleId !== articleId || state.status !== "completed") {
      throw new Error(`legacy audio state is not completed: ${articleId}`);
    }
    if (!SHA256.test(state.policyRevision ?? "") || !state.sourceRevisions) {
      throw new Error(`legacy audio dependency is invalid: ${articleId}`);
    }
    const draft = readDatabaseDraft(database, articleId);
    const translation = readDatabaseTranslationState(database, articleId);
    const requests = ttsRequestsForDraft(draft, translation);
    for (const locale of ["es", "en"]) {
      const job = state.jobs?.[locale];
      const result = job?.result;
      if (job?.status !== "completed" || !JOB_ID.test(job.jobId ?? "") || !result || result.locale !== locale) {
        throw new Error(`legacy ${locale} audio is incomplete: ${articleId}`);
      }
      if (state.sourceRevisions[locale] !== requests[locale].sourceRevision) {
        throw new Error(`legacy ${locale} audio source differs from current content: ${articleId}`);
      }
      if (basename(result.file ?? "") !== result.file || !SHA256.test(result.sha256 ?? "")) {
        throw new Error(`legacy ${locale} audio identity is invalid: ${articleId}`);
      }
      const path = join(jobsRoot, job.jobId, "audio", result.file);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size !== result.sizeBytes || await fileSha256(path) !== result.sha256) {
        throw new Error(`legacy ${locale} audio checksum differs: ${articleId}`);
      }
      values.push({ articleId, draftRevision: draft.revision, locale, jobId: job.jobId,
        sourceRevision: state.sourceRevisions[locale], policyRevision: state.policyRevision,
        uploaded: job.jobId.startsWith("upload-es-"), sizeBytes: result.sizeBytes,
        sha256: result.sha256, path, key: dependencyKey(state, locale, job) });
    }
  }
  return values;
}

export async function previewAudioImport({ statesRoot, jobsRoot, databasePath }) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const values = await candidates(statesRoot, jobsRoot, database);
    const byJob = database.prepare("SELECT id, dependency_hash FROM jobs WHERE id = ?");
    const byKey = database.prepare("SELECT id, dependency_hash FROM jobs WHERE idempotency_key = ?");
    const audio = values.map(({ key, path, ...candidate }) => {
      const job = byJob.get(candidate.jobId) ?? byKey.get(key);
      const action = !job ? "insert"
        : job.id === candidate.jobId && job.dependency_hash === candidate.sourceRevision ? "unchanged" : "conflict";
      return { ...candidate, action };
    });
    return { schemaVersion: 1, source: "legacy-json-audio", total: audio.length,
      insert: audio.filter(({ action }) => action === "insert").length,
      unchanged: audio.filter(({ action }) => action === "unchanged").length,
      conflicts: audio.filter(({ action }) => action === "conflict").length, audio };
  } finally { database.close(); }
}
