#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const root = resolve(argument("--release-root"));
const serviceResult = argument("--service-result");
const exitStatus = argument("--exit-status");
if (!root.startsWith("/opt/fanaticosos-blog/publisher/releases/release-")) throw new Error("release root is invalid");
if (serviceResult === "success" && exitStatus === "0") process.exit(0);
try {
  await readFile(`${root}/release/release-manifest.json`);
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const failure = {
  schemaVersion: 1, error: "La compilación privada no pasó la validación.",
  serviceResult, exitStatus, failedAt: new Date().toISOString(),
};
const target = `${root}/failure.json`;
const temporary = `${target}.${randomUUID()}.saving`;
await writeFile(temporary, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, target);
