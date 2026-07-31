import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://fanaticosos.com",
  output: "static",
  vite: { cacheDir: ".vite" },
  integrations: [sitemap()],
});
