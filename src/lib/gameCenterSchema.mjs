import { z } from "astro/zod";

const team = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  abbreviation: z.string().min(2).max(4),
});

const gameStatus = z.enum(["scheduled", "in_progress", "final", "postponed", "canceled", "tbd"]);

const game = z.object({
  id: z.string().min(1),
  status: gameStatus,
  startsAt: z.iso.datetime().nullable(),
  timeZone: z.string().min(1),
  venue: z.string().min(1).nullable(),
  home: team,
  away: team,
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  boxScoreUrl: z.url().refine((value) => new URL(value).hostname === "www.espn.com", "Box score must use www.espn.com"),
});

const result = game.extend({
  status: z.literal("final"),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
});

const standing = z.object({
  team,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
});

export const gameCenterSchema = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime(),
  source: z.object({
    primary: z.url(),
    verification: z.url(),
  }),
  nextGame: game.nullable(),
  previousGame: result.nullable(),
  recentResults: z.array(result).max(3),
  nfcNorth: z.array(standing).length(4),
}).superRefine((value, context) => {
  const abbreviations = value.nfcNorth.map((entry) => entry.team.abbreviation);
  const expected = ["CHI", "DET", "GB", "MIN"];
  if (new Set(abbreviations).size !== expected.length || expected.some((teamAbbreviation) => !abbreviations.includes(teamAbbreviation))) {
    context.addIssue({
      code: "custom",
      path: ["nfcNorth"],
      message: "NFC North must contain CHI, DET, GB, and MIN exactly once",
    });
  }
});
