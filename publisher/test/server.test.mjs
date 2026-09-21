import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { databaseDraftStore } from "../lib/draft-store.mjs";
import { translationSourceRevision } from "../lib/translation-jobs.mjs";
import { audiogramWithFreshness, audioByteRange, audioWithFreshness, createPublisherServer, crossSiteRejection, isJsonContentType, releaseArtifactsEligible, releaseWithFreshness, translationWithFreshness } from "../server.mjs";

const fields = {
  title: "Los Bears ganan",
  description: "Resumen del partido.",
  body: "Texto completo del artículo.",
  category: "Chicago Bears",
  season: 2026,
  tags: ["NFL"],
  status: "draft",
  featuredImage: {},
};

test("state-changing requests must come from the publisher origin or a non-browser client", () => {
  const request = (method, headers = {}) => ({ method, headers: { host: "100.121.48.92:4310", ...headers } });
  assert.equal(crossSiteRejection(request("GET", { origin: "https://evil.example" })), null);
  assert.equal(crossSiteRejection(request("POST")), null);
  assert.equal(crossSiteRejection(request("POST", { origin: "http://100.121.48.92:4310", "sec-fetch-site": "same-origin" })), null);
  assert.equal(crossSiteRejection(request("PUT", { "sec-fetch-site": "none" })), null);
  assert.match(crossSiteRejection(request("POST", { origin: "https://evil.example" })), /origin does not match/);
  assert.match(crossSiteRejection(request("POST", { origin: "http://100.121.48.92:4311" })), /origin does not match/);
  assert.match(crossSiteRejection(request("POST", { origin: "null" })), /cross-site/);
  assert.match(crossSiteRejection(request("POST", { origin: "not a url" })), /invalid/);
  assert.match(crossSiteRejection(request("PUT", { origin: "http://100.121.48.92:4310", "sec-fetch-site": "cross-site" })), /cross-site/);
  assert.match(crossSiteRejection(request("POST", { "sec-fetch-site": "same-site" })), /cross-site/);
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);
  assert.equal(isJsonContentType(undefined), false);
});

test("cross-site form submissions cannot change publisher state", async (context) => {
  const { server, base, siteSettingsPath } = await fixture();
  context.after(() => server.close());
  const before = await readFile(siteSettingsPath, "utf8").catch(() => null);
  const body = JSON.stringify({ weeklySongUrl: "https://music.fanaticosos.com/share/new-song" });
  const crossSite = await fetch(`${base}/api/music`, {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body,
  });
  assert.equal(crossSite.status, 403);
  const fetchMetadata = await fetch(`${base}/api/music`, {
    method: "PUT", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body,
  });
  assert.equal(fetchMetadata.status, 403);
  const plainTextForm = await fetch(`${base}/api/music`, {
    method: "PUT", headers: { "Content-Type": "text/plain" }, body,
  });
  assert.equal(plainTextForm.status, 400);
  assert.match((await plainTextForm.json()).error, /application\/json/);
  const acknowledge = await fetch(`${base}/api/notifications/acknowledge-all`, {
    method: "POST", headers: { Origin: "https://evil.example" },
  });
  assert.equal(acknowledge.status, 403);
  assert.equal(await readFile(siteSettingsPath, "utf8").catch(() => null), before);
  const sameOrigin = await fetch(`${base}/api/music`, {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: base, "Sec-Fetch-Site": "same-origin" }, body,
  });
  assert.equal(sameOrigin.status, 202);
});

