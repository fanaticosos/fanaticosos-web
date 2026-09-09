import { constants } from "node:fs";
import { chmod, copyFile, lstat, rename, unlink } from "node:fs/promises";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";

async function mustNotExist(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`refusing to overwrite existing file: ${path}`);
}

export function verifyDatabaseFile(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("SQLite integrity check failed");
    }
    const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length !== 0) throw new Error("SQLite foreign-key check failed");
    const migrations = database.prepare(`
      SELECT name, checksum_sha256, applied_at
      FROM schema_migrations
      ORDER BY name
    `).all();
    if (migrations.length === 0) throw new Error("database has no applied migrations");
    return { integrity: "ok", migrations };
  } finally {
    database.close();
  }
}

export async function createVerifiedBackup(database, destinationPath) {
  await mustNotExist(destinationPath);
  const temporaryPath = `${destinationPath}.${randomUUID()}.saving`;
  try {
    await backup(database, temporaryPath);
    await chmod(temporaryPath, 0o600);
    const verification = verifyDatabaseFile(temporaryPath);
    await rename(temporaryPath, destinationPath);
    return { path: destinationPath, ...verification };
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

export async function restoreVerifiedBackup(backupPath, destinationPath) {
  const backupVerification = verifyDatabaseFile(backupPath);
  await mustNotExist(destinationPath);
  const temporaryPath = `${destinationPath}.${randomUUID()}.restoring`;
  try {
    await copyFile(backupPath, temporaryPath, constants.COPYFILE_EXCL);
    await chmod(temporaryPath, 0o600);
    const restoredVerification = verifyDatabaseFile(temporaryPath);
    if (JSON.stringify(restoredVerification.migrations) !== JSON.stringify(backupVerification.migrations)) {
      throw new Error("restored database migration history differs from backup");
    }
    await rename(temporaryPath, destinationPath);
    return { path: destinationPath, ...restoredVerification };
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}
