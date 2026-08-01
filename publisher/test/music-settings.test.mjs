import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fallback from "../../src/data/site-settings.json" with { type: "json" };
import { readMusicSettings, resolveWeeklySong, saveWeeklySong } from "../lib/music-settings.mjs";

test("music settings use fallback and persist an atomically resolved song", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-music-"));
  const fallbackPath = join(root, "fallback.json");
  const path = join(root, "saved", "site-settings.json");
  await writeFile(fallbackPath, JSON.stringify(fallback));
  assert.equal((await readMusicSettings(path, fallbackPath)).music.weeklySong.title, "Send Me An Angel");
  const settings = await saveWeeklySong({
    path,
    fallbackPath,
    weeklySongUrl: "https://music.fanaticosos.com/share/new-song",
    resolver: async () => ({
      title: "Bear Down, Chicago Bears",
      artist: "Jerry Downs",
      album: "Chicago Football",
      duration: 134,
      coverUrl: "https://music.fanaticosos.com/share/img/cover-token",
      streamUrl: "https://music.fanaticosos.com/share/s/stream-token",
    }),
  });
  assert.equal(settings.music.weeklySong.artist, "Jerry Downs");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), settings);
});

test("weekly song resolution uses the private Navidrome route and publishes public media URLs", async () => {
  let requestedUrl;
  let requestedOptions;
  const share = JSON.stringify(JSON.stringify({
    tracks: [{ id: "stream-token", title: "Song", artist: "Artist", album: "Album", duration: 120 }],
  }));
  const html = `<meta property="og:image" content="http://100.121.55.59:4533/share/img/cover-token?size=300"><script>window.__SHARE_INFO__ = ${share}</script>`;
  const song = await resolveWeeklySong("https://music.fanaticosos.com/share/public-token", async (url, options) => {
    requestedUrl = url.href;
    requestedOptions = options;
    return new Response(html);
  });
  assert.equal(requestedUrl, "http://100.121.55.59:4533/share/public-token");
  assert.equal(requestedOptions.headers["x-forwarded-host"], "music.fanaticosos.com");
  assert.equal(song.coverUrl, "https://music.fanaticosos.com/share/img/cover-token?size=300");
  assert.equal(song.streamUrl, "https://music.fanaticosos.com/share/s/stream-token");
});
