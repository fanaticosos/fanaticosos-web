import { createHash, randomUUID } from "node:crypto";
import { withTransaction } from "./database.mjs";

const JOB_ID = /^audiogram-es-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SELECT = `SELECT j.id AS job_id, j.status AS job_status, j.dependency_hash, j.checkpoint_json,
  j.error_message, j.created_at, j.started_at, j.heartbeat_at, j.finished_at,
  r.article_id, r.revision_number, a.id AS artifact_id, a.status AS artifact_status,
  a.path AS artifact_path, a.checksum_sha256 FROM jobs j
  JOIN revisions r ON r.id = j.revision_id JOIN artifacts a ON a.id = j.artifact_id`;

function saved(value) { return value ? JSON.parse(value) : {}; }
function state(row) {
  if (!row) return null; const checkpoint = saved(row.checkpoint_json);
  const statuses = { queued: "queued", leased: "running", retry_wait: "queued", completed: "completed", failed: "failed", cancelled: "failed" };
  return { schemaVersion: 1, articleId: row.article_id, draftRevision: row.revision_number,
    jobId: row.job_id, status: statuses[row.job_status], audioSha256: checkpoint.audioSha256 ?? row.dependency_hash,
    createdAt: row.created_at, updatedAt: row.finished_at ?? row.heartbeat_at ?? row.started_at ?? row.created_at,
    ...(checkpoint.result ? { result: checkpoint.result } : {}), ...(row.error_message ? { error: row.error_message } : {}),
    artifact: { id: row.artifact_id, status: row.artifact_status, path: row.artifact_path, sha256: row.checksum_sha256 } };
}

export function queueDatabaseAudiogram(database, { draft, request, jobId, now = new Date() }) {
  if (!JOB_ID.test(jobId ?? "") || request.articleId !== draft.articleId || request.draftRevision !== draft.revision || !SHA256.test(request.audioSha256 ?? "")) throw new Error("audiogram request identity is invalid");
  const dependency = createHash("sha256").update(JSON.stringify(request)).digest("hex"); const key = `audiogram:${dependency}`;
  return withTransaction(database, (connection) => {
    const existing = connection.prepare(`${SELECT} WHERE j.idempotency_key = ?`).get(key); if (existing) return state(existing);
    if (connection.prepare("SELECT 1 FROM jobs WHERE type = 'audiogram' AND status IN ('queued','leased','retry_wait')").get()) throw new Error("Ya hay un video preparándose.");
    const revision = connection.prepare(`SELECT r.id FROM articles ar JOIN revisions r ON r.id = ar.current_revision_id
      WHERE ar.id = ? AND r.revision_number = ?`).get(draft.articleId, draft.revision);
    const audio = connection.prepare("SELECT id FROM artifacts WHERE type = 'audio' AND locale = 'es' AND status = 'accepted' AND checksum_sha256 = ?").get(request.audioSha256);
    if (!revision || !audio) throw new Error("completed current Spanish audio is required for the audiogram");
    const artifactId = randomUUID(); const timestamp = now.toISOString();
    connection.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, created_at, updated_at)
      VALUES (?, ?, 'audiogram', 'es', ?, 'pending', ?, ?)`).run(artifactId, revision.id, dependency, timestamp, timestamp);
    connection.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash, status, checkpoint_json, available_at, created_at)
      VALUES (?, 'audiogram', ?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .run(jobId, revision.id, artifactId, key, dependency, JSON.stringify({ schemaVersion: 1, audioSha256: request.audioSha256 }), timestamp, timestamp);
    return state(connection.prepare(`${SELECT} WHERE j.id = ?`).get(jobId));
  });
}

export function readDatabaseAudiogramState(database, articleId) {
  const row = database.prepare(`${SELECT} WHERE r.article_id = ? AND j.type = 'audiogram' ORDER BY j.created_at DESC, j.id DESC LIMIT 1`).get(articleId);
  if (!row) { const error = new Error("audiogram state was not found"); error.code = "ENOENT"; throw error; } return state(row);
}
export function listActiveDatabaseAudiograms(database) { return database.prepare(`${SELECT} WHERE j.type = 'audiogram' AND j.status IN ('queued','leased','retry_wait') ORDER BY j.created_at`).all().map(state); }
export function startDatabaseAudiogram(database, jobId, now = new Date()) {
  const result = database.prepare(`UPDATE jobs SET status='leased', attempt=attempt+1, lease_owner='systemd', lease_expires_at=?, heartbeat_at=?, started_at=COALESCE(started_at,?)
    WHERE id=? AND type='audiogram' AND status IN ('queued','retry_wait')`).run(new Date(now.getTime()+35*60*1000).toISOString(), now.toISOString(), now.toISOString(), jobId);
  if (result.changes !== 1) throw new Error("audiogram job is not available");
}
export function completeDatabaseAudiogram(database, { jobId, result, artifactPath, now = new Date() }) {
  if (!artifactPath || !SHA256.test(result?.sha256 ?? "")) throw new Error("verified audiogram artifact is required");
  return withTransaction(database, (connection) => {
    const job = connection.prepare("SELECT artifact_id, checkpoint_json FROM jobs WHERE id=? AND type='audiogram'").get(jobId); const timestamp=now.toISOString();
    if (!job) throw new Error("audiogram job was not found");
    const artifact = connection.prepare(`UPDATE artifacts SET status='accepted', path=?, checksum_sha256=?, updated_at=?, accepted_at=? WHERE id=? AND status='pending'`)
      .run(artifactPath,result.sha256,timestamp,timestamp,job.artifact_id);
    const completed = connection.prepare(`UPDATE jobs SET status='completed', checkpoint_json=?, heartbeat_at=?, finished_at=?, lease_owner=NULL, lease_expires_at=NULL WHERE id=? AND status='leased'`)
      .run(JSON.stringify({ ...saved(job.checkpoint_json), result }),timestamp,timestamp,jobId);
    if (artifact.changes!==1 || completed.changes!==1) throw new Error("audiogram job is not running"); return state(connection.prepare(`${SELECT} WHERE j.id=?`).get(jobId));
  });
}
export function failDatabaseAudiogram(database, jobId, message, now=new Date()) {
  return withTransaction(database, (connection) => { const timestamp=now.toISOString(); const job=connection.prepare(`UPDATE jobs SET status='failed', error_message=?, heartbeat_at=?, finished_at=?, lease_owner=NULL, lease_expires_at=NULL WHERE id=? AND type='audiogram' AND status IN ('queued','leased','retry_wait')`).run(message,timestamp,timestamp,jobId); if(job.changes!==1) throw new Error("audiogram job cannot be failed"); connection.prepare("UPDATE artifacts SET status='failed', updated_at=? WHERE id=(SELECT artifact_id FROM jobs WHERE id=?) AND status='pending'").run(timestamp,jobId); return state(connection.prepare(`${SELECT} WHERE j.id=?`).get(jobId)); });
}
