#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listDrafts, newDraft, readDraft, updateDraft, writeDraft } from "./lib/drafts.mjs";
import { contentTypeForName, MAX_IMAGE_BYTES, saveImage } from "./lib/uploads.mjs";
import { acknowledgeNotification, createNotification, listNotifications } from "./lib/notifications.mjs";
import { queueTranslation, readTranslationState, reconcileTranslations, updateTranslationResult } from "./lib/translation-jobs.mjs";
import { audioFileForState, queueTts, readTtsState, reconcileTts, ttsRequestsForDraft } from "./lib/tts-jobs.mjs";
import { previewPage } from "./lib/preview.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS = join(HERE, "..", "config", "publisher", "defaults.json");
const UUID_PATH = /^\/api\/drafts\/([0-9a-f-]{36})$/;
const TRANSLATION_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/translation$/;
const AUDIO_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/audio(?:\/(es|en))?$/;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/preview.css", ["preview.css", "text/css; charset=utf-8"]],
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

export function createPublisherServer({
  draftsRoot,
  uploadsRoot = join(dirname(draftsRoot), "uploads"),
  settingsPath = DEFAULT_SETTINGS,
  notificationsRoot = join(dirname(draftsRoot), "notifications"),
  queueRoot = join(dirname(draftsRoot), "queue"),
  statesRoot = join(dirname(draftsRoot), "states"),
  jobsRoot = join(dirname(dirname(draftsRoot)), "jobs"),
}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://publisher.local");
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && url.pathname === "/api/settings") {
        const settings = JSON.parse(await readFile(settingsPath, "utf8"));
        if (settings.schemaVersion !== 1) throw new Error("publisher settings are invalid");
        return json(response, 200, { settings });
      }
      if (request.method === "GET" && url.pathname === "/api/notifications") {
        return json(response, 200, { notifications: await listNotifications(notificationsRoot) });
      }
      const notificationMatch = /^\/api\/notifications\/([0-9a-f-]{36})\/acknowledge$/.exec(url.pathname);
      if (notificationMatch && request.method === "POST") {
        const notification = await acknowledgeNotification(notificationsRoot, notificationMatch[1]);
        return json(response, 200, { notification });
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
      const previewMatch = /^\/preview\/([0-9a-f-]{36})\/(es|en)$/.exec(url.pathname);
      if (previewMatch && request.method === "GET") {
        const [draft, translation, audio, settings] = await Promise.all([
          readDraft(draftsRoot, previewMatch[1]),
          readTranslationState(statesRoot, previewMatch[1]),
          readTtsState(statesRoot, previewMatch[1]),
          readFile(settingsPath, "utf8").then(JSON.parse),
        ]);
        const requests = ttsRequestsForDraft(draft, translation);
        if (audio.sourceRevisions?.es !== requests.es.sourceRevision || audio.sourceRevisions?.en !== requests.en.sourceRevision) throw new Error("preview audio is stale");
        const body = Buffer.from(previewPage({ draft, translation, audio, locale: previewMatch[2], settings }));
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length,
          "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'none'",
          "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
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
      const translationMatch = TRANSLATION_PATH.exec(url.pathname);
      if (translationMatch && request.method === "POST") {
        const value = await requestJson(request);
        const draft = await readDraft(draftsRoot, translationMatch[1]);
        if (value.expectedRevision !== draft.revision) {
          throw new Error("save the current draft revision before translation");
        }
        const translation = await queueTranslation({ draft, queueRoot, statesRoot });
        await createNotification(notificationsRoot, {
          level: "info", event: "translation-started", articleId: draft.articleId,
          message: `Traducción iniciada: ${draft.title}`,
        });
        return json(response, 202, { translation });
      }
      if (translationMatch && request.method === "GET") {
        await reconcileTranslations({
          statesRoot, jobsRoot,
          onComplete: (state) => createNotification(notificationsRoot, {
            level: "success", event: "translation-completed", articleId: state.articleId,
            message: "La versión en inglés está lista para revisión.",
          }),
          onFailure: (state) => createNotification(notificationsRoot, {
            level: "error", event: "translation-failed", articleId: state.articleId,
            message: `La traducción se detuvo: ${state.error}`,
          }),
        });
        return json(response, 200, { translation: await readTranslationState(statesRoot, translationMatch[1]) });
      }
      if (translationMatch && request.method === "PUT") {
        const value = await requestJson(request);
        const draft = await readDraft(draftsRoot, translationMatch[1]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current Spanish draft before correcting English");
        const translation = await updateTranslationResult(statesRoot, draft.articleId, draft.revision, value.result);
        await createNotification(notificationsRoot, {
          level: "success", event: "translation-corrected", articleId: draft.articleId,
          message: "La corrección en inglés fue guardada; el audio en inglés debe regenerarse.",
        });
        return json(response, 200, { translation });
      }
      const audioMatch = AUDIO_PATH.exec(url.pathname);
      if (audioMatch && request.method === "POST" && !audioMatch[2]) {
        const value = await requestJson(request);
        const draft = await readDraft(draftsRoot, audioMatch[1]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft revision before audio generation");
        const translation = await readTranslationState(statesRoot, draft.articleId);
        const audio = await queueTts({ draft, translation, queueRoot, statesRoot });
        await createNotification(notificationsRoot, {
          level: "info", event: "audio-started", articleId: draft.articleId,
          message: `Audios en español e inglés iniciados: ${draft.title}`,
        });
        return json(response, 202, { audio });
      }
      if (audioMatch && request.method === "GET" && !audioMatch[2]) {
        await reconcileTts({
          statesRoot, jobsRoot,
          onComplete: (state) => createNotification(notificationsRoot, {
            level: "success", event: "audio-completed", articleId: state.articleId,
            message: "Los audios en español e inglés están listos para escuchar.",
          }),
          onFailure: (state) => createNotification(notificationsRoot, {
            level: "error", event: "audio-failed", articleId: state.articleId,
            message: `La generación de audio se detuvo: ${state.error}`,
          }),
        });
        return json(response, 200, { audio: await readTtsState(statesRoot, audioMatch[1]) });
      }
      if (audioMatch && request.method === "GET" && audioMatch[2]) {
        const state = await readTtsState(statesRoot, audioMatch[1]);
        const body = await readFile(audioFileForState(state, audioMatch[2], jobsRoot));
        response.writeHead(200, {
          "Content-Type": "audio/mpeg", "Content-Length": body.length,
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        });
        return response.end(body);
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
  const notificationsRoot = process.env.PUBLISHER_NOTIFICATIONS_ROOT ?? join(HERE, ".local-notifications");
  const queueRoot = process.env.PUBLISHER_QUEUE_ROOT ?? join(HERE, ".local-queue");
  const statesRoot = process.env.PUBLISHER_STATES_ROOT ?? join(HERE, ".local-states");
  const jobsRoot = process.env.PUBLISHER_JOBS_ROOT ?? join(HERE, ".local-jobs");
  const options = { draftsRoot, uploadsRoot, notificationsRoot, queueRoot, statesRoot, jobsRoot };
  const reconcile = () => reconcileTranslations({
    statesRoot, jobsRoot,
    onComplete: (state) => createNotification(notificationsRoot, {
      level: "success", event: "translation-completed", articleId: state.articleId,
      message: "La versión en inglés está lista para revisión.",
    }),
    onFailure: (state) => createNotification(notificationsRoot, {
      level: "error", event: "translation-failed", articleId: state.articleId,
      message: `La traducción se detuvo: ${state.error}`,
    }),
  }).catch((error) => console.error("translation reconciliation failed", error));
  const reconcileAudio = () => reconcileTts({
    statesRoot, jobsRoot,
    onComplete: (state) => createNotification(notificationsRoot, {
      level: "success", event: "audio-completed", articleId: state.articleId,
      message: "Los audios en español e inglés están listos para escuchar.",
    }),
    onFailure: (state) => createNotification(notificationsRoot, {
      level: "error", event: "audio-failed", articleId: state.articleId,
      message: `La generación de audio se detuvo: ${state.error}`,
    }),
  }).catch((error) => console.error("audio reconciliation failed", error));
  setInterval(reconcile, 10_000).unref();
  setInterval(reconcileAudio, 10_000).unref();
  reconcile();
  reconcileAudio();
  createPublisherServer(options).listen(port, host, () => {
    console.log(`Fanaticosos publisher listening on http://${host}:${port}`);
  });
}
