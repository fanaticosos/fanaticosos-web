import { z } from "astro/zod";

const navidromeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && ["music.fanaticosos.com", "musica.fanaticosos.com"].includes(url.hostname)
    && /^\/share\/[^/]+\/?$/.test(url.pathname);
}, "Must be an HTTPS Navidrome share URL on music.fanaticosos.com");

export const siteSettingsSchema = z.object({
  version: z.literal(1),
  music: z.object({
    playlistUrl: navidromeUrl,
    weeklySongUrl: navidromeUrl,
  }),
});
