import { json, sameOrigin } from "../lib/http.js";

const cleanText = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ env }) {
  if (!env.MAP_DB) return json({ error: "configuration_unavailable" }, 503);
  const result = await env.MAP_DB.prepare(
    "SELECT city, country, lat, lng FROM supporters WHERE status = 'approved' ORDER BY created_at DESC LIMIT 5000",
  ).all();
  return json({ supporters: result.results ?? [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (!env.MAP_DB || !env.MAP_IP_PEPPER) return json({ error: "configuration_unavailable" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > 10_000) return json({ error: "request_too_large" }, 413);

  let data;
  try { data = await request.json(); } catch { return json({ error: "invalid_request" }, 400); }
  if (data.website) return json({ accepted: true }, 202);

  const city = cleanText(data.city);
  const country = cleanText(data.country);
  const visitorId = cleanText(data.visitorId);
  const lat = Math.round(Number(data.lat) * 10) / 10;
  const lng = Math.round(Number(data.lng) * 10) / 10;
  if (!city || city.length > 80 || !country || country.length > 80 || !visitorId || visitorId.length > 80 ||
      !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return json({ error: "invalid_location" }, 400);
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const visitorHash = await hash(`${env.MAP_IP_PEPPER}:visitor:${visitorId}`);
  const ipHash = await hash(`${env.MAP_IP_PEPPER}:ip:${ip}`);
  const recent = await env.MAP_DB.prepare(
    "SELECT COUNT(*) AS total FROM supporters WHERE ip_hash = ? AND updated_at > datetime('now', '-1 hour')",
  ).bind(ipHash).first();
  if (Number(recent?.total) >= 5) return json({ error: "rate_limited" }, 429);

  await env.MAP_DB.prepare(`INSERT INTO supporters
    (city, country, lat, lng, visitor_hash, ip_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', datetime('now'), datetime('now'))
    ON CONFLICT(visitor_hash) DO UPDATE SET city=excluded.city, country=excluded.country,
      lat=excluded.lat, lng=excluded.lng, ip_hash=excluded.ip_hash, status='approved', updated_at=datetime('now')`)
    .bind(city, country, lat, lng, visitorHash, ipHash).run();
  const count = await env.MAP_DB.prepare(
    "SELECT COUNT(*) AS total FROM supporters WHERE status = 'approved'",
  ).first();
  return json({ supporter: { city, country, lat, lng }, count: Number(count?.total ?? 0) }, 201);
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
}
