import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readDatabaseDraft } from "./database-drafts.mjs";
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
      return { ...candidate, action };
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
