import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { siteSettingsSchema } from "../../src/lib/siteSettingsSchema.mjs";

const JOB = /^release-[0-9a-f]{32}-r1-[0-9a-f]{8}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function previewMusicImport({ databasePath, settingsPath, statesRoot, releasesRoot }) {
  const settingsBytes = await readFile(settingsPath); const settings = siteSettingsSchema.parse(JSON.parse(settingsBytes));
  const publication = JSON.parse(await readFile(join(statesRoot, "music-publication.json"), "utf8"));
  if (publication.schemaVersion !== 1 || !JOB.test(publication.jobId ?? "") || publication.status !== "completed"
    || !Number.isFinite(Date.parse(publication.createdAt ?? "")) || !Number.isFinite(Date.parse(publication.updatedAt ?? ""))) throw new Error("legacy music publication is invalid");
  const root = join(releasesRoot, publication.jobId); const manifestBytes = await readFile(join(root, "release", "release-manifest.json")); const manifest = JSON.parse(manifestBytes);
  const receipt = JSON.parse(await readFile(join(root, "cloudflare-production.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.releaseKind !== "music" || receipt.schemaVersion !== 1 || receipt.environment !== "production"
    || receipt.jobId !== publication.jobId || receipt.url !== publication.deploymentUrl || !Number.isFinite(Date.parse(receipt.validatedAt ?? ""))) throw new Error("legacy music release evidence is invalid");
  if (!(await stat(join(root, "release", "dist", "index.html"))).isFile()) throw new Error("legacy music release output is missing");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys=ON");
    const existing = database.prepare("SELECT status FROM releases WHERE id=?").get(publication.jobId);
    const latest = database.prepare(`SELECT rel.catalog_id FROM deployments d JOIN releases rel ON rel.id=d.release_id
      WHERE d.status='published' ORDER BY d.published_at DESC,d.id DESC LIMIT 1`).get();
    if (!latest) throw new Error("SQLite has no published article catalog");
    return { settingsVersion: settings.version, weeklySongTitle: settings.music.weeklySong.title, settingsSha256: hash(settingsBytes),
      publicationJobId: publication.jobId, manifestSha256: hash(manifestBytes), deploymentUrl: receipt.url,
      alreadyImported: Boolean(existing), catalogId: latest.catalog_id };
  } finally { database.close(); }
}
