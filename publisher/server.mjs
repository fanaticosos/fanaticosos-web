#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listDrafts, newDraft, readDraft, updateDraft, writeDraft } from "./lib/drafts.mjs";
import { contentTypeForName, MAX_IMAGE_BYTES, saveImage } from "./lib/uploads.mjs";
import { acknowledgeNotification, createNotification, listNotifications } from "./lib/notifications.mjs";
import { queueTranslation, readTranslationState, reconcileTranslations, updateTranslationResult } from "./lib/translation-jobs.mjs";
import { audioFileForState, queueTts, readTtsState, reconcileTts, ttsPolicyRevision, ttsRequestsForDraft } from "./lib/tts-jobs.mjs";
import { previewPage, renderMarkdown } from "./lib/preview.mjs";
import { queueRelease, readReleaseState, reconcileReleases } from "./lib/release-jobs.mjs";
import { readMusicSettings, resolveWeeklySong, saveWeeklySong } from "./lib/music-settings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS = join(HERE, "..", "config", "publisher", "defaults.json");
const DEFAULT_TTS_PRODUCTION = join(HERE, "..", "config", "tts", "production.json");
const DEFAULT_TTS_PRONUNCIATIONS = join(HERE, "..", "config", "tts", "pronunciations.json");
const DEFAULT_SITE_SETTINGS = join(HERE, "..", "src", "data", "site-settings.json");
const UUID_PATH = /^\/api\/drafts\/([0-9a-f-]{36})$/;
const TRANSLATION_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/translation$/;
const AUDIO_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/audio(?:\/(es|en))?$/;
const RELEASE_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/release$/;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/seo.js", ["seo.js", "text/javascript; charset=utf-8"]],
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
  releasesRoot = join(dirname(draftsRoot), "releases"),
  ttsProductionPath = DEFAULT_TTS_PRODUCTION,
  ttsPronunciationsPath = DEFAULT_TTS_PRONUNCIATIONS,
  siteSettingsPath = join(draftsRoot, "site-settings.json"),
  siteSettingsFallbackPath = DEFAULT_SITE_SETTINGS,
  musicResolver = resolveWeeklySong,
}) {
  async function currentTtsPolicyRevision() {
    const [production, pronunciations] = await Promise.all([
      readFile(ttsProductionPath, "utf8").then(JSON.parse),
      readFile(ttsPronunciationsPath, "utf8").then(JSON.parse),
    ]);
    return ttsPolicyRevision(production, pronunciations);
  }
  async function translationCompleted(state) {
    await createNotification(notificationsRoot, {
      level: "success", event: "translation-completed", articleId: state.articleId,
      message: state.workflow === "preview" ? "La versión en inglés está lista; los audios se preparan automáticamente." : "La versión en inglés está lista para revisión.",
    });
    if (state.workflow !== "preview") return;
    const draft = await readDraft(draftsRoot, state.articleId);
    const audio = await queueTts({
      draft, translation: state, queueRoot, statesRoot,
      policyRevision: await currentTtsPolicyRevision(), workflow: "preview",
    });
    await createNotification(notificationsRoot, {
      level: "info", event: "audio-started", articleId: state.articleId,
      message: `Audios en español e inglés iniciados automáticamente: ${draft.title}`,
    });
    return audio;
  }
  async function translationFailed(state) {
    await createNotification(notificationsRoot, {
      level: "error", event: "translation-failed", articleId: state.articleId,
      message: `La traducción se detuvo: ${state.error}`,
    });
  }
  async function audioCompleted(state) {
    await createNotification(notificationsRoot, {
      level: "success", event: "audio-completed", articleId: state.articleId,
      message: state.workflow === "preview" ? "Los audios están listos; la vista previa se valida automáticamente." : "Los audios en español e inglés están listos para escuchar.",
    });
    if (state.workflow !== "preview") return;
    const draft = await readDraft(draftsRoot, state.articleId);
    const release = await queueRelease({ draft, queueRoot, statesRoot });
    await createNotification(notificationsRoot, {
      level: "info", event: "release-started", articleId: state.articleId,
      message: `Validación privada iniciada automáticamente: ${draft.title}`,
    });
    return release;
  }
  async function audioFailed(state) {
    await createNotification(notificationsRoot, {
      level: "error", event: "audio-failed", articleId: state.articleId,
      message: `La generación de audio se detuvo: ${state.error}`,
    });
  }
  async function releaseCompleted(state) {
    await createNotification(notificationsRoot, {
      level: "success", event: "release-completed", articleId: state.articleId,
      message: "La vista previa privada está lista para revisar; todavía no está publicada.",
    });
  }
  async function releaseFailed(state) {
    await createNotification(notificationsRoot, {
      level: "error", event: "release-failed", articleId: state.articleId,
      message: `La preparación privada se detuvo: ${state.error}`,
    });
  }
  async function reconcilePublisherJobs() {
    await reconcileTranslations({ statesRoot, jobsRoot, onComplete: translationCompleted, onFailure: translationFailed });
    await reconcileTts({ statesRoot, jobsRoot, onComplete: audioCompleted, onFailure: audioFailed });
    await reconcileReleases({ statesRoot, releasesRoot, onComplete: releaseCompleted, onFailure: releaseFailed });
  }
  const server = createServer(async (request, response) => {
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
      if (request.method === "GET" && url.pathname === "/api/music") {
        return json(response, 200, { settings: await readMusicSettings(siteSettingsPath, siteSettingsFallbackPath) });
      }
      if (request.method === "POST" && url.pathname === "/api/markdown-preview") {
        const value = await requestJson(request);
        if (typeof value.markdown !== "string") throw new Error("El texto del artículo es obligatorio.");
        return json(response, 200, { html: renderMarkdown(value.markdown) });
      }
      if (request.method === "PUT" && url.pathname === "/api/music") {
        const value = await requestJson(request);
        if (typeof value.weeklySongUrl !== "string") throw new Error("El enlace de la canción es obligatorio.");
        const settings = await saveWeeklySong({
          path: siteSettingsPath,
          fallbackPath: siteSettingsFallbackPath,
          weeklySongUrl: value.weeklySongUrl,
          resolver: musicResolver,
        });
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
          "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://music.fanaticosos.com https://musica.fanaticosos.com; media-src https://music.fanaticosos.com https://musica.fanaticosos.com; style-src 'self'; script-src 'self'",
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
        if (audio.policyRevision !== await currentTtsPolicyRevision() || audio.sourceRevisions?.es !== requests.es.sourceRevision || audio.sourceRevisions?.en !== requests.en.sourceRevision) throw new Error("preview audio is stale");
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
        const translation = await queueTranslation({ draft, queueRoot, statesRoot, workflow: value.workflow ?? "manual" });
        await createNotification(notificationsRoot, {
          level: "info", event: "translation-started", articleId: draft.articleId,
          message: `Traducción iniciada: ${draft.title}`,
        });
        return json(response, 202, { translation });
      }
      if (translationMatch && request.method === "GET") {
        await reconcileTranslations({ statesRoot, jobsRoot, onComplete: translationCompleted, onFailure: translationFailed });
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
        const audio = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision: await currentTtsPolicyRevision(), workflow: value.workflow ?? "manual" });
        await createNotification(notificationsRoot, {
          level: "info", event: "audio-started", articleId: draft.articleId,
          message: `Audios en español e inglés iniciados: ${draft.title}`,
        });
        return json(response, 202, { audio });
      }
      if (audioMatch && request.method === "GET" && !audioMatch[2]) {
        await reconcileTts({ statesRoot, jobsRoot, onComplete: audioCompleted, onFailure: audioFailed });
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
      const releaseMatch = RELEASE_PATH.exec(url.pathname);
      if (releaseMatch && request.method === "POST") {
        const value = await requestJson(request);
        const [draft, translation, audio] = await Promise.all([
          readDraft(draftsRoot, releaseMatch[1]), readTranslationState(statesRoot, releaseMatch[1]), readTtsState(statesRoot, releaseMatch[1]),
        ]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft before preparing publication");
        const requests = ttsRequestsForDraft(draft, translation);
        if (audio.status !== "completed" || audio.policyRevision !== await currentTtsPolicyRevision() || audio.sourceRevisions?.es !== requests.es.sourceRevision || audio.sourceRevisions?.en !== requests.en.sourceRevision) throw new Error("current bilingual audio is required before preparing publication");
        const release = await queueRelease({ draft, queueRoot, statesRoot });
        await createNotification(notificationsRoot, { level: "info", event: "release-started", articleId: draft.articleId, message: `Preparación privada iniciada: ${draft.title}` });
        return json(response, 202, { release });
      }
      if (releaseMatch && request.method === "GET") {
        await reconcileReleases({ statesRoot, releasesRoot, onComplete: releaseCompleted, onFailure: releaseFailed });
        return json(response, 200, { release: await readReleaseState(statesRoot, releaseMatch[1]) });
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
  server.reconcilePublisherJobs = reconcilePublisherJobs;
  return server;
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
  const releasesRoot = process.env.PUBLISHER_RELEASES_ROOT ?? join(HERE, ".local-releases");
  const siteSettingsPath = process.env.PUBLISHER_SITE_SETTINGS_PATH ?? join(HERE, ".local-site-settings.json");
  const options = { draftsRoot, uploadsRoot, notificationsRoot, queueRoot, statesRoot, jobsRoot, releasesRoot, siteSettingsPath };
  const server = createPublisherServer(options);
  const reconcile = () => server.reconcilePublisherJobs().catch((error) => console.error("publisher reconciliation failed", error));
  setInterval(reconcile, 10_000).unref();
  reconcile();
  server.listen(port, host, () => {
    console.log(`Fanaticosos publisher listening on http://${host}:${port}`);
  });
}
