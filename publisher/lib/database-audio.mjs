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
  return {
    schemaVersion: 1,
    articleId,
    draftRevision: Math.max(...rows.map(({ revision_number }) => revision_number)),
    status: failed ? "failed" : completed === 2 ? "completed" : running ? "running" : "queued",
    workflow: checkpoint(rows[0].checkpoint_json).workflow ?? "legacy-import",
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
  if (!['es', 'en'].includes(locale) || state.jobs?.[locale]?.status !== "completed") {
    throw new Error("audio is not ready");
  }
  const path = state.jobs[locale].artifact?.path;
  if (typeof path !== "string" || !path) throw new Error("accepted audio artifact is missing");
  return path;
}
