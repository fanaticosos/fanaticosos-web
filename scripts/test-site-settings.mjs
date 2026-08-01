import assert from "node:assert/strict";
import { siteSettingsSchema } from "../src/lib/siteSettingsSchema.mjs";

const validSettings = {
  version: 1,
  music: {
    playlistUrl: "https://musica.fanaticosos.com/share/playlist",
    weeklySongUrl: "https://musica.fanaticosos.com/share/song",
    weeklySong: {
      title: "Send Me An Angel",
      artist: "Real Life",
      album: "Heartland",
      duration: 232.7,
      coverUrl: "https://musica.fanaticosos.com/share/img/cover-token",
      streamUrl: "https://musica.fanaticosos.com/share/s/stream-token",
    },
  },
};

assert.doesNotThrow(() => siteSettingsSchema.parse(validSettings));
assert.doesNotThrow(() => siteSettingsSchema.parse({
  ...validSettings,
  music: { ...validSettings.music, weeklySongUrl: "https://music.fanaticosos.com/share/song" },
}));

const invalidSettings = [
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "http://musica.fanaticosos.com/share/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://example.com/share/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://musica.fanaticosos.com/not-shared/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://musica.fanaticosos.com/share/" } },
  { version: 1, music: { playlistUrl: validSettings.music.playlistUrl } },
  { ...validSettings, music: { ...validSettings.music, weeklySong: { ...validSettings.music.weeklySong, title: "" } } },
];

for (const settings of invalidSettings) {
  assert.throws(() => siteSettingsSchema.parse(settings));
}

console.log(`Passed valid-settings test and ${invalidSettings.length} rejection tests.`);
