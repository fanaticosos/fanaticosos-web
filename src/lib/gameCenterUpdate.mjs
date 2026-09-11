import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildGameCenterFromEspnHtml, extractEspnBoxScore } from "./espnGameCenter.mjs";
import {
  extractOfficialBearsSchedule,
  verifyGameCenterAgainstOfficialSchedule,
} from "./bearsScheduleVerification.mjs";

export const ESPN_TEAM_URL = "https://www.espn.com/nfl/team/_/name/chi/chicago-bears";
export const BEARS_SCHEDULE_URL = "https://www.chicagobears.com/schedule/";

function verifyPreviousGame(previousGame, boxScore) {
  if (!previousGame) return;
  const matches = previousGame.id === boxScore.id
    && previousGame.home.name === boxScore.home.name
    && previousGame.away.name === boxScore.away.name
    && previousGame.homeScore === boxScore.home.score
    && previousGame.awayScore === boxScore.away.score
    && Date.parse(previousGame.startsAt) === Date.parse(boxScore.startsAt);
  if (!matches) throw new Error("ESPN team result does not match its individual box score");
}

export function buildVerifiedGameCenter({ teamHtml, officialHtml, boxScoreHtml, updatedAt }) {
  const candidate = buildGameCenterFromEspnHtml(teamHtml, { updatedAt });
  const officialGames = extractOfficialBearsSchedule(officialHtml);
  const scheduleVerification = verifyGameCenterAgainstOfficialSchedule(candidate, officialGames);
  if (!scheduleVerification.verified) {
    throw new Error(`Official Bears schedule verification failed: ${scheduleVerification.reason}`);
  }
  if (candidate.previousGame) verifyPreviousGame(candidate.previousGame, extractEspnBoxScore(boxScoreHtml));
  return candidate;
}

async function fetchText(fetchImplementation, url) {
  const response = await fetchImplementation(url, {
    headers: { "user-agent": "FanaticOSOS-GameCenter/1.0 (+https://fanaticosos.com)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return response.text();
}

export async function updateGameCenter({
  outputPath,
  fetchImplementation = fetch,
  updatedAt = Date.now(),
}) {
  const [teamHtml, officialHtml] = await Promise.all([
    fetchText(fetchImplementation, ESPN_TEAM_URL),
    fetchText(fetchImplementation, BEARS_SCHEDULE_URL),
  ]);
  const preliminary = buildGameCenterFromEspnHtml(teamHtml, { updatedAt });
  const boxScoreHtml = preliminary.previousGame
    ? await fetchText(fetchImplementation, preliminary.previousGame.boxScoreUrl)
    : "";
  const candidate = buildVerifiedGameCenter({ teamHtml, officialHtml, boxScoreHtml, updatedAt });

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, outputPath);
  return candidate;
}
