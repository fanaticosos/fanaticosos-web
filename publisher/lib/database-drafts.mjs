import { randomUUID } from "node:crypto";

import { withTransaction } from "./database.mjs";
import { validateOwnerFields } from "./drafts.mjs";
import { slugify } from "./release.mjs";

const SELECT_DRAFT = `
  SELECT a.id AS article_id, a.created_at AS article_created_at, a.updated_at,
         r.revision_number, r.status, r.title, r.description, r.body,
         r.category, r.season, r.tags_json, r.featured_image_json
  FROM articles a
  JOIN revisions r ON r.id = a.current_revision_id
`;

function storedDraft(row) {
  if (!row) return null;
  return {
    schemaVersion: 1,
    articleId: row.article_id,
    revision: row.revision_number,
    createdAt: row.article_created_at,
    updatedAt: row.updated_at,
    title: row.title,
    description: row.description,
    body: row.body,
    category: row.category,
    season: row.season,
    tags: JSON.parse(row.tags_json),
    status: row.status,
    featuredImage: JSON.parse(row.featured_image_json),
  };
}

function insertRevision(database, articleId, revision, owner, createdAt) {
  const revisionId = randomUUID();
  database.prepare(`
    INSERT INTO revisions (
      id, article_id, revision_number, status, title, description, body,
      category, season, tags_json, featured_image_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revisionId, articleId, revision, owner.status, owner.title, owner.description,
    owner.body, owner.category, owner.season, JSON.stringify(owner.tags),
    JSON.stringify(owner.featuredImage), createdAt,
  );
  return revisionId;
}

export function createDatabaseDraft(database, ownerFields, now = new Date()) {
  const owner = validateOwnerFields(ownerFields);
  const timestamp = now.toISOString();
  return withTransaction(database, (connection) => {
    const articleId = randomUUID();
    connection.prepare(`
      INSERT INTO articles (id, slug, current_revision_id, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?)
    `).run(articleId, slugify(owner.title), timestamp, timestamp);
    const revisionId = insertRevision(connection, articleId, 1, owner, timestamp);
    connection.prepare("UPDATE articles SET current_revision_id = ? WHERE id = ?")
      .run(revisionId, articleId);
    return readDatabaseDraft(connection, articleId);
  });
}

export function readDatabaseDraft(database, articleId) {
  const row = database.prepare(`${SELECT_DRAFT} WHERE a.id = ?`).get(articleId);
  if (!row) {
    const error = new Error("draft was not found");
    error.code = "ENOENT";
    throw error;
  }
  return storedDraft(row);
}

export function listDatabaseDrafts(database) {
  return database.prepare(`${SELECT_DRAFT} ORDER BY a.updated_at DESC`).all().map(storedDraft);
}

export function updateDatabaseDraft(database, articleId, expectedRevision, ownerFields, now = new Date()) {
  const owner = validateOwnerFields(ownerFields);
  return withTransaction(database, (connection) => {
    const existing = readDatabaseDraft(connection, articleId);
    if (existing.revision !== expectedRevision) {
      throw new Error("draft was changed in another browser session");
    }
    if (JSON.stringify(validateOwnerFields(existing)) === JSON.stringify(owner)) return existing;

    const timestamp = now.toISOString();
    const current = connection.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(articleId);
    connection.prepare("UPDATE revisions SET status = 'superseded' WHERE id = ?")
      .run(current.current_revision_id);
    const revisionId = insertRevision(connection, articleId, expectedRevision + 1, owner, timestamp);
    connection.prepare(`
      UPDATE articles SET slug = ?, current_revision_id = ?, updated_at = ? WHERE id = ?
    `).run(slugify(owner.title), revisionId, timestamp, articleId);
    return readDatabaseDraft(connection, articleId);
  });
}
