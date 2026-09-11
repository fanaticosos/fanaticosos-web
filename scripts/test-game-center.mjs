import assert from "node:assert/strict";
import { gameCenterSchema } from "../src/lib/gameCenterSchema.mjs";
import source from "../src/data/game-center.json" with { type: "json" };

assert.doesNotThrow(() => gameCenterSchema.parse(source));

assert.throws(() => gameCenterSchema.parse({
  ...source,
  previousGame: { ...source.previousGame, status: "scheduled" },
}));

assert.throws(() => gameCenterSchema.parse({
  ...source,
  nextGame: { ...source.nextGame, boxScoreUrl: "https://example.com/game/401872661" },
}));

assert.throws(() => gameCenterSchema.parse({
  ...source,
  nfcNorth: source.nfcNorth.map((entry) => ({ ...entry, team: { ...entry.team, abbreviation: "CHI" } })),
}));

console.log("Passed Game Center contract tests.");
