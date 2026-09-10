#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const root = resolve(argument("--job-root"));
const serviceResult = argument("--service-result");
const exitStatus = argument("--exit-status");
if (!/^\/opt\/fanaticosos-blog\/jobs\/tts-(?:es|en)-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(root)) {
  throw new Error("TTS job root is invalid");
}
if (serviceResult === "success" && exitStatus === "0") process.exit(0);
try {
  await readFile(`${root}/audio/result.json`);
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const target = `${root}/failure.json`;
const temporary = `${target}.${randomUUID()}.saving`;
const failure = {
  schemaVersion: 1,
  error: "La generación de audio no pudo completarse.",
  serviceResult,
  exitStatus,
  failedAt: new Date().toISOString(),
};
await writeFile(temporary, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, target);
