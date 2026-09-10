import { createHash } from "node:crypto";

import { withTransaction } from "./database.mjs";

const RELEASE_JOB = /^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function checkpoint(value) { return value ? JSON.parse(value) : {}; }

const SELECT_RELEASE = `
  SELECT rel.id AS release_id, rel.status AS release_status, rel.path,
         rel.manifest_json, rel.manifest_checksum_sha256, rel.created_at AS release_created_at,
         rel.validated_at, rel.error_message AS release_error,
         j.id AS job_id, j.status AS job_status, j.dependency_hash, j.checkpoint_json,
         j.created_at, j.started_at, j.heartbeat_at, j.finished_at, j.error_message,
         r.article_id, r.revision_number
  FROM jobs j JOIN revisions r ON r.id = j.revision_id
  JOIN releases rel ON rel.id = j.id
`;

function state(row) {
  if (!row) return null; const saved = checkpoint(row.checkpoint_json);
  const statuses = { queued: "queued", leased: "running", retry_wait: "queued", completed: "completed", failed: "failed", cancelled: "failed" };
  return { schemaVersion: 1, articleId: row.article_id, draftRevision: row.revision_number,
    jobId: row.job_id, status: statuses[row.job_status], createdAt: row.created_at,
    updatedAt: row.finished_at ?? row.heartbeat_at ?? row.started_at ?? row.created_at,
    ...(saved.manifest ? { manifest: saved.manifest } : {}),
    ...(row.error_message ? { error: row.error_message } : {}) };
}

function currentRevision(database, draft) {
  const row = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId);
  const revision = row && database.prepare("SELECT id, revision_number FROM revisions WHERE id = ?").get(row.current_revision_id);
  if (!revision || revision.revision_number !== draft.revision) throw new Error("draft is not the current database revision");
  return revision.id;
}

export function releaseDependency({ draft, translation, audio }) {
  return digest({ articleId: draft.articleId, revision: draft.revision,
    translation: translation.artifact?.sha256, esAudio: audio.jobs?.es?.result?.sha256,
    enAudio: audio.jobs?.en?.result?.sha256, featuredImage: draft.featuredImage });
}

