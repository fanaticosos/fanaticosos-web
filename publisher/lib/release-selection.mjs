import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const JOB_PATTERN = /^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;

export async function selectRelease({ releasesRoot, jobId }) {
  if (!JOB_PATTERN.test(jobId)) throw new Error("release job ID is invalid");
  const root = resolve(releasesRoot);
  const release = join(root, jobId, "release");
  const manifestPath = join(release, "release-manifest.json");
  const dist = join(release, "dist");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.deployment !== "disabled") {
    throw new Error("release manifest is not a validated private release");
  }
  if ((await lstat(dist)).isDirectory() === false) throw new Error("release dist is invalid");
  for (const route of [manifest.routes?.es, manifest.routes?.en]) {
    if (typeof route !== "string" || !route.startsWith("/") || !route.endsWith("/")) {
      throw new Error("release route is invalid");
    }
    await lstat(join(dist, route, "index.html"));
  }
  const current = join(root, "current");
  const temporary = join(root, `.current-${randomUUID()}`);
  await symlink(join(jobId, "release"), temporary);
  try {
    await rename(temporary, current);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { jobId: basename(jobId), manifest };
}
