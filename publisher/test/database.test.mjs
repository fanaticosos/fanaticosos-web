import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createVerifiedBackup, restoreVerifiedBackup, verifyDatabaseFile } from "../lib/database-backup.mjs";
import { closeDatabase, migrateDatabase, openDatabase, withTransaction } from "../lib/database.mjs";

async function fixture() {
  return mkdtemp(join(tmpdir(), "fanaticosos-database-test-"));
}

test("initial migration creates the contracted schema with foreign keys and WAL", async () => {
  const root = await fixture();
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(({ name }) => name);
    assert.deepEqual(tables, [
      "article_catalog_entries", "article_catalogs", "articles", "artifacts", "deployments",
      "jobs", "release_artifacts", "releases", "revisions", "schema_migrations",
      "site_settings_revisions",
    ]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
    const triggers = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all().map(({ name }) => name);
    assert.deepEqual(triggers, ["accepted_artifact_cannot_be_deleted", "accepted_artifact_content_is_immutable"]);
  } finally {
    closeDatabase(database);
  }
});

test("migration history is idempotent and rejects edited applied migrations", async () => {
  const root = await fixture();
  const path = join(root, "publisher.sqlite");
  let database = await openDatabase(path);
  await migrateDatabase(database);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
  closeDatabase(database);

  const migrationsRoot = join(root, "migrations");
  await mkdir(migrationsRoot);
  await writeFile(join(migrationsRoot, "001-initial-schema.sql"), "CREATE TABLE changed (id TEXT PRIMARY KEY) STRICT;\n");
  database = await openDatabase(path, { migrate: false });
  await assert.rejects(migrateDatabase(database, { migrationsRoot }), /checksum differs/);
  closeDatabase(database);
});

test("transaction helper commits complete changes and rolls back failures", async () => {
  const root = await fixture();
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    withTransaction(database, (connection) => {
      connection.prepare("INSERT INTO articles (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run("article-1", "article-one", "2026-09-09T00:00:00.000Z", "2026-09-09T00:00:00.000Z");
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM articles").get().count, 1);
    assert.throws(() => withTransaction(database, (connection) => {
      connection.prepare("INSERT INTO articles (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run("article-2", "article-two", "2026-09-09T00:00:00.000Z", "2026-09-09T00:00:00.000Z");
      throw new Error("forced failure");
    }), /forced failure/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM articles").get().count, 1);
  } finally {
    closeDatabase(database);
  }
});

test("read-only connections never change database permissions or contents", async () => {
  const root = await fixture();
  const path = join(root, "publisher.sqlite");
  const writable = await openDatabase(path);
  closeDatabase(writable);
  await chmod(path, 0o640);

  const database = await openDatabase(path, { readOnly: true, migrate: false });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
    assert.throws(() => database.prepare("DELETE FROM schema_migrations").run(), /read-only|readonly/i);
  } finally {
    closeDatabase(database);
  }
  assert.equal((await stat(path)).mode & 0o777, 0o640);
});

test("backup and restore are verified, private, and refuse overwrites", async () => {
  const root = await fixture();
  const sourcePath = join(root, "publisher.sqlite");
  const backupPath = join(root, "publisher.backup.sqlite");
  const restoredPath = join(root, "publisher.restored.sqlite");
  const database = await openDatabase(sourcePath);
  withTransaction(database, (connection) => {
    connection.prepare("INSERT INTO articles (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("article-1", "article-one", "2026-09-09T00:00:00.000Z", "2026-09-09T00:00:00.000Z");
  });
  const created = await createVerifiedBackup(database, backupPath);
  closeDatabase(database);

  assert.equal(created.integrity, "ok");
  assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  assert.equal(verifyDatabaseFile(backupPath).integrity, "ok");
  const backupDatabase = await openDatabase(backupPath);
  try {
    await assert.rejects(createVerifiedBackup(backupDatabase, backupPath), /refusing to overwrite/);
  } finally {
    closeDatabase(backupDatabase);
  }

  const restored = await restoreVerifiedBackup(backupPath, restoredPath);
  assert.equal(restored.integrity, "ok");
  assert.equal((await stat(restoredPath)).mode & 0o777, 0o600);
  const restoredDatabase = await openDatabase(restoredPath);
  assert.equal(restoredDatabase.prepare("SELECT slug FROM articles").get().slug, "article-one");
  closeDatabase(restoredDatabase);
  await assert.rejects(restoreVerifiedBackup(backupPath, restoredPath), /refusing to overwrite/);
});