test("audio byte ranges support browser metadata and seeking requests", () => {
  assert.deepEqual(audioByteRange("bytes=0-", 1000), { start: 0, end: 999 });
  assert.deepEqual(audioByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.equal(audioByteRange(undefined, 1000), null);
  assert.throws(() => audioByteRange("bytes=1000-", 1000), /unsatisfiable/);
});

test("completed preview becomes stale when either accepted audio changes", () => {
  const release = {
    status: "completed",
    draftRevision: 1,
    manifest: { assets: { esAudio: { sha256: "old-es" }, enAudio: { sha256: "same-en" } } },
  };
  const audio = {
    status: "completed",
    draftRevision: 1,
    jobs: {
      es: { result: { sha256: "new-es" } },
      en: { result: { sha256: "same-en" } },
    },
  };
  assert.equal(releaseWithFreshness(release, audio).status, "stale");
  audio.jobs.es.result.sha256 = "old-es";
  assert.equal(releaseWithFreshness(release, audio).status, "completed");
  delete release.manifest.assets.esAudio;
  audio.jobs.es.result.sha256 = "ignored-es";
  assert.equal(releaseWithFreshness(release, audio).status, "completed");
});

test("completed audio reports stale locales when narration sources or policy change", () => {
  const audio = {
    status: "completed",
    policyRevision: "current-policy",
    sourceRevisions: { es: "old-es", en: "current-en" },
  };
  const requests = { es: { sourceRevision: "current-es" }, en: { sourceRevision: "current-en" } };
  assert.deepEqual(audioWithFreshness(audio, requests, "current-policy").staleLocales, ["es"]);
  assert.deepEqual(audioWithFreshness(audio, requests, "new-policy").staleLocales, ["es", "en"]);
  audio.sourceRevisions.es = "current-es";
  assert.equal(audioWithFreshness(audio, requests, "current-policy").status, "completed");
});

test("audio freshness follows each locale's own policy and keeps uploads and pre-split audio current", () => {
  const requests = { es: { sourceRevision: "current-es" }, en: { sourceRevision: "current-en" } };
  const current = { es: "es-policy", en: "en-policy", legacy: "legacy-policy" };
  const generated = {
    status: "completed", sourceRevisions: { es: "current-es", en: "current-en" },
    policyRevisions: { es: "es-policy", en: "en-policy" },
    jobs: { es: { policyRevision: "es-policy", uploaded: false }, en: { policyRevision: "en-policy", uploaded: false } },
  };
  assert.equal(audioWithFreshness(generated, requests, current).status, "completed");
  assert.deepEqual(audioWithFreshness(generated, requests, { ...current, en: "en-changed" }).staleLocales, ["en"]);
  assert.deepEqual(audioWithFreshness(generated, requests, { ...current, es: "es-changed" }).staleLocales, ["es"]);
  const preSplit = { status: "completed", policyRevision: "legacy-policy", sourceRevisions: { es: "current-es", en: "current-en" }, jobs: { es: {}, en: {} } };
  assert.equal(audioWithFreshness(preSplit, requests, current).status, "completed");
  assert.deepEqual(audioWithFreshness(preSplit, requests, { ...current, legacy: "legacy-changed" }).staleLocales, ["es", "en"]);
  const uploaded = { ...generated, jobs: { ...generated.jobs, es: { policyRevision: "whatever", uploaded: true } } };
  assert.equal(audioWithFreshness(uploaded, requests, { ...current, es: "es-changed" }).status, "completed");
  assert.equal(releaseArtifactsEligible({ draft: { revision: 1 }, audio: generated, requests, release: null, deployment: null, currentPolicyRevision: current }), true);
  assert.equal(releaseArtifactsEligible({ draft: { revision: 1 }, audio: generated, requests, release: null, deployment: null, currentPolicyRevision: { ...current, es: "es-changed" } }), false);
});

test("release preparation accepts current audio policy or an exact previously published artifact", () => {
  const draft = { revision: 3 };
  const requests = { es: { sourceRevision: "es-current" }, en: { sourceRevision: "en-current" } };
  const audio = {
    status: "completed", draftRevision: 3, policyRevision: "old-policy",
    sourceRevisions: { es: "es-current", en: "en-current" },
    jobs: { es: { result: { sha256: "es-hash" } }, en: { result: { sha256: "en-hash" } } },
  };
  const release = {
    status: "completed", draftRevision: 3, jobId: "release-old",
    manifest: { assets: { esAudio: { sha256: "es-hash" }, enAudio: { sha256: "en-hash" } } },
  };
  const deployment = { status: "completed", draftRevision: 3, releaseJobId: "release-old" };

  assert.equal(releaseArtifactsEligible({ draft, audio: { ...audio, policyRevision: "current-policy" }, requests, release: null, deployment: null, currentPolicyRevision: "current-policy" }), true);
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release, deployment, currentPolicyRevision: "current-policy" }), true);
  assert.equal(releaseArtifactsEligible({ draft, audio: { ...audio, sourceRevisions: { es: "historic-es", en: "historic-en" } }, requests, release, deployment, currentPolicyRevision: "current-policy" }), true);
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release, deployment: null, currentPolicyRevision: "current-policy" }), false);
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release: { ...release, manifest: { assets: { enAudio: { sha256: "changed" } } } }, deployment, currentPolicyRevision: "current-policy" }), false);
  assert.equal(releaseArtifactsEligible({ draft, audio: { ...audio, sourceRevisions: { ...audio.sourceRevisions, en: "stale" } }, requests, release: null, deployment: null, currentPolicyRevision: "current-policy" }), false);
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release, deployment: { ...deployment, releaseJobId: "another-release" }, currentPolicyRevision: "current-policy" }), false);
});

