import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, readlink, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const JOB_PATTERN = /^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function selectedJobId(root) {
  try {
    const metadata = await lstat(join(root, "current"));
    if (!metadata.isSymbolicLink()) return null;
    const target = await readlink(join(root, "current"));
    const jobId = target.split("/")[0];
    return JOB_PATTERN.test(jobId) ? jobId : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function retentionPlan({ releasesRoot, keepSuccessful = 10, failedDays = 30, now = new Date() }) {
  if (!Number.isInteger(keepSuccessful) || keepSuccessful < 1) throw new Error("keepSuccessful must be a positive integer");
  if (!Number.isInteger(failedDays) || failedDays < 1) throw new Error("failedDays must be a positive integer");
  const root = resolve(releasesRoot);
  const selected = await selectedJobId(root);
  const successful = [];
  const failed = [];
  const protectedJobs = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !JOB_PATTERN.test(entry.name)) continue;
    const jobRoot = join(root, entry.name);
    const manifest = await optionalJson(join(jobRoot, "release", "release-manifest.json"));
    const failure = await optionalJson(join(jobRoot, "failure.json"));
    const completedAt = Date.parse(manifest?.buildCompletedAt);
    const failedAt = Date.parse(failure?.failedAt);
    if (manifest?.schemaVersion === 1 && manifest.deployment === "disabled" && Number.isFinite(completedAt)) {
      successful.push({ jobId: entry.name, timestamp: completedAt });
    } else if (failure?.schemaVersion === 1 && Number.isFinite(failedAt)) {
      failed.push({ jobId: entry.name, timestamp: failedAt });
    } else {
      protectedJobs.push({ jobId: entry.name, reason: "active-or-unknown" });
    }
  }
  successful.sort((a, b) => b.timestamp - a.timestamp || b.jobId.localeCompare(a.jobId));
  const retainedSuccess = new Set(successful.slice(0, keepSuccessful).map(({ jobId }) => jobId));
  if (selected) retainedSuccess.add(selected);
  const cutoff = now.getTime() - failedDays * 24 * 60 * 60 * 1000;
  const remove = [
    ...successful.filter(({ jobId }) => !retainedSuccess.has(jobId)).map(({ jobId }) => ({ jobId, reason: "successful-retention-limit" })),
    ...failed.filter(({ jobId, timestamp }) => jobId !== selected && Number.isFinite(timestamp) && timestamp < cutoff)
      .map(({ jobId }) => ({ jobId, reason: "expired-failure" })),
  ];
  const deferred = protectedJobs.length > 0;
  return {
    schemaVersion: 1,
    policy: { keepSuccessful, failedDays },
    selected,
    deferred,
    remove: deferred ? [] : remove,
    protected: [
      ...successful.filter(({ jobId }) => retainedSuccess.has(jobId)).map(({ jobId }) => ({ jobId, reason: jobId === selected ? "selected" : "successful-retained" })),
      ...failed.filter(({ jobId, timestamp }) => jobId === selected || !Number.isFinite(timestamp) || timestamp >= cutoff)
        .map(({ jobId }) => ({ jobId, reason: jobId === selected ? "selected" : "recent-failure" })),
      ...protectedJobs,
    ],
  };
}

export async function applyRetention({ releasesRoot, plan }) {
  const root = resolve(releasesRoot);
  const removed = [];
  for (const candidate of plan.remove) {
    if (!JOB_PATTERN.test(candidate.jobId)) throw new Error("retention candidate is invalid");
    if (candidate.jobId === await selectedJobId(root)) throw new Error("selected release cannot be removed");
    const source = join(root, candidate.jobId);
    const metadata = await lstat(source);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("retention candidate is not a directory");
    const staging = join(root, `.pruning-${candidate.jobId}-${randomUUID()}`);
    await rename(source, staging);
    await rm(staging, { recursive: true, force: false });
    removed.push(candidate);
  }
  return removed;
}
