import { randomUUID } from "node:crypto";

import { withTransaction } from "./database.mjs";
import { translationSourceRevision } from "./translation-jobs.mjs";

const JOB_ID = /^translation-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function currentRevision(database, draft) {
  const row = database.prepare(`
    SELECT r.id AS revision_id, r.revision_number
    FROM articles a
    JOIN revisions r ON r.id = a.current_revision_id
    WHERE a.id = ?
  `).get(draft.articleId);
  if (!row || row.revision_number !== draft.revision) {
    throw new Error("draft is not the current database revision");
  }
  return row.revision_id;
}

function parseCheckpoint(value) {
  return value ? JSON.parse(value) : {};
}

function storedState(row) {
  if (!row) return null;
  const checkpoint = parseCheckpoint(row.checkpoint_json);
  const statuses = {
    queued: "queued", leased: "running", retry_wait: "queued",
    completed: "completed", failed: "failed", cancelled: "failed",
  };
  return {
    schemaVersion: 1,
    articleId: row.article_id,
    draftRevision: row.revision_number,
    jobId: row.job_id,
    status: statuses[row.job_status],
    workflow: checkpoint.workflow,
    createdAt: row.created_at,
    updatedAt: row.finished_at ?? row.heartbeat_at ?? row.started_at ?? row.created_at,
    bodyLayout: checkpoint.bodyLayout,
    sourceRevision: row.dependency_hash,
    ...(checkpoint.result ? { result: checkpoint.result } : {}),
    ...(checkpoint.provenance ? { provenance: checkpoint.provenance } : {}),
    ...(Number.isInteger(checkpoint.ownerRevision) ? { ownerRevision: checkpoint.ownerRevision } : {}),
    ...(checkpoint.ownerReviewedAt ? { ownerReviewedAt: checkpoint.ownerReviewedAt } : {}),
    ...(row.error_message ? { error: row.error_message } : {}),
    artifact: {
      id: row.artifact_id,
      status: row.artifact_status,
      path: row.artifact_path,
      sha256: row.checksum_sha256,
    },
  };
}

const SELECT_STATE = `
  SELECT j.id AS job_id, j.status AS job_status, j.dependency_hash,
         j.checkpoint_json, j.error_message, j.created_at, j.started_at,
         j.heartbeat_at, j.finished_at,
         r.article_id, r.revision_number,
         a.id AS artifact_id, a.status AS artifact_status,
         a.path AS artifact_path, a.checksum_sha256
  FROM jobs j
  JOIN revisions r ON r.id = j.revision_id
  JOIN artifacts a ON a.id = j.artifact_id
`;

