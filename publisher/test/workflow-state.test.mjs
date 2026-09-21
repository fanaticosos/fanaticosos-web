import assert from "node:assert/strict";
import test from "node:test";

import { audioActionLabel, canStartTranslation, deploymentStateForRevision } from "../public/workflow-state.js";

test("audio buttons say generate until that language has an accepted audio", () => {
  assert.equal(audioActionLabel("es", false), "Generar audio en español");
  assert.equal(audioActionLabel("en", false), "Generar audio en inglés");
  assert.equal(audioActionLabel("es", true), "Volver a generar audio en español");
  assert.equal(audioActionLabel("en", true), "Volver a generar audio en inglés");
});

test("saved Spanish draft can start translation before either audio job exists", () => {
  const draft = { articleId: "draft", revision: 2, narrationEs: "Guion narrable" };
  assert.equal(canStartTranslation({ draft, translation: null }), true);
  assert.equal(canStartTranslation({ draft, translation: null, unsavedChanges: true }), false);
  assert.equal(canStartTranslation({ draft: null, translation: null }), false);
  assert.equal(canStartTranslation({ draft, translation: { status: "queued" } }), false);
});

test("only a deployment for the open draft revision is shown as published", () => {
  assert.equal(deploymentStateForRevision(null, 4), "none");
  assert.equal(deploymentStateForRevision({ status: "completed", draftRevision: 3 }, 4), "outdated");
  assert.equal(deploymentStateForRevision({ status: "completed", draftRevision: 4 }, 4), "published");
  assert.equal(deploymentStateForRevision({ status: "running", draftRevision: 4 }, 4), "publishing");
  assert.equal(deploymentStateForRevision({ status: "failed", draftRevision: 4 }, 4), "failed");
});
