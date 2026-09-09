import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readDatabaseDraft } from "./database-drafts.mjs";
import { readDatabaseTranslationState } from "./database-translations.mjs";
import { closeDatabase, openDatabase, withTransaction } from "./database.mjs";
import { audioDependencyHash } from "./database-audio.mjs";
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
      const currentSourceRevision = requests[locale].sourceRevision;
      if (basename(result.file ?? "") !== result.file || !SHA256.test(result.sha256 ?? "")) {
        throw new Error(`legacy ${locale} audio identity is invalid: ${articleId}`);
      }
      const path = join(jobsRoot, job.jobId, "audio", result.file);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size !== result.sizeBytes || await fileSha256(path) !== result.sha256) {
        throw new Error(`legacy ${locale} audio checksum differs: ${articleId}`);
      }
      values.push({ articleId, draftRevision: draft.revision, locale, jobId: job.jobId,
        sourceRevision: state.sourceRevisions[locale], currentSourceRevision,
        sourceCurrent: state.sourceRevisions[locale] === currentSourceRevision,
        policyRevision: state.policyRevision,
        uploaded: job.jobId.startsWith("upload-es-"), sizeBytes: result.sizeBytes,
        sha256: result.sha256, path, key: dependencyKey(state, locale, job),
        dependencyHash: audioDependencyHash(state.sourceRevisions[locale], state.policyRevision,
          locale === "es" && job.jobId.startsWith("upload-es-")), result,
        createdAt: state.createdAt ?? result.generatedAt,
        updatedAt: state.updatedAt ?? result.generatedAt });
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
    const audio = values.map(({ key, path, result, createdAt, updatedAt, ...candidate }) => {
      const job = byJob.get(candidate.jobId) ?? byKey.get(key);
      const action = !job ? "insert"
        : job.id === candidate.jobId && job.dependency_hash === candidate.dependencyHash ? "unchanged" : "conflict";
      return { ...candidate, action };
    });
    return { schemaVersion: 1, source: "legacy-json-audio", total: audio.length,
      insert: audio.filter(({ action }) => action === "insert").length,
      unchanged: audio.filter(({ action }) => action === "unchanged").length,
      conflicts: audio.filter(({ action }) => action === "conflict").length,
      current: audio.filter(({ sourceCurrent }) => sourceCurrent).length,
      historic: audio.filter(({ sourceCurrent }) => !sourceCurrent).length, audio };
  } finally { database.close(); }
}

async function copyImmutableArtifact(root, candidate) {
  const directory = join(root, candidate.articleId);
  const destination = join(directory, `${candidate.locale}-${candidate.sourceRevision}-${candidate.sha256}.mp3`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const metadata = await stat(destination);
    if (!metadata.isFile() || metadata.size !== candidate.sizeBytes || await fileSha256(destination) !== candidate.sha256) {
      throw new Error(`audio artifact differs: ${candidate.articleId} ${candidate.locale}`);
    }
    return { path: destination, created: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(candidate.path, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o600);
  if (await fileSha256(destination) !== candidate.sha256) {
    await rm(destination, { force: false });
    throw new Error(`copied audio artifact checksum differs: ${candidate.articleId} ${candidate.locale}`);
  }
  return { path: destination, created: true };
}

export async function applyAudioImport({ statesRoot, jobsRoot, artifactsRoot, databasePath }) {
  const database = await openDatabase(databasePath);
  const createdPaths = [];
  try {
    const values = await candidates(statesRoot, jobsRoot, database);
    const existingJob = database.prepare("SELECT id FROM jobs WHERE id = ? OR idempotency_key = ?");
    const pending = values.filter((candidate) => !existingJob.get(candidate.jobId, candidate.key));
    if (pending.length !== values.length) {
      const preview = await previewAudioImport({ statesRoot, jobsRoot, databasePath });
      if (preview.conflicts) throw new Error("audio import conflicts with existing database state");
      if (preview.insert === 0) return { ...preview, applied: true };
      throw new Error("audio import is partially applied");
    }
    const artifacts = new Map();
    for (const candidate of pending) {
      const artifact = await copyImmutableArtifact(artifactsRoot, candidate);
      artifacts.set(candidate.jobId, artifact);
      if (artifact.created) createdPaths.push(artifact.path);
    }
    const report = withTransaction(database, (connection) => {
      for (const candidate of pending) {
        const revision = connection.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?")
          .get(candidate.articleId, candidate.draftRevision);
        if (!revision) throw new Error(`audio revision is missing: ${candidate.articleId}`);
        const artifact = artifacts.get(candidate.jobId);
        const artifactId = `legacy:${candidate.jobId}`;
        connection.prepare(`INSERT INTO artifacts (
          id, revision_id, type, locale, dependency_hash, status, path,
          checksum_sha256, created_at, updated_at, accepted_at
        ) VALUES (?, ?, 'audio', ?, ?, 'accepted', ?, ?, ?, ?, ?)`).run(
          artifactId, revision.id, candidate.locale, candidate.dependencyHash, artifact.path,
          candidate.sha256, candidate.createdAt, candidate.updatedAt, candidate.updatedAt,
        );
        connection.prepare(`INSERT INTO jobs (
          id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
          status, checkpoint_json, available_at, created_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`).run(
          candidate.jobId, candidate.locale === "es" ? "tts_es" : "tts_en", revision.id, artifactId,
          candidate.key, candidate.dependencyHash,
          JSON.stringify({ schemaVersion: 1, sourceRevision: candidate.sourceRevision,
            currentSourceRevision: candidate.currentSourceRevision, sourceCurrent: candidate.sourceCurrent,
            policyRevision: candidate.policyRevision, uploaded: candidate.uploaded, result: candidate.result }),
          candidate.createdAt, candidate.createdAt, candidate.createdAt, candidate.updatedAt,
        );
      }
      return { total: values.length, inserted: pending.length };
    });
    return { schemaVersion: 1, source: "legacy-json-audio", ...report, applied: true };
  } catch (error) {
    for (const path of createdPaths.reverse()) await rm(path, { force: false }).catch(() => {});
    throw error;
  } finally { closeDatabase(database); }
}
