import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { createDatabaseDraft, listDatabaseDrafts, readDatabaseDraft, updateDatabaseDraft } from "../lib/database-drafts.mjs";

const owner = {
  title: "Bears 2026",
  description: "Descripción",
  body: "Contenido",
  category: "Chicago Bears",
  season: 2026,
  tags: ["Bears"],
  status: "draft",
  featuredImage: {},
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-database-drafts-test-"));
  return openDatabase(join(root, "publisher.sqlite"));
}

test("database draft store creates, reloads, and lists the current revision", async () => {
  const database = await fixture();
  try {
    const created = createDatabaseDraft(database, owner, new Date("2026-09-09T00:00:00.000Z"));
    assert.equal(created.revision, 1);
    assert.deepEqual(readDatabaseDraft(database, created.articleId), created);
    assert.deepEqual(listDatabaseDrafts(database), [created]);
    assert.equal(database.prepare("SELECT slug FROM articles").get().slug, "bears-2026");
  } finally {
    closeDatabase(database);
  }
});

test("database draft update preserves no-ops and records revision history", async () => {
  const database = await fixture();
  try {
    const created = createDatabaseDraft(database, owner, new Date("2026-09-09T00:00:00.000Z"));
    assert.deepEqual(updateDatabaseDraft(database, created.articleId, 1, owner), created);
    const updated = updateDatabaseDraft(
      database,
      created.articleId,
      1,
      { ...owner, title: "Bears 2026 actualizado" },
      new Date("2026-09-09T01:00:00.000Z"),
    );
    assert.equal(updated.revision, 2);
    assert.equal(database.prepare("SELECT slug FROM articles").get().slug, "bears-2026-actualizado");
    assert.deepEqual(
      database.prepare("SELECT revision_number, status FROM revisions ORDER BY revision_number").all(),
      [{ revision_number: 1, status: "superseded" }, { revision_number: 2, status: "draft" }],
    );
    assert.throws(
      () => updateDatabaseDraft(database, created.articleId, 1, owner),
      /another browser session/,
    );
  } finally {
    closeDatabase(database);
  }
});
