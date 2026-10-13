import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { completeDatabaseDeployment, failDatabaseDeployment, listActiveDatabaseDeployments, queueDatabaseDeployment, readDatabaseDeploymentState, startDatabaseDeployment } from "./database-deployments.mjs";
import { queueDeployment, readDeploymentState, reconcileDeployment } from "./deployment-jobs.mjs";
import { RUNNING_DEPLOYMENT_TIMEOUT_MS } from "./deployment-timeouts.mjs";


async function optionalJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }

export function filesystemDeploymentStore({ queueRoot, statesRoot, releasesRoot }) {
  return {
    queue: (value) => queueDeployment({ ...value, queueRoot, statesRoot }),
    read: (articleId) => readDeploymentState(statesRoot, articleId),
    reconcile: async (articleId) => {
      const value = await readDeploymentState(statesRoot, articleId); return reconcileDeployment({ state: value, statesRoot, releasesRoot });
    },
  };
}

export function databaseDeploymentStore({ database, queueRoot, releasesRoot }) {
  return {
    async queue(value) {
      try {
        const existing = readDatabaseDeploymentState(database, value.articleId);
        if (existing.releaseJobId === value.releaseJobId && existing.status !== "failed") return existing;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      // A failed systemd attempt leaves the claimed request beside the
      // immutable release. Remove it before re-queuing so the dispatcher can
      // claim the retry instead of silently skipping it.
      await rm(join(releasesRoot, value.releaseJobId, "production-request.json"), { force: true });
      const state = queueDatabaseDeployment(database, value);
      const temporary = join(queueRoot, `.${state.jobId}.${randomUUID()}.queuing`); const target = join(queueRoot, state.jobId);
      try {
        await mkdir(queueRoot, { recursive: true, mode: 0o700 }); await mkdir(temporary, { mode: 0o700 });
        await writeFile(join(temporary, "request.json"), `${JSON.stringify({ schemaVersion: 1, articleId: state.articleId, draftRevision: state.draftRevision, releaseJobId: state.releaseJobId }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await rm(target, { recursive: true, force: true });
        await rename(temporary, target); await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
      } catch (error) { failDatabaseDeployment(database, state.jobId, "deployment request could not be queued", value.now); throw error; }
      return state;
    },
    read: async (articleId) => readDatabaseDeploymentState(database, articleId),
    async reconcile(articleId, now = new Date()) {
      const active = listActiveDatabaseDeployments(database).find((value) => value.articleId === articleId);
      if (!active) return readDatabaseDeploymentState(database, articleId);
      const root = join(releasesRoot, active.releaseJobId);
      const receipt = await optionalJson(join(root, "cloudflare-production.json"));
      if (receipt) {
        if (active.status === "queued") startDatabaseDeployment(database, active.jobId, now);
        return completeDatabaseDeployment(database, active.jobId, receipt, now);
      }
      let failure;
      try { failure = await optionalJson(join(root, "production-failure.json")); }
      catch (error) {
        if (error.code !== "EACCES") throw error;
        return failDatabaseDeployment(database, active.jobId, "La publicación pública no pudo completarse. El sitio anterior permanece activo.", now);
      }
      if (failure && (!Number.isFinite(Date.parse(failure.failedAt ?? ""))
        || Date.parse(failure.failedAt) >= Date.parse(active.createdAt))) {
        return failDatabaseDeployment(database, active.jobId, failure.error || "deployment failed", now);
      }
      if (active.status === "queued" && await optionalJson(join(root, "production-request.json"))) startDatabaseDeployment(database, active.jobId, now);
      if (active.status === "running" && active.startedAt && now.getTime() - Date.parse(active.startedAt) > RUNNING_DEPLOYMENT_TIMEOUT_MS) return failDatabaseDeployment(database, active.jobId, "La publicación excedió su límite automático y fue liberada.", now);
      return readDatabaseDeploymentState(database, articleId);
    },
  };
}
