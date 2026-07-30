import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteSettingsSchema } from "../src/lib/siteSettingsSchema.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsFile = path.join(projectRoot, "src/data/site-settings.json");
const source = JSON.parse(await readFile(settingsFile, "utf8"));
const settings = siteSettingsSchema.parse(source);

console.log(`Validated site settings version ${settings.version} with playlist and weekly-song links.`);
