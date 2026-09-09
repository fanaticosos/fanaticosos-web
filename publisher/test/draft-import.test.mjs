import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { applyDraftImport, legacyRevisionId, previewDraftImport } from "../lib/draft-import.mjs";
import { newDraft, writeDraft } from "../lib/drafts.mjs";

const ownerFields = {
  title: "Temporada número 3",
  description: "Descripción",
  body: "Contenido",
  category: "Chicago Bears",
  season: 2026,
  tags: ["Bears"],
  status: "draft",
  featuredImage: {},
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-draft-import-test-"));
  const draftsRoot = join(root, "drafts");
  await mkdir(draftsRoot);
  const databasePath = join(root, "publisher.sqlite");
  const database = await openDatabase(databasePath);
  closeDatabase(database);
  return { draftsRoot, databasePath };
}

test("draft import preview validates legacy drafts and writes nothing", async () => {
  const { draftsRoot, databasePath } = await fixture();
  const draft = newDraft(ownerFields, new Date("2026-09-09T00:00:00.000Z"));
  await writeDraft(draftsRoot, draft);

  const preview = await previewDraftImport({ draftsRoot, databasePath });
  assert.equal(preview.total, 1);
  assert.equal(preview.insert, 1);
  assert.equal(preview.conflicts, 0);
  assert.deepEqual(preview.drafts[0], {
    articleId: draft.articleId,
    revision: 1,
    revisionId: legacyRevisionId(draft.articleId, 1),
    slug: "temporada-numero-3",
    status: "draft",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    action: "insert",
  });

  const database = await openDatabase(databasePath);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM articles").get().count, 0);
  closeDatabase(database);
});

test("draft import preview rejects canonical slug collisions", async () => {
  const { draftsRoot, databasePath } = await fixture();
  await writeDraft(draftsRoot, newDraft(ownerFields));
  await writeDraft(draftsRoot, newDraft({ ...ownerFields, title: "Temporada número 3!" }));
  await assert.rejects(
    previewDraftImport({ draftsRoot, databasePath }),
    /draft slug collision/,
  );
});

test("draft import applies complete snapshots atomically and is idempotent", async () => {
  const { draftsRoot, databasePath } = await fixture();
  const draft = newDraft(ownerFields, new Date("2026-09-09T00:00:00.000Z"));
  await writeDraft(draftsRoot, draft);

  const applied = await applyDraftImport({ draftsRoot, databasePath });
  assert.equal(applied.applied, true);
  assert.equal(applied.insert, 1);
  assert.equal((await applyDraftImport({ draftsRoot, databasePath })).unchanged, 1);
  assert.equal((await previewDraftImport({ draftsRoot, databasePath })).unchanged, 1);

  const database = await openDatabase(databasePath);
  const stored = database.prepare(`
    SELECT articles.slug, articles.current_revision_id, revisions.*
    FROM articles JOIN revisions ON revisions.id = articles.current_revision_id
    WHERE articles.id = ?
  `).get(draft.articleId);
  assert.equal(stored.slug, "temporada-numero-3");
  assert.equal(stored.current_revision_id, legacyRevisionId(draft.articleId, 1));
  assert.equal(stored.title, ownerFields.title);
  assert.equal(stored.body, ownerFields.body);
  assert.deepEqual(JSON.parse(stored.tags_json), ownerFields.tags);
  closeDatabase(database);
});
