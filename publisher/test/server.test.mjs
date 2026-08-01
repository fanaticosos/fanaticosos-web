import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPublisherServer } from "../server.mjs";

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

async function fixture() {
  const draftsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-publisher-"));
  const uploadsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-uploads-"));
  const notificationsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-notifications-"));
  const queueRoot = await mkdtemp(join(tmpdir(), "fanaticosos-queue-"));
  const statesRoot = await mkdtemp(join(tmpdir(), "fanaticosos-states-"));
  const jobsRoot = await mkdtemp(join(tmpdir(), "fanaticosos-jobs-"));
  const server = createPublisherServer({ draftsRoot, uploadsRoot, notificationsRoot, queueRoot, statesRoot, jobsRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, queueRoot, statesRoot };
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
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  assert.match(html, /Publicador privado/);
  assert.match(html, /id="article-title"/);

  const app = await (await fetch(`${base}/app.js`)).text();
  assert.match(app, /articleTitle\.scrollIntoView/);
  assert.match(app, /articleTitle\.focus/);

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
    body: JSON.stringify({ expectedRevision: 1, draft: fields }),
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

test("accepted English revision can queue both locale audio jobs", async (context) => {
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
