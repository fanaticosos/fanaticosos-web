import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { audiogramWithFreshness, audioByteRange, createPublisherServer, releaseArtifactsEligible, releaseWithFreshness, translationWithFreshness } from "../server.mjs";

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

test("audiogram freshness follows the draft image and Spanish audio", () => {
  const draft = { revision: 2 };
  const audio = { jobs: { es: { result: { sha256: "current" } } } };
  const audiogram = { status: "completed", draftRevision: 2, audioSha256: "current" };
  assert.equal(audiogramWithFreshness(audiogram, draft, audio).status, "completed");
  assert.equal(audiogramWithFreshness({ ...audiogram, draftRevision: 1 }, draft, audio).status, "stale");
  assert.equal(audiogramWithFreshness({ ...audiogram, audioSha256: "old" }, draft, audio).status, "stale");
});

async function fixture() {
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
  const server = createPublisherServer({ draftsRoot, uploadsRoot, notificationsRoot, queueRoot, statesRoot, jobsRoot, siteSettingsPath, musicResolver });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, queueRoot, statesRoot, siteSettingsPath };
}

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
  assert.match(html, />Crear traducción y audio en inglés</);
  assert.match(html, /<details class="activity-panel">/);
  assert.match(html, /id="acknowledge-all"/);
  assert.doesNotMatch(html, /name="imageCaption"/);
  assert.match(html, /Crédito o pie de foto/);
  assert.match(html, /SEO y apariencia al compartir/);
  assert.match(html, /id="music-form"/);
  assert.match(html, /id="body-preview"/);
  assert.match(html, /data-markdown-action="heading"/);
  assert.match(html, /Canción de la semana/);
  assert.match(html, /Vista previa aproximada en redes y WhatsApp/);
  assert.match(html, /id="generate-audio" disabled hidden/);
  assert.match(html, /id="upload-spanish-audio"/);
  assert.match(html, /id="generate-spanish-audio"/);
  assert.match(html, /id="regenerate-english-audio"/);
  assert.match(html, /id="audiogram-result"/);
  assert.match(html, /class="audiogram-preview"/);
  assert.match(html, /id="download-audiogram"/);
  assert.match(html, /id="regenerate-audiogram"/);
  assert.match(html, /Copiar título y descripción para YouTube/);
  assert.match(html, /id="prepare-release" disabled hidden/);
  assert.match(html, /id="remove-image"/);
  assert.match(html, /Revisar vista previa y validar/);

  const app = await (await fetch(`${base}/app.js`)).text();
  assert.match(app, /articleTitle\.scrollIntoView/);
  assert.match(app, /articleTitle\.focus/);
  assert.match(app, /Esto no bloquea la traducción, el audio ni la publicación/);
  assert.doesNotMatch(app, /generateEnglish\.disabled = preflight\.status !== "ready"/);
  assert.match(app, /workflow: "preview"/);
  assert.match(app, /generateSeoPreview/);
  assert.match(app, /imagePath: ownerFields\.featuredImage\.path/);
  assert.match(app, /publishRelease\.disabled = true/);
  assert.match(app, /release\.status/);
  assert.match(app, /\/api\/music/);
  assert.match(app, /\/api\/markdown-preview/);

  const seo = await (await fetch(`${base}/seo.js`)).text();
  assert.match(seo, /canonicalUrl/);

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
  const response = await fetch(`${base}/api/drafts/${draft.articleId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: draft.revision }),
  });
  assert.equal(response.status, 202);
  const queued = (await readdir(queueRoot)).filter((name) => name.startsWith("tts-"));
  assert.equal(queued.length, 2);
  assert.equal(queued.some((name) => name.startsWith("tts-es-")), true);
  assert.equal(queued.some((name) => name.startsWith("tts-en-")), true);
});
