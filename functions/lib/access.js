let cachedKeys;

function decodePart(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodePart(value)));
}

export async function verifyAccessJwt(token, env, fetchImplementation = fetch) {
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer || !audiences.includes(env.ACCESS_AUD) || claims.exp <= now || (claims.nbf ?? 0) > now) return null;

  if (!cachedKeys) {
    const response = await fetchImplementation(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) return null;
    cachedKeys = (await response.json()).keys;
  }
  const jwk = cachedKeys.find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodePart(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return valid ? claims : null;
}

export async function requireAdministrator(request, env) {
  const claims = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), env);
  if (!claims?.email || claims.email.toLowerCase() !== env.PARTICIPATION_ADMIN_EMAIL?.toLowerCase()) return null;
  return claims;
}
