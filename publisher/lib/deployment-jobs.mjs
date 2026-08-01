import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
async function atomicJson(path, value) { const temporary = `${path}.${randomUUID()}.saving`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
export async function queueDeployment({ articleId, draftRevision, releaseJobId, queueRoot, statesRoot, now = new Date() }) {
  if (!/^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(releaseJobId)) throw new Error("validated release is required");
  const jobId = `deploy-${releaseJobId}`; const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { recursive: true, mode: 0o700 }); await atomicJson(join(temporary, "request.json"), { schemaVersion: 1, articleId, draftRevision, releaseJobId }); await rename(temporary, join(queueRoot, jobId));
  const state = { schemaVersion: 1, articleId, draftRevision, releaseJobId, status: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await atomicJson(join(statesRoot, `deployment-${articleId}.json`), state); await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 }); return state;
}
export async function readDeploymentState(statesRoot, articleId) { return JSON.parse(await readFile(join(statesRoot, `deployment-${articleId}.json`), "utf8")); }
export async function reconcileDeployment({ state, statesRoot, releasesRoot, now = new Date() }) {
  if (!["queued", "running"].includes(state.status)) return state; const root = join(releasesRoot, state.releaseJobId);
  try { state.receipt = JSON.parse(await readFile(join(root, "cloudflare-production.json"), "utf8")); state.status = "completed"; }
  catch (error) { if (error.code !== "ENOENT") throw error; try { const failure = JSON.parse(await readFile(join(root, "production-failure.json"), "utf8")); state.status = "failed"; state.error = failure.error; } catch (failureError) { if (failureError.code !== "ENOENT") throw failureError; try { await readFile(join(root, "production-request.json")); state.status = "running"; } catch (e) { if (e.code !== "ENOENT") throw e; } } }
  state.updatedAt = now.toISOString(); await atomicJson(join(statesRoot, `deployment-${state.articleId}.json`), state); return state;
}
