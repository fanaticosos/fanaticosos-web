import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { completeDatabaseMusicPublication, queueDatabaseMusicPublication, readDatabaseMusicPublication, readDatabaseMusicSettings, saveDatabaseMusicSettings, startDatabaseMusicPublication } from "../lib/database-music.mjs";
import { databaseMusicStore } from "../lib/music-store.mjs";

test("SQLite music settings and publication lifecycle are transactional and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-music-")); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const initial = { version: 1, music: { weeklySongUrl: "https://music.example/old" } }; const settings = { version: 1, music: { weeklySongUrl: "https://music.example/new" } };
    database.exec(`INSERT INTO article_catalogs VALUES ('catalog','2026-09-09T00:00:00Z');
      INSERT INTO site_settings_revisions VALUES ('settings', '${JSON.stringify(initial)}','2026-09-09T00:00:00Z');
      INSERT INTO releases(id,catalog_id,site_settings_revision_id,status,path,manifest_json,manifest_checksum_sha256,created_at,validated_at) VALUES('old','catalog','settings','validated','/old','{}','${"a".repeat(64)}','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z');
      INSERT INTO deployments(id,release_id,status,cloudflare_deployment_id,immutable_url,created_at,published_at) VALUES('dep','old','published','old','https://old.pages.dev','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z')`);
    saveDatabaseMusicSettings(database, settings, new Date("2026-09-09T01:00:00Z")); assert.deepEqual(readDatabaseMusicSettings(database), settings);
    const jobId = "release-11111111111111111111111111111111-r1-1234abcd"; const input = { settings, jobId, path: join(root, "release"), now: new Date("2026-09-09T01:01:00Z") };
    assert.equal(queueDatabaseMusicPublication(database, input).status, "queued");
    assert.equal(queueDatabaseMusicPublication(database, { ...input, jobId: jobId.replace("1234abcd", "abcdef12") }).jobId, jobId);
    startDatabaseMusicPublication(database, jobId, new Date("2026-09-09T01:02:00Z"));
    const manifest = { schemaVersion: 1, releaseKind: "music", buildCompletedAt: "2026-09-09T01:03:00Z" };
    const receipt = { schemaVersion: 1, environment: "production", jobId, url: "https://new.pages.dev", validatedAt: "2026-09-09T01:04:00Z" };
    assert.equal(completeDatabaseMusicPublication(database, { jobId, manifest, manifestChecksum: "b".repeat(64), receipt, now: new Date("2026-09-09T01:05:00Z") }).status, "completed");
    assert.equal(readDatabaseMusicPublication(database).deploymentUrl, receipt.url);
  } finally { closeDatabase(database); }
});

test("saving the current resolved weekly song creates no redundant settings revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-music-save-")); const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    const weeklySong = { title: "Song", artist: "Artist", album: "Album", duration: 10, coverUrl: "https://music.example/cover", streamUrl: "https://music.example/stream" };
    const settings = { version: 1, music: { playlistUrl: "https://music.example/list", weeklySongUrl: "https://music.example/song", weeklySong } };
    saveDatabaseMusicSettings(database, settings, new Date("2026-09-09T01:00:00Z"));
    const store = databaseMusicStore({ database, queueRoot: join(root, "queue"), releasesRoot: join(root, "releases"), resolver: async () => weeklySong });
    assert.deepEqual(await store.save(settings.music.weeklySongUrl), settings);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings_revisions").get().count, 1);
  } finally { closeDatabase(database); }
});
