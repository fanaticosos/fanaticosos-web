import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { createVerifiedBackup, restoreVerifiedBackup, verifyDatabaseFile } from "./database-backup.mjs";
import { closeDatabase, openDatabase } from "./database.mjs";

export const BACKUP_ID = /^db-[0-9]{8}T[0-9]{6}Z$/;

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function initializeDatabase(path) {
  const created = !(await exists(path));
  const database = await openDatabase(path);
  closeDatabase(database);
  return { created, path, ...verifyDatabaseFile(path) };
}

export function databaseStatus(path) {
  return { path, ...verifyDatabaseFile(path) };
}

export async function backupDatabase(databasePath, backupRoot, backupId) {
  if (!BACKUP_ID.test(backupId)) throw new Error("invalid database backup ID");
  const destinationPath = join(backupRoot, `${backupId}.sqlite`);
  const database = await openDatabase(databasePath);
  try {
    return await createVerifiedBackup(database, destinationPath);
  } finally {
    closeDatabase(database);
  }
}

export async function restoreDatabaseDrill(backupRoot, backupId) {
  if (!BACKUP_ID.test(backupId)) throw new Error("invalid database backup ID");
  const backupPath = join(backupRoot, `${backupId}.sqlite`);
  const drillRoot = await mkdtemp(join(backupRoot, ".restore-drill-"));
  const restoredPath = join(drillRoot, "publisher.sqlite");
  try {
    const restored = await restoreVerifiedBackup(backupPath, restoredPath);
    return { backupPath, integrity: restored.integrity, migrations: restored.migrations };
  } finally {
    await rm(drillRoot, { recursive: true, force: false });
  }
}
