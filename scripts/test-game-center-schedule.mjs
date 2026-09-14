import assert from "node:assert/strict";
import { test } from "node:test";
import { gameCenterPollDecision } from "./publisher/run_game_center_automation.mjs";

const current = { nextGame: { startsAt: "2026-09-20T17:00:00.000Z" } };

test("Game Center checks every ten minutes inside the game window", () => {
  assert.deepEqual(gameCenterPollDecision({ current, state: { lastSuccessfulCheckAt: "2026-09-20T16:19:59.000Z" }, now: new Date("2026-09-20T16:30:00.000Z") }), { due: true, mode: "game" });
  assert.deepEqual(gameCenterPollDecision({ current, state: { lastSuccessfulCheckAt: "2026-09-20T16:25:00.000Z" }, now: new Date("2026-09-20T16:30:00.000Z") }), { due: false, mode: "game" });
});

test("Game Center checks only daily outside the game window", () => {
  assert.deepEqual(gameCenterPollDecision({ current, state: { lastSuccessfulCheckAt: "2026-09-19T12:00:00.000Z" }, now: new Date("2026-09-20T12:00:01.000Z") }), { due: true, mode: "daily" });
  assert.deepEqual(gameCenterPollDecision({ current, state: { lastSuccessfulCheckAt: "2026-09-20T11:00:00.000Z" }, now: new Date("2026-09-20T12:00:00.000Z") }), { due: false, mode: "daily" });
});

test("Game Center respects provider backoff", () => {
  assert.deepEqual(gameCenterPollDecision({ current, state: { backoffUntil: "2026-09-20T13:00:00.000Z" }, now: new Date("2026-09-20T12:00:00.000Z") }), { due: false, mode: "backoff" });
});
