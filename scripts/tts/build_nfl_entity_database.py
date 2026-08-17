#!/usr/bin/env python3
"""Build the operational Fanaticosos NFL entity database from official NFL rosters."""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

NFL_ROSTER = "https://www.nfl.com/sitemap/html/rosters/{season}/{slug}"
PLAYER = re.compile(r'<a href="(/players/[^"]+/)"[^>]*>\s*([^<]+?)\s*</a>')
NAME_SUFFIXES = {"jr.", "sr.", "ii", "iii", "iv", "v"}


def player_surname(name: str) -> str | None:
    parts = name.split()
    if parts and parts[-1].casefold() in NAME_SUFFIXES:
        parts.pop()
    return parts[-1] if len(parts) >= 2 else None


def slugify_team(canonical: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", canonical.casefold()).strip("-")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_roster(season: int, canonical: str) -> list[dict[str, str]]:
    url = NFL_ROSTER.format(season=season, slug=slugify_team(canonical))
    request = urllib.request.Request(url, headers={"User-Agent": "FanaticososBlogData/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        body = response.read().decode("utf-8")
    players: list[dict[str, str]] = []
    seen: set[str] = set()
    for path, raw_name in PLAYER.findall(body):
        name = html.unescape(raw_name).strip()
        if not name or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        players.append({"name": name, "nflPath": path, "language": "en-US"})
    if len(players) < 40:
        raise ValueError(f"official roster for {canonical} returned only {len(players)} players")
    return players


def build(configuration: dict[str, Any], terms: dict[str, Any], season: int) -> dict[str, Any]:
    reviewed = {
        item["grapheme"].casefold(): item
        for item in configuration["entities"]
        if item.get("category") in {"player", "coach", "owner"}
    }
    teams = []
    for team in configuration["teams"]:
        players = fetch_roster(season, team["canonical"])
        for player in players:
            surname = player_surname(player["name"])
            if surname:
                player["writtenForms"] = [surname]
            override = reviewed.get(player["name"].casefold())
            if override:
                for key in ("alias", "narratorAlias", "writtenForms", "writtenFormAliases", "narratorWrittenFormAliases", "status", "sourceType"):
                    if key in override:
                        if key == "writtenForms":
                            player[key] = list(dict.fromkeys([*(player.get(key) or []), *override[key]]))
                        else:
                            player[key] = override[key]
        teams.append({
            "canonical": team["canonical"],
            "market": team["canonical"].removesuffix(team["nickname"]).strip(),
            "nickname": team["nickname"],
            "division": team["division"],
            "rosterSource": NFL_ROSTER.format(season=season, slug=slugify_team(team["canonical"])),
            "players": players,
        })
    places = [
        {key: item[key] for key in ("category", "grapheme", "language", "alias", "status", "sourceType") if key in item}
        for item in configuration["entities"]
        if item.get("category") in {"place", "venue", "school"}
    ]
    vocabulary = sorted({item["canonical"] for item in terms["terms"]}, key=str.casefold)
    return {
        "schemaVersion": 1,
        "version": 1,
        "season": season,
        "generatedOn": date.today().isoformat(),
        "policy": {
            "peopleAndPlacesLanguage": "en-US",
            "unknownProperNouns": "block",
            "visibleTextChanges": False,
        },
        "sources": [{
            "name": "NFL.com official roster sitemap",
            "urlTemplate": NFL_ROSTER,
            "type": "official",
        }],
        "teams": teams,
        "places": places,
        "terms": vocabulary,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configuration", required=True, type=Path)
    parser.add_argument("--terms", required=True, type=Path)
    parser.add_argument("--season", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    value = build(read_json(args.configuration), read_json(args.terms), args.season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    player_count = sum(len(team["players"]) for team in value["teams"])
    print(f"Built {len(value['teams'])} teams, {player_count} players, {len(value['places'])} places, and {len(value['terms'])} terms.")


if __name__ == "__main__":
    main()
