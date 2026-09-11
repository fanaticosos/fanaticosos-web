import { startDatabaseAudiogram } from "./database-audiograms.mjs";
import { startDatabaseAudio } from "./database-audio.mjs";
import { startDatabaseDeployment } from "./database-deployments.mjs";
import { startDatabaseMusicPublication } from "./database-music.mjs";
import { startDatabaseRelease } from "./database-releases.mjs";
import { startDatabaseTranslation } from "./database-translations.mjs";

export function claimDatabaseJob(database, jobId, now = new Date()) {
  const row = database.prepare("SELECT type FROM jobs WHERE id = ?").get(jobId);
  if (!row) throw new Error("durable job was not found");
  const lease = (minutes) => new Date(now.getTime() + minutes * 60 * 1000);
  if (row.type === "translation") startDatabaseTranslation(database, jobId, "systemd", lease(35), now);
  else if (["tts_es", "tts_en"].includes(row.type)) startDatabaseAudio(database, jobId, "systemd", lease(35), now);
  else if (row.type === "audiogram") startDatabaseAudiogram(database, jobId, now);
  else if (row.type === "release") startDatabaseRelease(database, jobId, lease(30), now);
  else if (row.type === "music_release") startDatabaseMusicPublication(database, jobId, now);
  else if (row.type === "deployment") startDatabaseDeployment(database, jobId, now);
  else throw new Error(`unsupported durable job type: ${row.type}`);
  return { jobId, type: row.type, status: "leased" };
}
