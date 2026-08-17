import assert from "node:assert/strict";
import test from "node:test";

import { requireTtsPreflight, ttsPreflight } from "../lib/tts-preflight.mjs";

const database = {
  schemaVersion: 1, version: 1, season: 2026,
  teams: Array.from({ length: 32 }, (_, index) => ({
    canonical: index ? `Team ${index}` : "Chicago Bears",
    market: index ? `City ${index}` : "Chicago",
    nickname: index ? `Nickname ${index}` : "Bears",
    rosterSource: "https://www.nfl.com/",
    players: index ? [] : [{ name: "Caleb Williams", language: "en-US" }, { name: "Deshaun Watson", language: "en-US" }],
  })),
  places: [{ category: "venue", grapheme: "Soldier Field", language: "en-US" }],
};
const azure = { entities: [{ category: "term", grapheme: "NFL", mode: "spanish-broadcast", alias: "ene efe ele" }] };

test("preflight detects roster players cities and venues", () => {
  const result = ttsPreflight({
    title: "Chicago Bears en Soldier Field",
    description: "Caleb Williams habló.",
    body: "Deshaun Watson compite en la NFL.",
  }, database, azure);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.detected.some((item) => item.written === "Caleb Williams" && item.language === "en-US"), true);
});

test("preflight blocks an unknown full proper name", () => {
  const draft = { title: "Chicago Bears", description: "Jugador nuevo", body: "Mystery Player llegó al equipo." };
  const result = ttsPreflight(draft, database, azure);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.unresolved, ["Mystery Player"]);
  assert.throws(() => requireTtsPreflight(draft, database, azure), /Mystery Player/);
});
