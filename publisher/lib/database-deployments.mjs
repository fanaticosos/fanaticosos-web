import { withTransaction } from "./database.mjs";

const RELEASE_JOB = /^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const DEPLOYMENT_TIMEOUT_MS = 15 * 60 * 1000;

const SELECT_DEPLOYMENT = `
  SELECT d.id AS deployment_id, d.release_id, d.status AS deployment_status,
         d.verification_json, d.created_at AS deployment_created_at,
         d.published_at, d.finished_at AS deployment_finished_at,
         d.error_message AS deployment_error,
         j.status AS job_status, j.created_at AS job_created_at,
         j.started_at, j.heartbeat_at, j.finished_at AS job_finished_at,
         r.article_id, r.revision_number
  FROM deployments d JOIN releases rel ON rel.id = d.release_id
  JOIN jobs release_job ON release_job.id = rel.id
  JOIN revisions r ON r.id = release_job.revision_id
  LEFT JOIN jobs j ON j.id = d.id AND j.type = 'deployment'
`;

function state(row) {
  if (!row) return null;
  const statuses = { queued: "queued", uploading: "running", verifying: "running", published: "completed", failed: "failed", rolled_back: "failed" };
  return {
    schemaVersion: 1, articleId: row.article_id, draftRevision: row.revision_number,
    releaseJobId: row.release_id, jobId: row.deployment_id,
    status: statuses[row.deployment_status], createdAt: row.deployment_created_at,
    updatedAt: row.deployment_finished_at ?? row.heartbeat_at ?? row.started_at ?? row.deployment_created_at,
    ...(row.verification_json ? { receipt: JSON.parse(row.verification_json) } : {}),
    ...(row.deployment_error ? { error: row.deployment_error } : {}),
  };
}

function failStale(connection, now) {
  const cutoff = new Date(now.getTime() - DEPLOYMENT_TIMEOUT_MS).toISOString();
  const stale = connection.prepare(`SELECT id FROM deployments
    WHERE status IN ('queued','uploading','verifying') AND created_at < ?`).all(cutoff);
  for (const { id } of stale) {
    connection.prepare(`UPDATE deployments SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?`)
      .run(now.toISOString(), "La publicación anterior se detuvo y fue liberada automáticamente.", id);
    connection.prepare(`UPDATE jobs SET status = 'failed', finished_at = ?, heartbeat_at = ?, error_message = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND status IN ('queued','leased','retry_wait')`)
      .run(now.toISOString(), now.toISOString(), "La publicación anterior se detuvo y fue liberada automáticamente.", id);
  }
}

