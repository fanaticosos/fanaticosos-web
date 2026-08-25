import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queueAudiogram, reconcileAudiograms } from "../lib/audiogram-jobs.mjs";

const articleId = "00000000-0000-4000-8000-000000000001";
const draft = { articleId, revision: 2, title: "Bears 2026", description: "Análisis", tags: ["#BearDown"], featuredImage: { path: "/uploads/photo.webp" } };
const audio = { status: "completed", draftRevision: 2, jobs: { es: { status: "completed", jobId: `tts-es-${articleId.replaceAll("-", "")}-r2-abcdef12`, result: { file: "es.mp3", sha256: "a".repeat(64) } } } };

test("queues and reconciles a full Spanish audiogram", async () => {
  const root = await mkdtemp(join(tmpdir(), "audiogram-")); const queueRoot = join(root, "queue"); const statesRoot = join(root, "states"); const jobsRoot = join(root, "jobs");
  const queued = await queueAudiogram({ draft, audio, queueRoot, statesRoot, now: new Date("2026-08-01T00:00:00Z") });
  const request = JSON.parse(await readFile(join(queueRoot, queued.jobId, "request.json"), "utf8"));
  assert.equal(request.canonicalUrl, "https://fanaticosos.com/blog/bears-2026/");
  await mkdir(join(jobsRoot, queued.jobId, "video"), { recursive: true });
  await writeFile(join(jobsRoot, queued.jobId, "video", "audiogram.mp4"), "video");
  await writeFile(join(jobsRoot, queued.jobId, "video", "result.json"), JSON.stringify({ file: "audiogram.mp4", sizeBytes: 5 }));
  await reconcileAudiograms({ statesRoot, jobsRoot });
  const state = JSON.parse(await readFile(join(statesRoot, `audiogram-${articleId}.json`), "utf8"));
  assert.equal(state.status, "completed");
});

test("simultaneous audiogram requests admit only one video job", async () => {
  const root = await mkdtemp(join(tmpdir(), "audiogram-race-"));
  const queueRoot = join(root, "queue"); const statesRoot = join(root, "states");
  const results = await Promise.allSettled([
    queueAudiogram({ draft, audio, queueRoot, statesRoot }),
    queueAudiogram({ draft, audio, queueRoot, statesRoot }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
});
