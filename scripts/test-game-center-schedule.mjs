import assert from "node:assert/strict";
import { test } from "node:test";
import { gameCenterPollDecision, preserveVenues } from "./publisher/run_game_center_automation.mjs";

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

test("Game Center preserves verified venue metadata omitted by ESPN team markup", () => {
  const projections = { season: 2026, playoffPercent: 69.5, divisionWinPercent: 37.2, averageWins: 10.5 };
  const candidate = { previousGame: { id: "game-1", venue: null }, nextGame: null, recentResults: [{ id: "game-1", venue: null }] };
  const prior = { previousGame: { id: "game-1", venue: "Soldier Field" }, nextGame: null, recentResults: [], projections };
  preserveVenues(candidate, prior);
  assert.equal(candidate.previousGame.venue, "Soldier Field");
  assert.equal(candidate.recentResults[0].venue, "Soldier Field");
  assert.equal(candidate.projections, projections);
});
