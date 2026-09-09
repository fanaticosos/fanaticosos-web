import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { closeDatabase, openDatabase, withTransaction } from "./database.mjs";
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
      owner,
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

function publicCandidate(candidate, action) {
  const { owner, ...safe } = candidate;
  return { ...safe, action };
}

function analyze(database, candidates) {
  const articleQuery = database.prepare(`
    SELECT slug, current_revision_id, created_at, updated_at FROM articles WHERE id = ?
  `);
  const revisionQuery = database.prepare(`
    SELECT revision_number, status, title, description, body, category, season,
           tags_json, featured_image_json, created_at
    FROM revisions WHERE id = ? AND article_id = ?
  `);
  return candidates.map((candidate) => {
    const article = articleQuery.get(candidate.articleId);
    if (!article) return { candidate, action: "insert" };
    const revision = revisionQuery.get(candidate.revisionId, candidate.articleId);
    const unchanged = article.slug === candidate.slug
      && article.current_revision_id === candidate.revisionId
      && article.created_at === candidate.createdAt
      && article.updated_at === candidate.updatedAt
      && revision?.revision_number === candidate.revision
      && revision?.status === candidate.status
      && revision?.title === candidate.owner.title
      && revision?.description === candidate.owner.description
      && revision?.body === candidate.owner.body
      && revision?.category === candidate.owner.category
      && revision?.season === candidate.owner.season
      && revision?.tags_json === JSON.stringify(candidate.owner.tags)
      && revision?.featured_image_json === JSON.stringify(candidate.owner.featuredImage)
      && revision?.created_at === candidate.createdAt;
    return { candidate, action: unchanged ? "unchanged" : "conflict" };
  });
}

function report(rows) {
  return {
    schemaVersion: 1,
    source: "legacy-json-drafts",
    total: rows.length,
    insert: rows.filter(({ action }) => action === "insert").length,
    unchanged: rows.filter(({ action }) => action === "unchanged").length,
    conflicts: rows.filter(({ action }) => action === "conflict").length,
    drafts: rows.map(({ candidate, action }) => publicCandidate(candidate, action)),
  };
}

export async function previewDraftImport({ draftsRoot, databasePath }) {
  const candidates = await importCandidates(draftsRoot);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    return report(analyze(database, candidates));
  } finally {
    database.close();
  }
}

export async function applyDraftImport({ draftsRoot, databasePath }) {
  const candidates = await importCandidates(draftsRoot);
  const database = await openDatabase(databasePath);
  try {
    return withTransaction(database, (connection) => {
      const rows = analyze(connection, candidates);
      if (rows.some(({ action }) => action === "conflict")) {
        throw new Error("draft import conflicts with existing database state");
      }
      const insertArticle = connection.prepare(`
        INSERT INTO articles (id, slug, current_revision_id, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `);
      const insertRevision = connection.prepare(`
        INSERT INTO revisions (
          id, article_id, revision_number, status, title, description, body,
          category, season, tags_json, featured_image_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const selectRevision = connection.prepare(`
        UPDATE articles SET current_revision_id = ? WHERE id = ?
      `);
      for (const { candidate, action } of rows) {
        if (action !== "insert") continue;
        insertArticle.run(candidate.articleId, candidate.slug, candidate.createdAt, candidate.updatedAt);
        insertRevision.run(
          candidate.revisionId,
          candidate.articleId,
          candidate.revision,
          candidate.status,
          candidate.owner.title,
          candidate.owner.description,
          candidate.owner.body,
          candidate.owner.category,
          candidate.owner.season,
          JSON.stringify(candidate.owner.tags),
          JSON.stringify(candidate.owner.featuredImage),
          candidate.createdAt,
        );
        selectRevision.run(candidate.revisionId, candidate.articleId);
      }
      return { ...report(rows), applied: true };
    });
  } finally {
    closeDatabase(database);
  }
}
