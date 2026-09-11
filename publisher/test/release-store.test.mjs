import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";
import { databaseReleaseStore } from "../lib/release-store.mjs";

function artifact(database, revisionId, { id, type, locale, sha256 }) {
  const timestamp = "2026-09-09T00:00:00.000Z";
  database.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path,
    checksum_sha256, created_at, updated_at, accepted_at) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`)
    .run(id, revisionId, type, locale, sha256, `/artifacts/${id}`, sha256, timestamp, timestamp, timestamp);
  return { id, sha256 };
}

test("SQLite release store owns state while the filesystem carries only worker requests and manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-store-test-"));
  const queueRoot = join(root, "queue"); const releasesRoot = join(root, "releases");
  const uploadsRoot = join(root, "uploads"); const imagesRoot = join(root, "artifacts", "images");
  const database = await openDatabase(join(root, "publisher.sqlite"));
  try {
    await mkdir(uploadsRoot, { recursive: true });
    const imageName = "12345678-1234-4123-8123-123456789abc.png";
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    await writeFile(join(uploadsRoot, imageName), imageBytes);
    const draft = createDatabaseDraft(database, { title: "Título", description: "Resumen", body: "Artículo", category: "Bears", season: 2026, tags: [], status: "draft", featuredImage: { path: `/uploads/${imageName}` } });
    const revisionId = database.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(draft.articleId).current_revision_id;
    const translation = { artifact: artifact(database, revisionId, { id: "translation", type: "translation", locale: "en", sha256: "a".repeat(64) }) };
    const audio = { jobs: {
      es: { result: { sha256: "b".repeat(64) }, artifact: artifact(database, revisionId, { id: "audio-es", type: "audio", locale: "es", sha256: "b".repeat(64) }) },
      en: { result: { sha256: "c".repeat(64) }, artifact: artifact(database, revisionId, { id: "audio-en", type: "audio", locale: "en", sha256: "c".repeat(64) }) },
    } };
    const sourceCommit = "d".repeat(40);
    const store = databaseReleaseStore({ database, queueRoot, releasesRoot, uploadsRoot, imagesRoot, repository: root, resolveSourceCommit: async () => sourceCommit });
    const now = new Date("2026-09-09T18:00:00Z");
    const queued = await store.queue({ draft, translation, audio, settings: { schemaVersion: 1 }, now });
    const request = JSON.parse(await readFile(join(queueRoot, queued.jobId, "request.json"), "utf8"));
    assert.equal(request.publishedAt, "2026-09-09T13:00:00-05:00");
    assert.equal(request.sourceCommit, sourceCommit);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM release_artifacts WHERE release_id = ?").get(queued.jobId).count, 4);
    const storedImage = database.prepare("SELECT path, checksum_sha256 FROM artifacts WHERE type = 'image'").get();
    assert.equal(storedImage.checksum_sha256, createHash("sha256").update(imageBytes).digest("hex"));
    assert.deepEqual(await readFile(storedImage.path), imageBytes);
    const manifest = { schemaVersion: 1, articleId: draft.articleId, publishedAt: request.publishedAt };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    await mkdir(join(releasesRoot, queued.jobId, "release"), { recursive: true });
    await writeFile(join(releasesRoot, queued.jobId, "request.json"), `${JSON.stringify(request)}\n`);
    await writeFile(join(releasesRoot, queued.jobId, "release", "release-manifest.json"), manifestBytes);
    let callback;
    await store.reconcile({ now: new Date("2026-09-09T18:01:00Z"), onComplete: (state) => { callback = state; } });
    assert.equal(callback.status, "completed");
    assert.deepEqual((await store.read(draft.articleId)).manifest, manifest);
    assert.equal(database.prepare("SELECT manifest_checksum_sha256 FROM releases WHERE id = ?").get(queued.jobId).manifest_checksum_sha256,
      createHash("sha256").update(manifestBytes).digest("hex"));
  } finally { closeDatabase(database); }
});
