import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TIMEOUT_MS = 12 * 60 * 1000;
let releaseQueueBusy = false;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export async function queueRelease({ draft, queueRoot, statesRoot, now = new Date() }) {
  if (releaseQueueBusy) throw new Error("Ya hay una preparación de publicación en curso.");
  releaseQueueBusy = true;
  try {
    await mkdir(queueRoot, { recursive: true, mode: 0o700 });
    await mkdir(statesRoot, { recursive: true, mode: 0o700 });
    const active = [];
    for (const name of (await readdir(statesRoot)).filter((name) => /^release-[0-9a-f-]{36}\.json$/.test(name))) {
      const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
      if (["queued", "running"].includes(state.status)) active.push(state);
    }
    if (active.length) throw new Error("Ya hay una preparación de publicación en curso.");
    const jobId = `release-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
    const request = { schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, publishedAt: zonedIso(now, "America/Chicago") };
    const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
    await mkdir(temporary, { mode: 0o700 });
    await atomicJson(join(temporary, "request.json"), request);
    await rename(temporary, join(queueRoot, jobId));
    const state = { schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, jobId, status: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await atomicJson(join(statesRoot, `release-${draft.articleId}.json`), state);
    await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
    return state;
  } finally {
    releaseQueueBusy = false;
  }
}

export function zonedIso(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName.replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export async function readReleaseState(statesRoot, articleId) {
  return JSON.parse(await readFile(join(statesRoot, `release-${articleId}.json`), "utf8"));
}

export async function reconcileReleases({ statesRoot, releasesRoot, onComplete, onFailure, now = new Date() }) {
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const names = (await readdir(statesRoot)).filter((name) => /^release-[0-9a-f-]{36}\.json$/.test(name));
  for (const name of names) {
    const path = join(statesRoot, name);
    const state = JSON.parse(await readFile(path, "utf8"));
    if (!["queued", "running"].includes(state.status)) continue;
    try {
      state.manifest = JSON.parse(await readFile(join(releasesRoot, state.jobId, "release", "release-manifest.json"), "utf8"));
      state.status = "completed";
      state.updatedAt = now.toISOString();
      await atomicJson(path, state);
      await onComplete?.(state);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const failure = JSON.parse(await readFile(join(releasesRoot, state.jobId, "failure.json"), "utf8"));
      state.status = "failed";
      state.error = failure.error;
      state.updatedAt = now.toISOString();
      await atomicJson(path, state);
      await onFailure?.(state);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await readFile(join(releasesRoot, state.jobId, "request.json"));
      state.status = "running";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (now.getTime() - new Date(state.createdAt).getTime() > TIMEOUT_MS) {
      state.status = "failed";
      state.error = "La preparación privada excedió su límite automático y fue detenida.";
      await onFailure?.(state);
    }
    state.updatedAt = now.toISOString();
    await atomicJson(path, state);
  }
}
