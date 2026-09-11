import assert from "node:assert/strict";
import {
  extractOfficialBearsSchedule,
  verifyGameCenterAgainstOfficialSchedule,
  verifyEspnGameAgainstOfficialSchedule,
} from "../src/lib/bearsScheduleVerification.mjs";

const officialGame = {
  Description: "The Carolina Panthers host the Chicago Bears.",
  Title: "Chicago Bears at Carolina Panthers",
  StartTime: "2026-09-13T17:00:00.000Z",
  EndTime: "2026-09-13T21:00:00.000Z",
  GameTerritory: "REGIONAL",
  GameId: "official-week-1",
  Week: "1",
  DmaCodes: ["000"],
  NflSeason: "2026",
};

const html = `<script>var nationalGames=[];var regionalGames=${JSON.stringify([officialGame, officialGame])};</script>`;
const schedule = extractOfficialBearsSchedule(html);
assert.equal(schedule.length, 1);
assert.deepEqual(schedule[0], {
  id: "official-week-1",
  week: 1,
  name: "Chicago Bears at Carolina Panthers",
  startsAt: "2026-09-13T17:00:00.000Z",
  home: "Carolina Panthers",
  away: "Chicago Bears",
});

const espnGame = {
  status: "scheduled",
  startsAt: "2026-09-13T17:00:00.000Z",
  home: { name: "Carolina Panthers" },
  away: { name: "Chicago Bears" },
};

assert.deepEqual(verifyEspnGameAgainstOfficialSchedule(espnGame, schedule), {
  verified: true,
  reason: "schedule-match",
  officialGameId: "official-week-1",
});
assert.deepEqual(verifyEspnGameAgainstOfficialSchedule({ ...espnGame, startsAt: "2026-09-13T18:00:00.000Z" }, schedule), {
  verified: false,
  reason: "schedule-mismatch",
});
assert.equal(verifyGameCenterAgainstOfficialSchedule({ nextGame: espnGame, recentResults: [] }, schedule).verified, true);
assert.equal(verifyGameCenterAgainstOfficialSchedule({ nextGame: null, recentResults: [{ ...espnGame, status: "final" }] }, schedule).verified, true);
assert.equal(verifyGameCenterAgainstOfficialSchedule({ nextGame: null, recentResults: [] }, schedule).verified, false);
assert.throws(() => extractOfficialBearsSchedule("<html></html>"), /contains no Bears games/);

console.log("Passed official Bears schedule verification tests.");
