import assert from "node:assert/strict";
import { verifyAccessJwt } from "../functions/lib/access.js";

const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", publicKey);
jwk.kid = "test-key";
const now = Math.floor(Date.now() / 1000);
const header = encode({ alg: "RS256", kid: "test-key" });
const payload = encode({ iss: "https://fanaticosos.cloudflareaccess.com", aud: ["audience"], email: "stream@fanaticosos.com", nbf: now - 1, exp: now + 60 });
const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${payload}`));
const token = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
const claims = await verifyAccessJwt(token, { ACCESS_TEAM_DOMAIN: "fanaticosos.cloudflareaccess.com", ACCESS_AUD: "audience" }, async () => new Response(JSON.stringify({ keys: [jwk] })));
assert.equal(claims.email, "stream@fanaticosos.com");
assert.equal(await verifyAccessJwt(`${header}.${payload}.invalid`, { ACCESS_TEAM_DOMAIN: "fanaticosos.cloudflareaccess.com", ACCESS_AUD: "audience" }), null);
console.log("Passed Cloudflare Access JWT tests.");
