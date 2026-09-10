function checkpoint(value) {
  return value ? JSON.parse(value) : {};
}

function localeState(row) {
  if (!row) return null;
  const saved = checkpoint(row.checkpoint_json);
  const statuses = {
    queued: "queued", leased: "running", retry_wait: "queued",
    completed: "completed", failed: "failed", cancelled: "failed",
  };
  return {
    articleId: row.article_id,
    draftRevision: row.revision_number,
    locale: row.locale,
    jobId: row.job_id,
    status: statuses[row.job_status],
    sourceRevision: saved.sourceRevision,
    currentSourceRevision: saved.currentSourceRevision,
    sourceCurrent: saved.sourceCurrent,
    policyRevision: saved.policyRevision,
    uploaded: saved.uploaded === true,
    createdAt: row.created_at,
    updatedAt: row.finished_at ?? row.heartbeat_at ?? row.started_at ?? row.created_at,
    ...(saved.result ? { result: saved.result } : {}),
    ...(row.error_message ? { error: row.error_message } : {}),
    artifact: {
      id: row.artifact_id, status: row.artifact_status,
      path: row.artifact_path, sha256: row.checksum_sha256,
      dependencyHash: row.dependency_hash,
    },
  };
}

const SELECT_LOCALE = `
  SELECT j.id AS job_id, j.status AS job_status, j.dependency_hash,
         j.checkpoint_json, j.error_message, j.created_at, j.started_at,
         j.heartbeat_at, j.finished_at, r.article_id, r.revision_number,
         a.id AS artifact_id, a.locale, a.status AS artifact_status,
         a.path AS artifact_path, a.checksum_sha256
  FROM jobs j
  JOIN revisions r ON r.id = j.revision_id
  JOIN artifacts a ON a.id = j.artifact_id
`;

export function readDatabaseAudioState(database, articleId) {
  const rows = database.prepare(`${SELECT_LOCALE}
    WHERE r.article_id = ? AND j.type IN ('tts_es', 'tts_en')
    ORDER BY j.created_at DESC, j.id DESC
  `).all(articleId);
  const latest = {};
  for (const row of rows) if (!latest[row.locale]) latest[row.locale] = localeState(row);
  if (!latest.es && !latest.en) {
    const error = new Error("audio state was not found"); error.code = "ENOENT"; throw error;
  }
  const locales = [latest.es, latest.en].filter(Boolean);
  const completed = locales.filter(({ status }) => status === "completed").length;
  const failed = locales.find(({ status }) => status === "failed");
  const running = locales.some(({ status }) => status === "running");
  const first = locales[0];
  const newestCheckpoint = checkpoint(rows[0].checkpoint_json);
  const workflow = latest.es?.uploaded && latest.es.status === "completed"
    ? "spanish-upload" : newestCheckpoint.workflow ?? "legacy-import";
  return {
    schemaVersion: 1,
    articleId,
    draftRevision: Math.max(...rows.map(({ revision_number }) => revision_number)),
    status: failed ? "failed" : completed === 2 ? "completed" : running ? "running" : "queued",
    workflow,
    ...(newestCheckpoint.regeneratedLocale ? { regeneratedLocale: newestCheckpoint.regeneratedLocale } : {}),
    createdAt: locales.map(({ createdAt }) => createdAt).sort()[0],
    updatedAt: locales.map(({ updatedAt }) => updatedAt).sort().at(-1),
    policyRevision: first.policyRevision,
    sourceRevisions: Object.fromEntries(locales.map((value) => [value.locale, value.sourceRevision])),
    jobs: Object.fromEntries(locales.map((value) => [value.locale, {
      jobId: value.jobId, status: value.status,
      ...(value.result ? { result: value.result } : {}),
      ...(value.error ? { error: value.error } : {}),
      artifact: value.artifact,
    }])),
    ...(failed ? { error: failed.error } : {}),
  };
}