test("release preparation can recover a deployed revision after its retained release record is gone", () => {
  const draft = { revision: 1 };
  const requests = { es: { sourceRevision: "new-es" }, en: { sourceRevision: "new-en" } };
  const result = (sourceRevision, hashCharacter) => ({ sourceRevision, sha256: hashCharacter.repeat(64), generatedAt: "2026-08-01T11:00:00Z" });
  const audio = {
    status: "completed", draftRevision: 1, policyRevision: "historic-policy",
    sourceRevisions: { es: "historic-es", en: "historic-en" },
    jobs: { es: { result: result("historic-es", "e") }, en: { result: result("historic-en", "b") } },
  };
  const deployment = { status: "completed", draftRevision: 1, receipt: { validatedAt: "2026-08-01T12:00:00Z" } };
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release: null, deployment, currentPolicyRevision: "current-policy" }), true);
  audio.jobs.en.result.generatedAt = "2026-08-01T13:00:00Z";
  assert.equal(releaseArtifactsEligible({ draft, audio, requests, release: null, deployment, currentPolicyRevision: "current-policy" }), false);
});

test("translation freshness follows article text revisions", () => {
  const translation = { status: "completed", draftRevision: 2 };
  assert.equal(translationWithFreshness(translation, { revision: 2 }).status, "completed");
  assert.equal(translationWithFreshness(translation, { revision: 3 }).status, "stale");
});

test("translation freshness follows its dependency across metadata-only revisions", () => {
  const draft = { ...fields, articleId: "00000000-0000-4000-8000-000000000001", revision: 3 };
  const sourceRevision = translationSourceRevision(draft);
  const translation = { status: "completed", draftRevision: 2, sourceRevision };
  assert.equal(translationWithFreshness(translation, draft).status, "completed");
  assert.equal(translationWithFreshness(translation, { ...draft, description: "Changed" }).status, "stale");
});

test("audiogram freshness follows the draft image and Spanish audio", () => {
  const draft = { revision: 2 };
  const audio = { jobs: { es: { result: { sha256: "current" } } } };
  const audiogram = { status: "completed", draftRevision: 2, audioSha256: "current" };
  assert.equal(audiogramWithFreshness(audiogram, draft, audio).status, "completed");
  assert.equal(audiogramWithFreshness({ ...audiogram, draftRevision: 1 }, draft, audio).status, "stale");
  assert.equal(audiogramWithFreshness({ ...audiogram, audioSha256: "old" }, draft, audio).status, "stale");
});

