#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { updateGameCenter } from "../../src/lib/gameCenterUpdate.mjs";
import { createNotification } from "../../publisher/lib/notifications.mjs";

const execute = promisify(execFile);
const GAME_INTERVAL_MS = 10 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GAME_WINDOW_BEFORE_MS = 30 * 60 * 1000;
const GAME_WINDOW_AFTER_MS = 8 * 60 * 60 * 1000;

function argument(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return resolve(process.argv[index + 1]); }
async function optionalJson(path) { return readFile(path, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; }); }
async function atomicJson(path, value) { const temporary = `${path}.${randomUUID()}.saving`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
function content(value) { const clone = structuredClone(value); delete clone.updatedAt; return JSON.stringify(clone); }
function preserveVenues(candidate, current) {
  for (const key of ["previousGame", "nextGame"]) {
    if (candidate[key] && !candidate[key].venue) {
      const prior = [current?.previousGame, current?.nextGame].find((game) => game?.id === candidate[key].id);
      if (prior?.venue) candidate[key].venue = prior.venue;
    }
  }
  return candidate;
}

export function gameCenterPollDecision({ current, state, now = new Date() }) {
  if (state?.backoffUntil && now < new Date(state.backoffUntil)) return { due: false, mode: "backoff" };
  const kickoff = Date.parse(current?.nextGame?.startsAt ?? "");
  const inGameWindow = Number.isFinite(kickoff) && now.getTime() >= kickoff - GAME_WINDOW_BEFORE_MS && now.getTime() <= kickoff + GAME_WINDOW_AFTER_MS;
  const interval = inGameWindow ? GAME_INTERVAL_MS : DAILY_INTERVAL_MS;
  const last = Date.parse(state?.lastSuccessfulCheckAt ?? "");
  return { due: !Number.isFinite(last) || now.getTime() - last >= interval, mode: inGameWindow ? "game" : "daily" };
}

async function main() {
  const repository = argument("--repository");
  const publisherRoot = argument("--publisher-root");
  const releasesRoot = join(publisherRoot, "releases");
  const automationRoot = join(publisherRoot, "game-center");
  const notificationsRoot = join(publisherRoot, "notifications");
  const statePath = join(automationRoot, "state.json");
  const currentPath = join(automationRoot, "current.json");
  const readyPath = join(automationRoot, "deploy-ready");
  await mkdir(automationRoot, { recursive: true, mode: 0o700 });
  const lock = await open(join(automationRoot, "run.lock"), "wx", 0o600).catch((error) => { if (error.code === "EEXIST") return null; throw error; });
  if (!lock) return;
  try {
    await rm(readyPath, { force: true });
    const current = await optionalJson(currentPath) ?? JSON.parse(await readFile(join(repository, "src/data/game-center.json"), "utf8"));
    const state = await optionalJson(statePath) ?? { schemaVersion: 1, consecutiveFailures: 0 };
    const now = new Date();
    const decision = gameCenterPollDecision({ current, state, now });
    if (!decision.due) return;
    const candidatePath = join(automationRoot, `.candidate-${process.pid}.json`);
    const candidate = preserveVenues(await updateGameCenter({ outputPath: candidatePath, updatedAt: now }), current);
    await atomicJson(candidatePath, candidate);
    if (content(candidate) === content(current)) {
      await atomicJson(statePath, { ...state, lastSuccessfulCheckAt: now.toISOString(), lastMode: decision.mode, consecutiveFailures: 0, backoffUntil: null });
      await rm(candidatePath, { force: true });
      return;
    }
    const articleId = randomUUID();
    const jobId = `release-${articleId.replaceAll("-", "")}-r1-${randomUUID().slice(0, 8)}`;
    const jobRoot = join(releasesRoot, jobId);
    await mkdir(jobRoot, { recursive: true, mode: 0o700 });
    await rename(candidatePath, join(jobRoot, "game-center.json"));
    await atomicJson(join(jobRoot, "request.json"), { schemaVersion: 1, releaseKind: "game-center", jobId, requestedAt: now.toISOString(), candidateSha256: createHash("sha256").update(content(candidate)).digest("hex") });
    await execute("/opt/nodejs/current/bin/node", [join(repository, "scripts/publisher/build_game_center_release.mjs"), "--repository", repository, "--releases-root", releasesRoot, "--candidate", join(jobRoot, "game-center.json"), "--output", join(jobRoot, "release")], { maxBuffer: 10_000_000 });
    await writeFile(readyPath, `${jobId}\n`, { mode: 0o600, flag: "wx" });
    await atomicJson(statePath, { ...state, lastSuccessfulCheckAt: now.toISOString(), lastMode: decision.mode, consecutiveFailures: 0, backoffUntil: null, pendingJobId: jobId });
  } catch (error) {
    const state = await optionalJson(statePath) ?? { schemaVersion: 1, consecutiveFailures: 0 };
    const failures = Math.min((state.consecutiveFailures ?? 0) + 1, 6);
    const backoffMinutes = Math.min(10 * (2 ** failures), 360);
    await atomicJson(statePath, { ...state, consecutiveFailures: failures, lastFailureAt: new Date().toISOString(), backoffUntil: new Date(Date.now() + backoffMinutes * 60_000).toISOString() });
    await createNotification(notificationsRoot, { level: "error", event: "game-center-update-failed", message: "Game Center no se actualizó porque las fuentes no coincidieron o no respondieron. Producción permanece intacta.", replacePending: true });
    throw error;
  } finally {
    await lock.close();
    await rm(join(automationRoot, "run.lock"), { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
