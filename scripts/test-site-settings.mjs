import assert from "node:assert/strict";
import { siteSettingsSchema } from "../src/lib/siteSettingsSchema.mjs";

const validSettings = {
  version: 1,
  music: {
    playlistUrl: "https://musica.fanaticosos.com/share/playlist",
    weeklySongUrl: "https://musica.fanaticosos.com/share/song",
  },
};

assert.doesNotThrow(() => siteSettingsSchema.parse(validSettings));

const invalidSettings = [
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "http://musica.fanaticosos.com/share/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://example.com/share/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://musica.fanaticosos.com/not-shared/song" } },
  { ...validSettings, music: { ...validSettings.music, weeklySongUrl: "https://musica.fanaticosos.com/share/" } },
  { version: 1, music: { playlistUrl: validSettings.music.playlistUrl } },
];

for (const settings of invalidSettings) {
  assert.throws(() => siteSettingsSchema.parse(settings));
}

console.log(`Passed valid-settings test and ${invalidSettings.length} rejection tests.`);
