import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { newDraft, readDraft, updateDraft, validateOwnerFields, writeDraft } from "../lib/drafts.mjs";

const valid = {
  title: "Los Bears ganan",
  description: "Resumen del partido de Chicago.",
  body: "Contenido periodístico del artículo.",
  category: "Chicago Bears",
  tags: ["NFL", "Bears"],
  status: "draft",
  featuredImage: {},
};

test("owner fields reject incomplete image attribution", () => {
  assert.throws(
    () => validateOwnerFields({ ...valid, featuredImage: { path: "photo.jpg" } }),
    /alternative text and credit/,
  );
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
