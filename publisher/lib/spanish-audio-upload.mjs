import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ttsRequestsForDraft } from "./tts-jobs.mjs";

const execFileAsync = promisify(execFile);
export const MAX_SPANISH_AUDIO_BYTES = 100 * 1024 * 1024;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export async function saveSpanishAudio({ draft, translation, buffer, jobsRoot, statesRoot, policyRevision, now = new Date(), probe }) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) throw new Error("El MP3 en español está vacío o es demasiado pequeño.");
  if (buffer.length > MAX_SPANISH_AUDIO_BYTES) throw new Error("El MP3 en español supera el límite de 100 MB.");
  const requests = ttsRequestsForDraft(draft, translation);
  const jobId = `upload-es-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
  const audioDir = join(jobsRoot, jobId, "audio");
  await mkdir(audioDir, { recursive: true, mode: 0o700 });
  const file = `es-${draft.articleId}.mp3`;
  const path = join(audioDir, file);
  await writeFile(path, buffer, { mode: 0o600, flag: "wx" });
  let metadata;
  try {
    metadata = probe ? await probe(path) : JSON.parse((await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,sample_rate,channels", "-of", "json", path])).stdout);
  } catch {
    throw new Error("El archivo no es un MP3 válido.");
  }
  const stream = metadata.streams?.find((value) => value.codec_name === "mp3");
  const durationSeconds = Number(metadata.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("El archivo no es un MP3 válido.");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const result = { schemaVersion: 1, locale: "es", file, sizeBytes: buffer.length, sha256, durationSeconds, codec: "mp3", sampleRate: Number(stream.sample_rate) || null, channels: Number(stream.channels) || null, voice: "Audio proporcionado por el autor", engine: "MP3 uploaded", textHash: requests.es.sourceRevision, generatedAt: now.toISOString() };
  await atomicJson(join(audioDir, "result.json"), result);
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `audio-${draft.articleId}.json`);
  let existing = {};
  try { existing = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const englishCurrent = existing.draftRevision === draft.revision && existing.sourceRevisions?.en === requests.en.sourceRevision && existing.jobs?.en ? existing.jobs.en : { status: "not-started" };
  const completed = englishCurrent.status === "completed";
  const state = { ...existing, schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision, status: completed ? "completed" : "awaiting-english", workflow: completed ? "spanish-upload" : (existing.workflow || "manual"), regeneratedLocale: "es", createdAt: existing.createdAt || now.toISOString(), updatedAt: now.toISOString(), policyRevision, sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision }, jobs: { es: { jobId, status: "completed", result }, en: englishCurrent } };
  await atomicJson(statePath, state);
  return state;
}
