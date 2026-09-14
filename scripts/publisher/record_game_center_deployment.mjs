#!/usr/bin/env node
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { createNotification } from "../../publisher/lib/notifications.mjs";

function argument(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return process.argv[index + 1]; }
async function atomicJson(path, value) { const temporary = `${path}.${randomUUID()}.saving`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }

const publisherRoot = resolve(argument("--publisher-root"));
const jobId = argument("--job-id");
const result = argument("--result");
if (!/^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(jobId)) throw new Error("invalid release job ID");
const automationRoot = join(publisherRoot, "game-center");
const statePath = join(automationRoot, "state.json");
const state = JSON.parse(await readFile(statePath, "utf8"));
if (result === "success") {
  await cp(join(publisherRoot, "releases", jobId, "game-center.json"), join(automationRoot, "current.json"), { force: true });
  await atomicJson(statePath, { ...state, pendingJobId: null, lastDeploymentAt: new Date().toISOString(), lastDeploymentJobId: jobId, consecutiveFailures: 0, backoffUntil: null });
  await createNotification(join(publisherRoot, "notifications"), { level: "success", event: "game-center-updated", message: "Game Center se actualizó, validó y publicó automáticamente.", replacePending: true });
} else {
  await atomicJson(statePath, { ...state, pendingJobId: null, lastFailureAt: new Date().toISOString(), backoffUntil: new Date(Date.now() + 60 * 60_000).toISOString() });
  await createNotification(join(publisherRoot, "notifications"), { level: "error", event: "game-center-update-failed", message: "El despliegue automático de Game Center falló. Producción fue conservada o restaurada automáticamente.", replacePending: true });
}
await rm(join(automationRoot, "deploy-ready"), { force: true });
