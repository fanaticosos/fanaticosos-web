export function espnPredictorUrl(gameId) {
  if (!/^\d+$/.test(String(gameId))) throw new Error("ESPN predictor game ID is invalid");
  return `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${gameId}/competitions/${gameId}/predictor`;
}

export function extractEspnPredictor(data, nextGame, asOf) {
  if (!nextGame) throw new Error("ESPN predictor requires a scheduled next game");
  if (data?.name !== `${nextGame.away.name} at ${nextGame.home.name}`
    || data?.shortName !== `${nextGame.away.abbreviation} @ ${nextGame.home.abbreviation}`) {
    throw new Error("ESPN predictor does not match the scheduled next game");
  }
  const projection = (side) => {
    const statistic = data?.[side]?.statistics?.find((item) => item.name === "gameProjection");
    const value = Number(statistic?.displayValue);
    if (!Number.isFinite(value) || value < 0 || value > 100 || !/^\d+(?:\.\d+)?$/.test(statistic?.displayValue ?? "")) {
      throw new Error(`ESPN ${side} game projection is invalid`);
    }
    return value;
  };
  const homePercent = projection("homeTeam");
  const awayPercent = projection("awayTeam");
  const tieStatistic = data?.homeTeam?.statistics?.find((item) => item.name === "teamChanceTie");
  const tiePercent = Number(tieStatistic?.value);
  if (!Number.isFinite(tiePercent) || tiePercent < 0 || tiePercent > 100
    || Math.abs(homePercent + awayPercent + tiePercent - 100) > 0.11) {
    throw new Error("ESPN win and tie probabilities do not add up to 100");
  }
  return {
    awayPercent,
    homePercent,
    sourceUrl: `https://www.espn.com/nfl/game/_/gameId/${nextGame.id}`,
    asOf,
  };
}
