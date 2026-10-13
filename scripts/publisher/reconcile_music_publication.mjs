#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDatabase, openDatabase } from "../../publisher/lib/database.mjs";
import { reconcileFailedDatabaseMusicPublication } from "../../publisher/lib/database-music.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const databasePath = resolve(argument("--database"));
const releaseRoot = resolve(argument("--release-root"));
const jobId = argument("--job-id");
if (!/^release-[0-9a-f]{32}-r1-[0-9a-f]{8}$/.test(jobId)) throw new Error("job ID is invalid");
if (!releaseRoot.endsWith(`/releases/${jobId}`)) throw new Error("release root is invalid");

const manifestBytes = await readFile(`${releaseRoot}/release/release-manifest.json`);
const manifest = JSON.parse(manifestBytes);
const receipt = JSON.parse(await readFile(`${releaseRoot}/cloudflare-production.json`, "utf8"));
const database = await openDatabase(databasePath);
try {
  const result = reconcileFailedDatabaseMusicPublication(database, {
    jobId,
    manifest,
    manifestChecksum: createHash("sha256").update(manifestBytes).digest("hex"),
    receipt,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  closeDatabase(database);
}
