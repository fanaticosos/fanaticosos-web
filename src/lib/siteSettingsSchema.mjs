import { z } from "astro/zod";

const navidromeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && url.hostname === "musica.fanaticosos.com"
    && /^\/share\/[^/]+\/?$/.test(url.pathname);
}, "Must be an HTTPS Navidrome share URL on musica.fanaticosos.com");

export const siteSettingsSchema = z.object({
  version: z.literal(1),
  music: z.object({
    playlistUrl: navidromeUrl,
    weeklySongUrl: navidromeUrl,
  }),
});
