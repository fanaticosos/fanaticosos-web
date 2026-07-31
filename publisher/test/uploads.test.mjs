import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveImage, validateImage } from "../lib/uploads.mjs";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test("upload rejects a claimed image with the wrong signature", () => {
  assert.throws(() => validateImage(Buffer.from("not an image"), "image/png"), /signature/);
});

test("upload receives a generated safe name and private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "fanaticosos-uploads-"));
  const upload = await saveImage(root, png, "image/png");
  assert.match(upload.name, /^[0-9a-f-]{36}\.png$/);
  assert.equal((await stat(join(root, upload.name))).mode & 0o777, 0o600);
});
