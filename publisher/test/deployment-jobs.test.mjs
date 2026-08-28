import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { queueDeployment, reconcileDeployment } from "../lib/deployment-jobs.mjs";

const articleId = "00000000-0000-4000-8000-000000000001";
const releaseJobId = "release-00000000000040008000000000000001-r1-abcdef12";

test("an active production deployment blocks an overlapping deployment", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-deployment-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await queueDeployment({ articleId, draftRevision: 1, releaseJobId, queueRoot, statesRoot, now: new Date("2026-08-24T12:00:00Z") });
  await assert.rejects(
    queueDeployment({ articleId: "11111111-1111-4111-8111-111111111111", draftRevision: 1, releaseJobId: "release-11111111111141118111111111111111-r1-bcdef123", queueRoot, statesRoot, now: new Date("2026-08-24T12:01:00Z") }),
    /publicación en curso/,
  );
});

test("a stale production deployment is released before a new one is queued", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-deployment-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await mkdir(statesRoot, { recursive: true });
  await writeFile(join(statesRoot, `deployment-${articleId}.json`), JSON.stringify({
    schemaVersion: 1, articleId, draftRevision: 1, releaseJobId, status: "running",
    createdAt: "2026-08-24T11:00:00Z", updatedAt: "2026-08-24T11:00:00Z",
  }));
  const nextArticleId = "11111111-1111-4111-8111-111111111111";
  const queued = await queueDeployment({ articleId: nextArticleId, draftRevision: 1, releaseJobId: "release-11111111111141118111111111111111-r1-bcdef123", queueRoot, statesRoot, now: new Date("2026-08-24T12:00:00Z") });
  assert.equal(queued.status, "queued");
  const stale = JSON.parse(await readFile(join(statesRoot, `deployment-${articleId}.json`), "utf8"));
  assert.equal(stale.status, "failed");
  assert.match(stale.error, /liberada automáticamente/);
});

test("reconciliation fails a deployment that exceeds its timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-deployment-"));
  const statesRoot = join(root, "states");
  const releasesRoot = join(root, "releases");
  await mkdir(statesRoot, { recursive: true });
  await mkdir(releasesRoot, { recursive: true });
  const state = { schemaVersion: 1, articleId, draftRevision: 1, releaseJobId, status: "queued", createdAt: "2026-08-24T11:00:00Z", updatedAt: "2026-08-24T11:00:00Z" };
  const reconciled = await reconcileDeployment({ state, statesRoot, releasesRoot, now: new Date("2026-08-24T12:00:00Z") });
  assert.equal(reconciled.status, "failed");
  assert.match(reconciled.error, /límite automático/);
});

test("legacy root-only deployment failure records do not wedge the queue", async (context) => {
  if (process.getuid?.() === 0) context.skip("root can read mode-000 fixtures");
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-deployment-"));
  const statesRoot = join(root, "states");
  const releasesRoot = join(root, "releases");
  const releaseRoot = join(releasesRoot, releaseJobId);
  await mkdir(statesRoot, { recursive: true });
  await mkdir(releaseRoot, { recursive: true });
  const failurePath = join(releaseRoot, "production-failure.json");
  await writeFile(failurePath, "{}", { mode: 0o600 });
  await chmod(failurePath, 0o000);
  context.after(() => chmod(failurePath, 0o600));
  const state = { schemaVersion: 1, articleId, draftRevision: 1, releaseJobId, status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const reconciled = await reconcileDeployment({ state, statesRoot, releasesRoot });
  assert.equal(reconciled.status, "failed");
  assert.match(reconciled.error, /sitio anterior permanece activo/);
});
