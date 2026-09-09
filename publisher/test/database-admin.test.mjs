import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { backupDatabase, databaseStatus, initializeDatabase, restoreDatabaseDrill } from "../lib/database-admin.mjs";

test("database administration initializes, backs up, and proves a clean restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-database-admin-test-"));
  const databaseRoot = join(root, "database");
  const backupRoot = join(root, "backups");
  await Promise.all([
    mkdir(databaseRoot, { mode: 0o700 }),
    mkdir(backupRoot, { mode: 0o700 }),
  ]);
  const databasePath = join(databaseRoot, "publisher.sqlite");

  const initialized = await initializeDatabase(databasePath);
  assert.equal(initialized.created, true);
  assert.equal(initialized.integrity, "ok");
  assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
  assert.equal((await initializeDatabase(databasePath)).created, false);
  assert.equal(databaseStatus(databasePath).integrity, "ok");

  const backupId = "db-20260909T180000Z";
  const createdBackup = await backupDatabase(databasePath, backupRoot, backupId);
  assert.equal(createdBackup.integrity, "ok");
  assert.equal((await stat(createdBackup.path)).mode & 0o777, 0o600);
  await assert.rejects(backupDatabase(databasePath, backupRoot, backupId), /refusing to overwrite/);

  const drill = await restoreDatabaseDrill(backupRoot, backupId);
  assert.equal(drill.integrity, "ok");
  assert.deepEqual((await readdir(backupRoot)).sort(), [`${backupId}.sqlite`]);
  await assert.rejects(restoreDatabaseDrill(backupRoot, "latest"), /invalid database backup ID/);
});
