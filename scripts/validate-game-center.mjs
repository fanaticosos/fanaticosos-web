import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gameCenterSchema } from "../src/lib/gameCenterSchema.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(projectRoot, "src", "data", "game-center.json");
const source = JSON.parse(await readFile(dataFile, "utf8"));
const gameCenter = gameCenterSchema.parse(source);

console.log(`Validated Game Center version ${gameCenter.version} with ${gameCenter.recentResults.length} recent result(s).`);
