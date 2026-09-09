import { createHash } from "node:crypto";
import { constants, createReadStream, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase, withTransaction } from "./database.mjs";

const STATE_FILE = /^release-([0-9a-f-]{36})\.json$/;
const JOB_ID = /^release-([0-9a-f]{32})-r([1-9][0-9]*)-([0-9a-f]{8})$/;
const SHA256 = /^[0-9a-f]{64}$/;

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("released article frontmatter is invalid");
  const field = (name) => {
    const raw = match[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
    if (!raw) return raw;
    return ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
      ? raw.slice(1, -1) : raw;
  };
  return { articleId: field("articleId"), status: field("status"), fixture: field("fixture") === "true", publishedAt: field("publishedAt") };
}

export async function publishedCatalog(releaseRoot) {
  const directory = join(releaseRoot, "src", "content", "articles", "es");
  const entries = [];
  for (const name of (await readdir(directory)).filter((value) => value.endsWith(".md")).sort()) {
    const value = frontmatter(await readFile(join(directory, name), "utf8"));
    if (value.fixture || value.status !== "published") continue;
    if (basename(name, ".md") !== value.articleId) throw new Error("released article identity is invalid");
    if (Number.isNaN(Date.parse(value.publishedAt))) throw new Error("released article publication date is invalid");
    entries.push(value);
  }
  return entries.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.articleId.localeCompare(right.articleId)).map(({ articleId }) => articleId);
}

