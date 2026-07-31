#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listDrafts, newDraft, readDraft, updateDraft, writeDraft } from "./lib/drafts.mjs";
import { contentTypeForName, MAX_IMAGE_BYTES, saveImage } from "./lib/uploads.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UUID_PATH = /^\/api\/drafts\/([0-9a-f-]{36})$/;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function requestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

async function requestBuffer(request, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error("upload is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createPublisherServer({ draftsRoot, uploadsRoot = join(dirname(draftsRoot), "uploads") }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://publisher.local");
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && STATIC_FILES.has(url.pathname)) {
        const [name, contentType] = STATIC_FILES.get(url.pathname);
        const body = await readFile(join(HERE, "public", name));
        response.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": body.length,
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        });
        return response.end(body);
      }
      if (url.pathname === "/api/drafts" && request.method === "GET") {
        return json(response, 200, { drafts: await listDrafts(draftsRoot) });
      }
      if (url.pathname === "/api/drafts" && request.method === "POST") {
        const draft = newDraft(await requestJson(request));
        await writeDraft(draftsRoot, draft);
        return json(response, 201, { draft });
      }
      if (url.pathname === "/api/uploads" && request.method === "POST") {
        const contentType = request.headers["content-type"]?.split(";", 1)[0] ?? "";
        const upload = await saveImage(
          uploadsRoot,
          await requestBuffer(request, MAX_IMAGE_BYTES + 1),
          contentType,
        );
        return json(response, 201, { upload });
      }
      const uploadMatch = /^\/uploads\/([^/]+)$/.exec(url.pathname);
      if (uploadMatch && request.method === "GET") {
        const contentType = contentTypeForName(uploadMatch[1]);
        if (!contentType) return json(response, 404, { error: "not found" });
        const body = await readFile(join(uploadsRoot, uploadMatch[1]));
        response.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": body.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return response.end(body);
      }
      const match = UUID_PATH.exec(url.pathname);
      if (match && request.method === "GET") {
        return json(response, 200, { draft: await readDraft(draftsRoot, match[1]) });
      }
      if (match && request.method === "PUT") {
        const value = await requestJson(request);
        if (!Number.isInteger(value.expectedRevision)) throw new Error("expectedRevision is required");
        const draft = await updateDraft(
          draftsRoot,
          match[1],
          value.expectedRevision,
          value.draft,
        );
        return json(response, 200, { draft });
      }
      return json(response, 404, { error: "not found" });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : /another browser session/.test(error.message) ? 409 : 400;
      return json(response, status, { error: error.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.PUBLISHER_HOST ?? "127.0.0.1";
  const port = Number(process.env.PUBLISHER_PORT ?? "4310");
  const draftsRoot = process.env.PUBLISHER_DRAFTS_ROOT ?? join(HERE, ".local-drafts");
  const uploadsRoot = process.env.PUBLISHER_UPLOADS_ROOT ?? join(HERE, ".local-uploads");
  createPublisherServer({ draftsRoot, uploadsRoot }).listen(port, host, () => {
    console.log(`Fanaticosos publisher listening on http://${host}:${port}`);
  });
}
