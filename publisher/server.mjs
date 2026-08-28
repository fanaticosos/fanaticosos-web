#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listDrafts, newDraft, readDraft, updateDraft, writeDraft } from "./lib/drafts.mjs";
import { contentTypeForName, MAX_IMAGE_BYTES, saveImage } from "./lib/uploads.mjs";
import { acknowledgeAllNotifications, acknowledgeNotification, createNotification, listNotifications } from "./lib/notifications.mjs";
import { queueTranslation, readTranslationState, reconcileTranslations, updateTranslationResult } from "./lib/translation-jobs.mjs";
import { audioFileForState, queueTts, queueTtsLocale, readTtsState, reconcileTts, ttsPolicyRevision, ttsRequestsForDraft } from "./lib/tts-jobs.mjs";
import { ttsPreflight } from "./lib/tts-preflight.mjs";
import { previewErrorPage, previewPage, renderMarkdown } from "./lib/preview.mjs";
import { rebaseReusableArtifacts } from "./lib/artifact-revisions.mjs";
import { queueRelease, readReleaseState, reconcileReleases } from "./lib/release-jobs.mjs";
import { queueDeployment, readDeploymentState, reconcileDeployment } from "./lib/deployment-jobs.mjs";
import { readMusicSettings, resolveWeeklySong, saveWeeklySong } from "./lib/music-settings.mjs";
import { queueMusicPublication, readMusicPublication } from "./lib/music-jobs.mjs";
import { audiogramFileForState, queueAudiogram, readAudiogramState, reconcileAudiograms } from "./lib/audiogram-jobs.mjs";
import { MAX_SPANISH_AUDIO_BYTES, saveSpanishAudio } from "./lib/spanish-audio-upload.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS = join(HERE, "..", "config", "publisher", "defaults.json");
const DEFAULT_TTS_PRODUCTION = join(HERE, "..", "config", "tts", "production.json");
const DEFAULT_TTS_PRONUNCIATIONS = join(HERE, "..", "config", "tts", "pronunciations.json");
const DEFAULT_TTS_AZURE_ENTITIES = join(HERE, "..", "config", "tts", "azure-nfl-entities.json");
const DEFAULT_TTS_ENTITY_DATABASE = join(HERE, "..", "config", "tts", "nfl-entities.json");
const DEFAULT_TTS_SPANISH_TERMS = join(HERE, "..", "config", "tts", "spanish-nfl-terms.json");
const DEFAULT_SITE_SETTINGS = join(HERE, "..", "src", "data", "site-settings.json");
const UUID_PATH = /^\/api\/drafts\/([0-9a-f-]{36})$/;
const TRANSLATION_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/translation$/;
const AUDIO_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/audio(?:\/(es|en))?$/;
const TTS_PREFLIGHT_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/tts-preflight$/;
const AUDIOGRAM_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/audiogram(?:\/(video))?$/;
const RELEASE_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/release$/;
const PUBLISH_PATH = /^\/api\/drafts\/([0-9a-f-]{36})\/publish$/;
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

