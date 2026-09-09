import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { completeDatabaseDeployment, failDatabaseDeployment, listActiveDatabaseDeployments, queueDatabaseDeployment, readDatabaseDeploymentState, startDatabaseDeployment } from "./database-deployments.mjs";
import { queueDeployment, readDeploymentState, reconcileDeployment } from "./deployment-jobs.mjs";

const TIMEOUT_MS = 15 * 60 * 1000;

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
        if (existing.releaseJobId === value.releaseJobId) return existing;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const state = queueDatabaseDeployment(database, value);
      const temporary = join(queueRoot, `.${state.jobId}.${randomUUID()}.queuing`); const target = join(queueRoot, state.jobId);
      try {
        await mkdir(queueRoot, { recursive: true, mode: 0o700 }); await mkdir(temporary, { mode: 0o700 });
        await writeFile(join(temporary, "request.json"), `${JSON.stringify({ schemaVersion: 1, articleId: state.articleId, draftRevision: state.draftRevision, releaseJobId: state.releaseJobId }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
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
      if (failure) return failDatabaseDeployment(database, active.jobId, failure.error || "deployment failed", now);
      if (active.status === "queued" && await optionalJson(join(root, "production-request.json"))) startDatabaseDeployment(database, active.jobId, now);
      if (now.getTime() - Date.parse(active.createdAt) > TIMEOUT_MS) return failDatabaseDeployment(database, active.jobId, "La publicación excedió su límite automático y fue liberada.", now);
      return readDatabaseDeploymentState(database, articleId);
    },
  };
}