export function databaseAudioFile(state, locale) {
  if (!["es", "en"].includes(locale) || state.jobs?.[locale]?.status !== "completed") {
    throw new Error("audio is not ready");
  }
  const path = state.jobs[locale].artifact?.path;
  if (typeof path !== "string" || !path) throw new Error("accepted audio artifact is missing");
  return path;
}

function insertPending(connection, { draft, revisionId, locale, jobId, sourceRevision, policyRevision, workflow, uploaded = false, regeneratedLocale, now }) {
  if (!["es", "en"].includes(locale) || !JOB_ID.test(jobId ?? "")) throw new Error("audio job identity is invalid");
  if (!["manual", "preview", "audio-regeneration", "spanish-upload"].includes(workflow)) throw new Error("audio workflow is invalid");
  const dependencyHash = audioDependencyHash(sourceRevision, policyRevision, uploaded);
  const policyKey = uploaded ? "owner-upload" : policyRevision;
  const idempotencyKey = `audio:${locale}:${draft.articleId}:${sourceRevision}:${policyKey}`;
  const jobType = locale === "es" ? "tts_es" : "tts_en";
  const existing = connection.prepare(`${SELECT_LOCALE}
    WHERE j.type = ? AND j.dependency_hash = ?
    ORDER BY j.created_at DESC, j.id DESC LIMIT 1`).get(jobType, dependencyHash);
  if (existing && !["failed", "cancelled"].includes(existing.job_status)) return localeState(existing);
  const effectiveIdempotencyKey = existing ? `${idempotencyKey}:retry:${jobId}` : idempotencyKey;
  const artifactId = randomUUID(); const timestamp = now.toISOString();
  connection.prepare(`INSERT INTO artifacts (
    id, revision_id, type, locale, dependency_hash, status, created_at, updated_at
  ) VALUES (?, ?, 'audio', ?, ?, 'pending', ?, ?)`)
    .run(artifactId, revisionId, locale, dependencyHash, timestamp, timestamp);
  connection.prepare(`INSERT INTO jobs (
    id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
    status, checkpoint_json, available_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .run(jobId, jobType, revisionId, artifactId,
      effectiveIdempotencyKey, dependencyHash, JSON.stringify({ schemaVersion: 1, workflow,
        sourceRevision, currentSourceRevision: sourceRevision, sourceCurrent: true,
        policyRevision, uploaded, ...(regeneratedLocale ? { regeneratedLocale } : {}) }), timestamp, timestamp);
  return localeState(connection.prepare(`${SELECT_LOCALE} WHERE j.id = ?`).get(jobId));
}

export function queueDatabaseAudio(database, { draft, requests, policyRevision, jobIds, workflow = "manual", now = new Date() }) {
  return withTransaction(database, (connection) => {
    const revisionId = currentRevision(connection, draft);
    for (const locale of ["es", "en"]) insertPending(connection, { draft, revisionId, locale,
      jobId: jobIds[locale], sourceRevision: requests[locale].sourceRevision, policyRevision, workflow, now });
    return readDatabaseAudioState(connection, draft.articleId);
  });
}

export function queueDatabaseAudioLocale(database, { draft, request, locale, policyRevision, jobId, workflow = "audio-regeneration", uploaded = false, now = new Date() }) {
  return withTransaction(database, (connection) => {
    const revisionId = currentRevision(connection, draft);
    insertPending(connection, { draft, revisionId, locale, jobId,
      sourceRevision: request.sourceRevision, policyRevision, workflow, uploaded, regeneratedLocale: locale, now });
    return readDatabaseAudioState(connection, draft.articleId);
  });
}

export function listActiveDatabaseAudio(database) {
  return database.prepare(`${SELECT_LOCALE}
    WHERE j.type IN ('tts_es', 'tts_en') AND j.status IN ('queued', 'leased', 'retry_wait')
    ORDER BY j.created_at, j.id`).all().map(localeState);
}

export function startDatabaseAudio(database, jobId, leaseOwner, leaseExpiresAt, now = new Date()) {
  if (!leaseOwner || !(leaseExpiresAt instanceof Date) || leaseExpiresAt <= now) throw new Error("a valid audio lease is required");
  const result = database.prepare(`UPDATE jobs SET status = 'leased', attempt = attempt + 1,
    lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ? AND type IN ('tts_es', 'tts_en') AND status IN ('queued', 'retry_wait')`)
    .run(leaseOwner, leaseExpiresAt.toISOString(), now.toISOString(), now.toISOString(), jobId);
  if (result.changes !== 1) throw new Error("audio job is not available");
}

export function completeDatabaseAudio(database, { jobId, result, artifactPath, checksumSha256, now = new Date() }) {
  if (!artifactPath || !SHA256.test(checksumSha256 ?? "") || result?.sha256 !== checksumSha256) {
    throw new Error("verified audio artifact identity is required");
  }
  return withTransaction(database, (connection) => {
    const job = connection.prepare("SELECT artifact_id, checkpoint_json FROM jobs WHERE id = ? AND type IN ('tts_es', 'tts_en')").get(jobId);
    if (!job) throw new Error("audio job was not found");
    const timestamp = now.toISOString(); const saved = checkpoint(job.checkpoint_json);
    const artifact = connection.prepare(`UPDATE artifacts SET status = 'accepted', path = ?, checksum_sha256 = ?,
      updated_at = ?, accepted_at = ? WHERE id = ? AND status = 'pending'`)
      .run(artifactPath, checksumSha256, timestamp, timestamp, job.artifact_id);
    if (artifact.changes !== 1) throw new Error("audio artifact is not pending");
    const completed = connection.prepare(`UPDATE jobs SET status = 'completed', checkpoint_json = ?, heartbeat_at = ?,
      finished_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'leased'`)
      .run(JSON.stringify({ ...saved, result }), timestamp, timestamp, jobId);
    if (completed.changes !== 1) throw new Error("audio job is not leased");
    return localeState(connection.prepare(`${SELECT_LOCALE} WHERE j.id = ?`).get(jobId));
  });
}

export function failDatabaseAudio(database, jobId, errorMessage, now = new Date()) {
  if (typeof errorMessage !== "string" || !errorMessage.trim()) throw new Error("audio failure is required");
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString();
    const job = connection.prepare(`UPDATE jobs SET status = 'failed', error_message = ?, heartbeat_at = ?,
      finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND type IN ('tts_es', 'tts_en') AND status IN ('queued', 'leased', 'retry_wait')`)
      .run(errorMessage.trim(), timestamp, timestamp, jobId);
    if (job.changes !== 1) throw new Error("audio job cannot be failed");
    connection.prepare(`UPDATE artifacts SET status = 'failed', updated_at = ?
      WHERE id = (SELECT artifact_id FROM jobs WHERE id = ?) AND status = 'pending'`).run(timestamp, jobId);
    return localeState(connection.prepare(`${SELECT_LOCALE} WHERE j.id = ?`).get(jobId));
  });
}
import { createHash, randomUUID } from "node:crypto";

import { withTransaction } from "./database.mjs";

const JOB_ID = /^(?:tts-(?:es|en)|upload-es)-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function audioDependencyHash(sourceRevision, policyRevision, uploaded = false) {
  if (!SHA256.test(sourceRevision ?? "") || (!uploaded && !SHA256.test(policyRevision ?? ""))) {
    throw new Error("audio dependency is invalid");
  }
  return createHash("sha256").update(JSON.stringify({
    sourceRevision, policyRevision: uploaded ? "owner-upload" : policyRevision,
  })).digest("hex");
}

function currentRevision(database, draft) {
  const row = database.prepare(`SELECT r.id AS revision_id, r.revision_number
    FROM articles a JOIN revisions r ON r.id = a.current_revision_id WHERE a.id = ?`).get(draft.articleId);
  if (!row || row.revision_number !== draft.revision) throw new Error("draft is not the current database revision");
  return row.revision_id;
}
