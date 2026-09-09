import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { previewMusicImport } from "../lib/music-import.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

test("music import preview verifies settings, release, and deployment without writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "music-import-")); const databasePath = join(root, "db.sqlite"); const database = await openDatabase(databasePath);
  database.exec(`INSERT INTO article_catalogs VALUES ('catalog','2026-09-09T00:00:00Z');
    INSERT INTO site_settings_revisions VALUES ('settings','{}','2026-09-09T00:00:00Z');
    INSERT INTO releases(id,catalog_id,site_settings_revision_id,status,path,manifest_json,manifest_checksum_sha256,created_at,validated_at) VALUES('old','catalog','settings','validated','/old','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z');
    INSERT INTO deployments(id,release_id,status,cloudflare_deployment_id,immutable_url,created_at,published_at) VALUES('dep','old','published','x','https://x.pages.dev','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z')`); closeDatabase(database);
  const settings = { version: 1, music: { playlistUrl: "https://music.fanaticosos.com/share/p", weeklySongUrl: "https://music.fanaticosos.com/share/s", weeklySong: { title: "Song", artist: "Artist", album: "Album", duration: 1, coverUrl: "https://music.fanaticosos.com/share/img/x", streamUrl: "https://music.fanaticosos.com/share/s/x" } } };
  const jobId = "release-11111111111111111111111111111111-r1-11111111"; const statesRoot = join(root, "states"); const releasesRoot = join(root, "releases"); const releaseRoot = join(releasesRoot, jobId);
  await mkdir(statesRoot); await mkdir(join(releaseRoot, "release", "dist"), { recursive: true });
  await writeFile(join(root, "settings.json"), JSON.stringify(settings));
  await writeFile(join(statesRoot, "music-publication.json"), JSON.stringify({ schemaVersion: 1, jobId, status: "completed", createdAt: "2026-09-09T01:00:00Z", updatedAt: "2026-09-09T01:01:00Z", deploymentUrl: "https://x.pages.dev" }));
  await writeFile(join(releaseRoot, "release", "release-manifest.json"), JSON.stringify({ schemaVersion: 1, releaseKind: "music" }));
  await writeFile(join(releaseRoot, "cloudflare-production.json"), JSON.stringify({ schemaVersion: 1, environment: "production", jobId, url: "https://x.pages.dev", validatedAt: "2026-09-09T01:01:00Z" }));
  await writeFile(join(releaseRoot, "release", "dist", "index.html"), "ok");
  const result = await previewMusicImport({ databasePath, settingsPath: join(root, "settings.json"), statesRoot, releasesRoot });
  assert.equal(result.weeklySongTitle, "Song"); assert.equal(result.alreadyImported, false);
});