async function copyImageArtifact(artifactsRoot, candidate, manifest) {
  const image = manifest.assets?.image;
  if (!image) return null;
  const source = join(candidate.releaseRoot, image.path);
  const directory = join(artifactsRoot, candidate.articleId);
  const destination = join(directory, `${image.sha256}-${basename(image.path)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    if (await fileSha256(destination) !== image.sha256) throw new Error(`release image artifact differs: ${candidate.articleId}`);
    return { path: destination, created: false, sha256: image.sha256 };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await copyFile(source, destination, constants.COPYFILE_EXCL); await chmod(destination, 0o600);
  if (await fileSha256(destination) !== image.sha256) { await rm(destination, { force: false }); throw new Error(`copied release image differs: ${candidate.articleId}`); }
  return { path: destination, created: true, sha256: image.sha256 };
}

export async function previewReleaseImport({ statesRoot, releasesRoot, databasePath }) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const names = (await readdir(statesRoot)).filter((name) => STATE_FILE.test(name)).sort();
    if (!names.length) throw new Error("no legacy release states were found");
    const releases = [];
    for (const name of names) {
      const articleId = name.match(STATE_FILE)[1];
      const state = JSON.parse(await readFile(join(statesRoot, name), "utf8"));
      if (state.schemaVersion !== 1 || state.articleId !== articleId || state.status !== "completed" || !JOB_ID.test(state.jobId ?? "")) {
        throw new Error(`legacy release state is invalid: ${articleId}`);
      }
      const releaseRoot = join(releasesRoot, state.jobId, "release");
      const manifestPath = join(releaseRoot, "release-manifest.json");
      let manifestBytes;
      try { manifestBytes = await readFile(manifestPath); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        const deployment = await optionalJson(join(statesRoot, `deployment-${articleId}.json`));
        if (deployment?.status === "completed" && deployment.releaseJobId === state.jobId) {
          throw new Error(`deployed release directory is missing: ${articleId}`);
        }
        releases.push({ articleId, draftRevision: state.draftRevision, jobId: state.jobId,
          action: "skip-unretained", reason: "release was never successfully deployed and its retained directory is gone" });
        continue;
      }
      const manifest = JSON.parse(manifestBytes);
      if (JSON.stringify(manifest) !== JSON.stringify(state.manifest) || manifest.articleId !== articleId || manifest.draftRevision !== state.draftRevision) {
        throw new Error(`legacy release manifest differs: ${articleId}`);
      }
      const revision = database.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?").get(articleId, state.draftRevision);
      if (!revision) throw new Error(`legacy release revision is missing: ${articleId}`);
      const catalog = await publishedCatalog(releaseRoot);
      const missingCatalog = catalog.filter((id) => !database.prepare("SELECT 1 FROM articles WHERE id = ?").get(id));
      const assets = {};
      for (const locale of ["es", "en"]) {
        const value = manifest.assets?.[`${locale}Audio`];
        if (!value || !SHA256.test(value.sha256 ?? "")) throw new Error(`legacy ${locale} release audio is invalid: ${articleId}`);
        assets[`${locale}Audio`] = {
          sha256: value.sha256,
          inDatabase: Boolean(database.prepare("SELECT 1 FROM artifacts WHERE type = 'audio' AND locale = ? AND checksum_sha256 = ? AND status = 'accepted'").get(locale, value.sha256)),
        };
      }
      if (manifest.assets?.image) {
        const image = manifest.assets.image;
        if (typeof image.path !== "string" || !image.path.startsWith("public/") || image.path.split("/").includes("..")) {
          throw new Error(`legacy release image path is invalid: ${articleId}`);
        }
        const imagePath = join(releaseRoot, image.path);
        const metadata = await stat(imagePath);
        assets.image = { sha256: image.sha256, verified: metadata.isFile() && SHA256.test(image.sha256 ?? "") && await fileSha256(imagePath) === image.sha256 };
      }
      const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
      const existing = database.prepare("SELECT manifest_checksum_sha256 FROM releases WHERE id = ?").get(state.jobId);
      releases.push({ articleId, draftRevision: state.draftRevision, jobId: state.jobId,
        manifestSha256,
        catalogCount: catalog.length, missingCatalog, assets,
        releaseRoot,
        action: !existing ? "insert" : existing.manifest_checksum_sha256 === manifestSha256 ? "unchanged" : "conflict" });
    }
    return { schemaVersion: 1, source: "legacy-json-releases", total: releases.length,
      insert: releases.filter(({ action }) => action === "insert").length,
      unchanged: releases.filter(({ action }) => action === "unchanged").length,
      conflicts: releases.filter(({ action }) => action === "conflict").length,
      skipped: releases.filter(({ action }) => action === "skip-unretained").length,
      missingCatalog: releases.reduce((count, value) => count + (value.missingCatalog?.length ?? 0), 0),
      missingAudio: releases.reduce((count, value) => count + (value.assets
        ? [value.assets.esAudio, value.assets.enAudio].filter(({ inDatabase }) => !inDatabase).length : 0), 0),
      invalidImages: releases.filter(({ assets }) => assets?.image && !assets.image.verified).length,
      releases: releases.map(({ releaseRoot, ...value }) => value) };
  } finally { database.close(); }
}

export async function applyReleaseImport({ statesRoot, releasesRoot, imagesRoot, databasePath }) {
  const preview = await previewReleaseImport({ statesRoot, releasesRoot, databasePath });
  if (preview.missingCatalog || preview.missingAudio || preview.invalidImages || preview.conflicts) throw new Error("release import preview is not clean");
  if (preview.insert === 0) return { ...preview, applied: true };
  if (preview.unchanged) throw new Error("release import is partially applied");
  const database = await openDatabase(databasePath); const createdPaths = [];
  try {
    const pending = preview.releases.filter(({ action }) => action === "insert");
    const prepared = [];
    for (const candidate of pending) {
      const releaseRoot = join(releasesRoot, candidate.jobId, "release");
      const manifestBytes = await readFile(join(releaseRoot, "release-manifest.json"));
      const manifest = JSON.parse(manifestBytes); const catalogIds = await publishedCatalog(releaseRoot);
      const settingsBytes = await readFile(join(releaseRoot, "src", "data", "site-settings.json"));
      JSON.parse(settingsBytes);
      const image = await copyImageArtifact(imagesRoot, { ...candidate, releaseRoot }, manifest);
      if (image?.created) createdPaths.push(image.path);
      prepared.push({ candidate, releaseRoot, manifest, manifestBytes, catalogIds, settingsBytes, image });
    }
    const result = withTransaction(database, (connection) => {
      let deployments = 0; let skippedDeployments = 0;
      for (const value of prepared) {
        const { candidate, releaseRoot, manifest, manifestBytes, catalogIds, settingsBytes, image } = value;
        const catalogRows = catalogIds.map((articleId) => {
          const row = connection.prepare("SELECT current_revision_id FROM articles WHERE id = ?").get(articleId);
          if (!row?.current_revision_id) throw new Error(`release catalog revision is missing: ${articleId}`);
          return { articleId, revisionId: row.current_revision_id };
        });
        const catalogHash = createHash("sha256").update(JSON.stringify(catalogRows)).digest("hex");
        const catalogId = `legacy:catalog:${catalogHash}`; const settingsHash = createHash("sha256").update(settingsBytes).digest("hex");
        const settingsId = `legacy:settings:${settingsHash}`;
        connection.prepare("INSERT OR IGNORE INTO article_catalogs (id, created_at) VALUES (?, ?)").run(catalogId, manifest.buildCompletedAt);
        const insertEntry = connection.prepare("INSERT OR IGNORE INTO article_catalog_entries (catalog_id, article_id, revision_id, position) VALUES (?, ?, ?, ?)");
        catalogRows.forEach((row, position) => insertEntry.run(catalogId, row.articleId, row.revisionId, position));
        connection.prepare("INSERT OR IGNORE INTO site_settings_revisions (id, settings_json, created_at) VALUES (?, ?, ?)")
          .run(settingsId, settingsBytes.toString("utf8"), manifest.buildCompletedAt);
        connection.prepare(`INSERT INTO releases (id, catalog_id, site_settings_revision_id, status, path,
          manifest_json, manifest_checksum_sha256, created_at, validated_at)
          VALUES (?, ?, ?, 'validated', ?, ?, ?, ?, ?)`)
          .run(candidate.jobId, catalogId, settingsId, releaseRoot, manifestBytes.toString("utf8"), candidate.manifestSha256,
            manifest.publishedAt, manifest.buildCompletedAt);
        const revisionId = connection.prepare("SELECT id FROM revisions WHERE article_id = ? AND revision_number = ?").get(candidate.articleId, candidate.draftRevision).id;
        if (image) {
          const imageId = `legacy:image:${candidate.jobId}`;
          connection.prepare(`INSERT INTO artifacts (id, revision_id, type, locale, dependency_hash, status, path,
            checksum_sha256, created_at, updated_at, accepted_at) VALUES (?, ?, 'image', NULL, ?, 'accepted', ?, ?, ?, ?, ?)`)
            .run(imageId, revisionId, image.sha256, image.path, image.sha256, manifest.publishedAt, manifest.buildCompletedAt, manifest.buildCompletedAt);
          connection.prepare("INSERT INTO release_artifacts (release_id, artifact_id, checksum_sha256) VALUES (?, ?, ?)").run(candidate.jobId, imageId, image.sha256);
        }
        for (const locale of ["es", "en"]) {
          const checksum = manifest.assets[`${locale}Audio`].sha256;
          const artifact = connection.prepare("SELECT id FROM artifacts WHERE type = 'audio' AND locale = ? AND checksum_sha256 = ? AND status = 'accepted'").get(locale, checksum);
          connection.prepare("INSERT INTO release_artifacts (release_id, artifact_id, checksum_sha256) VALUES (?, ?, ?)").run(candidate.jobId, artifact.id, checksum);
        }
        const translation = connection.prepare("SELECT id, checksum_sha256 FROM artifacts WHERE revision_id = ? AND type = 'translation' AND status = 'accepted' ORDER BY accepted_at DESC LIMIT 1").get(revisionId);
        if (translation) connection.prepare("INSERT INTO release_artifacts (release_id, artifact_id, checksum_sha256) VALUES (?, ?, ?)").run(candidate.jobId, translation.id, translation.checksum_sha256);
        connection.prepare(`INSERT INTO jobs (id, type, revision_id, artifact_id, idempotency_key, dependency_hash,
          status, checkpoint_json, available_at, created_at, started_at, finished_at)
          VALUES (?, 'release', ?, NULL, ?, ?, 'completed', ?, ?, ?, ?, ?)`)
          .run(candidate.jobId, revisionId, `release:${candidate.manifestSha256}`, candidate.manifestSha256,
            JSON.stringify({ schemaVersion: 1, manifest }), manifest.publishedAt, manifest.publishedAt, manifest.publishedAt, manifest.buildCompletedAt);
      }
      for (const name of connection.prepare("SELECT id FROM articles").all().map(({ id }) => `deployment-${id}.json`)) {
        const statePath = join(statesRoot, name);
        // Deployment state is optional for drafts that were only previewed.
        let state; try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        if (!connection.prepare("SELECT 1 FROM releases WHERE id = ?").get(state.releaseJobId)) { skippedDeployments += 1; continue; }
        const id = `legacy:deploy:${state.releaseJobId}`; const receipt = state.receipt ?? {};
        if (state.status === "completed") {
          const deploymentId = new URL(receipt.url).hostname.split(".")[0];
          if (!deploymentId || !receipt.validatedAt) throw new Error(`legacy deployment receipt is invalid: ${state.releaseJobId}`);
          connection.prepare(`INSERT INTO deployments (id, release_id, status, cloudflare_deployment_id, immutable_url,
            verification_json, created_at, published_at, finished_at) VALUES (?, ?, 'published', ?, ?, ?, ?, ?, ?)`)
            .run(id, state.releaseJobId, deploymentId, receipt.url, JSON.stringify(receipt), state.createdAt, receipt.validatedAt, state.updatedAt);
        } else if (state.status === "failed") {
          connection.prepare(`INSERT INTO deployments (id, release_id, status, created_at, finished_at, error_message)
            VALUES (?, ?, 'failed', ?, ?, ?)`)
            .run(id, state.releaseJobId, state.createdAt, state.updatedAt, state.error ?? "legacy deployment failed");
        } else continue;
        deployments += 1;
      }
      return { releases: pending.length, deployments, skippedDeployments };
    });
    return { schemaVersion: 1, source: "legacy-json-releases", ...result, skippedReleases: preview.skipped, applied: true };
  } catch (error) {
    for (const path of createdPaths.reverse()) await rm(path, { force: false }).catch(() => {});
    throw error;
  } finally { closeDatabase(database); }
}
