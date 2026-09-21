const numberBeforeLabel = (html, label, suffix = "") => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`>([0-9]+(?:\\.[0-9]+)?)${suffix}<\\/div><div[^>]*>${escapedLabel}<\\/div>`);
  const match = html.replaceAll("<!-- -->", "").match(pattern);
  if (!match) throw new Error(`PFN ${label} value was not found`);
  return Number(match[1]);
};

export function extractPfnProjections(html, asOf) {
  return {
    season: 2026,
    playoffPercent: numberBeforeLabel(html, "Playoff %", "%"),
    divisionWinPercent: numberBeforeLabel(html, "Div Win %", "%"),
    averageWins: numberBeforeLabel(html, "Avg Wins"),
    sourceUrl: "https://www.profootballnetwork.com/nfl-hq/teams/chicago-bears/schedule/",
    asOf,
  };
}