async function readOptionalState(readState) {
  try {
    return await readState();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function releaseWithFreshness(release, audio) {
  if (!release || release.status !== "completed") return release;
  const current = audio?.status === "completed"
    && release.draftRevision === audio.draftRevision
    && (!release.manifest?.assets?.esAudio || release.manifest.assets.esAudio.sha256 === audio.jobs?.es?.result?.sha256)
    && release.manifest?.assets?.enAudio?.sha256 === audio.jobs?.en?.result?.sha256;
  return current ? release : { ...release, status: "stale" };
}

export function releaseArtifactsEligible({ draft, audio, requests, release, deployment, currentPolicyRevision }) {
  const sourcesAreCurrent = audio?.status === "completed"
    && audio.draftRevision === draft.revision
    && audio.sourceRevisions?.es === requests.es.sourceRevision
    && audio.sourceRevisions?.en === requests.en.sourceRevision;
  if (!sourcesAreCurrent) return false;
  if (audio.policyRevision === currentPolicyRevision) return true;

  return release?.status === "completed"
    && release.draftRevision === draft.revision
    && deployment?.status === "completed"
    && deployment.draftRevision === draft.revision
    && deployment.releaseJobId === release.jobId
    && (!release.manifest?.assets?.esAudio || release.manifest.assets.esAudio.sha256 === audio.jobs?.es?.result?.sha256)
    && release.manifest?.assets?.enAudio?.sha256 === audio.jobs?.en?.result?.sha256;
}

export function translationWithFreshness(translation, draft) {
  if (!translation || translation.status !== "completed") return translation;
  return translation.draftRevision === draft.revision
    ? translation
    : { ...translation, status: "stale" };
}

export function audiogramWithFreshness(audiogram, draft, audio) {
  if (!audiogram || audiogram.status !== "completed") return audiogram;
  const current = audiogram.draftRevision === draft.revision
    && audiogram.audioSha256 === audio?.jobs?.es?.result?.sha256;
  return current ? audiogram : { ...audiogram, status: "stale" };
}

export function audioByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) throw new Error("audio byte range is invalid");
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    throw new Error("audio byte range is unsatisfiable");
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
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
  ttsAzureEntitiesPath = DEFAULT_TTS_AZURE_ENTITIES,
  ttsEntityDatabasePath = DEFAULT_TTS_ENTITY_DATABASE,
  ttsSpanishTermsPath = DEFAULT_TTS_SPANISH_TERMS,
  siteSettingsPath = join(draftsRoot, "site-settings.json"),
  siteSettingsFallbackPath = DEFAULT_SITE_SETTINGS,
  musicResolver = resolveWeeklySong,
}) {
  async function currentTtsReferences() {
    const [azureEntities, entityDatabase] = await Promise.all([
      readFile(ttsAzureEntitiesPath, "utf8").then(JSON.parse),
      readFile(ttsEntityDatabasePath, "utf8").then(JSON.parse),
    ]);
    return { azureEntities, entityDatabase };
  }
  async function currentTtsPreflight(draft) {
    const [{ azureEntities, entityDatabase }, spanishTerms] = await Promise.all([
      currentTtsReferences(),
      readFile(ttsSpanishTermsPath, "utf8").then(JSON.parse),
    ]);
    return ttsPreflight(draft, entityDatabase, azureEntities, spanishTerms);
  }
  async function currentTtsPolicyRevision() {
    const [production, pronunciations, azureEntities, entityDatabase, spanishTerms] = await Promise.all([
      readFile(ttsProductionPath, "utf8").then(JSON.parse),
      readFile(ttsPronunciationsPath, "utf8").then(JSON.parse),
      readFile(ttsAzureEntitiesPath, "utf8").then(JSON.parse),
      readFile(ttsEntityDatabasePath, "utf8").then(JSON.parse),
      readFile(ttsSpanishTermsPath, "utf8").then(JSON.parse),
    ]);
    return ttsPolicyRevision(production, pronunciations, { azureEntities, entityDatabase }, spanishTerms);
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
      message: `Audio en inglés iniciado automáticamente. Sube tu MP3 en español para completar la publicación: ${draft.title}`,
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
    const regeneratedLanguage = state.regeneratedLocale === "en" ? "inglés" : "español";
    await createNotification(notificationsRoot, {
      level: "success", event: state.workflow === "audio-regeneration" ? `audio-${state.regeneratedLocale}-regeneration` : "audio-completed", articleId: state.articleId,
      message: state.workflow === "preview"
        ? "Los audios están listos; la vista previa se valida automáticamente."
        : state.workflow === "audio-regeneration"
          ? `El audio en ${regeneratedLanguage} regenerado está listo en el reproductor de este borrador.`
          : "Los audios en español e inglés están listos para escuchar.",
      replacePending: state.workflow === "audio-regeneration",
    });
    if (state.workflow !== "audio-regeneration" || state.regeneratedLocale === "es") {
      const draft = await readDraft(draftsRoot, state.articleId);
      await queueAudiogram({ draft, audio: state, queueRoot, statesRoot });
      await createNotification(notificationsRoot, { level: "info", event: "audiogram-started", articleId: state.articleId, message: "Creando el video completo para YouTube automáticamente.", replacePending: true });
    }
    if (!["preview", "spanish-upload"].includes(state.workflow)) return;
    const draft = await readDraft(draftsRoot, state.articleId);
    const release = await queueRelease({ draft, queueRoot, statesRoot });
    await createNotification(notificationsRoot, {
      level: "info", event: "release-started", articleId: state.articleId,
      message: `Validación privada iniciada automáticamente: ${draft.title}`,
    });
    return release;
  }
  async function audiogramCompleted(state) {
    await createNotification(notificationsRoot, { level: "success", event: "audiogram-completed", articleId: state.articleId, message: "El video completo para YouTube está listo para revisar y descargar.", replacePending: true });
  }
  async function audiogramFailed(state) {
    await createNotification(notificationsRoot, { level: "error", event: "audiogram-failed", articleId: state.articleId, message: `El video para YouTube se detuvo: ${state.error}`, replacePending: true });
  }
  async function audioFailed(state) {
    const regeneratedLanguage = state.regeneratedLocale === "en" ? "inglés" : "español";
    await createNotification(notificationsRoot, {
      level: "error", event: state.workflow === "audio-regeneration" ? `audio-${state.regeneratedLocale}-regeneration` : "audio-failed", articleId: state.articleId,
      message: `${state.workflow === "audio-regeneration" ? `La regeneración del audio en ${regeneratedLanguage}` : "La generación de audio"} se detuvo: ${state.error}`,
      replacePending: state.workflow === "audio-regeneration",
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
    const operations = [
      ["translations", () => reconcileTranslations({ statesRoot, jobsRoot, onComplete: translationCompleted, onFailure: translationFailed })],
      ["audio", () => reconcileTts({ statesRoot, jobsRoot, onComplete: audioCompleted, onFailure: audioFailed })],
      ["audiograms", () => reconcileAudiograms({ statesRoot, jobsRoot, onComplete: audiogramCompleted, onFailure: audiogramFailed })],
      ["releases", () => reconcileReleases({ statesRoot, releasesRoot, onComplete: releaseCompleted, onFailure: releaseFailed })],
    ];
    const failures = [];
    for (const [name, operation] of operations) {
      try {
        await operation();
      } catch (error) {
        failures.push({ name, error });
        console.error(`publisher ${name} reconciliation failed`, error);
      }
    }
    return failures;
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
        return json(response, 200, { settings: await readMusicSettings(siteSettingsPath, siteSettingsFallbackPath), publication: await readMusicPublication(statesRoot, releasesRoot) });
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
        await readMusicPublication(statesRoot, releasesRoot);
        const publication = await queueMusicPublication({ settings, queueRoot, statesRoot });
        await createNotification(notificationsRoot, { level: "info", event: "music-publication-started", message: `Publicación de la canción iniciada: ${settings.music.weeklySong.title}` });
        return json(response, 202, { settings, publication });
      }
      if (request.method === "GET" && url.pathname === "/api/notifications") {
        return json(response, 200, { notifications: await listNotifications(notificationsRoot) });
      }
      if (request.method === "POST" && url.pathname === "/api/notifications/acknowledge-all") {
        return json(response, 200, { acknowledged: await acknowledgeAllNotifications(notificationsRoot) });
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
          "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://music.fanaticosos.com https://musica.fanaticosos.com; media-src 'self' https://music.fanaticosos.com https://musica.fanaticosos.com; style-src 'self'; script-src 'self'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        });
        return response.end(body);
      }
      const previewMatch = /^\/preview\/([0-9a-f-]{36})\/(es|en)$/.exec(url.pathname);
      if (previewMatch && request.method === "GET") {
        try {
          const draft = await readDraft(draftsRoot, previewMatch[1]);
          await rebaseReusableArtifacts({ draft, statesRoot });
          const [translation, audio, settings] = await Promise.all([
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
        } catch {
          const body = Buffer.from(previewErrorPage());
          response.writeHead(409, {
            "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length,
            "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'none'",
            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
          });
          return response.end(body);
        }
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
        if (contentType === "audio/mpeg") {
          const articleId = url.searchParams.get("articleId") ?? String(request.headers["x-article-id"] ?? "");
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(articleId)) {
            throw new Error("El identificador del borrador no es válido.");
          }
          let draft;
          try { draft = await readDraft(draftsRoot, articleId); } catch (error) { throw new Error(`No se encontró el borrador indicado (${error.code || "error"}).`); }
          const expectedRevision = Number(url.searchParams.get("revision") ?? request.headers["x-draft-revision"]);
          if (expectedRevision !== draft.revision) throw new Error("Guarda el borrador actual antes de subir el MP3 en español.");
          let translation;
          try { translation = await readTranslationState(statesRoot, draft.articleId); } catch (error) { throw new Error(`No se encontró la traducción actual (${error.code || "error"}).`); }
          const buffer = await requestBuffer(request, MAX_SPANISH_AUDIO_BYTES + 1);
          let audio;
          try { audio = await saveSpanishAudio({ draft, translation, buffer, jobsRoot, statesRoot, policyRevision: await currentTtsPolicyRevision() }); } catch (error) { throw new Error(`No se pudo guardar el MP3: ${error.message}`); }
          await createNotification(notificationsRoot, { level: "success", event: "spanish-audio-uploaded", articleId: draft.articleId, message: "El MP3 en español fue validado y guardado.", replacePending: true });
          if (audio.status === "completed") {
            try { await audioCompleted(audio); } catch (error) { throw new Error(`El MP3 se guardó, pero falló la preparación posterior: ${error.message}`); }
          }
          return json(response, 201, { audio });
        }
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
        const draft = await readDraft(draftsRoot, translationMatch[1]);
        await rebaseReusableArtifacts({ draft, statesRoot });
        const translation = await readOptionalState(() => readTranslationState(statesRoot, translationMatch[1]));
        return json(response, 200, { translation: translationWithFreshness(translation, draft) });
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
      const ttsPreflightMatch = TTS_PREFLIGHT_PATH.exec(url.pathname);
      if (ttsPreflightMatch && request.method === "GET") {
        const draft = await readDraft(draftsRoot, ttsPreflightMatch[1]);
        return json(response, 200, { preflight: await currentTtsPreflight(draft) });
      }
      if (audioMatch && request.method === "POST" && audioMatch[2] === "en") {
        const value = await requestJson(request);
        const draft = await readDraft(draftsRoot, audioMatch[1]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft revision before regenerating English audio");
        const translation = await readTranslationState(statesRoot, draft.articleId);
        const locale = audioMatch[2];
        const language = "inglés";
        const audio = await queueTtsLocale({ draft, translation, locale, queueRoot, statesRoot, policyRevision: await currentTtsPolicyRevision() });
        await createNotification(notificationsRoot, {
          level: "info", event: `audio-${locale}-regeneration`, articleId: draft.articleId,
          message: `Regenerando el audio en ${language}: ${draft.title}`,
          replacePending: true,
        });
        return json(response, 202, { audio });
      }
      if (audioMatch && request.method === "POST" && !audioMatch[2]) {
        const value = await requestJson(request);
        const draft = await readDraft(draftsRoot, audioMatch[1]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft revision before audio generation");
        const translation = await readTranslationState(statesRoot, draft.articleId);
        const audio = await queueTts({ draft, translation, queueRoot, statesRoot, policyRevision: await currentTtsPolicyRevision(), workflow: value.workflow ?? "manual" });
        await createNotification(notificationsRoot, {
          level: "info", event: "audio-started", articleId: draft.articleId,
          message: `Audio en inglés iniciado. Sube tu MP3 en español para completar la publicación: ${draft.title}`,
        });
        return json(response, 202, { audio });
      }
      if (audioMatch && request.method === "GET" && !audioMatch[2]) {
        await reconcileTts({ statesRoot, jobsRoot, onComplete: audioCompleted, onFailure: audioFailed });
        return json(response, 200, { audio: await readOptionalState(() => readTtsState(statesRoot, audioMatch[1])) });
      }
      if (audioMatch && request.method === "GET" && audioMatch[2]) {
        const state = await readTtsState(statesRoot, audioMatch[1]);
        const body = await readFile(audioFileForState(state, audioMatch[2], jobsRoot));
        const range = audioByteRange(request.headers.range, body.length);
        const payload = range ? body.subarray(range.start, range.end + 1) : body;
        response.writeHead(range ? 206 : 200, {
          "Content-Type": "audio/mpeg", "Content-Length": payload.length,
          "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${body.length}` } : {}),
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        });
        return response.end(payload);
      }
      const audiogramMatch = AUDIOGRAM_PATH.exec(url.pathname);
      if (audiogramMatch && request.method === "POST" && !audiogramMatch[2]) {
        const value = await requestJson(request);
        const [draft, audio] = await Promise.all([readDraft(draftsRoot, audiogramMatch[1]), readTtsState(statesRoot, audiogramMatch[1])]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft before creating the audiogram");
        const audiogram = await queueAudiogram({ draft, audio, queueRoot, statesRoot });
        await createNotification(notificationsRoot, { level: "info", event: "audiogram-started", articleId: draft.articleId, message: "Creando el video completo para YouTube automáticamente.", replacePending: true });
        return json(response, 202, { audiogram });
      }
      if (audiogramMatch && request.method === "GET" && !audiogramMatch[2]) {
        await reconcileAudiograms({ statesRoot, jobsRoot, onComplete: audiogramCompleted, onFailure: audiogramFailed });
        const [audiogram, draft, audio] = await Promise.all([
          readOptionalState(() => readAudiogramState(statesRoot, audiogramMatch[1])),
          readDraft(draftsRoot, audiogramMatch[1]),
          readOptionalState(() => readTtsState(statesRoot, audiogramMatch[1])),
        ]);
        return json(response, 200, { audiogram: audiogramWithFreshness(audiogram, draft, audio) });
      }
      if (audiogramMatch && request.method === "GET" && audiogramMatch[2] === "video") {
        const state = await readAudiogramState(statesRoot, audiogramMatch[1]);
        const body = await readFile(audiogramFileForState(state, jobsRoot));
        const range = audioByteRange(request.headers.range, body.length);
        const payload = range ? body.subarray(range.start, range.end + 1) : body;
        response.writeHead(range ? 206 : 200, {
          "Content-Type": "video/mp4", "Content-Length": payload.length, "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${body.length}` } : {}),
          ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="fanaticosos-${state.articleId}.mp4"` } : {}),
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        });
        return response.end(payload);
      }
      const releaseMatch = RELEASE_PATH.exec(url.pathname);
      if (releaseMatch && request.method === "POST") {
        const value = await requestJson(request);
        const [draft, translation, audio, previousRelease, previousDeployment] = await Promise.all([
          readDraft(draftsRoot, releaseMatch[1]), readTranslationState(statesRoot, releaseMatch[1]), readTtsState(statesRoot, releaseMatch[1]),
          readOptionalState(() => readReleaseState(statesRoot, releaseMatch[1])),
          readOptionalState(() => readDeploymentState(statesRoot, releaseMatch[1])),
        ]);
        if (value.expectedRevision !== draft.revision) throw new Error("save the current draft before preparing publication");
        const requests = ttsRequestsForDraft(draft, translation);
        if (!releaseArtifactsEligible({
          draft, audio, requests, release: previousRelease, deployment: previousDeployment,
          currentPolicyRevision: await currentTtsPolicyRevision(),
        })) throw new Error("current bilingual audio is required before preparing publication");
        const release = await queueRelease({ draft, queueRoot, statesRoot });
        await createNotification(notificationsRoot, { level: "info", event: "release-started", articleId: draft.articleId, message: `Preparación privada iniciada: ${draft.title}` });
        return json(response, 202, { release });
      }
      if (releaseMatch && request.method === "GET") {
        await reconcileReleases({ statesRoot, releasesRoot, onComplete: releaseCompleted, onFailure: releaseFailed });
        const [release, audio] = await Promise.all([
          readOptionalState(() => readReleaseState(statesRoot, releaseMatch[1])),
          readOptionalState(() => readTtsState(statesRoot, releaseMatch[1])),
        ]);
        return json(response, 200, { release: releaseWithFreshness(release, audio) });
      }
      const publishMatch = PUBLISH_PATH.exec(url.pathname);
      if (publishMatch && request.method === "POST") {
        const value = await requestJson(request); const [draft, release, audio] = await Promise.all([readDraft(draftsRoot, publishMatch[1]), readReleaseState(statesRoot, publishMatch[1]), readTtsState(statesRoot, publishMatch[1])]);
        if (value.expectedRevision !== draft.revision || release.status !== "completed" || release.draftRevision !== draft.revision) throw new Error("La vista previa actual debe validarse antes de publicar.");
        if (release.manifest?.assets?.esAudio?.sha256 !== audio.jobs?.es?.result?.sha256 || release.manifest?.assets?.enAudio?.sha256 !== audio.jobs?.en?.result?.sha256) throw new Error("Uno de los audios cambió; vuelve a crear la vista previa antes de publicar.");
        const deployment = await queueDeployment({ articleId: draft.articleId, draftRevision: draft.revision, releaseJobId: release.jobId, queueRoot, statesRoot });
        await createNotification(notificationsRoot, { level: "info", event: "deployment-started", articleId: draft.articleId, message: `Publicación iniciada: ${draft.title}` }); return json(response, 202, { deployment });
      }
      if (publishMatch && request.method === "GET") {
        const state = await readOptionalState(() => readDeploymentState(statesRoot, publishMatch[1]));
        return json(response, 200, {
          deployment: state ? await reconcileDeployment({ state, statesRoot, releasesRoot }) : null,
        });
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
        await rebaseReusableArtifacts({ draft, statesRoot });
        return json(response, 200, { draft });
      }
      return json(response, 404, { error: "not found" });
    } catch (error) {
      const message = error?.message ?? "Request failed.";
      const notFound = error?.code === "ENOENT";
      const status = notFound ? 404 : /another browser session/.test(message) ? 409 : 400;
      return json(response, status, { error: notFound ? "Resource not found." : message });
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
