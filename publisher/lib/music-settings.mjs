import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { parseNavidromeShare } from "../../src/lib/navidromeShare.mjs";
import { siteSettingsSchema } from "../../src/lib/siteSettingsSchema.mjs";

const PRIVATE_NAVIDROME = "http://100.121.55.59:4533";

export async function readMusicSettings(path, fallbackPath) {
  const contents = await readFile(path, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return readFile(fallbackPath, "utf8");
  });
  return siteSettingsSchema.parse(JSON.parse(contents));
}

export async function resolveWeeklySong(publicUrl, fetcher = fetch) {
  const url = new URL(publicUrl);
  const privateUrl = new URL(`${url.pathname}${url.search}`, PRIVATE_NAVIDROME);
  const response = await fetcher(privateUrl, {
    headers: {
      "x-forwarded-host": url.host,
      "x-forwarded-proto": "https",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Navidrome no pudo abrir el enlace compartido.");
  return parseNavidromeShare(await response.text(), publicUrl);
}

export async function saveWeeklySong({ path, fallbackPath, weeklySongUrl, resolver = resolveWeeklySong }) {
  const current = await readMusicSettings(path, fallbackPath);
  const weeklySong = await resolver(weeklySongUrl);
  const settings = siteSettingsSchema.parse({
    ...current,
    music: { ...current.music, weeklySongUrl, weeklySong },
  });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  return settings;
}
