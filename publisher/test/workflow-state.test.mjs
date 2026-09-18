import assert from "node:assert/strict";
import test from "node:test";

import { deploymentStateForRevision } from "../public/workflow-state.js";

test("only a deployment for the open draft revision is shown as published", () => {
  assert.equal(deploymentStateForRevision(null, 4), "none");
  assert.equal(deploymentStateForRevision({ status: "completed", draftRevision: 3 }, 4), "outdated");
  assert.equal(deploymentStateForRevision({ status: "completed", draftRevision: 4 }, 4), "published");
  assert.equal(deploymentStateForRevision({ status: "running", draftRevision: 4 }, 4), "publishing");
  assert.equal(deploymentStateForRevision({ status: "failed", draftRevision: 4 }, 4), "failed");
});
