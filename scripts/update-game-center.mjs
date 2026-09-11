import { resolve } from "node:path";
import { updateGameCenter } from "../src/lib/gameCenterUpdate.mjs";

const outputPath = resolve(process.argv[2] ?? "src/data/game-center.json");
const result = await updateGameCenter({ outputPath });
console.log(`Updated Game Center through ${result.updatedAt}: ${result.previousGame?.id ?? "no result"} -> ${result.nextGame?.id ?? "no next game"}`);
