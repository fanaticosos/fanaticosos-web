import { json } from "../../lib/http.js";

export function onRequestGet({ env }) {
  if (!env.PUBLIC_TURNSTILE_SITE_KEY) return json({ error: "configuration_unavailable" }, 503);
  return json({ turnstileSiteKey: env.PUBLIC_TURNSTILE_SITE_KEY });
}
