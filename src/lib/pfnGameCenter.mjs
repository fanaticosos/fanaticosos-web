const decodeHtml = (value) => value
  .replaceAll("&amp;", "&")
  .replaceAll("&#x27;", "'")
  .replaceAll("&quot;", '"');

const numberBeforeLabel = (html, label, suffix = "") => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`>([0-9]+(?:\\.[0-9]+)?)${suffix}<\\/div><div[^>]*>${escapedLabel}<\\/div>`);
  const match = html.replaceAll("<!-- -->", "").match(pattern);
  if (!match) throw new Error(`PFN ${label} value was not found`);
  return Number(match[1]);
};

export function extractPfnGameCenter(html, nextGame, asOf) {
  if (!nextGame) throw new Error("PFN win probability requires a scheduled next game");
  const projections = {
    season: 2026,
    playoffPercent: numberBeforeLabel(html, "Playoff %", "%"),
    divisionWinPercent: numberBeforeLabel(html, "Div Win %", "%"),
    averageWins: numberBeforeLabel(html, "Avg Wins"),
    sourceUrl: "https://www.profootballnetwork.com/nfl-hq/teams/chicago-bears/schedule/",
    asOf,
  };

  const labels = [...html.matchAll(/aria-label="([^"]*PFN win probability from 100,000 simulations:[^"]*)"/g)]
    .map((match) => decodeHtml(match[1]));
  const label = labels.find((value) => value.includes(`${nextGame.away.name} at ${nextGame.home.name}`));
  if (!label) throw new Error(`PFN win probability did not match ${nextGame.away.name} at ${nextGame.home.name}`);
  const awayMatch = label.match(new RegExp(`${nextGame.away.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ([0-9]+)%`));
  const homeMatch = label.match(new RegExp(`${nextGame.home.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ([0-9]+)%`));
  if (!awayMatch || !homeMatch) throw new Error("PFN win probability values were not found for both teams");
  const awayPercent = Number(awayMatch[1]);
  const homePercent = Number(homeMatch[1]);
  if (awayPercent + homePercent !== 100) throw new Error("PFN win probabilities must add up to 100");

  return {
    projections,
    winProbability: { awayPercent, homePercent, sourceUrl: projections.sourceUrl, asOf },
  };
}
