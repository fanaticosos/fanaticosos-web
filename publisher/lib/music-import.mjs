import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { siteSettingsSchema } from "../../src/lib/siteSettingsSchema.mjs";
import { closeDatabase, openDatabase, withTransaction } from "./database.mjs";

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

export async function applyMusicImport({ databasePath, settingsPath, statesRoot, releasesRoot }) {
  const preview = await previewMusicImport({ databasePath, settingsPath, statesRoot, releasesRoot });
  const settingsBytes = await readFile(settingsPath); const settings = JSON.parse(settingsBytes);
  const publication = JSON.parse(await readFile(join(statesRoot, "music-publication.json"), "utf8"));
  const releaseRoot = join(releasesRoot, publication.jobId, "release");
  const manifestBytes = await readFile(join(releaseRoot, "release-manifest.json")); const manifest = JSON.parse(manifestBytes);
  const receipt = JSON.parse(await readFile(join(releasesRoot, publication.jobId, "cloudflare-production.json"), "utf8"));
  const database = await openDatabase(databasePath);
  try {
    return withTransaction(database, (connection) => {
      const existing = connection.prepare("SELECT manifest_checksum_sha256 FROM releases WHERE id=?").get(publication.jobId);
      if (existing) {
        if (existing.manifest_checksum_sha256 !== preview.manifestSha256) throw new Error("music import conflicts with SQLite");
        return { inserted: 0, unchanged: 1 };
      }
      const settingsId = `music:settings:${preview.settingsSha256}`; const validatedAt = manifest.buildCompletedAt ?? publication.updatedAt;
      connection.prepare("INSERT OR IGNORE INTO site_settings_revisions(id,settings_json,created_at) VALUES(?,?,?)")
        .run(settingsId, JSON.stringify(settings), publication.createdAt);
      connection.prepare(`INSERT INTO releases(id,catalog_id,site_settings_revision_id,status,path,manifest_json,manifest_checksum_sha256,created_at,validated_at)
        VALUES(?,?,?,'validated',?,?,?,?,?)`).run(publication.jobId, preview.catalogId, settingsId, releaseRoot,
          manifestBytes.toString("utf8"), preview.manifestSha256, publication.createdAt, validatedAt);
      connection.prepare(`INSERT INTO jobs(id,type,revision_id,artifact_id,idempotency_key,dependency_hash,status,checkpoint_json,available_at,created_at,started_at,finished_at)
        VALUES(?,'music_release',NULL,NULL,?,?,'completed',?,?,?,?,?)`).run(publication.jobId, `music:${preview.settingsSha256}`,
          preview.settingsSha256, JSON.stringify({ schemaVersion: 1, settings, manifest, receipt }), publication.createdAt,
          publication.createdAt, publication.createdAt, publication.updatedAt);
      const previous = connection.prepare("SELECT id FROM deployments WHERE status='published' ORDER BY published_at DESC,id DESC LIMIT 1").get();
      const deploymentId = `legacy:music-deploy:${publication.jobId}`; const cloudflareId = new URL(receipt.url).hostname.split(".")[0];
      connection.prepare(`INSERT INTO deployments(id,release_id,status,cloudflare_deployment_id,immutable_url,verification_json,previous_deployment_id,created_at,published_at,finished_at)
        VALUES(?,?,'published',?,?,?,?,?,?,?)`).run(deploymentId, publication.jobId, cloudflareId, receipt.url,
          JSON.stringify(receipt), previous?.id ?? null, publication.createdAt, receipt.validatedAt, publication.updatedAt);
      return { inserted: 1, unchanged: 0 };
    });
  } finally { closeDatabase(database); }
}
