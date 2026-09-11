import { gameCenterSchema } from "./gameCenterSchema.mjs";

const BEARS = { id: "3", name: "Chicago Bears", abbreviation: "CHI" };
const ESPN_TEAM_URL = "https://www.espn.com/nfl/team/_/name/chi/chicago-bears";
const BEARS_SCHEDULE_URL = "https://www.chicagobears.com/schedule/";

export function extractEspnState(html) {
  const marker = "window['__espnfitt__']";
  const markerStart = html.indexOf(marker);
  if (markerStart < 0) throw new Error("ESPN state marker is missing");

  const objectStart = html.indexOf("{", markerStart + marker.length);
  if (objectStart < 0) throw new Error("ESPN state object is missing");

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = objectStart; index < html.length; index += 1) {
    const character = html[index];

    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(objectStart, index + 1));
        } catch (error) {
          throw new Error(`ESPN state is not valid JSON: ${error.message}`);
        }
      }
    }
  }

  throw new Error("ESPN state object is incomplete");
}

function opponent(event) {
  const name = [event.opponentLocation, event.opponentNickname].filter(Boolean).join(" ");
  if (!name || !event.opponentAbbreviation) throw new Error(`ESPN event ${event.id} has no opponent`);
  return { id: event.opponentAbbreviation, name, abbreviation: event.opponentAbbreviation };
}

function teams(event) {
  const other = opponent(event);
  if (event.homeAway === "h") return { home: BEARS, away: other };
  if (event.homeAway === "a") return { home: other, away: BEARS };
  throw new Error(`ESPN event ${event.id} has invalid homeAway`);
}

function boxScoreUrl(event) {
  return `https://www.espn.com/nfl/boxscore/_/gameId/${event.id}`;
}

function status(event) {
  if (event.status === "post" || event.statusName === "STATUS_FINAL") return "final";
  if (event.status === "in") return "in_progress";
  if (event.date === "TBD" || event.timeValid === false) return "tbd";
  return "scheduled";
}

function baseGame(event) {
  return {
    id: String(event.id),
    status: status(event),
    startsAt: event.date === "TBD" ? null : new Date(event.date).toISOString(),
    timeZone: "America/Chicago",
    venue: event.venue?.fullName ?? null,
    ...teams(event),
    homeScore: null,
    awayScore: null,
    boxScoreUrl: boxScoreUrl(event),
  };
}

function finalGame(event) {
  const match = /^([WLT])\s+(\d+)-(\d+)$/.exec(event.score ?? "");
  if (!match) throw new Error(`ESPN final event ${event.id} has invalid score`);

  const [, outcome, first, second] = match;
  const bearsScore = Number(outcome === "L" ? second : first);
  const opponentScore = Number(outcome === "L" ? first : second);
  const game = baseGame(event);
  if (game.status !== "final") throw new Error(`ESPN event ${event.id} is not final`);

  return {
    ...game,
    homeScore: game.home.abbreviation === "CHI" ? bearsScore : opponentScore,
    awayScore: game.away.abbreviation === "CHI" ? bearsScore : opponentScore,
  };
}

function standingsFrom(module) {
  const group = module?.feed?.[0];
  const entries = group?.entries;
  const statMap = group?.statMap;
  if (!Array.isArray(entries) || !statMap) throw new Error("ESPN NFC North standings are missing");

  const index = (name) => {
    const value = statMap[name]?.i;
    if (!Number.isInteger(value)) throw new Error(`ESPN standings field ${name} is missing`);
    return value;
  };
  const wins = index("wins");
  const losses = index("losses");
  const ties = index("ties");

  return entries.map((entry) => ({
    team: {
      id: entry.team.abbrev,
      name: entry.team.displayName,
      abbreviation: entry.team.abbrev,
    },
    wins: Number(entry.stats[wins]),
    losses: Number(entry.stats[losses]),
    ties: Number(entry.stats[ties]),
  }));
}

export function buildGameCenterFromEspnHtml(html, options = {}) {
  const state = extractEspnState(html);
  const clubhouse = state.page?.content?.clubhouse;
  const seasons = clubhouse?.columns?.leftColumn?.schedule?.seasons;
  if (!Array.isArray(seasons)) throw new Error("ESPN team schedule is missing");

  const events = seasons.flatMap((season) => season.feed ?? []);
  const upcoming = events
    .filter((event) => ["scheduled", "in_progress", "tbd"].includes(status(event)))
    .sort((left, right) => {
      if (left.date === "TBD") return 1;
      if (right.date === "TBD") return -1;
      return Date.parse(left.date) - Date.parse(right.date);
    });
  const finals = events
    .filter((event) => status(event) === "final")
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 3)
    .map(finalGame);

  const value = {
    version: 1,
    updatedAt: new Date(options.updatedAt ?? Date.now()).toISOString(),
    source: { primary: ESPN_TEAM_URL, verification: BEARS_SCHEDULE_URL },
    nextGame: upcoming[0] ? baseGame(upcoming[0]) : null,
    previousGame: finals[0] ?? null,
    recentResults: finals,
    nfcNorth: standingsFrom(clubhouse?.columns?.rightColumn?.standings),
  };

  return gameCenterSchema.parse(value);
}

function boxScoreTeam(team) {
  if (!team?.id || !team?.displayName || !team?.abbrev) {
    throw new Error("ESPN box score contains an incomplete team");
  }

  return {
    id: String(team.id),
    name: team.displayName,
    abbreviation: team.abbrev,
    score: Number(team.score),
    linescores: (team.linescores ?? []).map((line) => Number(line.displayValue)),
  };
}

export function extractEspnBoxScore(html) {
  const state = extractEspnState(html);
  const gamepackage = state.page?.content?.gamepackage;
  const strip = gamepackage?.gmStrp;
  const home = boxScoreTeam(gamepackage?.prsdTms?.home);
  const away = boxScoreTeam(gamepackage?.prsdTms?.away);

  if (!strip?.gid || strip?.statusState !== "post") {
    throw new Error("ESPN box score is not final");
  }
  if (![home.score, away.score, ...home.linescores, ...away.linescores].every(Number.isFinite)) {
    throw new Error("ESPN box score contains an invalid score");
  }

  return {
    id: String(strip.gid),
    status: "final",
    startsAt: new Date(strip.dt).toISOString(),
    home,
    away,
  };
}
