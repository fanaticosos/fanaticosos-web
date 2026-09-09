import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
        || !JOB.test(state.jobId ?? "") || !["queued", "running", "completed", "failed"].includes(state.status)) throw new Error(`legacy audiogram state is invalid: ${articleId}`);
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
