import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEPLOYMENT_TIMEOUT_MS = 15 * 60 * 1000;
let deploymentQueueBusy = false;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function isStale(state, now) {
  const timestamp = Date.parse(state.updatedAt || state.createdAt || "");
  return !Number.isFinite(timestamp) || now.getTime() - timestamp > DEPLOYMENT_TIMEOUT_MS;
}

export async function queueDeployment({ articleId, draftRevision, releaseJobId, queueRoot, statesRoot, now = new Date() }) {
  if (!/^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(releaseJobId)) throw new Error("validated release is required");
  if (deploymentQueueBusy) throw new Error("Ya hay una publicación en curso.");
  deploymentQueueBusy = true;
  try {
    await mkdir(queueRoot, { recursive: true, mode: 0o700 });
    await mkdir(statesRoot, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(statesRoot)).filter((value) => /^deployment-[0-9a-f-]{36}\.json$/.test(value))) {
      const path = join(statesRoot, name);
      const state = JSON.parse(await readFile(path, "utf8"));
      if (!["queued", "running"].includes(state.status)) continue;
      if (!isStale(state, now)) throw new Error("Ya hay una publicación en curso.");
      await atomicJson(path, { ...state, status: "failed", error: "La publicación anterior se detuvo y fue liberada automáticamente.", updatedAt: now.toISOString() });
    }

    const jobId = `deploy-${releaseJobId}`;
    const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
    await mkdir(temporary, { mode: 0o700 });
    await atomicJson(join(temporary, "request.json"), { schemaVersion: 1, articleId, draftRevision, releaseJobId });
    await rename(temporary, join(queueRoot, jobId));
    const state = { schemaVersion: 1, articleId, draftRevision, releaseJobId, status: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await atomicJson(join(statesRoot, `deployment-${articleId}.json`), state);
    await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
    return state;
  } finally {
    deploymentQueueBusy = false;
  }
}

export async function readDeploymentState(statesRoot, articleId) {
  return JSON.parse(await readFile(join(statesRoot, `deployment-${articleId}.json`), "utf8"));
}

export async function reconcileDeployment({ state, statesRoot, releasesRoot, now = new Date() }) {
  if (!["queued", "running"].includes(state.status)) return state;
  const root = join(releasesRoot, state.releaseJobId);
  try {
    state.receipt = JSON.parse(await readFile(join(root, "cloudflare-production.json"), "utf8"));
    state.status = "completed";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const failure = JSON.parse(await readFile(join(root, "production-failure.json"), "utf8"));
      state.status = "failed";
      state.error = failure.error;
    } catch (failureError) {
      if (failureError.code !== "ENOENT") throw failureError;
      try {
        await readFile(join(root, "production-request.json"));
        state.status = "running";
      } catch (requestError) {
        if (requestError.code !== "ENOENT") throw requestError;
      }
    }
  }
  if (["queued", "running"].includes(state.status) && isStale(state, now)) {
    state.status = "failed";
    state.error = "La publicación excedió su límite automático y fue liberada.";
  }
  state.updatedAt = now.toISOString();
  await atomicJson(join(statesRoot, `deployment-${state.articleId}.json`), state);
  return state;
}
