import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BEARS_SCHEDULE_URL,
  ESPN_TEAM_URL,
  PFN_URL,
  updateGameCenter,
} from "../src/lib/gameCenterUpdate.mjs";
import { espnPredictorUrl, extractEspnPredictor } from "../src/lib/espnPredictor.mjs";

const standings = ["CHI", "DET", "GB", "MIN"].map((abbrev) => ({
  team: { abbrev, displayName: abbrev === "CHI" ? "Chicago Bears" : abbrev },
  stats: ["0", "0", "0"],
}));
const teamState = { page: { content: { clubhouse: { columns: {
  leftColumn: { schedule: { seasons: [{ feed: [
    { id: "401872963", date: "2026-09-13T17:00Z", timeValid: true, status: "pre", opponentLocation: "Carolina", opponentNickname: "Panthers", opponentAbbreviation: "CAR", homeAway: "a" },
    { id: "401872937", date: "2026-08-29T22:00Z", timeValid: true, status: "post", statusName: "STATUS_FINAL", score: "W 24-15", opponentLocation: "Tennessee", opponentNickname: "Titans", opponentAbbreviation: "TEN", homeAway: "a" },
  ] }] } },
  rightColumn: { standings: { feed: [{ entries: standings, statMap: { wins: { i: 0 }, losses: { i: 1 }, ties: { i: 2 } } }] } },
} } } } };
const boxState = { page: { content: { gamepackage: {
  gmStrp: { gid: "401872937", dt: "2026-08-29T22:00Z", statusState: "post" },
  prsdTms: {
    home: { id: "TEN", displayName: "Tennessee Titans", abbrev: "TEN", score: "15", linescores: [] },
    away: { id: "3", displayName: "Chicago Bears", abbrev: "CHI", score: "24", linescores: [] },
  },
} } } };
const scriptHtml = (state) => `<script>window['__espnfitt__']=${JSON.stringify(state)};</script>`;
const officialHtml = `<script>var nationalGames=[];var regionalGames=${JSON.stringify([{
  GameId: "official-next", Week: "1", Title: "Chicago Bears at Carolina Panthers", StartTime: "2026-09-13T17:00:00.000Z",
}])};</script>`;
const pfnHtml = `<div>69.5%</div><div>Playoff %</div><div>37.2%</div><div>Div Win %</div><div>10.5</div><div>Avg Wins</div><button aria-label="Week 1. Chicago Bears at Carolina Panthers. PFN win probability from 100,000 simulations: Chicago Bears 61%, Carolina Panthers 39%. Show details"></button>`;
const predictor = {
  name: "Chicago Bears at Carolina Panthers", shortName: "CHI @ CAR",
  homeTeam: { statistics: [{ name: "gameProjection", displayValue: "38.5" }, { name: "teamChanceTie", value: 0.3 }] },
  awayTeam: { statistics: [{ name: "gameProjection", displayValue: "61.2" }] },
};

function mockFetch({ wrongScore = false, wrongPredictor = false } = {}) {
  return async (url) => {
    let body;
    if (url === ESPN_TEAM_URL) body = scriptHtml(teamState);
    else if (url === BEARS_SCHEDULE_URL) body = officialHtml;
    else if (url === PFN_URL) body = pfnHtml;
    else if (url === espnPredictorUrl("401872963")) body = JSON.stringify(wrongPredictor ? { ...predictor, shortName: "MIN @ CHI" } : predictor);
    else body = scriptHtml(wrongScore
      ? { ...boxState, page: { content: { gamepackage: { ...boxState.page.content.gamepackage, prsdTms: { ...boxState.page.content.gamepackage.prsdTms, away: { ...boxState.page.content.gamepackage.prsdTms.away, score: "23" } } } } } }
      : boxState);
    return { ok: true, status: 200, text: async () => body };
  };
}

const directory = await mkdtemp(join(tmpdir(), "fanaticosos-game-center-"));
const outputPath = join(directory, "game-center.json");
try {
  await writeFile(outputPath, "sentinel\n");
  const updated = await updateGameCenter({ outputPath, fetchImplementation: mockFetch(), updatedAt: "2026-09-10T23:59:00Z" });
  assert.equal(updated.previousGame.id, "401872937");
  assert.deepEqual(updated.projections, {
    season: 2026, playoffPercent: 69.5, divisionWinPercent: 37.2, averageWins: 10.5,
    sourceUrl: PFN_URL, asOf: "2026-09-10",
  });
  assert.deepEqual(updated.nextGame.winProbability, { awayPercent: 61.2, homePercent: 38.5, sourceUrl: "https://www.espn.com/nfl/game/_/gameId/401872963", asOf: "2026-09-10" });
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).nextGame.id, "401872963");

  assert.throws(() => extractEspnPredictor({ ...predictor, name: "Minnesota Vikings at Chicago Bears" }, updated.nextGame, "2026-09-10"), /does not match/);

  await writeFile(outputPath, "preserve-me\n");
  await assert.rejects(
    updateGameCenter({ outputPath, fetchImplementation: mockFetch({ wrongScore: true }), updatedAt: "2026-09-10T23:59:00Z" }),
    /does not match/,
  );
  assert.equal(await readFile(outputPath, "utf8"), "preserve-me\n");
  await assert.rejects(
    updateGameCenter({ outputPath, fetchImplementation: mockFetch({ wrongPredictor: true }), updatedAt: "2026-09-10T23:59:00Z" }),
    /does not match/,
  );
  assert.equal(await readFile(outputPath, "utf8"), "preserve-me\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Passed atomic Game Center update tests.");
