import assert from "node:assert/strict";
import { fetchNavidromeShare, parseNavidromeShare } from "../src/lib/navidromeShare.mjs";

const track = {
  id: "public-track-token",
  title: "Send Me An Angel",
  artist: "Real Life",
  album: "Heartland",
  duration: 232.7,
};
const encodedShare = JSON.stringify(JSON.stringify({ id: "share-id", tracks: [track] }));
const html = `<meta property="og:image" content="https://music.fanaticosos.com/share/img/public-cover-token?size=300"><script>window.__SHARE_INFO__ = ${encodedShare}</script>`;
const parsed = parseNavidromeShare(html, "https://music.fanaticosos.com/share/share-id");

assert.equal(parsed.title, track.title);
assert.equal(parsed.artist, track.artist);
assert.equal(parsed.album, track.album);
assert.equal(parsed.streamUrl, "https://music.fanaticosos.com/share/s/public-track-token");
assert.equal(parsed.coverUrl, "https://music.fanaticosos.com/share/img/public-cover-token?size=300");
assert.throws(() => parseNavidromeShare(html, "https://example.com/share/share-id"));

const fallback = await fetchNavidromeShare(
  "https://music.fanaticosos.com/share/share-id",
  async () => new Response("Unavailable", { status: 503 }),
);
assert.equal(fallback, null);

console.log("Passed Navidrome share metadata and fallback tests.");
