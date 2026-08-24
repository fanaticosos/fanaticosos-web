import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { queueMusicPublication, readMusicPublication } from "../lib/music-jobs.mjs";

test("a stale music publication never blocks the next song", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-music-jobs-"));
  const queueRoot = join(root, "queue");
  const statesRoot = join(root, "states");
  await mkdir(statesRoot, { recursive: true });
  await writeFile(join(statesRoot, "music-publication.json"), JSON.stringify({
    schemaVersion: 1,
    jobId: "release-11111111111111111111111111111111-r1-11111111",
    status: "running",
    createdAt: "2026-08-13T23:31:40.449Z",
    updatedAt: "2026-08-13T23:31:40.449Z",
  }));

  const state = await queueMusicPublication({
    settings: { music: { weeklySong: { title: "New song" } } },
    queueRoot,
    statesRoot,
    now: new Date("2026-08-24T15:00:00.000Z"),
  });

  assert.equal(state.status, "queued");
  assert.notEqual(state.jobId, "release-11111111111111111111111111111111-r1-11111111");
});

test("reading a stale music publication marks it failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-music-jobs-"));
  const statesRoot = join(root, "states");
  const releasesRoot = join(root, "releases");
  await mkdir(statesRoot, { recursive: true });
  await mkdir(releasesRoot, { recursive: true });
  await writeFile(join(statesRoot, "music-publication.json"), JSON.stringify({
    schemaVersion: 1,
    jobId: "release-22222222222222222222222222222222-r1-22222222",
    status: "running",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  }));

  const state = await readMusicPublication(statesRoot, releasesRoot);
  assert.equal(state.status, "failed");
  assert.match(state.error, /liberada automáticamente/);
  assert.equal(JSON.parse(await readFile(join(statesRoot, "music-publication.json"), "utf8")).status, "failed");
});