async function fixture({ draftStore, ...overrides } = {}) {
  const draftsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-publisher-"));
  const uploadsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-uploads-"));
  const notificationsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-notifications-"));
  const queueRoot = await mkdtemp(join(tmpdir(), "fanaticosos-queue-"));
  const statesRoot = await mkdtemp(join(tmpdir(), "fanaticosos-states-"));
  const jobsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-jobs-"));
  const siteSettingsPath = join(draftsRoot, "site-settings.json");
  const musicResolver = async () => ({
    title: "Bear Down, Chicago Bears",
    artist: "Jerry Downs",
    album: "Chicago Football",
    duration: 134,
    coverUrl: "https://music.fanaticosos.com/share/img/cover-token",
    streamUrl: "https://music.fanaticosos.com/share/s/stream-token",
  });
  const server = createPublisherServer({ draftsRoot, draftStore, uploadsRoot, notificationsRoot, queueRoot, statesRoot, jobsRoot, siteSettingsPath, musicResolver, ...overrides });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, draftsRoot, queueRoot, statesRoot, siteSettingsPath };
}

test("concurrent publisher reconciliation shares one in-flight pass", async (context) => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const translationStore = { reconcile: async () => { calls += 1; await gate; } };
  const { server } = await fixture({ translationStore });
  context.after(() => server.close());
  const first = server.reconcilePublisherJobs();
  const second = server.reconcilePublisherJobs();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [[], []]);
  await server.reconcilePublisherJobs();
  assert.equal(calls, 2);
});

test("health endpoint is available without touching drafts", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("notification inbox is persistent and private", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const response = await fetch(`${base}/api/notifications`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { notifications: [] });
});

test("owner defaults are centralized and available to the editor", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const settings = (await (await fetch(`${base}/api/settings`)).json()).settings;
  assert.equal(settings.author.name, "Antonio Contreras");
  assert.equal(settings.timezone, "America/Chicago");
  assert.equal(settings.defaultSeason, 2026);
  assert.equal(settings.defaultTags.length, 10);
  assert.equal(settings.promotion.platforms.length, 3);
  const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(serverSource, /audioStore\.read\(previewMatch\[1\]\),\s*readFile\(settingsPath, "utf8"\)\.then\(JSON\.parse\)/);
  assert.doesNotMatch(serverSource, /audioStore\.read\(previewMatch\[1\]\),\s*musicStore\.settings\(\)/);
});

test("weekly song can be resolved, previewed, and persisted", async (context) => {
  const { server, base, siteSettingsPath } = await fixture();
  context.after(() => server.close());
  const initial = (await (await fetch(`${base}/api/music`)).json()).settings;
  assert.equal(initial.music.weeklySong.title, "Send Me An Angel");
  const response = await fetch(`${base}/api/music`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weeklySongUrl: "https://music.fanaticosos.com/share/new-song" }),
  });
  assert.equal(response.status, 202);
  const result = await response.json();
  const saved = result.settings;
  assert.equal(saved.music.weeklySong.title, "Bear Down, Chicago Bears");
  assert.equal(result.publication.status, "queued");
  assert.equal(JSON.parse(await readFile(siteSettingsPath, "utf8")).music.weeklySongUrl, "https://music.fanaticosos.com/share/new-song");
});

test("Markdown preview renders article structure without executing owner HTML", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const response = await fetch(`${base}/api/markdown-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown: "## Sección\n\nTexto **importante**.\n\n<script>alert(1)</script>" }),
  });
  assert.equal(response.status, 200);
  const { html } = await response.json();
  assert.match(html, /<h2>Sección<\/h2>/);
  assert.match(html, /<strong>importante<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
});

test("valid image upload can be previewed privately", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const response = await fetch(`${base}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  assert.equal(response.status, 201);
  const upload = (await response.json()).upload;
  const preview = await fetch(`${base}${upload.path}`);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
});

