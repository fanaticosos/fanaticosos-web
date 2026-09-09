import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readMusicSettings, saveWeeklySong } from "./music-settings.mjs";
import { queueMusicPublication, readMusicPublication } from "./music-jobs.mjs";
import { completeDatabaseMusicPublication, failDatabaseMusicPublication, musicJobId, queueDatabaseMusicPublication, readDatabaseMusicPublication, readDatabaseMusicSettings, saveDatabaseMusicSettings, startDatabaseMusicPublication } from "./database-music.mjs";

const TIMEOUT_MS = 30 * 60 * 1000;
async function optional(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }

export function filesystemMusicStore({ settingsPath, fallbackPath, queueRoot, statesRoot, releasesRoot, resolver }) {
  return { settings: () => readMusicSettings(settingsPath, fallbackPath), save: (url) => saveWeeklySong({ path: settingsPath, fallbackPath, weeklySongUrl: url, resolver }), queue: (settings) => queueMusicPublication({ settings, queueRoot, statesRoot }), publication: () => readMusicPublication(statesRoot, releasesRoot) };
}

export function databaseMusicStore({ database, queueRoot, releasesRoot, resolver }) {
  return {
    settings: async () => readDatabaseMusicSettings(database),
    async save(url) { const current = readDatabaseMusicSettings(database); const weeklySong = await resolver(url); return saveDatabaseMusicSettings(database, { ...current, music: { ...current.music, weeklySongUrl: url, weeklySong } }); },
    async queue(settings) {
      const jobId = musicJobId(); const now = new Date(); const state = queueDatabaseMusicPublication(database, { settings, jobId, path: join(releasesRoot, jobId, "release"), now });
      if (state.jobId !== jobId) return state;
      const articleId = jobId.slice(8, 40).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
      const request = { schemaVersion: 1, releaseKind: "music", articleId, draftRevision: 1, requestedAt: now.toISOString(), settings }; const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
      try { await mkdir(queueRoot, { recursive: true, mode: 0o700 }); await mkdir(temporary, { mode: 0o700 }); await writeFile(join(temporary, "request.json"), `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, join(queueRoot, jobId)); await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 }); }
      catch (error) { await rm(temporary, { recursive: true, force: true }); failDatabaseMusicPublication(database, jobId, "music request could not be queued"); throw error; }
      return state;
    },
    async publication(now = new Date()) {
      const current = readDatabaseMusicPublication(database); if (!current || !["queued", "running"].includes(current.status)) return current;
      const root = join(releasesRoot, current.jobId); const manifestPath = join(root, "release", "release-manifest.json"); const manifest = await optional(manifestPath); const receipt = await optional(join(root, "cloudflare-production.json"));
      if (manifest && receipt) { if (current.status === "queued") startDatabaseMusicPublication(database, current.jobId, now); const bytes = await readFile(manifestPath); return completeDatabaseMusicPublication(database, { jobId: current.jobId, manifest, manifestChecksum: createHash("sha256").update(bytes).digest("hex"), receipt, now }); }
      const failure = await optional(join(root, "failure.json")) ?? await optional(join(root, "production-failure.json")); if (failure) return failDatabaseMusicPublication(database, current.jobId, failure.error || "music publication failed", now);
      if (now.getTime() - Date.parse(current.updatedAt || current.createdAt) > TIMEOUT_MS) return failDatabaseMusicPublication(database, current.jobId, "La publicación anterior se detuvo y fue liberada automáticamente.", now);
      if (current.status === "queued" && await optional(join(root, "request.json"))) startDatabaseMusicPublication(database, current.jobId, now);
      return readDatabaseMusicPublication(database);
    },
  };
}
