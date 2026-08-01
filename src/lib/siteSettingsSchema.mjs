import { z } from "astro/zod";

const navidromeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && ["music.fanaticosos.com", "musica.fanaticosos.com"].includes(url.hostname)
    && /^\/share\/[^/]+\/?$/.test(url.pathname);
}, "Must be an HTTPS Navidrome share URL on music.fanaticosos.com");

const navidromeAssetUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && ["music.fanaticosos.com", "musica.fanaticosos.com"].includes(url.hostname)
    && /^\/share\/(?:img|s)\/[^/]+\/?$/.test(url.pathname);
}, "Must be an HTTPS Navidrome public asset URL on music.fanaticosos.com");

const weeklySong = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string(),
  duration: z.number().positive(),
  coverUrl: navidromeAssetUrl,
  streamUrl: navidromeAssetUrl,
});

export const siteSettingsSchema = z.object({
  version: z.literal(1),
  music: z.object({
    playlistUrl: navidromeUrl,
    weeklySongUrl: navidromeUrl,
    weeklySong,
  }),
});