test("editor shell is served with private security headers", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /media-src 'self'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  assert.match(html, /Publicador privado/);
  assert.match(html, /id="article-title"/);
  assert.match(html, /class="workflow-dock"/);
  assert.match(html, /id="dock-save"/);
  assert.match(html, /id="dock-translate"/);
  assert.match(html, /id="dock-preview"/);
  assert.match(html, /id="dock-publish"/);
  assert.match(html, /id="workflow-state" role="status" aria-live="polite"/);
  assert.match(html, /id="english-review-note" hidden/);
  assert.match(html, /id="retranslate-english" type="button" hidden/);
  assert.match(html, /class="future-actions" hidden/);
  assert.match(html, /id="save-draft"[^>]* hidden/);
  assert.match(html, />Crear traducción al inglés</);
  assert.match(html, /No se gastarán créditos hasta que pulses/);
  assert.match(html, /<details class="activity-panel">/);
  assert.match(html, /id="acknowledge-all"/);
  assert.doesNotMatch(html, /name="imageCaption"/);
  assert.match(html, /Crédito o pie de foto/);
  assert.match(html, /SEO y apariencia al compartir/);
  assert.doesNotMatch(html, /id="music-form"/);
  assert.match(html, /href="\/music\.html"/);
  assert.match(html, /id="body-preview"/);
  assert.match(html, /data-markdown-action="heading"/);
  assert.match(html, /Canción semanal/);
  assert.match(html, /Vista previa aproximada en redes y WhatsApp/);
  assert.match(html, /id="generate-audio" disabled hidden/);
  assert.match(html, /id="upload-spanish-audio"/);
  assert.match(html, /id="generate-spanish-audio"/);
  assert.match(html, /id="regenerate-english-audio"/);
  assert.match(html, /id="regenerate-english-audio"[^>]*>Generar audio en inglés</);
  assert.match(html, /id="audio-es-player" hidden/);
  assert.match(html, /id="audio-en-player" hidden/);
  assert.doesNotMatch(html, /class="workflow-steps"/);
  assert.match(html, /id="audiogram-result"/);
  assert.match(html, /class="audiogram-preview"/);
  assert.match(html, /id="download-audiogram"/);
  assert.match(html, /id="regenerate-audiogram"/);
  assert.match(html, /Copiar título y descripción para YouTube/);
  assert.match(html, /id="prepare-release" disabled hidden/);
  assert.match(html, /id="remove-image"/);
  assert.match(html, /Preparar y abrir vista previa/);

  const app = await (await fetch(`${base}/app.js`)).text();
  assert.match(app, /translationNeedsConfirmation \|\| !staleLocales\.includes\("en"\)/);
  assert.match(app, /englishResult\.scrollIntoView/);
  assert.doesNotMatch(app, /window\.open\(`\/preview/);
  assert.match(app, /window\.location\.assign\(`\/preview/);
  assert.match(app, /canStartTranslation\(\{ draft: current, translation, unsavedChanges: hasUnsavedChanges \}\)/);
  assert.match(app, /dockTranslate\.addEventListener\("click"/);
  assert.match(app, /articleTitle\.scrollIntoView/);
  assert.match(app, /articleTitle\.focus/);
  assert.match(app, /Esto no bloquea la traducción, el audio ni la publicación/);
  assert.doesNotMatch(app, /generateEnglish\.disabled = preflight\.status !== "ready"/);
  assert.match(app, /workflow: "manual"/);
  assert.doesNotMatch(app, /preparando audios automáticamente/);
  assert.match(app, /generateSeoPreview/);
  assert.match(app, /imagePath: ownerFields\.featuredImage\.path/);
  assert.match(app, /publishRelease\.disabled = true/);
  assert.match(app, /release\.status/);
  assert.doesNotMatch(app, /\/api\/music/);
  assert.match(app, /\/api\/markdown-preview/);
  assert.match(app, /window\.addEventListener\("beforeunload"/);
  assert.match(app, /confirmDiscardChanges/);
  assert.match(app, /const refreshes = await Promise\.allSettled/);
  assert.match(app, /El borrador quedó guardado, pero no se pudo actualizar todo el estado/);
  assert.match(app, /El borrador sí permanece guardado/);

  const musicResponse = await fetch(`${base}/music.html`);
  assert.equal(musicResponse.status, 200);
  const musicHtml = await musicResponse.text();
  assert.match(musicHtml, /id="music-form"/);
  assert.match(musicHtml, /Cambia la canción del inicio en un solo paso/);
  const musicApp = await (await fetch(`${base}/music.js`)).text();
  assert.match(musicApp, /\/api\/music/);
  assert.match(musicApp, /Publicando… puedes salir de esta pantalla/);
  assert.match(musicApp, /Esta canción no está activa en la página principal/);

  const seo = await (await fetch(`${base}/seo.js`)).text();
  assert.match(seo, /canonicalUrl/);
  const workflowStateModule = await (await fetch(`${base}/workflow-state.js`)).text();
  assert.match(workflowStateModule, /deploymentStateForRevision/);

  const styles = await (await fetch(`${base}/styles.css`)).text();
  assert.match(styles, /#notification-list[^}]*max-height:[^}]*overflow-y: auto/);
});

test("draft can be created, listed, reopened, and updated", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const createdResponse = await fetch(`${base}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).draft;
  const list = await (await fetch(`${base}/api/drafts`)).json();
  assert.equal(list.drafts[0].articleId, created.articleId);
  const reopened = await (await fetch(`${base}/api/drafts/${created.articleId}`)).json();
  assert.equal(reopened.draft.body, fields.body);
  const updatedResponse = await fetch(`${base}/api/drafts/${created.articleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: 1, draft: { ...fields, title: "Nuevo título" } }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).draft.revision, 2);
});

test("publisher can use SQLite as the sole draft authority without writing legacy JSON", async (context) => {
  const databaseRoot = await mkdtemp(join(tmpdir(), "fanaticosos-publisher-database-"));
  const database = await openDatabase(join(databaseRoot, "publisher.sqlite"));
  const { server, base, draftsRoot } = await fixture({ draftStore: databaseDraftStore(database) });
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeDatabase(database);
  });

  const createdResponse = await fetch(`${base}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).draft;
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM articles").get().count, 1);
  assert.deepEqual(await readdir(draftsRoot), []);

  const listed = (await (await fetch(`${base}/api/drafts`)).json()).drafts;
  assert.equal(listed[0].articleId, created.articleId);
  const updatedResponse = await fetch(`${base}/api/drafts/${created.articleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: 1, draft: { ...fields, title: "Autoridad SQLite" } }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).draft.revision, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM revisions").get().count, 2);
  assert.deepEqual(await readdir(draftsRoot), []);
});

