# Fan map deployment

The fan map frontend is included in the normal Astro build. Its API runs through `public/_worker.js` and stores markers in a Cloudflare D1 database bound as `MAP_DB`.

## One-time Cloudflare setup

1. Create a D1 database for the production Pages project.
2. Apply `migrations/0002_bears_nation_map.sql` to that database.
3. In the `fanaticosos-web` Pages project, add the D1 binding `MAP_DB` for both preview and production.
4. Add an encrypted text secret named `MAP_IP_PEPPER` with a long random value to both environments.

Every public marker is reverse-geocoded before insertion. Coordinates without a land result, a different country,
or no approximate match for the submitted city are rejected. The default validator is the public OpenStreetMap
Nominatim endpoint. `MAP_GEOCODER_URL` may override its base URL without a code deployment; keep the endpoint
behind a compatible `/reverse` API. Requests are user-triggered and the existing per-IP limit bounds abuse.

The checked-in production deployment continues to upload `dist/`. Astro copies `_worker.js` into that directory, and Wrangler bundles it automatically during `pages deploy`.

## Verification

- `GET /api/fan-map` returns `{ "supporters": [] }` on an empty database.
- A marker added from `/mapa/` appears after refresh.
- A valid new submission creates one approximate marker.
- `/en/map/` uses the same marker collection.
