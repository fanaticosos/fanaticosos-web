import assert from "node:assert/strict";
import { buildGameCenterFromEspnHtml, extractEspnBoxScore, extractEspnState } from "../src/lib/espnGameCenter.mjs";

const event = (overrides) => ({
  id: "future",
  date: "2026-09-13T17:00Z",
  timeValid: true,
  status: "pre",
  statusName: "STATUS_SCHEDULED",
  opponentLocation: "Carolina",
  opponentNickname: "Panthers",
  opponentAbbreviation: "CAR",
  homeAway: "a",
  ...overrides,
});

const standings = ["CHI", "DET", "GB", "MIN"].map((abbreviation, position) => ({
  team: { abbrev: abbreviation, displayName: abbreviation === "CHI" ? "Chicago Bears" : abbreviation },
  stats: [String(position), "-", String(position), "0", "0", "0", "0", "-", "0", ".000", String(3 - position)],
}));

const state = {
  page: {
    content: {
      clubhouse: {
        columns: {
          leftColumn: {
            schedule: {
              seasons: [
                { title: 2, feed: [event({})] },
                { title: 1, feed: [
                  event({ id: "old", date: "2026-08-15T17:00Z", status: "post", statusName: "STATUS_FINAL", score: "W 34-10", opponentLocation: "Cleveland", opponentNickname: "Browns", opponentAbbreviation: "CLE", homeAway: "h" }),
                  event({ id: "latest", date: "2026-08-29T22:00Z", status: "post", statusName: "STATUS_FINAL", score: "W 24-15", opponentLocation: "Tennessee", opponentNickname: "Titans", opponentAbbreviation: "TEN", homeAway: "a" }),
                ] },
              ],
            },
          },
          rightColumn: {
            standings: {
              feed: [{
                entries: standings,
                statMap: { losses: { i: 2 }, ties: { i: 8 }, wins: { i: 10 } },
              }],
            },
          },
        },
      },
    },
  },
};

const html = `<script>window['__CONFIG__']={"test":true};</script><script>window['__espnfitt__']=${JSON.stringify(state)};</script>`;
assert.deepEqual(extractEspnState(html), state);

const gameCenter = buildGameCenterFromEspnHtml(html, { updatedAt: "2026-09-10T23:59:00Z" });
assert.equal(gameCenter.nextGame.id, "future");
assert.equal(gameCenter.nextGame.home.abbreviation, "CAR");
assert.equal(gameCenter.nextGame.away.abbreviation, "CHI");
assert.equal(gameCenter.previousGame.id, "latest");
assert.equal(gameCenter.previousGame.homeScore, 15);
assert.equal(gameCenter.previousGame.awayScore, 24);
assert.equal(gameCenter.recentResults[1].homeScore, 34);
assert.equal(gameCenter.recentResults[1].awayScore, 10);
assert.deepEqual(gameCenter.nfcNorth.map((entry) => entry.team.abbreviation), ["CHI", "DET", "GB", "MIN"]);

assert.throws(() => extractEspnState("<html></html>"), /marker is missing/);
assert.throws(() => buildGameCenterFromEspnHtml(html.replace("W 24-15", "Final")), /invalid score/);

const boxScoreState = { page: { content: { gamepackage: {
  gmStrp: { gid: "latest", dt: "2026-08-29T22:00Z", statusState: "post" },
  prsdTms: {
    home: { id: "10", displayName: "Tennessee Titans", abbrev: "TEN", score: "15", linescores: [{ displayValue: "7" }, { displayValue: "8" }] },
    away: { id: "3", displayName: "Chicago Bears", abbrev: "CHI", score: "24", linescores: [{ displayValue: "10" }, { displayValue: "14" }] },
  },
} } } };
const boxScoreHtml = `<script>window['__espnfitt__']=${JSON.stringify(boxScoreState)};</script>`;
assert.deepEqual(extractEspnBoxScore(boxScoreHtml), {
  id: "latest",
  status: "final",
  startsAt: "2026-08-29T22:00:00.000Z",
  home: { id: "10", name: "Tennessee Titans", abbreviation: "TEN", score: 15, linescores: [7, 8] },
  away: { id: "3", name: "Chicago Bears", abbreviation: "CHI", score: 24, linescores: [10, 14] },
});

console.log("Passed ESPN Game Center extraction tests.");
