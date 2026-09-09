import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  const field = (name) => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { articleId: field("articleId"), status: field("status"), fixture: field("fixture") === "true" };
}

async function publishedCatalog(releaseRoot) {
  const directory = join(releaseRoot, "src", "content", "articles", "es");
  const ids = [];
  for (const name of (await readdir(directory)).filter((value) => value.endsWith(".md")).sort()) {
    const value = frontmatter(await readFile(join(directory, name), "utf8"));
    if (value.fixture || value.status !== "published") continue;
    if (basename(name, ".md") !== value.articleId) throw new Error("released article identity is invalid");
    ids.push(value.articleId);
  }
  return ids;
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
      releases.push({ articleId, draftRevision: state.draftRevision, jobId: state.jobId,
        manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
        catalogCount: catalog.length, missingCatalog, assets,
        action: database.prepare("SELECT 1 FROM releases WHERE id = ?").get(state.jobId) ? "unchanged" : "insert" });
    }
    return { schemaVersion: 1, source: "legacy-json-releases", total: releases.length,
      insert: releases.filter(({ action }) => action === "insert").length,
      unchanged: releases.filter(({ action }) => action === "unchanged").length,
      skipped: releases.filter(({ action }) => action === "skip-unretained").length,
      missingCatalog: releases.reduce((count, value) => count + (value.missingCatalog?.length ?? 0), 0),
      missingAudio: releases.reduce((count, value) => count + (value.assets
        ? [value.assets.esAudio, value.assets.enAudio].filter(({ inDatabase }) => !inDatabase).length : 0), 0),
      invalidImages: releases.filter(({ assets }) => assets?.image && !assets.image.verified).length,
      releases };
  } finally { database.close(); }
}
