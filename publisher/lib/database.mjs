import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const DEFAULT_MIGRATIONS_ROOT = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION_NAME = /^\d{3}-[a-z0-9-]+\.sql$/;

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function configure(database) {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  if (database.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1) {
    throw new Error("SQLite foreign-key enforcement is unavailable");
  }
}

function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
}

export async function readMigrations(root = DEFAULT_MIGRATIONS_ROOT) {
  const names = (await readdir(root)).filter((name) => MIGRATION_NAME.test(name)).sort();
  if (names.length === 0) throw new Error("no database migrations were found");
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(root, name), "utf8");
    return { name, sql, checksumSha256: checksum(sql) };
  }));
}

export async function migrateDatabase(database, { migrationsRoot = DEFAULT_MIGRATIONS_ROOT, now = new Date() } = {}) {
  ensureMigrationTable(database);
  const migrations = await readMigrations(migrationsRoot);
  const appliedRows = database.prepare("SELECT name, checksum_sha256 FROM schema_migrations ORDER BY name").all();
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum_sha256]));

  for (const migration of migrations) {
    const recordedChecksum = applied.get(migration.name);
    if (recordedChecksum && recordedChecksum !== migration.checksumSha256) {
      throw new Error(`applied migration checksum differs: ${migration.name}`);
    }
    if (recordedChecksum) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (name, checksum_sha256, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.name, migration.checksumSha256, now.toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`database migration failed: ${migration.name}`, { cause: error });
    }
  }
  return migrations.map(({ name, checksumSha256 }) => ({ name, checksumSha256 }));
}

export async function openDatabase(path, options = {}) {
  if (typeof path !== "string" || !path || path === ":memory:") {
    throw new Error("database path must be a persistent filesystem path");
  }
  const database = new DatabaseSync(path, { timeout: 5000 });
  try {
    configure(database);
    if (options.migrate !== false) await migrateDatabase(database, options);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function closeDatabase(database) {
  database.close();
}

export function withTransaction(database, operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(database);
    if (result && typeof result.then === "function") {
      throw new Error("database transactions must use synchronous callbacks");
    }
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function databaseFilename(path) {
  return basename(path);
}