export function queueDatabaseTranslation(database, {
  draft, jobId, workflow = "manual", bodyLayout, now = new Date(),
}) {
  if (!JOB_ID.test(jobId ?? "")) throw new Error("translation job identity is invalid");
  if (!["manual", "preview"].includes(workflow)) throw new Error("translation workflow is invalid");
  const dependencyHash = translationSourceRevision(draft);
  const idempotencyKey = `translation:${draft.articleId}:${dependencyHash}`;
  const timestamp = now.toISOString();

  return withTransaction(database, (connection) => {
    const existing = connection.prepare(`${SELECT_STATE} WHERE j.idempotency_key = ?`).get(idempotencyKey);
    if (existing) return storedState(existing);
    const revisionId = currentRevision(connection, draft);
    const artifactId = randomUUID();
    connection.prepare(`
      INSERT INTO artifacts (
        id, revision_id, type, locale, dependency_hash, status, created_at, updated_at
      ) VALUES (?, ?, 'translation', 'en', ?, 'pending', ?, ?)
    `).run(artifactId, revisionId, dependencyHash, timestamp, timestamp);
    connection.prepare(`
      INSERT INTO jobs (
        id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
        status, checkpoint_json, available_at, created_at
      ) VALUES (?, 'translation', ?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(
      jobId, revisionId, artifactId, idempotencyKey, dependencyHash,
      JSON.stringify({ schemaVersion: 1, workflow, bodyLayout }), timestamp, timestamp,
    );
    return readDatabaseTranslationState(connection, draft.articleId);
  });
}

export function readDatabaseTranslationState(database, articleId) {
  const row = database.prepare(`${SELECT_STATE}
    WHERE r.article_id = ? AND j.type = 'translation'
    ORDER BY j.created_at DESC, j.id DESC LIMIT 1
  `).get(articleId);
  if (!row) {
    const error = new Error("translation state was not found");
    error.code = "ENOENT";
    throw error;
  }
  return storedState(row);
}

export function listActiveDatabaseTranslations(database) {
  return database.prepare(`${SELECT_STATE}
    WHERE j.type = 'translation' AND j.status IN ('queued', 'leased', 'retry_wait')
    ORDER BY j.created_at, j.id
  `).all().map(storedState);
}

export function startDatabaseTranslation(database, jobId, leaseOwner, leaseExpiresAt, now = new Date()) {
  if (!leaseOwner || !(leaseExpiresAt instanceof Date) || leaseExpiresAt <= now) {
    throw new Error("a valid translation lease is required");
  }
  const result = database.prepare(`
    UPDATE jobs SET status = 'leased', attempt = attempt + 1, lease_owner = ?,
      lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ? AND type = 'translation' AND status IN ('queued', 'retry_wait')
  `).run(leaseOwner, leaseExpiresAt.toISOString(), now.toISOString(), now.toISOString(), jobId);
  if (result.changes !== 1) throw new Error("translation job is not available");
}

export function completeDatabaseTranslation(database, {
  jobId, result, provenance, artifactPath, checksumSha256, now = new Date(),
}) {
  if (typeof artifactPath !== "string" || !artifactPath || !SHA256.test(checksumSha256 ?? "")) {
    throw new Error("verified translation artifact identity is required");
  }
  const timestamp = now.toISOString();
  return withTransaction(database, (connection) => {
    const job = connection.prepare("SELECT artifact_id, checkpoint_json FROM jobs WHERE id = ? AND type = 'translation'").get(jobId);
    if (!job) throw new Error("translation job was not found");
    const checkpoint = parseCheckpoint(job.checkpoint_json);
    const artifact = connection.prepare(`
      UPDATE artifacts SET status = 'accepted', path = ?, checksum_sha256 = ?,
        updated_at = ?, accepted_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(artifactPath, checksumSha256, timestamp, timestamp, job.artifact_id);
    if (artifact.changes !== 1) throw new Error("translation artifact is not pending");
    connection.prepare(`
      UPDATE jobs SET status = 'completed', checkpoint_json = ?, heartbeat_at = ?,
        finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'leased'
    `).run(JSON.stringify({ ...checkpoint, result, provenance }), timestamp, timestamp, jobId);
    const state = connection.prepare(`${SELECT_STATE} WHERE j.id = ?`).get(jobId);
    if (state.job_status !== "completed") throw new Error("translation job is not leased");
    return storedState(state);
  });
}

export function failDatabaseTranslation(database, jobId, errorMessage, now = new Date()) {
  if (typeof errorMessage !== "string" || !errorMessage.trim()) throw new Error("translation failure is required");
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString();
    const job = connection.prepare(`
      UPDATE jobs SET status = 'failed', error_message = ?, heartbeat_at = ?,
        finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND type = 'translation' AND status IN ('queued', 'leased', 'retry_wait')
    `).run(errorMessage.trim(), timestamp, timestamp, jobId);
    if (job.changes !== 1) throw new Error("translation job cannot be failed");
    connection.prepare(`
      UPDATE artifacts SET status = 'failed', updated_at = ?
      WHERE id = (SELECT artifact_id FROM jobs WHERE id = ?) AND status = 'pending'
    `).run(timestamp, jobId);
    return storedState(connection.prepare(`${SELECT_STATE} WHERE j.id = ?`).get(jobId));
  });
}

export function correctDatabaseTranslation(database, {
  draft, result, artifactPath, checksumSha256, now = new Date(),
}) {
  if (typeof artifactPath !== "string" || !artifactPath || !SHA256.test(checksumSha256 ?? "")) {
    throw new Error("verified translation artifact identity is required");
  }
  for (const [field, maximum] of [["title", 300], ["description", 500], ["body", 100_000]]) {
    if (typeof result?.[field] !== "string" || !result[field].trim() || result[field].trim().length > maximum) {
      throw new Error(`English ${field} is invalid`);
    }
  }
  const timestamp = now.toISOString();
  return withTransaction(database, (connection) => {
    const previous = readDatabaseTranslationState(connection, draft.articleId);
    const dependencyHash = translationSourceRevision(draft);
    if (previous.status !== "completed" || previous.sourceRevision !== dependencyHash) {
      throw new Error("English translation is stale for this draft");
    }
    const revisionId = currentRevision(connection, draft);
    const artifactId = randomUUID();
    const jobId = `translation-review-${randomUUID()}`;
    connection.prepare("UPDATE artifacts SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'accepted'")
      .run(timestamp, previous.artifact.id);
    connection.prepare(`INSERT INTO artifacts (
      id, revision_id, type, locale, dependency_hash, status, path,
      checksum_sha256, created_at, updated_at, accepted_at
    ) VALUES (?, ?, 'translation', 'en', ?, 'accepted', ?, ?, ?, ?, ?)`)
      .run(artifactId, revisionId, dependencyHash, artifactPath, checksumSha256, timestamp, timestamp, timestamp);
    const ownerRevision = (previous.ownerRevision ?? 0) + 1;
    connection.prepare(`INSERT INTO jobs (
      id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
      status, checkpoint_json, available_at, created_at, started_at, finished_at
    ) VALUES (?, 'translation', ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
      .run(jobId, revisionId, artifactId, `translation-review:${artifactId}`, dependencyHash,
        JSON.stringify({ schemaVersion: 1, workflow: previous.workflow ?? "manual", bodyLayout: previous.bodyLayout,
          result: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.trim()])),
          provenance: previous.provenance, ownerRevision, ownerReviewedAt: timestamp }),
        timestamp, timestamp, timestamp, timestamp);
    return storedState(connection.prepare(`${SELECT_STATE} WHERE j.id = ?`).get(jobId));
  });
}
