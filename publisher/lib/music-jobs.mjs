import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

const ACTIVE_PUBLICATION_LIMIT_MS = 30 * 60 * 1000;

function isStale(state, now) {
  const timestamp = Date.parse(state.updatedAt || state.createdAt || "");
  return !Number.isFinite(timestamp) || now.getTime() - timestamp > ACTIVE_PUBLICATION_LIMIT_MS;
}

export async function queueMusicPublication({ settings, queueRoot, statesRoot, now = new Date() }) {
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const existing = await readFile(join(statesRoot, "music-publication.json"), "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && ["queued", "running"].includes(existing.status) && !isStale(existing, now)) {
    throw new Error("Ya hay una canción publicándose.");
  }
  const articleId = randomUUID();
  const jobId = `release-${articleId.replaceAll("-", "")}-r1-${randomUUID().slice(0, 8)}`;
  const request = { schemaVersion: 1, releaseKind: "music", articleId, draftRevision: 1, requestedAt: now.toISOString(), settings };
  const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { mode: 0o700 });
  await atomicJson(join(temporary, "request.json"), request);
  await rename(temporary, join(queueRoot, jobId));
  const state = { schemaVersion: 1, jobId, status: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await atomicJson(join(statesRoot, "music-publication.json"), state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
}

export async function readMusicPublication(statesRoot, releasesRoot) {
  const path = join(statesRoot, "music-publication.json");
  const state = await readFile(path, "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!state || !["queued", "running"].includes(state.status)) return state;
  const root = join(releasesRoot, state.jobId);
  const receipt = await readFile(join(root, "cloudflare-production.json"), "utf8").then(JSON.parse).catch(() => null);
  const failure = await readFile(join(root, "failure.json"), "utf8").then(JSON.parse).catch(() => null);
  if (receipt) {
    const completed = { ...state, status: "completed", deploymentUrl: receipt.url, updatedAt: receipt.validatedAt };
    await atomicJson(path, completed);
    return completed;
  }
  if (failure) {
    const failed = { ...state, status: "failed", error: failure.error, updatedAt: failure.failedAt };
    await atomicJson(path, failed);
    return failed;
  }
  if (isStale(state, new Date())) {
    const failed = { ...state, status: "failed", error: "La publicación anterior se detuvo y fue liberada automáticamente.", updatedAt: new Date().toISOString() };
    await atomicJson(path, failed);
    return failed;
  }
  const request = await readFile(join(root, "request.json"), "utf8").catch(() => null);
  return { ...state, status: request ? "running" : "queued", updatedAt: new Date().toISOString() };
}
