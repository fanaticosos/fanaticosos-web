#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { chown, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
function argument(name) { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} is required`); return process.argv[i + 1]; }
const root = resolve(argument("--release-root"));
if (!root.startsWith("/opt/fanaticosos-blog/publisher/releases/release-")) throw new Error("release root is invalid");
const result = argument("--service-result");
const status = argument("--exit-status");
if (result === "success" && status === "0") process.exit(0);
try { await readFile(`${root}/cloudflare-production.json`); process.exit(0); } catch (error) { if (error.code !== "ENOENT") throw error; }
const target = `${root}/failure.json`;
const temporary = `${target}.${randomUUID()}.saving`;
await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, error: "La canción se guardó, pero la publicación pública no pudo completarse.", serviceResult: result, exitStatus: status, failedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
const owner = await stat(root);
await chown(temporary, owner.uid, owner.gid);
await rename(temporary, target);
