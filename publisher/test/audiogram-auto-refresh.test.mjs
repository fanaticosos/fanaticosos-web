import test from "node:test";
import assert from "node:assert/strict";
import { audiogramNeedsRefresh } from "../server.mjs";

test("a completed stale audiogram refreshes automatically when Spanish audio is current", () => {
  const draft = { revision: 2 };
  const audio = {
    status: "completed",
    draftRevision: 2,
    jobs: { es: { status: "completed", result: { sha256: "current-audio" } } },
  };
  const audiogram = { status: "completed", draftRevision: 1, audioSha256: "current-audio" };
  assert.equal(audiogramNeedsRefresh(audiogram, draft, audio), true);
});

test("a stale audiogram waits until current Spanish audio exists", () => {
  const draft = { revision: 2 };
  const audiogram = { status: "completed", draftRevision: 1, audioSha256: "old-audio" };
  assert.equal(audiogramNeedsRefresh(audiogram, draft, {
    status: "completed",
    draftRevision: 1,
    jobs: { es: { status: "completed", result: { sha256: "old-audio" } } },
  }), false);
});

test("the current audiogram is not queued again", () => {
  const draft = { revision: 2 };
  const audio = {
    status: "completed",
    draftRevision: 2,
    jobs: { es: { status: "completed", result: { sha256: "current-audio" } } },
  };
  const audiogram = { status: "completed", draftRevision: 2, audioSha256: "current-audio" };
  assert.equal(audiogramNeedsRefresh(audiogram, draft, audio), false);
});
