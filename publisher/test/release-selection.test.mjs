import assert from "node:assert/strict";
import { mkdir, mkdtemp, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { selectRelease } from "../lib/release-selection.mjs";

const first = "release-00000000000040008000000000000001-r1-11111111";
const second = "release-00000000000040008000000000000002-r2-22222222";

async function fixture(root, jobId, deployment = "disabled") {
  const release = join(root, jobId, "release");
  await mkdir(join(release, "dist", "blog", "es"), { recursive: true });
  await mkdir(join(release, "dist", "en", "blog", "en"), { recursive: true });
  await writeFile(join(release, "dist", "blog", "es", "index.html"), "es");
  await writeFile(join(release, "dist", "en", "blog", "en", "index.html"), "en");
  await writeFile(join(release, "release-manifest.json"), JSON.stringify({
    schemaVersion: 1, deployment, routes: { es: "/blog/es/", en: "/en/blog/en/" },
  }));
}

test("validated releases can be selected and restored atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-selection-"));
  await fixture(root, first);
  await fixture(root, second);
  await selectRelease({ releasesRoot: root, jobId: first });
  assert.equal(await readlink(join(root, "current")), join(first, "release"));
  await selectRelease({ releasesRoot: root, jobId: second });
  assert.equal(await readlink(join(root, "current")), join(second, "release"));
  await selectRelease({ releasesRoot: root, jobId: first });
  assert.equal(await readlink(join(root, "current")), join(first, "release"));
});

test("an invalid release cannot replace the selected release", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-selection-invalid-"));
  await fixture(root, first);
  await fixture(root, second, "production");
  await selectRelease({ releasesRoot: root, jobId: first });
  await assert.rejects(selectRelease({ releasesRoot: root, jobId: second }), /validated private release/);
  assert.equal(await readlink(join(root, "current")), join(first, "release"));
});
