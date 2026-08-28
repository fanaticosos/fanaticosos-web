import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { queueRelease, readReleaseState, reconcileReleases, zonedIso } from "../lib/release-jobs.mjs";

const draft = { articleId: "00000000-0000-4000-8000-000000000001", revision: 5 };

test("private release request is mode 600 and reconciles a manifest once", async () => {
  assert.equal(zonedIso(new Date("2026-07-31T14:00:00Z"), "America/Chicago"), "2026-07-31T09:00:00-05:00");
  const root = await mkdtemp(join(tmpdir(), "publisher-release-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const releasesRoot = join(root, "releases");
  const state = await queueRelease({ draft, queueRoot, statesRoot });
  assert.equal((await stat(join(queueRoot, state.jobId, "request.json"))).mode & 0o777, 0o600);
  const output = join(releasesRoot, state.jobId, "release");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "release-manifest.json"), JSON.stringify({ deployment: "disabled" }));
  let completed = 0;
  await reconcileReleases({ statesRoot, releasesRoot, onComplete: () => { completed += 1; } });
  assert.equal((await readReleaseState(statesRoot, draft.articleId)).status, "completed");
  await reconcileReleases({ statesRoot, releasesRoot, onComplete: () => { completed += 1; } });
  assert.equal(completed, 1);
});

test("a second release cannot overlap an active release", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-release-lock-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await queueRelease({ draft, queueRoot, statesRoot });
  await assert.rejects(
    queueRelease({ draft: { ...draft, articleId: "00000000-0000-4000-8000-000000000002" }, queueRoot, statesRoot }),
    /Ya hay una preparación de publicación en curso/,
  );
  await assert.doesNotReject(stat(join(queueRoot, ".wake")));
});

test("rebuilding a published article preserves its original publication date", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-release-date-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await mkdir(statesRoot, { recursive: true });
  await writeFile(join(statesRoot, `release-${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1, articleId: draft.articleId, draftRevision: 5,
    jobId: "release-00000000000040008000000000000001-r5-abcdef12", status: "completed",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:01:00.000Z",
    manifest: { publishedAt: "2026-07-31T09:00:00-05:00" },
  }));
  const state = await queueRelease({ draft, queueRoot, statesRoot, now: new Date("2026-08-28T23:00:00Z") });
  const request = JSON.parse(await readFile(join(queueRoot, state.jobId, "request.json"), "utf8"));
  assert.equal(request.publishedAt, "2026-07-31T09:00:00-05:00");
});

test("rebuilding after retention recovers the production deployment date", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-release-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const draft = { articleId: "00000000-0000-4000-8000-000000000003", revision: 1 };
  const release = await queueRelease({ draft, queueRoot, statesRoot, publishedAt: "2026-08-07T18:41:19Z", now: new Date("2026-08-28T23:00:00Z") });
  const request = JSON.parse(await readFile(join(queueRoot, release.jobId, "request.json"), "utf8"));
  assert.equal(request.publishedAt, "2026-08-07T13:41:19-05:00");
});

test("simultaneous release requests admit exactly one build", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-release-race-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  const results = await Promise.allSettled([
    queueRelease({ draft, queueRoot, statesRoot }),
    queueRelease({ draft: { ...draft, articleId: "00000000-0000-4000-8000-000000000003" }, queueRoot, statesRoot }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
});

test("a stale release lock is failed and does not block a new build", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-release-stale-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await mkdir(statesRoot, { recursive: true });
  await writeFile(join(statesRoot, `release-${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1,
    articleId: draft.articleId,
    draftRevision: draft.revision,
    jobId: "release-00000000000040008000000000000001-r5-abcdef12",
    status: "running",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  }));
  const next = { ...draft, articleId: "00000000-0000-4000-8000-000000000004" };
  await assert.doesNotReject(queueRelease({ draft: next, queueRoot, statesRoot, now: new Date("2026-08-25T00:13:00.000Z") }));
  assert.equal((await readReleaseState(statesRoot, draft.articleId)).status, "failed");
});
