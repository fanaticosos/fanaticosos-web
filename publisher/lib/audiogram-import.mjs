import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, closeDatabase, withTransaction } from "./database.mjs";

const STATE = /^audiogram-([0-9a-f-]{36})\.json$/;
const JOB = /^audiogram-es-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

async function checksum(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

export async function previewAudiogramImport({ databasePath, statesRoot, jobsRoot }) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const candidates = [];
    for (const name of (await readdir(statesRoot)).filter((value) => STATE.test(value)).sort()) {
      const articleId = name.match(STATE)[1]; const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
      if (state.schemaVersion !== 1 || state.articleId !== articleId || !Number.isInteger(state.draftRevision)
        || !JOB.test(state.jobId ?? "") || !SHA256.test(state.audioSha256 ?? "")
        || !["queued", "running", "completed", "failed"].includes(state.status)) throw new Error(`legacy audiogram state is invalid: ${articleId}`);
      const revision = database.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?").get(articleId, state.draftRevision);
      if (!revision) throw new Error(`audiogram revision is missing from SQLite: ${articleId}`);
      let artifact = null;
      if (state.status === "completed") {
        const result = state.result; const path = join(jobsRoot, state.jobId, "video", basename(result?.file ?? ""));
        const metadata = await stat(path);
        if (!metadata.isFile() || metadata.size !== result.sizeBytes || !SHA256.test(result.sha256 ?? "") || await checksum(path) !== result.sha256) {
          throw new Error(`legacy audiogram artifact is invalid: ${articleId}`);
        }
        artifact = { path, sha256: result.sha256, sizeBytes: metadata.size };
      }
      candidates.push({ articleId, revisionId: revision.id, jobId: state.jobId, status: state.status, artifact });
    }
    return { count: candidates.length, completed: candidates.filter(({ status }) => status === "completed").length,
      failed: candidates.filter(({ status }) => status === "failed").length,
      active: candidates.filter(({ status }) => ["queued", "running"].includes(status)).length,
      verifiedArtifacts: candidates.filter(({ artifact }) => artifact).length };
  } finally { database.close(); }
}

export async function applyAudiogramImport({ databasePath, statesRoot, jobsRoot, artifactsRoot }) {
  await previewAudiogramImport({ databasePath, statesRoot, jobsRoot });
  const database = await openDatabase(databasePath); const created = [];
  try {
    const candidates = [];
    for (const name of (await readdir(statesRoot)).filter((value) => STATE.test(value)).sort()) {
      const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
      if (state.status !== "completed") continue;
      const source = join(jobsRoot, state.jobId, "video", basename(state.result.file));
      const directory = join(artifactsRoot, state.articleId); const path = join(directory, `${state.result.sha256}.mp4`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try { if (await checksum(path) !== state.result.sha256) throw new Error("stored audiogram artifact differs"); }
      catch (error) { if (error.code !== "ENOENT") throw error; await copyFile(source, path, constants.COPYFILE_EXCL); await chmod(path, 0o600); created.push(path); }
      candidates.push({ state, path });
    }
    const result = withTransaction(database, (connection) => {
      let inserted = 0; let unchanged = 0;
      for (const { state, path } of candidates) {
        const revision = connection.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?").get(state.articleId, state.draftRevision);
        const artifactId = `legacy:audiogram:${state.jobId}`; const existing = connection.prepare("SELECT checksum_sha256, path FROM artifacts WHERE id = ?").get(artifactId);
        if (existing) { if (existing.checksum_sha256 !== state.result.sha256 || existing.path !== path) throw new Error(`audiogram import conflict: ${state.articleId}`); unchanged += 1; continue; }
        const timestamp = state.updatedAt ?? state.createdAt ?? state.result.generatedAt;
        connection.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path, checksum_sha256, created_at, updated_at, accepted_at)
          VALUES (?, ?, 'audiogram', 'es', ?, 'accepted', ?, ?, ?, ?, ?)`)
          .run(artifactId, revision.id, state.audioSha256, path, state.result.sha256, state.createdAt ?? timestamp, timestamp, timestamp);
        connection.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash, status, checkpoint_json, available_at, created_at, started_at, finished_at)
          VALUES (?, 'audiogram', ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
          .run(state.jobId, revision.id, artifactId, `legacy:audiogram:${state.jobId}`, state.audioSha256,
            JSON.stringify({ schemaVersion: 1, result: state.result }), state.createdAt ?? timestamp, state.createdAt ?? timestamp, state.createdAt ?? timestamp, timestamp);
        inserted += 1;
      }
      return { inserted, unchanged };
    });
    created.length = 0; return result;
  } catch (error) { for (const path of created) await rm(path).catch(() => {}); throw error; }
  finally { closeDatabase(database); }
}