export function queueDatabaseRelease(database, { draft, translation, audio, imageArtifact = null, jobId, path, settings, publishedAt, now = new Date() }) {
  if (!RELEASE_JOB.test(jobId ?? "") || typeof path !== "string" || !path) throw new Error("release job identity is invalid");
  if (!Number.isFinite(Date.parse(publishedAt ?? ""))) throw new Error("release publication date is invalid");
  const dependencyHash = releaseDependency({ draft, translation, audio }); const key = `release:${dependencyHash}`;
  return withTransaction(database, (connection) => {
    const existing = connection.prepare(`${SELECT_RELEASE} WHERE j.type = 'release' AND j.dependency_hash = ?
      ORDER BY j.created_at DESC, j.id DESC LIMIT 1`).get(dependencyHash);
    if (existing && !["failed", "cancelled"].includes(existing.job_status)) return state(existing);
    const effectiveKey = existing ? `${key}:retry:${jobId}` : key;
    if (connection.prepare("SELECT 1 FROM jobs WHERE type = 'release' AND status IN ('queued', 'leased', 'retry_wait')").get()) throw new Error("Ya hay una preparación de publicación en curso.");
    const revisionId = currentRevision(connection, draft); const timestamp = now.toISOString();
    const previousEntries = connection.prepare(`SELECT e.article_id, e.revision_id, e.position
      FROM article_catalog_entries e WHERE e.catalog_id = (
        SELECT rel.catalog_id FROM deployments d JOIN releases rel ON rel.id = d.release_id
        WHERE d.status = 'published' ORDER BY d.published_at DESC, d.id DESC LIMIT 1
      ) ORDER BY e.position`).all();
    const seen = new Set(); const entries = [{ article_id: draft.articleId, revision_id: revisionId }]; seen.add(draft.articleId);
    for (const entry of previousEntries) if (!seen.has(entry.article_id)) { entries.push(entry); seen.add(entry.article_id); }
    const catalogId = `catalog:${digest(entries.map(({ article_id, revision_id }) => [article_id, revision_id]))}`;
    connection.prepare("INSERT OR IGNORE INTO article_catalogs (id, created_at) VALUES (?, ?)").run(catalogId, timestamp);
    const insertEntry = connection.prepare("INSERT OR IGNORE INTO article_catalog_entries (catalog_id, article_id, revision_id, position) VALUES (?, ?, ?, ?)");
    entries.forEach((entry, position) => insertEntry.run(catalogId, entry.article_id, entry.revision_id, position));
    const settingsJson = JSON.stringify(settings); const settingsId = `settings:${digest(settings)}`;
    connection.prepare("INSERT OR IGNORE INTO site_settings_revisions (id, settings_json, created_at) VALUES (?, ?, ?)").run(settingsId, settingsJson, timestamp);
    connection.prepare(`INSERT INTO releases (id, catalog_id, site_settings_revision_id, status, path, created_at)
      VALUES (?, ?, ?, 'building', ?, ?)`).run(jobId, catalogId, settingsId, path, timestamp);
    if (draft.featuredImage?.path) {
      if (!imageArtifact?.id || !imageArtifact.path || !SHA256.test(imageArtifact.sha256 ?? "")) throw new Error("release image artifact is invalid");
      connection.prepare(`INSERT OR IGNORE INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path,
        checksum_sha256, created_at, updated_at, accepted_at) VALUES (?, ?, 'image', NULL, ?, 'accepted', ?, ?, ?, ?, ?)`)
        .run(imageArtifact.id, revisionId, imageArtifact.sha256, imageArtifact.path, imageArtifact.sha256, timestamp, timestamp, timestamp);
      const stored = connection.prepare("SELECT revision_id, type, status, path, checksum_sha256 FROM artifacts WHERE id = ?").get(imageArtifact.id);
      if (stored?.revision_id !== revisionId || stored.type !== "image" || stored.status !== "accepted"
        || stored.path !== imageArtifact.path || stored.checksum_sha256 !== imageArtifact.sha256) throw new Error("release image artifact conflicts with SQLite");
    }
    const boundArtifacts = [translation.artifact, audio.jobs?.es?.artifact, audio.jobs?.en?.artifact, imageArtifact].filter(Boolean);
    const insertArtifact = connection.prepare(`INSERT INTO release_artifacts (release_id, artifact_id, checksum_sha256)
      SELECT ?, id, checksum_sha256 FROM artifacts
      WHERE id = ? AND status = 'accepted' AND checksum_sha256 = ?`);
    for (const artifact of boundArtifacts) {
      if (!artifact?.id || !SHA256.test(artifact.sha256 ?? "") || insertArtifact.run(jobId, artifact.id, artifact.sha256).changes !== 1) {
        throw new Error("release requires accepted immutable translation and audio artifacts");
      }
    }
    connection.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
      status, checkpoint_json, available_at, created_at) VALUES (?, 'release', ?, NULL, ?, ?, 'queued', ?, ?, ?)`)
      .run(jobId, revisionId, effectiveKey, dependencyHash, JSON.stringify({ schemaVersion: 1, publishedAt }), timestamp, timestamp);
    return state(connection.prepare(`${SELECT_RELEASE} WHERE j.id = ?`).get(jobId));
  });
}

export function readDatabaseReleaseImageArtifact(database, releaseId) {
  const rows = database.prepare(`SELECT a.id, a.path, a.checksum_sha256 AS sha256
    FROM release_artifacts ra JOIN artifacts a ON a.id = ra.artifact_id
    WHERE ra.release_id = ? AND a.type = 'image' AND a.status = 'accepted'`).all(releaseId);
  if (rows.length > 1) throw new Error("release has multiple image artifacts");
  return rows[0] ?? null;
}

export function readDatabaseReleaseState(database, articleId) {
  const row = database.prepare(`${SELECT_RELEASE} WHERE r.article_id = ? ORDER BY j.created_at DESC, j.id DESC LIMIT 1`).get(articleId);
  if (!row) { const error = new Error("release state was not found"); error.code = "ENOENT"; throw error; }
  return state(row);
}

export function listActiveDatabaseReleases(database) {
  return database.prepare(`${SELECT_RELEASE} WHERE j.status IN ('queued', 'leased', 'retry_wait') ORDER BY j.created_at`).all().map(state);
}

export function startDatabaseRelease(database, jobId, leaseExpiresAt, now = new Date()) {
  const changed = database.prepare(`UPDATE jobs SET status = 'leased', attempt = attempt + 1, lease_owner = 'systemd',
    lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND type = 'release' AND status IN ('queued','retry_wait')`)
    .run(leaseExpiresAt.toISOString(), now.toISOString(), now.toISOString(), jobId);
  if (changed.changes !== 1) throw new Error("release job is not available");
}

export function completeDatabaseRelease(database, jobId, manifest, manifestChecksum, now = new Date()) {
  if (!SHA256.test(manifestChecksum ?? "")) throw new Error("release manifest checksum is invalid");
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString(); const row = connection.prepare("SELECT checkpoint_json FROM jobs WHERE id = ? AND type = 'release'").get(jobId);
    if (!row) throw new Error("release job was not found"); const saved = checkpoint(row.checkpoint_json);
    const release = connection.prepare(`UPDATE releases SET status = 'validated', manifest_json = ?, manifest_checksum_sha256 = ?, validated_at = ? WHERE id = ? AND status = 'building'`)
      .run(JSON.stringify(manifest), manifestChecksum, timestamp, jobId);
    const job = connection.prepare(`UPDATE jobs SET status = 'completed', checkpoint_json = ?, finished_at = ?, heartbeat_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'leased'`)
      .run(JSON.stringify({ ...saved, manifest }), timestamp, timestamp, jobId);
    if (release.changes !== 1 || job.changes !== 1) throw new Error("release job is not running");
    return state(connection.prepare(`${SELECT_RELEASE} WHERE j.id = ?`).get(jobId));
  });
}

export function failDatabaseRelease(database, jobId, message, now = new Date()) {
  return withTransaction(database, (connection) => {
    const timestamp = now.toISOString();
    const job = connection.prepare(`UPDATE jobs SET status = 'failed', error_message = ?, finished_at = ?, heartbeat_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND type = 'release' AND status IN ('queued','leased','retry_wait')`).run(message, timestamp, timestamp, jobId);
    if (job.changes !== 1) throw new Error("release job cannot be failed");
    connection.prepare("UPDATE releases SET status = 'failed', error_message = ? WHERE id = ? AND status = 'building'").run(message, jobId);
    return state(connection.prepare(`${SELECT_RELEASE} WHERE j.id = ?`).get(jobId));
  });
}
