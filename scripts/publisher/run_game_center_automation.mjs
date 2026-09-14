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
export function preserveVenues(candidate, current) {
  const priorGames = [current?.previousGame, current?.nextGame, ...(current?.recentResults ?? [])].filter(Boolean);
  for (const game of [candidate.previousGame, candidate.nextGame, ...(candidate.recentResults ?? [])].filter(Boolean)) {
    if (!game.venue) {
      const prior = priorGames.find((value) => value.id === game.id);
      if (prior?.venue) game.venue = prior.venue;
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

export async function pendingProposal({ releasesRoot, state, candidate }) {
  const jobId = state?.pendingJobId;
  if (!/^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(jobId ?? "")) return null;
  const proposal = await optionalJson(join(releasesRoot, jobId, "game-center.json"));
  const manifest = await optionalJson(join(releasesRoot, jobId, "release", "release-manifest.json"));
  if (!proposal || manifest?.releaseKind !== "game-center") return null;
  return content(proposal) === content(candidate) ? jobId : null;
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
    const current = await optionalJson(currentPath) ?? JSON.parse(await readFile(join(repository, "src/data/game-center.json"), "utf8"));
    const state = await optionalJson(statePath) ?? { schemaVersion: 1, consecutiveFailures: 0 };
    const now = new Date();
    const decision = process.env.FANATICOSOS_GAME_CENTER_FORCE === "1"
      ? { due: true, mode: "forced" }
      : gameCenterPollDecision({ current, state, now });
    if (!decision.due) return;
    const candidatePath = join(automationRoot, `.candidate-${process.pid}.json`);
    const candidate = preserveVenues(await updateGameCenter({ outputPath: candidatePath, updatedAt: now }), current);
    await atomicJson(candidatePath, candidate);
    if (content(candidate) === content(current)) {
      await rm(readyPath, { force: true });
      await atomicJson(statePath, { ...state, lastSuccessfulCheckAt: now.toISOString(), lastMode: decision.mode, consecutiveFailures: 0, backoffUntil: null, pendingJobId: null });
      await rm(candidatePath, { force: true });
      return;
    }
    // A validated proposal that still matches the sources is kept; the owner
    // publishes it explicitly. Nothing here uploads to Cloudflare.
    const pending = await pendingProposal({ releasesRoot, state, candidate });
    if (pending) {
      await rm(candidatePath, { force: true });
      await rm(readyPath, { force: true });
      await writeFile(readyPath, `${pending}\n`, { mode: 0o600, flag: "wx" });
      await atomicJson(statePath, { ...state, lastSuccessfulCheckAt: now.toISOString(), lastMode: decision.mode, consecutiveFailures: 0, backoffUntil: null, pendingJobId: pending });
      return;
    }
    await rm(readyPath, { force: true });
    const articleId = randomUUID();
    const jobId = `release-${articleId.replaceAll("-", "")}-r1-${randomUUID().slice(0, 8)}`;
    const jobRoot = join(releasesRoot, jobId);
    await mkdir(jobRoot, { recursive: true, mode: 0o700 });
    await rename(candidatePath, join(jobRoot, "game-center.json"));
    await atomicJson(join(jobRoot, "request.json"), { schemaVersion: 1, releaseKind: "game-center", jobId, requestedAt: now.toISOString(), candidateSha256: createHash("sha256").update(content(candidate)).digest("hex") });
    await execute("/opt/nodejs/current/bin/node", [join(repository, "scripts/publisher/build_game_center_release.mjs"), "--repository", repository, "--releases-root", releasesRoot, "--candidate", join(jobRoot, "game-center.json"), "--output", join(jobRoot, "release")], { maxBuffer: 10_000_000 });
    await writeFile(readyPath, `${jobId}\n`, { mode: 0o600, flag: "wx" });
    await atomicJson(statePath, { ...state, lastSuccessfulCheckAt: now.toISOString(), lastMode: decision.mode, consecutiveFailures: 0, backoffUntil: null, pendingJobId: jobId, pendingSince: now.toISOString() });
    await createNotification(notificationsRoot, {
      level: "info", event: "game-center-ready",
      message: `Game Center tiene una actualización validada pendiente de publicación manual (${jobId}). Producción no cambia hasta ejecutar publish-game-center.`,
      replacePending: true,
    });
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
