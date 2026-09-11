# Fan map deployment

The fan map frontend is included in the normal Astro build. Its API runs through `public/_worker.js` and stores markers in a Cloudflare D1 database bound as `MAP_DB`.

## One-time Cloudflare setup

1. Create a D1 database for the production Pages project.
2. Apply `migrations/0001_fan_map.sql` to that database.
3. In the `fanaticosos-web` Pages project, add the D1 binding `MAP_DB` for both preview and production.
4. Add an encrypted text secret named `MAP_IP_PEPPER` with a long random value to both environments.

The checked-in production deployment continues to upload `dist/`. Astro copies `_worker.js` into that directory, and Wrangler bundles it automatically during `pages deploy`.

## Verification

- `GET /api/fan-map` returns `{ "supporters": [] }` on an empty database.
- A marker added from `/mapa/` appears after refresh.
- Re-submitting from the same browser updates its marker instead of creating another.
- `/en/map/` uses the same marker collection.
