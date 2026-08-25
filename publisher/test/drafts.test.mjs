import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listDrafts, newDraft, readDraft, updateDraft, validateOwnerFields, writeDraft } from "../lib/drafts.mjs";

const valid = {
  title: "Los Bears ganan",
  description: "Resumen del partido de Chicago.",
  body: "Contenido periodístico del artículo.",
  category: "Chicago Bears",
  season: 2026,
  tags: ["NFL", "Bears"],
  status: "draft",
  featuredImage: {},
};

test("image accessibility and attribution fields are optional for the owner", () => {
  const fields = validateOwnerFields({ ...valid, featuredImage: { path: "photo.jpg" } });
  assert.deepEqual(fields.featuredImage, { path: "photo.jpg", alt: "", caption: "", credit: "" });
  const legacy = validateOwnerFields({
    ...valid,
    featuredImage: { path: "photo.jpg", alt: "Practice", caption: "Old caption", credit: "Photographer" },
  });
  assert.equal(legacy.featuredImage.caption, "");
  assert.equal(legacy.featuredImage.credit, "Photographer");
});

test("draft survives a complete save and reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-drafts-"));
  const draft = newDraft(valid, new Date("2026-07-31T12:00:00Z"));
  await writeDraft(root, draft);
  assert.deepEqual(await readDraft(root, draft.articleId), draft);
  assert.equal((await stat(join(root, `${draft.articleId}.json`))).mode & 0o777, 0o600);
});

test("revision check prevents one browser from overwriting another", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-drafts-"));
  const draft = newDraft(valid);
  await writeDraft(root, draft);
  await updateDraft(root, draft.articleId, 1, { ...valid, title: "Revisión dos" });
  await assert.rejects(
    updateDraft(root, draft.articleId, 1, { ...valid, title: "Edición vieja" }),
    /another browser session/,
  );
});

test("simultaneous edits cannot both overwrite the same revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-drafts-"));
  const draft = newDraft(valid);
  await writeDraft(root, draft);
  const results = await Promise.allSettled([
    updateDraft(root, draft.articleId, 1, { ...valid, title: "Primera edición" }),
    updateDraft(root, draft.articleId, 1, { ...valid, title: "Segunda edición" }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal((await readDraft(root, draft.articleId)).revision, 2);
});

test("one corrupt draft does not hide every valid draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-drafts-"));
  const draft = newDraft(valid);
  await writeDraft(root, draft);
  await writeFile(join(root, "00000000-0000-4000-8000-000000000099.json"), "not-json");
  assert.deepEqual((await listDrafts(root)).map(({ articleId }) => articleId), [draft.articleId]);
});

test("saving an unchanged draft preserves its revision and completed artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-drafts-"));
  const draft = newDraft(valid, new Date("2026-08-25T12:00:00Z"));
  await writeDraft(root, draft);
  const saved = await updateDraft(root, draft.articleId, 1, valid, new Date("2026-08-25T13:00:00Z"));
  assert.equal(saved.revision, 1);
  assert.equal(saved.updatedAt, "2026-08-25T12:00:00.000Z");
});
