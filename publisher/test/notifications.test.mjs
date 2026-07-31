import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acknowledgeNotification, createNotification, listNotifications } from "../lib/notifications.mjs";

test("notification persists until explicitly acknowledged", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-notifications-"));
  const created = await createNotification(root, {
    level: "error",
    event: "translation-failed",
    articleId: null,
    message: "La traducción falló.",
  }, new Date("2026-07-31T12:00:00Z"));
  assert.equal((await listNotifications(root))[0].acknowledgedAt, null);
  await acknowledgeNotification(root, created.id, new Date("2026-07-31T12:05:00Z"));
  assert.equal((await listNotifications(root))[0].acknowledgedAt, "2026-07-31T12:05:00.000Z");
  assert.equal((await stat(join(root, `${created.id}.json`))).mode & 0o777, 0o600);
});
