import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { rebaseReusableArtifacts } from "../lib/artifact-revisions.mjs";
import { translationSourceRevision } from "../lib/translation-jobs.mjs";
import { ttsRequestsForDraft } from "../lib/tts-jobs.mjs";

const original = {
  articleId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  title: "Título",
  description: "Resumen",
  body: "## Inicio\n\nTexto.",
  featuredImage: {},
};

test("translation source revision matches the production Python contract", () => {
  assert.equal(translationSourceRevision(original), "2e0543ea039b2976eb0e3a058cd953c9741a0a22861ced3392a8f05377934bee");
});

test("an image-only draft revision preserves accepted translation and audio", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-artifact-revision-"));
  const statesRoot = join(root, "states");
  await mkdir(statesRoot);
  const translation = {
    schemaVersion: 1,
    articleId: original.articleId,
    draftRevision: 1,
    status: "completed",
    sourceRevision: translationSourceRevision(original),
    result: { title: "Title", description: "Summary", body: "## Start\n\nText." },
  };
  const requests = ttsRequestsForDraft(original, translation);
  const audio = {
    schemaVersion: 1,
    articleId: original.articleId,
    draftRevision: 1,
    status: "completed",
    sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision },
    jobs: { es: { status: "completed" }, en: { status: "completed" } },
  };
  await writeFile(join(statesRoot, `${original.articleId}.json`), JSON.stringify(translation));
  await writeFile(join(statesRoot, `audio-${original.articleId}.json`), JSON.stringify(audio));

  const withImage = { ...original, revision: 2, featuredImage: { path: "/uploads/photo.webp" } };
  assert.deepEqual(await rebaseReusableArtifacts({ draft: withImage, statesRoot }), { translation: true, audio: true });
  const savedTranslation = JSON.parse(await readFile(join(statesRoot, `${original.articleId}.json`), "utf8"));
  const savedAudio = JSON.parse(await readFile(join(statesRoot, `audio-${original.articleId}.json`), "utf8"));
  assert.equal(savedTranslation.draftRevision, 2);
  assert.equal(savedAudio.draftRevision, 2);
  assert.deepEqual(savedAudio.sourceRevisions, {
    es: ttsRequestsForDraft(withImage, savedTranslation).es.sourceRevision,
    en: ttsRequestsForDraft(withImage, savedTranslation).en.sourceRevision,
  });
});

test("article text changes never rebase accepted artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-artifact-stale-"));
  const statesRoot = join(root, "states");
  await mkdir(statesRoot);
  await writeFile(join(statesRoot, `${original.articleId}.json`), JSON.stringify({
    articleId: original.articleId,
    draftRevision: 1,
    status: "completed",
    sourceRevision: translationSourceRevision(original),
  }));
  const changed = { ...original, revision: 2, body: `${original.body}\n\nCambio real.` };
  assert.deepEqual(await rebaseReusableArtifacts({ draft: changed, statesRoot }), { translation: false, audio: false });
});