export function queueDatabaseDeployment(database, { articleId, draftRevision, releaseJobId, now = new Date() }) {
  if (!RELEASE_JOB.test(releaseJobId ?? "")) throw new Error("validated release is required");
  return withTransaction(database, (connection) => {
    failStale(connection, now);
    const id = `deploy-${releaseJobId}`;
    const existing = connection.prepare(`${SELECT_DEPLOYMENT} WHERE d.id = ?`).get(id);
    if (existing) return state(existing);
    const active = connection.prepare(`SELECT 1 FROM deployments WHERE status IN ('queued','uploading','verifying')
      UNION ALL SELECT 1 FROM jobs WHERE type = 'music_release' AND status IN ('queued','leased','retry_wait') LIMIT 1`).get();
    if (active) throw new Error("Ya hay una publicación en curso.");
    const release = connection.prepare(`SELECT rel.manifest_checksum_sha256, release_job.revision_id
      FROM releases rel JOIN jobs release_job ON release_job.id = rel.id
      JOIN revisions r ON r.id = release_job.revision_id
      WHERE rel.id = ? AND rel.status = 'validated' AND release_job.status = 'completed'
        AND r.article_id = ? AND r.revision_number = ?`).get(releaseJobId, articleId, draftRevision);
    if (!release) throw new Error("validated release is required");
    const timestamp = now.toISOString();
    connection.prepare(`INSERT INTO deployments (id, release_id, status, created_at) VALUES (?, ?, 'queued', ?)`)
      .run(id, releaseJobId, timestamp);
    connection.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
      status, checkpoint_json, available_at, created_at) VALUES (?, 'deployment', ?, NULL, ?, ?, 'queued', ?, ?, ?)`)
      .run(id, release.revision_id, `deployment:${releaseJobId}`, release.manifest_checksum_sha256,
        JSON.stringify({ schemaVersion: 1, releaseJobId }), timestamp, timestamp);
    return state(connection.prepare(`${SELECT_DEPLOYMENT} WHERE d.id = ?`).get(id));
  });
}

export function readDatabaseDeploymentState(database, articleId) {
  const row = database.prepare(`${SELECT_DEPLOYMENT} WHERE r.article_id = ?
    ORDER BY d.created_at DESC, d.id DESC LIMIT 1`).get(articleId);
  if (!row) { const error = new Error("deployment state was not found"); error.code = "ENOENT"; throw error; }
  return state(row);
}

export function listActiveDatabaseDeployments(database) {
  return database.prepare(`${SELECT_DEPLOYMENT} WHERE d.status IN ('queued','uploading','verifying') ORDER BY d.created_at`).all().map(state);
}

export function startDatabaseDeployment(database, deploymentId, now = new Date()) {
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString(); const expires = new Date(now.getTime() + DEPLOYMENT_TIMEOUT_MS).toISOString();
    const deployment = connection.prepare("UPDATE deployments SET status = 'uploading' WHERE id = ? AND status = 'queued'").run(deploymentId);
    const job = connection.prepare(`UPDATE jobs SET status = 'leased', attempt = attempt + 1, lease_owner = 'systemd',
      lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'queued'`)
      .run(expires, timestamp, timestamp, deploymentId);
    if (deployment.changes !== 1 || job.changes !== 1) throw new Error("deployment is not queued");
  });
}

export function completeDatabaseDeployment(database, deploymentId, receipt, now = new Date()) {
  if (receipt?.schemaVersion !== 1 || receipt.environment !== "production" || receipt.jobId !== deploymentId.replace(/^deploy-/, "")
    || !/^https:\/\/[a-zA-Z0-9.-]+\.pages\.dev$/.test(receipt.url ?? "") || !Number.isFinite(Date.parse(receipt.validatedAt ?? ""))) {
    throw new Error("production deployment receipt is invalid");
  }
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString(); const cloudflareId = new URL(receipt.url).hostname.split(".")[0];
    const previous = connection.prepare("SELECT id FROM deployments WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1").get();
    const deployment = connection.prepare(`UPDATE deployments SET status = 'published', cloudflare_deployment_id = ?, immutable_url = ?,
      verification_json = ?, previous_deployment_id = ?, published_at = ?, finished_at = ? WHERE id = ? AND status IN ('uploading','verifying')`)
      .run(cloudflareId, receipt.url, JSON.stringify(receipt), previous?.id ?? null, receipt.validatedAt, timestamp, deploymentId);
    const job = connection.prepare(`UPDATE jobs SET status = 'completed', checkpoint_json = ?, heartbeat_at = ?, finished_at = ?,
      lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'leased'`)
      .run(JSON.stringify({ schemaVersion: 1, receipt }), timestamp, timestamp, deploymentId);
    if (deployment.changes !== 1 || job.changes !== 1) throw new Error("deployment is not running");
    return state(connection.prepare(`${SELECT_DEPLOYMENT} WHERE d.id = ?`).get(deploymentId));
  });
}

export function failDatabaseDeployment(database, deploymentId, message, now = new Date()) {
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString();
    const deployment = connection.prepare(`UPDATE deployments SET status = 'failed', finished_at = ?, error_message = ?
      WHERE id = ? AND status IN ('queued','uploading','verifying')`).run(timestamp, message, deploymentId);
    connection.prepare(`UPDATE jobs SET status = 'failed', error_message = ?, heartbeat_at = ?, finished_at = ?,
      lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status IN ('queued','leased','retry_wait')`)
      .run(message, timestamp, timestamp, deploymentId);
    if (deployment.changes !== 1) throw new Error("deployment cannot be failed");
    return state(connection.prepare(`${SELECT_DEPLOYMENT} WHERE d.id = ?`).get(deploymentId));
  });
}
