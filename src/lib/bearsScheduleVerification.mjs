const BEARS_NAME = "Chicago Bears";

function extractArrayAssignment(html, variableName) {
  const marker = `var ${variableName}=`;
  const markerStart = html.indexOf(marker);
  if (markerStart < 0) throw new Error(`Official schedule variable ${variableName} is missing`);

  const arrayStart = html.indexOf("[", markerStart + marker.length);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = arrayStart; index < html.length; index += 1) {
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

    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(arrayStart, index + 1));
        } catch (error) {
          throw new Error(`Official schedule ${variableName} is not valid JSON: ${error.message}`);
        }
      }
    }
  }

  throw new Error(`Official schedule variable ${variableName} is incomplete`);
}

export function extractOfficialBearsSchedule(html) {
  const candidates = ["nationalGames", "regionalGames"]
    .flatMap((variableName) => {
      try {
        return extractArrayAssignment(html, variableName);
      } catch (error) {
        if (error.message.includes("is missing")) return [];
        throw error;
      }
    })
    .filter((game) => game.Title?.includes(BEARS_NAME));

  if (candidates.length === 0) throw new Error("Official Bears schedule contains no Bears games");

  const unique = new Map();
  for (const game of candidates) unique.set(game.GameId, game);

  return [...unique.values()].map((game) => ({
    id: String(game.GameId),
    week: Number(game.Week),
    name: game.Title,
    startsAt: new Date(game.StartTime).toISOString(),
    home: game.Title.split(" at ")[1],
    away: game.Title.split(" at ")[0],
  }));
}

export function verifyEspnGameAgainstOfficialSchedule(espnGame, officialGames) {
  if (espnGame === null) return { verified: true, reason: "no-upcoming-game" };
  if (espnGame.status === "tbd") return { verified: false, reason: "official-time-not-final" };

  const match = officialGames.find((game) => {
    const sameTeams = game.home === espnGame.home.name && game.away === espnGame.away.name;
    const sameTime = Date.parse(game.startsAt) === Date.parse(espnGame.startsAt);
    return sameTeams && sameTime;
  });

  if (!match) return { verified: false, reason: "schedule-mismatch" };
  return { verified: true, reason: "schedule-match", officialGameId: match.id };
}

export function verifyGameCenterAgainstOfficialSchedule(gameCenter, officialGames) {
  const espnGames = [gameCenter.nextGame, ...gameCenter.recentResults].filter(Boolean);
  const matches = officialGames.map((officialGame) => ({
    officialGame,
    espnGame: espnGames.find((game) => {
      const sameTeams = officialGame.home === game.home.name && officialGame.away === game.away.name;
      const sameTime = Date.parse(officialGame.startsAt) === Date.parse(game.startsAt);
      return sameTeams && sameTime;
    }),
  }));
  const match = matches.find(({ espnGame }) => espnGame);

  if (!match) return { verified: false, reason: "active-week-mismatch" };
  return {
    verified: true,
    reason: "active-week-match",
    officialGameId: match.officialGame.id,
    espnGameId: match.espnGame.id,
  };
}
