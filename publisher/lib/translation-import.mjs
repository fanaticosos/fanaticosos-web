import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readDatabaseDraft } from "./database-drafts.mjs";
import { closeDatabase, openDatabase, withTransaction } from "./database.mjs";
import { translationSourceRevision } from "./translation-jobs.mjs";

const STATE_FILE = /^([0-9a-f-]{36})\.json$/;
const JOB_ID = /^translation-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function validText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is invalid`);
  return value;
}

async function candidates(statesRoot, database) {
  const names = (await readdir(statesRoot)).filter((name) => STATE_FILE.test(name)).sort();
  if (names.length === 0) throw new Error("no legacy translation states were found");
  const rows = [];
  for (const name of names) {
    const articleId = name.match(STATE_FILE)[1];
    const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
    if (state.articleId !== articleId || state.schemaVersion !== 1 || state.status !== "completed") {
      throw new Error(`legacy translation state is not completed: ${articleId}`);
    }
    if (!JOB_ID.test(state.jobId ?? "") || !SHA256.test(state.sourceRevision ?? "")) {
      throw new Error(`legacy translation identity is invalid: ${articleId}`);
    }
    if (!Array.isArray(state.bodyLayout) || !state.result || !state.provenance) {
      throw new Error(`legacy translation artifact is incomplete: ${articleId}`);
    }
    for (const field of ["title", "description", "body"]) validText(state.result[field], `translation ${field}`);
    const draft = readDatabaseDraft(database, articleId);
    const expected = translationSourceRevision(draft);
    if (state.sourceRevision !== expected) throw new Error(`legacy translation source differs from current draft: ${articleId}`);
    rows.push({
      articleId, draftRevision: draft.revision, jobId: state.jobId,
      sourceRevision: state.sourceRevision, workflow: state.workflow ?? "manual",
      ownerRevision: state.ownerRevision ?? 0, bodyLayoutCount: state.bodyLayout.length,
      state,
    });
  }
  return rows;
}

export async function previewTranslationImport({ statesRoot, databasePath }) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const values = await candidates(statesRoot, database);
    const byJob = database.prepare("SELECT id, dependency_hash FROM jobs WHERE id = ?");
    const byKey = database.prepare("SELECT id, dependency_hash FROM jobs WHERE idempotency_key = ?");
    const translations = values.map((candidate) => {
      const key = `translation:${candidate.articleId}:${candidate.sourceRevision}`;
      const job = byJob.get(candidate.jobId) ?? byKey.get(key);
      const action = !job ? "insert"
        : job.id === candidate.jobId && job.dependency_hash === candidate.sourceRevision ? "unchanged" : "conflict";
      const { state, ...safe } = candidate;
      return { ...safe, action };
    });
    return {
      schemaVersion: 1, source: "legacy-json-translations", total: translations.length,
      insert: translations.filter(({ action }) => action === "insert").length,
      unchanged: translations.filter(({ action }) => action === "unchanged").length,
      conflicts: translations.filter(({ action }) => action === "conflict").length,
      translations,
    };
  } finally {
    database.close();
  }
}

function artifactBytes(candidate) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    articleId: candidate.articleId,
    sourceRevision: candidate.sourceRevision,
    result: candidate.state.result,
    provenance: candidate.state.provenance,
    ownerRevision: candidate.state.ownerRevision ?? 0,
    ownerReviewedAt: candidate.state.ownerReviewedAt ?? null,
  }, null, 2)}\n`);
}

async function writeImmutableArtifact(root, candidate) {
  const directory = join(root, candidate.articleId);
  const path = join(directory, `${candidate.sourceRevision}.json`);
  const bytes = artifactBytes(candidate);
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(path);
    if (!existing.equals(bytes)) throw new Error(`translation artifact differs: ${candidate.articleId}`);
    return { path, checksumSha256, created: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${candidate.jobId}.saving`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return { path, checksumSha256, created: true };
}

export async function applyTranslationImport({ statesRoot, artifactsRoot, databasePath }) {
  const database = await openDatabase(databasePath);
  const createdPaths = [];
  try {
    const values = await candidates(statesRoot, database);
    const existingJob = database.prepare("SELECT id FROM jobs WHERE id = ? OR idempotency_key = ?");
    const pending = values.filter((candidate) => !existingJob.get(
      candidate.jobId, `translation:${candidate.articleId}:${candidate.sourceRevision}`,
    ));
    if (pending.length !== values.length) {
      const preview = await previewTranslationImport({ statesRoot, databasePath });
      if (preview.conflicts) throw new Error("translation import conflicts with existing database state");
      if (preview.insert === 0) return { ...preview, applied: true };
      throw new Error("translation import is partially applied");
    }
    const artifacts = new Map();
    for (const candidate of pending) {
      const artifact = await writeImmutableArtifact(artifactsRoot, candidate);
      artifacts.set(candidate.jobId, artifact);
      if (artifact.created) createdPaths.push(artifact.path);
    }
    const report = withTransaction(database, (connection) => {
      for (const candidate of pending) {
        const artifact = artifacts.get(candidate.jobId);
        const revision = connection.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?").get(candidate.articleId, candidate.draftRevision);
        if (!revision) throw new Error(`translation revision is missing: ${candidate.articleId}`);
        const artifactId = `legacy:${candidate.jobId}`;
        connection.prepare(`INSERT INTO artifacts (
          id, revision_id, type, locale, dependency_hash, status, path,
          checksum_sha256, created_at, updated_at, accepted_at
        ) VALUES (?, ?, 'translation', 'en', ?, 'accepted', ?, ?, ?, ?, ?)`)
          .run(artifactId, revision.id, candidate.sourceRevision, artifact.path, artifact.checksumSha256,
            candidate.state.createdAt, candidate.state.updatedAt, candidate.state.updatedAt);
        connection.prepare(`INSERT INTO jobs (
          id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
          status, checkpoint_json, available_at, created_at, started_at, finished_at
        ) VALUES (?, 'translation', ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
          .run(candidate.jobId, revision.id, artifactId,
            `translation:${candidate.articleId}:${candidate.sourceRevision}`, candidate.sourceRevision,
            JSON.stringify({ schemaVersion: 1, workflow: candidate.workflow, bodyLayout: candidate.state.bodyLayout,
              result: candidate.state.result, provenance: candidate.state.provenance,
              ownerRevision: candidate.state.ownerRevision ?? 0, ownerReviewedAt: candidate.state.ownerReviewedAt ?? null }),
            candidate.state.createdAt, candidate.state.createdAt, candidate.state.createdAt, candidate.state.updatedAt);
      }
      return { total: values.length, inserted: pending.length };
    });
    return { schemaVersion: 1, source: "legacy-json-translations", ...report, applied: true };
  } catch (error) {
    for (const path of createdPaths.reverse()) await rm(path, { force: false }).catch(() => {});
    throw error;
  } finally {
    closeDatabase(database);
  }
}
