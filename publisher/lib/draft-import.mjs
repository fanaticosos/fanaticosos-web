import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readDraft, validateOwnerFields } from "./drafts.mjs";
import { slugify } from "./release.mjs";

const DRAFT_FILE = /^([0-9a-f-]{36})\.json$/;

export function legacyRevisionId(articleId, revision) {
  return `legacy:${articleId}:r${revision}`;
}

function validTimestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

async function importCandidates(draftsRoot) {
  const names = (await readdir(draftsRoot)).filter((name) => DRAFT_FILE.test(name)).sort();
  if (names.length === 0) throw new Error("no legacy drafts were found");
  const candidates = [];
  for (const name of names) {
    const articleId = name.match(DRAFT_FILE)[1];
    const draft = await readDraft(draftsRoot, articleId);
    const owner = validateOwnerFields(draft);
    const slug = slugify(owner.title);
    if (!slug) throw new Error(`draft produces an empty slug: ${articleId}`);
    candidates.push({
      articleId,
      revision: draft.revision,
      revisionId: legacyRevisionId(articleId, draft.revision),
      slug,
      status: owner.status,
      createdAt: validTimestamp(draft.createdAt, "createdAt"),
      updatedAt: validTimestamp(draft.updatedAt, "updatedAt"),
    });
  }
  const slugs = new Map();
  for (const candidate of candidates) {
    const other = slugs.get(candidate.slug);
    if (other) throw new Error(`draft slug collision: ${other} and ${candidate.articleId}`);
    slugs.set(candidate.slug, candidate.articleId);
  }
  return candidates;
}

export async function previewDraftImport({ draftsRoot, databasePath }) {
  const candidates = await importCandidates(draftsRoot);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const articleQuery = database.prepare("SELECT slug, current_revision_id FROM articles WHERE id = ?");
    const revisionQuery = database.prepare(`
      SELECT revision_number, status FROM revisions WHERE id = ? AND article_id = ?
    `);
    const rows = candidates.map((candidate) => {
      const article = articleQuery.get(candidate.articleId);
      if (!article) return { ...candidate, action: "insert" };
      const revision = revisionQuery.get(candidate.revisionId, candidate.articleId);
      const unchanged = article.slug === candidate.slug
        && article.current_revision_id === candidate.revisionId
        && revision?.revision_number === candidate.revision
        && revision?.status === candidate.status;
      return { ...candidate, action: unchanged ? "unchanged" : "conflict" };
    });
    return {
      schemaVersion: 1,
      source: "legacy-json-drafts",
      total: rows.length,
      insert: rows.filter(({ action }) => action === "insert").length,
      unchanged: rows.filter(({ action }) => action === "unchanged").length,
      conflicts: rows.filter(({ action }) => action === "conflict").length,
      drafts: rows,
    };
  } finally {
    database.close();
  }
}
