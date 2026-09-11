import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import { completeDatabaseRelease, failDatabaseRelease, listActiveDatabaseReleases, queueDatabaseRelease, readDatabaseReleaseState, startDatabaseRelease } from "./database-releases.mjs";
import { queueRelease, readReleaseState, reconcileReleases, zonedIso } from "./release-jobs.mjs";
import { contentTypeForName, validateImage } from "./uploads.mjs";

const TIMEOUT_MS = 12 * 60 * 1000;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const execute = promisify(execFile);

export async function repositorySourceCommit(repository) {
  const { stdout } = await execute("git", ["-C", repository, "rev-parse", "HEAD"]);
  const commit = stdout.trim();
  if (!GIT_COMMIT.test(commit)) throw new Error("repository source commit is invalid");
  return commit;
}

export function filesystemReleaseStore({ queueRoot, statesRoot, releasesRoot }) {
  return { queue: (value) => queueRelease({ ...value, queueRoot, statesRoot }), read: (articleId) => readReleaseState(statesRoot, articleId), reconcile: (callbacks) => reconcileReleases({ statesRoot, releasesRoot, ...callbacks }) };
}

async function optionalJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function writeRequest(queueRoot, jobId, request) {
  await mkdir(queueRoot, { recursive: true, mode: 0o700 }); const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  await mkdir(temporary, { mode: 0o700 }); await writeFile(join(temporary, "request.json"), `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, join(queueRoot, jobId)); await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
}

async function preserveImageArtifact({ draft, uploadsRoot, imagesRoot }) {
  if (!draft.featuredImage?.path) return null;
  const name = basename(draft.featuredImage.path);
  if (draft.featuredImage.path !== `/uploads/${name}` || !contentTypeForName(name)) throw new Error("featured image is outside the private upload store");
  const source = join(uploadsRoot, name); const bytes = await readFile(source);
  validateImage(bytes, contentTypeForName(name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = join(imagesRoot, draft.articleId); const path = join(directory, `${sha256}${extname(name)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || createHash("sha256").update(await readFile(path)).digest("hex") !== sha256) throw new Error("stored image artifact differs");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" }); await chmod(path, 0o600);
  }
  return { id: `image:${draft.articleId}:r${draft.revision}:${sha256}`, path, sha256 };
}

export function databaseReleaseStore({ database, queueRoot, releasesRoot, uploadsRoot, imagesRoot, repository, resolveSourceCommit = repositorySourceCommit }) {
  return {
    async queue({ draft, translation, audio, settings, publishedAt, now = new Date() }) {
      const sourceCommit = await resolveSourceCommit(repository);
      const jobId = `release-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
      const previous = database.prepare(`SELECT rel.manifest_json
        FROM deployments d JOIN releases rel ON rel.id = d.release_id
        JOIN article_catalog_entries e ON e.catalog_id = rel.catalog_id
        WHERE d.status = 'published' AND e.article_id = ?
        ORDER BY d.published_at DESC, d.id DESC LIMIT 1`).get(draft.articleId);
      const previousPublishedAt = previous?.manifest_json ? JSON.parse(previous.manifest_json).publishedAt : null;
      const effectivePublishedAt = Number.isFinite(Date.parse(previousPublishedAt ?? ""))
        ? previousPublishedAt
        : Number.isFinite(Date.parse(publishedAt ?? ""))
          ? zonedIso(new Date(publishedAt), "America/Chicago")
          : zonedIso(now, "America/Chicago");
      const imageArtifact = await preserveImageArtifact({ draft, uploadsRoot, imagesRoot });
      const state = queueDatabaseRelease(database, { draft, translation, audio, imageArtifact, jobId,
        path: join(releasesRoot, jobId, "release"), settings, publishedAt: effectivePublishedAt, sourceCommit, now });
      if (state.jobId !== jobId) return state;
      try { await writeRequest(queueRoot, jobId, { schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, publishedAt: effectivePublishedAt, sourceCommit }); }
      catch (error) { failDatabaseRelease(database, jobId, "release request could not be queued", now); throw error; }
      return state;
    },
    async read(articleId) { return readDatabaseReleaseState(database, articleId); },
    async reconcile({ onComplete, onFailure, now = new Date() }) {
      for (const active of listActiveDatabaseReleases(database)) {
        const root = join(releasesRoot, active.jobId); const manifestPath = join(root, "release", "release-manifest.json");
        const manifest = await optionalJson(manifestPath);
        if (manifest) {
          if (active.status === "queued") startDatabaseRelease(database, active.jobId, new Date(now.getTime() + TIMEOUT_MS), now);
          const bytes = await readFile(manifestPath); const checksum = createHash("sha256").update(bytes).digest("hex");
          const completed = completeDatabaseRelease(database, active.jobId, manifest, checksum, now); await onComplete?.(completed); continue;
        }
        const failure = await optionalJson(join(root, "failure.json"));
        if (failure) { const failed = failDatabaseRelease(database, active.jobId, failure.error || "release failed", now); await onFailure?.(failed); continue; }
        if (active.status === "queued" && await optionalJson(join(root, "request.json"))) startDatabaseRelease(database, active.jobId, new Date(now.getTime() + TIMEOUT_MS), now);
        if (now.getTime() - new Date(active.createdAt).getTime() > TIMEOUT_MS) { const failed = failDatabaseRelease(database, active.jobId, "La preparación privada excedió su límite automático y fue detenida.", now); await onFailure?.(failed); }
      }
    },
  };
}
