import test from "node:test";
import assert from "node:assert/strict";
import { audiogramWithFreshness } from "../server.mjs";
import { audiogramInputSignature, audiogramRequestForDraft } from "../lib/audiogram-jobs.mjs";

function inputs(draft, audio) {
  return audiogramInputSignature(audiogramRequestForDraft(draft, audio));
}

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001",
  revision: 2,
  title: "Bears win",
  description: "Game recap",
  tags: ["#BearDown"],
  featuredImage: { path: "/uploads/current.webp" },
};
const audio = {
  status: "completed",
  draftRevision: 2,
  jobs: { es: { jobId: "tts-es-current", status: "completed", result: { file: "audio.mp3", sha256: "a".repeat(64) } } },
};

test("a completed video remains downloadable across revision-only changes", () => {
  const audiogram = { status: "completed", draftRevision: 1, audioSha256: "a".repeat(64), inputSignature: inputs(draft, audio) };
  assert.equal(audiogramWithFreshness(audiogram, draft, audio).status, "completed");
});

test("a completed video becomes stale when a real video input changes", () => {
  const previousDraft = { ...draft, featuredImage: { path: "/uploads/previous.webp" } };
  const audiogram = { status: "completed", draftRevision: 1, audioSha256: "a".repeat(64), inputSignature: inputs(previousDraft, audio) };
  assert.equal(audiogramWithFreshness(audiogram, draft, audio).status, "stale");
});

test("legacy video state keeps the strict revision fallback", () => {
  const audio = {
    status: "completed",
    draftRevision: 2,
    jobs: { es: { status: "completed", result: { sha256: "current-audio" } } },
  };
  const audiogram = { status: "completed", draftRevision: 1, audioSha256: "current-audio" };
  assert.equal(audiogramWithFreshness(audiogram, { revision: 2 }, audio).status, "stale");
});