test("saved draft workflow endpoints are idle before processing starts", async (context) => {
  const { server, base, statesRoot } = await fixture();
  context.after(() => server.close());
  const draft = (await (await fetch(`${base}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  })).json()).draft;

  const endpoints = [
    ["translation", "translation"],
    ["audio", "audio"],
    ["audiogram", "audiogram"],
    ["release", "release"],
    ["publish", "deployment"],
  ];
  for (const [endpoint, property] of endpoints) {
    const response = await fetch(`${base}/api/drafts/${draft.articleId}/${endpoint}`);
    assert.equal(response.status, 200, endpoint);
    assert.equal((await response.json())[property], null, endpoint);
  }

  const reopened = await (await fetch(`${base}/api/drafts/${draft.articleId}`)).json();
  assert.equal(reopened.draft.articleId, draft.articleId);
  assert.equal(reopened.draft.revision, 1);

  await writeFile(join(statesRoot, `${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1,
    articleId: draft.articleId,
    draftRevision: draft.revision,
    status: "failed",
    error: "Translation worker exited before producing a result.",
  }));
  const failedResponse = await fetch(`${base}/api/drafts/${draft.articleId}/translation`);
  const failed = (await failedResponse.json()).translation;
  assert.equal(failedResponse.status, 200);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Translation worker exited before producing a result.");
});

test("filesystem errors do not expose internal paths", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const missingId = "00000000-0000-4000-8000-000000000000";
  const response = await fetch(`${base}/api/drafts/${missingId}`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: "Resource not found." });
  assert.doesNotMatch(JSON.stringify(body), /fanaticosos-|ENOENT|states|drafts|\//i);
});

