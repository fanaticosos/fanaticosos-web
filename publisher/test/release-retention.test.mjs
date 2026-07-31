import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyRetention, retentionPlan } from "../lib/release-retention.mjs";

function job(number) {
  return `release-${number.toString(16).padStart(32, "0")}-r1-${number.toString(16).padStart(8, "0")}`;
}

async function success(root, jobId, timestamp) {
  await mkdir(join(root, jobId, "release", "dist"), { recursive: true });
  await writeFile(join(root, jobId, "release", "release-manifest.json"), JSON.stringify({
    schemaVersion: 1, deployment: "disabled", buildCompletedAt: timestamp,
  }));
}

async function failure(root, jobId, timestamp) {
  await mkdir(join(root, jobId), { recursive: true });
  await writeFile(join(root, jobId, "failure.json"), JSON.stringify({ schemaVersion: 1, failedAt: timestamp }));
}

test("retention preserves ten successes, selected release, and recent failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-retention-"));
  for (let index = 1; index <= 12; index += 1) await success(root, job(index), `2026-07-${index.toString().padStart(2, "0")}T12:00:00Z`);
  await symlink(join(job(1), "release"), join(root, "current"));
  await failure(root, job(20), "2026-05-01T12:00:00Z");
  await failure(root, job(21), "2026-07-25T12:00:00Z");
  const plan = await retentionPlan({ releasesRoot: root, now: new Date("2026-07-31T12:00:00Z") });
  assert.deepEqual(plan.remove.map(({ jobId }) => jobId).sort(), [job(2), job(20)].sort());
  assert.ok(plan.protected.some(({ jobId, reason }) => jobId === job(1) && reason === "selected"));
  assert.ok(plan.protected.some(({ jobId, reason }) => jobId === job(21) && reason === "recent-failure"));
});

test("retention removes nothing while an active or unknown job exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-retention-active-"));
  await success(root, job(1), "2026-01-01T12:00:00Z");
  await success(root, job(2), "2026-02-01T12:00:00Z");
  await mkdir(join(root, job(30)), { recursive: true });
  await writeFile(join(root, job(30), "request.json"), "{}");
  const plan = await retentionPlan({ releasesRoot: root, keepSuccessful: 1, now: new Date("2026-07-31T12:00:00Z") });
  assert.equal(plan.deferred, true);
  assert.deepEqual(plan.remove, []);
  assert.ok(plan.protected.some(({ jobId, reason }) => jobId === job(30) && reason === "active-or-unknown"));
});

test("dry-run changes nothing and apply removes only planned directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-retention-apply-"));
  await success(root, job(1), "2026-01-01T12:00:00Z");
  await success(root, job(2), "2026-02-01T12:00:00Z");
  const plan = await retentionPlan({ releasesRoot: root, keepSuccessful: 1, now: new Date("2026-07-31T12:00:00Z") });
  await access(join(root, job(1)));
  const removed = await applyRetention({ releasesRoot: root, plan });
  assert.deepEqual(removed, [{ jobId: job(1), reason: "successful-retention-limit" }]);
  await assert.rejects(access(join(root, job(1))), { code: "ENOENT" });
  await access(join(root, job(2)));
});

test("a release selected after planning is still protected during apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-retention-race-"));
  await success(root, job(1), "2026-01-01T12:00:00Z");
  await success(root, job(2), "2026-02-01T12:00:00Z");
  const plan = await retentionPlan({ releasesRoot: root, keepSuccessful: 1, now: new Date("2026-07-31T12:00:00Z") });
  await symlink(join(job(1), "release"), join(root, "current"));
  await assert.rejects(applyRetention({ releasesRoot: root, plan }), /selected release cannot be removed/);
  await access(join(root, job(1)));
});