test("stale browser revision returns a conflict", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const created = (await (await fetch(`${base}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  })).json()).draft;
  const update = () => fetch(`${base}/api/drafts/${created.articleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: 1, draft: { ...fields, title: "Updated title" } }),
  });
  assert.equal((await update()).status, 200);
  assert.equal((await update()).status, 409);
});

test("saved draft can queue one private translation job", async (context) => {
  const { server, base, queueRoot } = await fixture();
  context.after(() => server.close());
  const draft = (await (await fetch(`${base}/api/drafts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
  })).json()).draft;
  const response = await fetch(`${base}/api/drafts/${draft.articleId}/translation`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(response.status, 202);
  const translation = (await response.json()).translation;
  assert.equal(translation.status, "queued");
  assert.equal((await readFile(join(queueRoot, translation.jobId, "request.json"), "utf8")).includes(draft.title), true);
});

test("accepted English revision queues bilingual audio jobs", async (context) => {
  const { server, base, queueRoot, statesRoot } = await fixture();
  context.after(() => server.close());
  const draft = (await (await fetch(`${base}/api/drafts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
  })).json()).draft;
  await writeFile(join(statesRoot, `${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    status: "completed", sourceRevision: "a".repeat(64),
    result: { title: "The Bears win", description: "Game summary.", body: "Complete article text." },
  }), { mode: 0o600 });
  const unconfirmed = await fetch(`${base}/api/drafts/${draft.articleId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /review and confirm/);
  assert.equal((await readdir(queueRoot)).filter((name) => name.startsWith("tts-")).length, 0);
  const response = await fetch(`${base}/api/drafts/${draft.articleId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision, confirmReviewed: true }),
  });
  assert.equal(response.status, 202);
  const queued = (await readdir(queueRoot)).filter((name) => name.startsWith("tts-"));
  assert.equal(queued.length, 2);
  assert.equal(queued.some((name) => name.startsWith("tts-es-")), true);
  assert.equal(queued.some((name) => name.startsWith("tts-en-")), true);
});

test("an old upload-waiting draft can generate Spanish audio", async (context) => {
  const { server, base, queueRoot, statesRoot } = await fixture();
  context.after(() => server.close());
  const draft = (await (await fetch(`${base}/api/drafts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
  })).json()).draft;
  await writeFile(join(statesRoot, `${draft.articleId}.json`), JSON.stringify({
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    status: "completed", sourceRevision: "a".repeat(64),
    result: { title: "The Bears win", description: "Game summary.", body: "Complete article text." },
  }), { mode: 0o600 });
  const initial = await fetch(`${base}/api/drafts/${draft.articleId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision, workflow: "preview", confirmReviewed: true }),
  });
  const state = (await initial.json()).audio;
  state.status = "awaiting-upload";
  state.jobs.es = { status: "awaiting-upload" };
  state.jobs.en = { ...state.jobs.en, status: "completed", result: { file: "en.mp3", sha256: "e".repeat(64) } };
  await writeFile(join(statesRoot, `audio-${draft.articleId}.json`), JSON.stringify(state), { mode: 0o600 });

  const response = await fetch(`${base}/api/drafts/${draft.articleId}/audio/es`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(response.status, 202);
  const recovered = (await response.json()).audio;
  assert.equal(recovered.workflow, "preview");
  assert.equal(recovered.jobs.en.status, "completed");
  assert.match(recovered.jobs.es.jobId, /^tts-es-/);
  assert.equal((await readdir(queueRoot)).filter((name) => name.startsWith("tts-es-")).length, 2);
});
